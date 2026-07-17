/**
 * Updater Page — Auto-Updater Panel & Rollback Engine
 * Fase 16: One-click updates, rollback, health check, schedule, history
 */

const UpdaterPage = (() => {
  let state = {
    versionInfo: null,
    updateInfo: null,
    history: null,
    backups: [],
    health: null,
    schedule: null,
    changelog: [],
  };

  // ── Initialization ──────────────────────────────────────────────
  async function init() {
    await LP.init();
    await loadAll();
  }

  async function loadAll() {
    await Promise.all([
      loadVersionInfo(),
      loadUpdateStatus(),
      loadChangelog(),
      loadHealth(),
      loadHistory(),
      loadBackups(),
      loadSchedule(),
    ]);
  }

  // ── Version Info ────────────────────────────────────────────────
  async function loadVersionInfo() {
    try {
      const res = await LP.get('/updater/version');
      if (res?.success) {
        state.versionInfo = res.data;
        const d = res.data;
        document.getElementById('ovCurrentVersion').textContent = d.current || '—';
        document.getElementById('ovCurrentBranch').innerHTML = `<span class="lp-badge lp-badge-ghost">${d.branch || 'main'}</span>`;
        document.getElementById('ovCurrentCommit').textContent = d.commit ? d.commit.substring(0, 12) + '...' : '—';
        document.getElementById('ovLastUpdated').textContent = 'Last update: ' + (d.lastUpdated ? new Date(d.lastUpdated).toLocaleString() : '—');
        document.getElementById('ovChannel').textContent = d.channel || 'stable';
        document.getElementById('ovNodeVersion').textContent = 'Node: ' + (d.nodeVersion || '—');
      }
    } catch (err) {
      console.error('Failed to load version info', err);
    }
  }

  // ── Update Status ──────────────────────────────────────────────
  async function loadUpdateStatus() {
    try {
      const res = await LP.get('/updater/check');
      if (res?.success) {
        state.updateInfo = res.data;
        const d = res.data;
        document.getElementById('ovLatestVersion').textContent = d.latest || '—';

        const statusEl = document.getElementById('ovUpdateStatus');
        const badgeEl = document.getElementById('updaterHealthBadge');

        if (d.hasUpdate) {
          statusEl.innerHTML = '<span class="lp-badge lp-badge-danger"><span class="lp-badge-dot"></span>Update Available!</span>';
          badgeEl.innerHTML = '<span class="lp-badge lp-badge-danger"><i class="bi bi-arrow-up-circle me-1"></i>Update: ' + d.latest + '</span>';
        } else {
          statusEl.innerHTML = '<span class="lp-badge lp-badge-success"><span class="lp-badge-dot"></span>Up to Date</span>';
          badgeEl.innerHTML = '<span class="lp-badge lp-badge-success"><i class="bi bi-check-circle me-1"></i>Up to Date</span>';
        }

        // Diff stats
        const diffCard = document.getElementById('ovDiffStatsCard');
        if (d.diffStats && d.diffStats.files > 0) {
          diffCard.style.display = 'block';
          document.getElementById('ovDiffFiles').textContent = d.diffStats.files + ' files';
          document.getElementById('ovDiffInsertions').textContent = '+' + d.diffStats.insertions;
          document.getElementById('ovDiffDeletions').textContent = '-' + d.diffStats.deletions;
          document.getElementById('ovBehindCount').textContent = d.behindCount + ' commits behind';
        } else {
          diffCard.style.display = d.hasUpdate ? 'block' : 'none';
          if (d.hasUpdate) {
            document.getElementById('ovBehindCount').textContent = d.behindCount + ' commits behind';
          }
        }
      }
    } catch (err) {
      console.error('Failed to load update status', err);
    }
  }

  // ── Changelog ──────────────────────────────────────────────────
  async function loadChangelog() {
    try {
      const res = await LP.get('/updater/changelog?limit=30');
      if (res?.success && res.data?.entries) {
        state.changelog = res.data.entries;
        renderChangelog(res.data.entries);
      }
    } catch (err) {
      console.error('Failed to load changelog', err);
    }
  }

  function renderChangelog(entries) {
    const loading = document.getElementById('ovChangelogLoading');
    const content = document.getElementById('ovChangelogContent');

    if (loading) loading.style.display = 'none';
    if (!content) return;

    content.style.display = 'block';

    if (!entries || entries.length === 0) {
      content.innerHTML = '<div style="padding:12px;color:var(--text-muted);text-align:center;">No commit history available</div>';
      return;
    }

    content.innerHTML = entries.map(e => {
      const shortHash = e.hash ? e.hash.substring(0, 8) : '????';
      return `<div style="display:flex;gap:10px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:12px;line-height:1.5;">
        <code style="color:var(--accent-warning);font-family:monospace;white-space:nowrap;min-width:70px;">${shortHash}</code>
        <span style="color:var(--text-secondary);">${LP.escapeHtml(e.message)}</span>
      </div>`;
    }).join('');
  }

  async function refreshChangelog() {
    await loadChangelog();
    LP.toast('Changelog refreshed', 'success');
  }

  // ── Health Check ───────────────────────────────────────────────
  async function loadHealth() {
    try {
      const res = await LP.get('/updater/health');
      if (res?.success) {
        state.health = res.data;
        renderHealth(res.data);
      }
    } catch (err) {
      console.error('Failed to load health', err);
    }
  }

  function renderHealth(data) {
    const container = document.getElementById('ovHealthContainer');
    const schContainer = document.getElementById('schHealthResults');

    if (!data || !data.results) {
      const html = '<div style="text-align:center;padding:15px;color:var(--text-muted);">No health data available</div>';
      if (container) container.innerHTML = html;
      if (schContainer) schContainer.innerHTML = html;
      return;
    }

    const overallColor = data.overall === 'healthy' ? 'var(--accent-success)' : (data.overall === 'degraded' ? 'var(--accent-warning)' : 'var(--accent-danger)');
    const overallIcon = data.overall === 'healthy' ? 'bi-check-circle-fill' : (data.overall === 'degraded' ? 'bi-exclamation-circle-fill' : 'bi-x-circle-fill');

    const itemsHtml = data.results.map(r => {
      const statusColor = r.status === 'ok' ? 'var(--accent-success)' : (r.status === 'warn' ? 'var(--accent-warning)' : 'var(--accent-danger)');
      const statusIcon = r.status === 'ok' ? 'bi-check-circle' : (r.status === 'warn' ? 'bi-exclamation-circle' : 'bi-x-circle');
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
        <span style="font-size:12px;color:var(--text-secondary);">${r.name}</span>
        <span style="font-size:12px;color:${statusColor};">
          <i class="bi ${statusIcon} me-1"></i> <span title="${LP.escapeHtml(r.detail || '')}">${r.status}</span>
        </span>
      </div>`;
    }).join('');

    const html = `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:rgba(0,0,0,0.15);border-radius:8px;margin-bottom:10px;">
        <i class="bi ${overallIcon}" style="color:${overallColor};font-size:16px;"></i>
        <span style="font-weight:600;text-transform:uppercase;font-size:12px;color:${overallColor};">${data.overall}</span>
        <span style="font-size:11px;color:var(--text-muted);margin-left:auto;">${new Date(data.timestamp).toLocaleTimeString()}</span>
      </div>
      ${itemsHtml}
    `;

    if (container) container.innerHTML = html;
    if (schContainer) schContainer.innerHTML = html;

    // Update uptime
    const uptimeEl = document.getElementById('ovUptime');
    if (uptimeEl && data.uptime) uptimeEl.textContent = data.uptime;

    const restartEl = document.getElementById('ovLastRestart');
    if (restartEl) {
      restartEl.textContent = data.lastRestart ? new Date(data.lastRestart).toLocaleString() : '—';
    }
  }

  async function refreshHealth() {
    await loadHealth();
    LP.toast('Health check completed', 'success');
  }

  // ── History ────────────────────────────────────────────────────
  async function loadHistory() {
    try {
      const res = await LP.get('/updater/history');
      if (res?.success) {
        state.history = res.data;
        renderHistory(res.data);
      }
    } catch (err) {
      console.error('Failed to load history', err);
    }
  }

  function renderHistory(data) {
    const container = document.getElementById('historyContent');
    if (!container) return;

    const updates = data?.updates || [];

    if (updates.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted);"><i class="bi bi-inbox" style="font-size:32px;display:block;margin-bottom:10px;"></i>No update history yet</div>';
      return;
    }

    container.innerHTML = updates.map(entry => {
      const statusColor = entry.status === 'success' ? 'var(--accent-success)' : (entry.status === 'failed_rolled_back' ? 'var(--accent-warning)' : 'var(--accent-danger)');
      const statusIcon = entry.status === 'success' ? 'bi-check-circle-fill' : (entry.status === 'failed_rolled_back' ? 'bi-arrow-counterclockwise' : 'bi-x-circle-fill');
      const typeIcon = entry.type === 'rollback' ? 'bi-arrow-counterclockwise' : 'bi-cloud-download';
      const typeColor = entry.type === 'rollback' ? 'var(--accent-warning)' : 'var(--accent-primary)';

      const fromVer = entry.fromVersion || '—';
      const toVer = entry.toVersion || '—';
      const fromHash = entry.previousCommit ? entry.previousCommit.substring(0, 8) : '';
      const toHash = entry.newCommit ? entry.newCommit.substring(0, 8) : '';

      const ts = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '—';

      return `<div style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:6px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <i class="bi ${typeIcon}" style="color:${typeColor};font-size:16px;"></i>
            <span style="font-weight:600;font-size:13px;text-transform:capitalize;color:var(--text-primary);">${entry.type}</span>
            <span class="lp-badge" style="background:${statusColor}20;color:${statusColor};border:1px solid ${statusColor}40;font-size:10px;">${entry.status.replace(/_/g, ' ')}</span>
          </div>
          <span style="font-size:11px;color:var(--text-muted);font-family:monospace;">${ts}</span>
        </div>
        <div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">
          ${fromVer !== toVer ? `<span>${fromVer} → ${toVer}</span>` : ''}
          ${fromHash ? `<code style="color:var(--accent-warning);font-family:monospace;margin-left:8px;">${fromHash}</code>` : ''}
          ${toHash && toHash !== fromHash ? `<span style="color:var(--text-muted);margin:0 4px;">→</span><code style="color:var(--accent-primary);font-family:monospace;">${toHash}</code>` : ''}
          ${entry.branch ? `<span class="lp-badge lp-badge-ghost" style="font-size:9px;margin-left:6px;">${entry.branch}</span>` : ''}
          ${entry.channel ? `<span class="lp-badge lp-badge-ghost" style="font-size:9px;">${entry.channel}</span>` : ''}
        </div>
        ${entry.log ? `<div style="margin-top:4px;">
          <button class="btn-lp btn-lp-ghost btn-lp-sm" style="font-size:10px;padding:2px 6px;" onclick="UpdaterPage.toggleHistoryLog(this)">Show Log</button>
          <pre style="display:none;margin-top:6px;padding:8px;background:rgba(0,0,0,0.2);border-radius:6px;font-family:monospace;font-size:11px;color:var(--text-secondary);max-height:150px;overflow-y:auto;white-space:pre-wrap;">${LP.escapeHtml(entry.log)}</pre>
        </div>` : ''}
      </div>`;
    }).join('');
  }

  function toggleHistoryLog(btn) {
    const pre = btn.nextElementSibling;
    if (pre) {
      const isHidden = pre.style.display === 'none' || !pre.style.display;
      pre.style.display = isHidden ? 'block' : 'none';
      btn.textContent = isHidden ? 'Hide Log' : 'Show Log';
    }
  }

  async function refreshHistory() {
    await loadHistory();
    LP.toast('History refreshed', 'success');
  }

  async function clearHistory() {
    if (!(await LP.confirm('Clear all update history entries? This cannot be undone.', 'Clear History'))) return;
    try {
      const res = await LP.delete('/updater/history');
      if (res?.success) {
        LP.toast('History cleared', 'success');
        await loadHistory();
      }
    } catch (err) {
      LP.toast('Failed to clear history', 'error');
    }
  }

  // ── Backups ─────────────────────────────────────────────────────
  async function loadBackups() {
    try {
      const res = await LP.get('/updater/backups');
      if (res?.success) {
        state.backups = res.data || [];
        renderBackups(res.data || []);
        populateBackupSelect(res.data || []);
      }
    } catch (err) {
      console.error('Failed to load backups', err);
    }
  }

  function renderBackups(backups) {
    const container = document.getElementById('rbBackupList');
    if (!container) return;

    if (!backups || backups.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:12px;color:var(--text-muted);font-size:12px;">No backups yet. Create one before updating.</div>';
      return;
    }

    container.innerHTML = backups.map(b => {
      const size = b.size ? formatSize(b.size) : '?';
      const ts = b.createdAt ? new Date(b.createdAt).toLocaleString() : '—';
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:12px;">
        <div>
          <div style="color:var(--text-primary);font-weight:500;">${LP.escapeHtml(b.name)}</div>
          <div style="color:var(--text-muted);font-size:10px;">${ts} · ${size}</div>
        </div>
        <span class="lp-badge lp-badge-success" style="font-size:9px;">${b.type || 'backup'}</span>
      </div>`;
    }).join('');
  }

  function populateBackupSelect(backups) {
    const select = document.getElementById('rbBackupSelect');
    if (!select) return;

    if (!backups || backups.length === 0) {
      select.innerHTML = '<option value="">No backups available</option>';
      return;
    }

    select.innerHTML = backups.map(b =>
      `<option value="${LP.escapeHtml(b.name)}">${LP.escapeHtml(b.name)} (${b.size ? formatSize(b.size) : '?'})</option>`
    ).join('');
  }

  async function createBackup() {
    const btn = document.getElementById('btnCreateBackup');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Creating...'; }

    try {
      const res = await LP.post('/updater/backups');
      if (res?.success) {
        LP.toast('Backup created successfully!', 'success');
        await loadBackups();
      } else {
        LP.toast(res?.message || 'Backup failed', 'error');
      }
    } catch (err) {
      LP.toast('Failed to create backup', 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-plus-circle me-1"></i> Backup Now'; }
    }
  }

  // ── Schedule ────────────────────────────────────────────────────
  async function loadSchedule() {
    try {
      const res = await LP.get('/updater/schedule');
      if (res?.success) {
        state.schedule = res.data;
        const d = res.data;
        document.getElementById('schEnabled').checked = d.enabled || false;
        document.getElementById('schFreq').value = d.frequency || 'daily';
        document.getElementById('schTime').value = d.time || '03:00';
        document.getElementById('schBranch').value = d.branch || 'main';
        document.getElementById('schChannel').value = d.channel || 'stable';
        document.getElementById('schMaxBackups').value = d.maxBackups || 5;
        document.getElementById('schHealthTimeout').value = d.healthCheckTimeout || 60;
      }
    } catch (err) {
      console.error('Failed to load schedule', err);
    }
  }

  async function saveSchedule() {
    const config = {
      enabled: document.getElementById('schEnabled').checked,
      frequency: document.getElementById('schFreq').value,
      time: document.getElementById('schTime').value,
      branch: document.getElementById('schBranch').value,
      channel: document.getElementById('schChannel').value,
      maxBackups: parseInt(document.getElementById('schMaxBackups').value) || 5,
      healthCheckTimeout: parseInt(document.getElementById('schHealthTimeout').value) || 60,
    };

    try {
      const res = await LP.post('/updater/schedule', config);
      if (res?.success) {
        LP.toast('Schedule configuration saved', 'success');
        state.schedule = config;
      } else {
        LP.toast(res?.message || 'Failed to save schedule', 'error');
      }
    } catch (err) {
      LP.toast('Failed to save schedule', 'error');
    }
  }

  // ── Update Actions ──────────────────────────────────────────────
  async function refreshUpdateStatus() {
    document.getElementById('upLog').textContent = 'Checking for updates...\n';
    await loadUpdateStatus();
    document.getElementById('upLog').textContent += '✅ Check completed.\n';
  }

  function showUpdateConfirm() {
    const method = document.getElementById('upMethod').value;
    const branch = document.getElementById('upBranch').value;
    const channel = document.getElementById('upChannel').value;

    const details = document.getElementById('upConfirmDetails');
    details.innerHTML = `
      <table style="font-size:12px;width:100%;">
        <tr><td style="padding:4px 8px;color:var(--text-muted);">Method</td><td style="padding:4px 8px;color:var(--text-primary);font-weight:600;">${method}</td></tr>
        <tr><td style="padding:4px 8px;color:var(--text-muted);">Branch</td><td style="padding:4px 8px;color:var(--text-primary);font-weight:600;">${branch}</td></tr>
        <tr><td style="padding:4px 8px;color:var(--text-muted);">Channel</td><td style="padding:4px 8px;color:var(--text-primary);font-weight:600;">${channel}</td></tr>
      </table>
    `;

    const modal = new bootstrap.Modal(document.getElementById('updateConfirmModal'));
    modal.show();
  }

  async function runUpdate() {
    showUpdateConfirm();
  }

  async function confirmUpdate() {
    const method = document.getElementById('upMethod').value;
    const branch = document.getElementById('upBranch').value;
    const channel = document.getElementById('upChannel').value;

    document.getElementById('btnConfirmUpdate').disabled = true;
    document.getElementById('btnConfirmUpdate').innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Updating...';
    bootstrap.Modal.getInstance(document.getElementById('updateConfirmModal')).hide();

    const btn = document.getElementById('btnUpdate');
    btn.innerHTML = '<i class="bi bi-arrow-repeat spin me-1"></i> Updating...';
    btn.disabled = true;

    const logEl = document.getElementById('upLog');
    logEl.textContent = `Starting update on ${branch} (${channel}) via ${method}...\n`;

    try {
      const res = await LP.post('/updater/update', { method, branch, channel });
      if (res?.success) {
        logEl.textContent += res.data?.log || 'Update completed.\n';

        if (res.data?.rollback) {
          logEl.textContent += '\n⚠️ Update failed and was rolled back automatically.';
          LP.toast('Update failed, rolled back', 'warning');
        } else {
          logEl.textContent += '\n✅ Update completed! Waiting for panel to restart...';
          LP.toast('Update completed! Panel restarting...', 'success');
          startReconnectPolling(logEl);
        }
      } else {
        logEl.textContent += `\n❌ Error: ${res?.message || 'Unknown error'}`;
        LP.toast(res?.message || 'Update failed', 'error');
        btn.innerHTML = '<i class="bi bi-cloud-download me-1"></i> Update Panel';
        btn.disabled = false;
      }
    } catch (err) {
      logEl.textContent += `\n❌ Connection error: ${err.message}`;
      LP.toast('Connection error during update', 'error');
      btn.innerHTML = '<i class="bi bi-cloud-download me-1"></i> Update Panel';
      btn.disabled = false;
    } finally {
      document.getElementById('btnConfirmUpdate').disabled = false;
      document.getElementById('btnConfirmUpdate').innerHTML = '<i class="bi bi-cloud-download me-1"></i> Start Update';
    }
  }

  // ── Dry Run ─────────────────────────────────────────────────────
  async function dryRunUpdate() {
    const method = document.getElementById('upMethod').value;
    const branch = document.getElementById('upBranch').value;
    const channel = document.getElementById('upChannel').value;

    const btn = document.getElementById('btnDryRun');
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Simulating...';
    btn.disabled = true;

    const logEl = document.getElementById('upLog');
    logEl.textContent = `Dry run: simulating update on ${branch} (${channel}) via ${method}...\n`;

    try {
      const res = await LP.post('/updater/dry-run', { method, branch, channel });
      if (res?.success) {
        logEl.textContent += res.data?.log || 'Dry run completed.\n';
        logEl.textContent += '\n✅ Dry run completed — no changes were applied.';
        LP.toast('Dry run completed', 'success');
      } else {
        logEl.textContent += `\n❌ ${res?.message || 'Dry run failed'}`;
      }
    } catch (err) {
      logEl.textContent += `\n❌ Error: ${err.message}`;
    } finally {
      btn.innerHTML = '<i class="bi bi-eye me-1"></i> Dry Run';
      btn.disabled = false;
    }
  }

  // ── Rollback ────────────────────────────────────────────────────
  function toggleRollbackMethod() {
    const method = document.getElementById('rbMethod').value;
    document.getElementById('rbCommitGroup').style.display = method === 'commit' ? 'block' : 'none';
    document.getElementById('rbBackupGroup').style.display = method === 'backup' ? 'block' : 'none';
  }

  async function runRollback() {
    const method = document.getElementById('rbMethod').value;
    const commit = document.getElementById('rbCommit').value.trim();
    const backup = document.getElementById('rbBackupSelect').value;

    if (method === 'commit' && !commit) {
      LP.toast('Please enter a commit hash', 'error');
      return;
    }
    if (method === 'backup' && (!backup || backup === '')) {
      LP.toast('Please select a backup', 'error');
      return;
    }

    // Show confirmation
    const details = document.getElementById('rbConfirmDetails');
    if (method === 'commit') {
      details.innerHTML = `<li>Type: Git Rollback</li><li>Commit: <code style="color:var(--accent-warning);">${LP.escapeHtml(commit)}</code></li>`;
    } else {
      details.innerHTML = `<li>Type: Backup Restore</li><li>Backup: <code style="color:var(--accent-warning);">${LP.escapeHtml(backup)}</code></li>`;
    }

    const confirmBtn = document.getElementById('btnConfirmRollback');
    confirmBtn.dataset.method = method;
    confirmBtn.dataset.commit = commit;
    confirmBtn.dataset.backup = backup;

    const modal = new bootstrap.Modal(document.getElementById('rollbackConfirmModal'));
    modal.show();
  }

  async function confirmRollback() {
    const btn = document.getElementById('btnConfirmRollback');
    const method = btn.dataset.method;
    const commit = btn.dataset.commit;
    const backup = btn.dataset.backup;

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Rolling back...';
    bootstrap.Modal.getInstance(document.getElementById('rollbackConfirmModal')).hide();

    const logEl = document.getElementById('rbLog');
    logEl.style.display = 'block';
    logEl.textContent = 'Rolling back...\n';

    try {
      const payload = method === 'commit' ? { commit } : { restoreBackup: backup };
      const res = await LP.post('/updater/rollback', payload);
      if (res?.success) {
        logEl.textContent += res.data?.log || 'Rollback completed.\n';
        logEl.textContent += '\n✅ Panel restarting...';
        LP.toast('Rollback completed! Panel restarting...', 'success');
        startReconnectPolling(logEl);
      } else {
        logEl.textContent += `\n❌ ${res?.message || 'Rollback failed'}`;
        LP.toast(res?.message || 'Rollback failed', 'error');
      }
    } catch (err) {
      logEl.textContent += `\n❌ Error: ${err.message}`;
      LP.toast('Rollback connection error', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-arrow-counterclockwise me-1"></i> Execute Rollback';
      await loadAll();
    }
  }

  // ── Diff Preview ────────────────────────────────────────────────
  async function showDiffPreview() {
    const modal = new bootstrap.Modal(document.getElementById('diffModal'));
    document.getElementById('diffPreviewContent').textContent = 'Loading diff...';
    modal.show();

    try {
      const res = await LP.get('/updater/diff');
      if (res?.success) {
        document.getElementById('diffPreviewContent').textContent = res.data?.diff || 'No diff available';
      } else {
        document.getElementById('diffPreviewContent').textContent = 'Failed to load diff';
      }
    } catch (err) {
      document.getElementById('diffPreviewContent').textContent = 'Error: ' + err.message;
    }
  }

  // ── Reconnect Polling ───────────────────────────────────────────
  function startReconnectPolling(logEl) {
    const maxWait = 60000;
    const interval = 2000;
    const start = Date.now();
    let dots = 0;

    const poll = setInterval(async () => {
      dots++;
      const elapsed = Math.round((Date.now() - start) / 1000);

      if (Date.now() - start > maxWait) {
        clearInterval(poll);
        if (logEl) logEl.textContent += `\n❌ Server did not come back online after ${maxWait / 1000}s. Please check PM2/server logs.`;
        return;
      }

      try {
        const r = await fetch('/api/health', { signal: AbortSignal.timeout(3000) });
        if (r.ok) {
          clearInterval(poll);
          if (logEl) logEl.textContent += `\n✅ Panel is back online after ${elapsed}s! Reloading...`;
          setTimeout(() => window.location.reload(), 800);
        }
      } catch {
        if (logEl) {
          const lastNl = logEl.textContent.lastIndexOf('\n');
          const base = logEl.textContent.substring(0, lastNl + 1);
          logEl.textContent = base + `🔄 Waiting for restart... ${elapsed}s`;
          logEl.scrollTop = logEl.scrollHeight;
        }
      }
    }, interval);
  }

  // ── Helpers ─────────────────────────────────────────────────────
  function formatSize(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let size = bytes;
    while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
    return `${size.toFixed(1)} ${units[i]}`;
  }

  // ── Public API ──────────────────────────────────────────────────
  return {
    init,
    refreshChangelog,
    refreshHealth,
    refreshHistory,
    clearHistory,
    refreshUpdateStatus,
    runUpdate,
    confirmUpdate,
    dryRunUpdate,
    toggleRollbackMethod,
    runRollback,
    confirmRollback,
    showDiffPreview,
    saveSchedule,
    createBackup,
    toggleHistoryLog,
    createPreUpdateBackup: createBackup,
  };
})();

document.addEventListener('DOMContentLoaded', () => {
  UpdaterPage.init();
});
