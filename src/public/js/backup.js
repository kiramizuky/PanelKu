/**
 * Panelku — backup.js
 * Backup & Disaster Recovery frontend
 */

const BackupPage = {
  createJobBsModal: null,
  createLocalBsModal: null,
  jobLogBsModal: null,

  async init() {
    await LP.init();
    if (!LP.state.accessToken) return;
    this.createJobBsModal = new bootstrap.Modal(document.getElementById('createJobModal'));
    this.createLocalBsModal = new bootstrap.Modal(document.getElementById('createLocalBackupModal'));
    this.jobLogBsModal = new bootstrap.Modal(document.getElementById('jobLogModal'));
    this.refresh();
  },

  async refresh() {
    await Promise.all([
      this.loadOverview(),
      this.loadJobs(),
      this.loadLocalBackups(),
      this.loadRcloneStatus(),
      this.loadS3Config(),
      this.loadDRRemotes(),
    ]);
  },

  // ── Tab Switching ────────────────────────────────────

  switchTab(tabId) {
    document.querySelectorAll('.bkp-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.bkp-tab-content').forEach(t => t.classList.remove('active'));

    const tabBtn = document.querySelector(`.bkp-tab[data-tab="${tabId}"]`);
    if (tabBtn) tabBtn.classList.add('active');

    const tabContent = document.getElementById(`tab-${tabId}`);
    if (tabContent) tabContent.classList.add('active');
  },

  // ══════════════════════════════════════════════════════
  //  OVERVIEW
  // ══════════════════════════════════════════════════════

  async loadOverview() {
    try {
      const [rcloneRes, jobsRes, localRes, s3Res] = await Promise.all([
        LP.get('/backup/rclone'),
        LP.get('/backup/jobs'),
        LP.get('/backup'),
        LP.get('/backup/s3'),
      ]);

      // Status cards
      if (rcloneRes?.success) {
        const r = rcloneRes.data?.status;
        document.getElementById('bkpRcloneStatus').innerHTML = r?.installed
          ? '<span style="color:#10b981;">✓ Installed</span>'
          : '<span style="color:#ef4444;">Not installed</span>';
      }

      if (jobsRes?.success) {
        const j = jobsRes.data?.jobs || [];
        document.getElementById('bkpJobCount').textContent = `${j.length} jobs`;
      }

      if (localRes?.success) {
        const b = localRes.data || [];
        document.getElementById('bkpLocalCount').textContent = `${b.length} files`;
      }

      if (s3Res?.success) {
        const s3 = s3Res.data;
        document.getElementById('bkpS3Status').innerHTML = s3?.enabled
          ? '<span style="color:#10b981;">✓ Active</span>'
          : '<span style="color:#6b7280;">Not set</span>';
      }

      // Overview tab details
      if (rcloneRes?.success) {
        const r = rcloneRes.data?.status;
        document.getElementById('ovRcloneInstalled').innerHTML = r?.installed
          ? '<span style="color:#10b981;">✓ Installed</span>'
          : '<span class="text-danger">✗ Not installed</span>';
        document.getElementById('ovRcloneVersion').textContent = r?.version || 'N/A';
        document.getElementById('ovRcloneRemotes').textContent = (r?.remotes?.length || 0) + ' configured';
        document.getElementById('ovRcloneConfig').textContent = r?.configPath || 'N/A';
      }

      // Backup Health
      const healthEl = document.getElementById('ovBackupHealth');
      const jobs = jobsRes?.success ? (jobsRes.data?.jobs || []) : [];
      if (jobs.length === 0) {
        healthEl.innerHTML = '<div style="padding:10px 0;color:var(--text-muted);font-size:13px;">No backup jobs configured. <a href="#" onclick="BackupPage.switchTab(\'jobs\')" style="color:var(--accent-primary);">Create one now</a>.</div>';
      } else {
        const successCount = jobs.filter(j => j.lastStatus === 'success').length;
        const failedCount = jobs.filter(j => j.lastStatus === 'failed').length;
        const pendingCount = jobs.filter(j => !j.lastStatus).length;
        healthEl.innerHTML = `
          <div style="display:flex;gap:20px;flex-wrap:wrap;">
            <div style="text-align:center;padding:10px 15px;background:rgba(16,185,129,0.08);border-radius:10px;flex:1;">
              <div style="font-size:24px;font-weight:700;color:#10b981;">${successCount}</div>
              <div style="font-size:11px;color:var(--text-muted);">Successful</div>
            </div>
            <div style="text-align:center;padding:10px 15px;background:rgba(239,68,68,0.08);border-radius:10px;flex:1;">
              <div style="font-size:24px;font-weight:700;color:#ef4444;">${failedCount}</div>
              <div style="font-size:11px;color:var(--text-muted);">Failed</div>
            </div>
            <div style="text-align:center;padding:10px 15px;background:rgba(107,114,128,0.08);border-radius:10px;flex:1;">
              <div style="font-size:24px;font-weight:700;color:#6b7280;">${pendingCount}</div>
              <div style="font-size:11px;color:var(--text-muted);">Pending</div>
            </div>
          </div>
        `;
      }

      // Recent Jobs
      const recentEl = document.getElementById('ovRecentJobs');
      if (jobs.length === 0) {
        recentEl.innerHTML = '<div style="padding:10px;color:var(--text-muted);font-size:13px;">No backup jobs yet.</div>';
      } else {
        const recent = jobs.slice(0, 5);
        recentEl.innerHTML = recent.map(j => {
          const statusIcon = j.lastStatus === 'success' ? 'bi-check-circle-fill text-success' :
            j.lastStatus === 'failed' ? 'bi-x-circle-fill text-danger' : 'bi-hourglass text-muted';
          return `
            <div class="d-flex justify-content-between align-items-center py-2" style="border-bottom:1px solid rgba(255,255,255,0.04);">
              <div>
                <i class="bi ${statusIcon} me-2"></i>
                <strong style="font-size:13px;">${LP.escHtml(j.name)}</strong>
                <span style="font-size:11px;color:var(--text-muted);margin-left:8px;">
                  ${j.lastRun ? new Date(j.lastRun).toLocaleString() : 'Never run'}
                </span>
              </div>
              <span class="lp-badge ${j.enabled ? 'lp-badge-success' : 'lp-badge-warning'}" style="font-size:9px;">
                ${j.enabled ? 'Active' : 'Paused'}
              </span>
            </div>
          `;
        }).join('');
      }
    } catch (err) {
      console.error('Overview error:', err);
    }
  },

  // ══════════════════════════════════════════════════════
  //  BACKUP JOBS
  // ══════════════════════════════════════════════════════

  async loadJobs() {
    try {
      const res = await LP.get('/backup/jobs');
      if (!res?.success) throw new Error(res?.message);

      const jobs = res.data?.jobs || [];
      const container = document.getElementById('jobsListContainer');

      if (jobs.length === 0) {
        container.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text-muted);font-size:13px;">No backup jobs. Click "New Job" to create one.</div>';
        return;
      }

      container.innerHTML = jobs.map(j => {
        const statusIcon = j.lastStatus === 'success' ? 'bi-check-circle-fill text-success' :
          j.lastStatus === 'failed' ? 'bi-x-circle-fill text-danger' : 'bi-hourglass text-muted';
        return `
          <div class="p-3 rounded mb-2" style="background:rgba(0,0,0,0.1);border:1px solid var(--glass-border);">
            <div class="d-flex justify-content-between align-items-start mb-2">
              <div>
                <strong style="font-size:14px;color:var(--text-primary);">
                  <i class="bi ${statusIcon} me-1"></i> ${LP.escHtml(j.name)}
                </strong>
                <span class="lp-badge ${j.enabled ? 'lp-badge-success' : 'lp-badge-warning'}" style="font-size:9px;margin-left:8px;">
                  ${j.enabled ? 'Active' : 'Paused'}
                </span>
              </div>
              <div style="display:flex;gap:5px;">
                <button class="btn-lp btn-lp-ghost btn-lp-sm text-primary" onclick="BackupPage.runJob('${j.id}')" title="Run Now">
                  <i class="bi bi-play-fill"></i>
                </button>
                <button class="btn-lp btn-lp-ghost btn-lp-sm ${j.lastOutput ? 'text-info' : 'text-muted'}" onclick="BackupPage.showJobLog('${LP.encJsArg(j.name)}', '${LP.encJsArg(j.lastOutput || 'No output')}')" title="View Log">
                  <i class="bi bi-journal-text"></i>
                </button>
                <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="BackupPage.deleteJob('${j.id}', '${LP.encJsArg(j.name)}')" title="Delete">
                  <i class="bi bi-trash"></i>
                </button>
              </div>
            </div>
            <div style="font-size:12px;color:var(--text-muted);display:flex;flex-wrap:wrap;gap:15px;">
              <span><strong>Source:</strong> <code>${LP.escHtml(j.source)}</code></span>
              <span><strong>Dest:</strong> <code>${LP.escHtml(j.remote)}:${LP.escHtml(j.destPath)}</code></span>
              <span><strong>Type:</strong> ${j.type || 'sync'}</span>
              <span><strong>Schedule:</strong> <code>${LP.escHtml(j.schedule)}</code></span>
              ${j.retention ? `<span><strong>Retention:</strong> ${j.retention} copies</span>` : ''}
            </div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:6px;">
              <strong>Last Run:</strong> ${j.lastRun ? new Date(j.lastRun).toLocaleString() : 'Never'} &middot;
              <strong>Status:</strong> ${j.lastStatus ? `<span style="color:${j.lastStatus === 'success' ? '#10b981' : '#ef4444'};">${j.lastStatus.toUpperCase()}</span>` : 'N/A'}
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      document.getElementById('jobsListContainer').innerHTML =
        `<div style="padding:20px;text-align:center;color:var(--accent-danger);">Error: ${LP.escHtml(err.message)}</div>`;
    }
  },

  showCreateJobModal() {
    document.getElementById('cjName').value = '';
    document.getElementById('cjSource').value = '';
    document.getElementById('cjDestPath').value = 'backups';
    document.getElementById('cjType').value = 'sync';
    document.getElementById('cjSchedule').value = '0 2 * * *';
    document.getElementById('cjRetention').value = '7';
    document.getElementById('cjExclude').value = '';
    this._populateJobRemoteSelect();
    this.createJobBsModal.show();
  },

  async _populateJobRemoteSelect() {
    const select = document.getElementById('cjRemote');
    try {
      const res = await LP.get('/backup/rclone');
      const remotes = res?.data?.status?.remotes || [];
      if (remotes.length === 0) {
        select.innerHTML = '<option value="">No remotes configured</option>';
        return;
      }
      select.innerHTML = remotes.map(r => `<option value="${LP.escHtml(r)}">${LP.escHtml(r)}</option>`).join('');
    } catch {
      select.innerHTML = '<option value="">Failed to load remotes</option>';
    }
  },

  async createJob() {
    const name = document.getElementById('cjName').value.trim();
    const source = document.getElementById('cjSource').value.trim();
    const remote = document.getElementById('cjRemote').value;
    const destPath = document.getElementById('cjDestPath').value.trim();
    const type = document.getElementById('cjType').value;
    const schedule = document.getElementById('cjSchedule').value.trim();
    const retention = parseInt(document.getElementById('cjRetention').value) || 0;
    const excludeRaw = document.getElementById('cjExclude').value.trim();
    const excludePatterns = excludeRaw ? excludeRaw.split('\n').filter(Boolean).map(s => s.trim()) : [];

    if (!name || !source || !remote) {
      LP.toast('Name, source, and remote are required', 'error');
      return;
    }

    try {
      const res = await LP.post('/backup/jobs', { name, source, remote, destPath, type, schedule, retention, excludePatterns });
      if (res?.success) {
        LP.toast('Backup job created!', 'success');
        this.createJobBsModal.hide();
        this.loadJobs();
        this.loadOverview();
      } else {
        LP.toast(res?.message || 'Failed to create job', 'error');
      }
    } catch (err) {
      LP.toast('Error creating job: ' + err.message, 'error');
    }
  },

  async runJob(id) {
    try {
      const res = await LP.post(`/backup/jobs/${id}/run`);
      if (res?.success) {
        LP.toast(res.message || 'Backup completed!', 'success');
        this.loadJobs();
        this.loadOverview();
      } else {
        LP.toast(res?.message || 'Backup failed', 'error');
      }
    } catch (err) {
      LP.toast('Error running job: ' + err.message, 'error');
    }
  },

  async deleteJob(id, name) {
    if (!(await LP.confirm(`Delete backup job <strong>${LP.escHtml(name)}</strong>?`, 'Delete Job'))) return;
    try {
      const res = await LP.del(`/backup/jobs/${id}`);
      if (res?.success) {
        LP.toast('Job deleted', 'success');
        this.loadJobs();
        this.loadOverview();
      } else {
        LP.toast(res?.message || 'Failed to delete job', 'error');
      }
    } catch {
      LP.toast('Error deleting job', 'error');
    }
  },

  showJobLog(name, output) {
    document.getElementById('jobLogModalTitle').textContent = `Output: ${name}`;
    document.getElementById('jobLogArea').textContent = output || '[No output]';
    this.jobLogBsModal.show();
  },

  // ══════════════════════════════════════════════════════
  //  LOCAL BACKUPS
  // ══════════════════════════════════════════════════════

  async loadLocalBackups() {
    try {
      const res = await LP.get('/backup');
      if (!res?.success) throw new Error(res?.message);

      const backups = res.data || [];
      const tbody = document.getElementById('backupTableBody');

      if (backups.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--text-muted);font-size:13px;">No backups yet.</td></tr>';
        return;
      }

      tbody.innerHTML = backups.map(b => `
        <tr>
          <td class="font-mono"><strong>${LP.escHtml(b.name)}</strong></td>
          <td>${LP.formatBytes(b.size)}</td>
          <td>${new Date(b.created).toLocaleString()}</td>
          <td style="text-align:right">
            <button class="btn-lp btn-lp-ghost btn-lp-sm text-primary" onclick="BackupPage.showRestoreModal('${LP.encJsArg(b.name)}')" title="Restore">
              <i class="bi bi-clock-history"></i>
            </button>
            <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="BackupPage.deleteLocalBackup('${LP.encJsArg(b.name)}')" title="Delete">
              <i class="bi bi-trash"></i>
            </button>
          </td>
        </tr>
      `).join('');
    } catch (err) {
      document.getElementById('backupTableBody').innerHTML =
        `<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--accent-danger);">Error: ${LP.escHtml(err.message)}</td></tr>`;
    }
  },

  showCreateLocalBackupModal() {
    document.getElementById('lbType').value = 'mysql';
    document.getElementById('lbTarget').value = '';
    this.createLocalBsModal.show();
  },

  async createLocalBackup() {
    const type = document.getElementById('lbType').value;
    const target = document.getElementById('lbTarget').value.trim();
    if (!target) { LP.toast('Target is required', 'error'); return; }

    try {
      const res = await LP.post('/backup', { type, target });
      if (res?.success) {
        LP.toast('Backup created!', 'success');
        this.createLocalBsModal.hide();
        this.loadLocalBackups();
        this.loadOverview();
      } else {
        LP.toast(res?.message || 'Backup failed', 'error');
      }
    } catch (err) {
      LP.toast('Error: ' + err.message, 'error');
    }
  },

  async deleteLocalBackup(filename) {
    if (!(await LP.confirm(`Delete backup <strong>${LP.escHtml(filename)}</strong>? This cannot be undone.`, 'Delete Backup'))) return;
    try {
      const res = await LP.delete('/backup', { filename });
      if (res?.success) {
        LP.toast('Backup deleted', 'success');
        this.loadLocalBackups();
      } else {
        LP.toast(res?.message || 'Failed to delete', 'error');
      }
    } catch {
      LP.toast('Error deleting backup', 'error');
    }
  },

  showRestoreModal(filename) {
    const target = prompt('Enter target database name or directory path to restore to:', '');
    if (!target) return;
    this.restoreBackup(filename, target);
  },

  async restoreBackup(filename, target) {
    if (!(await LP.confirm(`Restore <strong>${LP.escHtml(filename)}</strong> to <strong>${LP.escHtml(target)}</strong>? Existing data may be overwritten.`, 'Restore Backup'))) return;
    try {
      const res = await LP.post('/backup/restore', { filename, target });
      if (res?.success) {
        LP.toast('Restore completed!', 'success');
      } else {
        LP.toast(res?.message || 'Restore failed', 'error');
      }
    } catch (err) {
      LP.toast('Error: ' + err.message, 'error');
    }
  },

  // ══════════════════════════════════════════════════════
  //  RCLONE
  // ══════════════════════════════════════════════════════

  async loadRcloneStatus() {
    try {
      const res = await LP.get('/backup/rclone');
      if (!res?.success) throw new Error(res?.message);

      const status = res.data?.status;
      const notInstalled = document.getElementById('rcloneNotInstalled');
      const content = document.getElementById('rcloneContent');

      if (!status?.installed) {
        notInstalled.style.display = 'block';
        content.style.display = 'none';
        return;
      }

      notInstalled.style.display = 'none';
      content.style.display = 'block';

      // Remotes list
      const remotes = status.remotes || [];
      const remotesEl = document.getElementById('rcloneRemotesList');

      if (remotes.length === 0) {
        remotesEl.innerHTML = '<div style="padding:15px;text-align:center;color:var(--text-muted);font-size:13px;">No remotes configured.</div>';
      } else {
        remotesEl.innerHTML = remotes.map(r => `
          <div class="d-flex justify-content-between align-items-center py-2" style="border-bottom:1px solid rgba(255,255,255,0.04);">
            <span><i class="bi bi-cloud text-warning me-2"></i> <strong>${LP.escHtml(r)}</strong></span>
            <div style="display:flex;gap:4px;">
              <button class="btn-lp btn-lp-ghost btn-lp-sm text-info" onclick="BackupPage.testRemote('${LP.encJsArg(r)}')" title="Test Connection" style="padding:2px 6px;font-size:10px;">
                <i class="bi bi-lightning-fill"></i>
              </button>
              <button class="btn-lp btn-lp-ghost btn-lp-sm" onclick="BackupPage.browseRemote('${LP.encJsArg(r)}')" style="padding:2px 6px;font-size:10px;" title="Browse">
                <i class="bi bi-folder2-open"></i>
              </button>
            </div>
          </div>
        `).join('');
      }

      // Populate browse remote select
      const browseSelect = document.getElementById('rcloneBrowseRemote');
      browseSelect.innerHTML = '<option value="">Select remote...</option>' +
        remotes.map(r => `<option value="${LP.escHtml(r)}">${LP.escHtml(r)}</option>`).join('');

      // Also populate DR remote select
      const drSelect = document.getElementById('drRemoteSelect');
      drSelect.innerHTML = '<option value="">Remote...</option>' +
        remotes.map(r => `<option value="${LP.escHtml(r)}">${LP.escHtml(r)}</option>`).join('');
    } catch {
      document.getElementById('rcloneNotInstalled').style.display = 'block';
      document.getElementById('rcloneContent').style.display = 'none';
    }
  },

  async installRclone() {
    const btn = document.querySelector('#rcloneNotInstalled .btn-lp-primary');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Installing...'; }
    try {
      const res = await LP.post('/backup/rclone/install');
      if (res?.success) {
        LP.toast('Rclone installed!', 'success');
        this.loadRcloneStatus();
      } else {
        LP.toast(res?.message || 'Installation failed', 'error');
      }
    } catch {
      LP.toast('Installation error', 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-download me-1"></i> Install Rclone'; }
    }
  },

  async testRemote(name) {
    LP.toast('Testing connection...', 'info');
    try {
      const res = await LP.post('/backup/rclone/test', { name });
      if (res?.success) {
        LP.toast('Connection successful!', 'success');
      } else {
        LP.toast(res?.message || 'Connection failed', 'error');
      }
    } catch (err) {
      LP.toast('Connection error: ' + err.message, 'error');
    }
  },

  async browseRemote(remoteName) {
    const select = document.getElementById('rcloneBrowseRemote');
    const remote = remoteName || select.value;
    const path = document.getElementById('rcloneBrowsePath').value.trim();
    if (!remote) { LP.toast('Select a remote', 'warning'); return; }

    const resultsEl = document.getElementById('rcloneBrowseResults');
    resultsEl.innerHTML = '<div style="padding:10px;text-align:center;color:var(--text-muted);"><div class="spinner-border spinner-border-sm me-1"></div> Browsing...</div>';

    try {
      const qs = new URLSearchParams({ remote, path: path || '' }).toString();
      const res = await LP.get(`/backup/rclone/files?${qs}`);
      if (res?.success) {
        const data = res.data;
        const files = data.files || [];
        if (files.length === 0) {
          resultsEl.innerHTML = '<div style="padding:15px;text-align:center;color:var(--text-muted);">No files found at this path</div>';
        } else {
          resultsEl.innerHTML = files.map(f =>
            `<div class="py-1 px-2" style="border-bottom:1px solid rgba(255,255,255,0.03);display:flex;justify-content:space-between;">
              <span><i class="bi bi-file-earmark me-1"></i>${LP.escHtml(f.name)}</span>
              <span style="color:var(--text-muted);">${LP.formatBytes(f.size)}</span>
            </div>`
          ).join('');
        }
      } else {
        resultsEl.innerHTML = `<div style="padding:10px;text-align:center;color:var(--accent-danger);">${LP.escHtml(res?.message || 'Error browsing')}</div>`;
      }
    } catch (err) {
      resultsEl.innerHTML = `<div style="padding:10px;text-align:center;color:var(--accent-danger);">Error: ${LP.escHtml(err.message)}</div>`;
    }
  },

  // ══════════════════════════════════════════════════════
  //  S3 CONFIG
  // ══════════════════════════════════════════════════════

  async loadS3Config() {
    try {
      const res = await LP.get('/backup/s3');
      if (!res?.success) return;
      const cfg = res.data || {};
      document.getElementById('s3Enabled').checked = cfg.enabled || false;
      document.getElementById('s3Endpoint').value = cfg.endpoint || '';
      document.getElementById('s3Region').value = cfg.region || 'us-east-1';
      document.getElementById('s3Bucket').value = cfg.bucket || '';
      document.getElementById('s3AccessKey').value = cfg.accessKey || '';
      document.getElementById('s3SecretKey').value = cfg.secretKey || '';
      this.toggleS3Fields();
    } catch { /* ignore */ }
  },

  toggleS3Fields() {
    const enabled = document.getElementById('s3Enabled').checked;
    const inputs = ['s3Endpoint', 's3Region', 's3Bucket', 's3AccessKey', 's3SecretKey'];
    inputs.forEach(id => {
      document.getElementById(id).disabled = !enabled;
    });
  },

  async saveS3Config() {
    const enabled = document.getElementById('s3Enabled').checked;
    const endpoint = document.getElementById('s3Endpoint').value;
    const region = document.getElementById('s3Region').value;
    const bucket = document.getElementById('s3Bucket').value;
    const accessKey = document.getElementById('s3AccessKey').value;
    const secretKey = document.getElementById('s3SecretKey').value;

    if (enabled && (!bucket || !accessKey || !secretKey)) {
      LP.toast('Bucket, Access Key, and Secret Key are required when enabled', 'error');
      return;
    }

    try {
      const res = await LP.post('/backup/s3', { enabled, endpoint, region, bucket, accessKey, secretKey });
      if (res?.success) {
        LP.toast('S3 configuration saved!', 'success');
        this.loadOverview();
      } else {
        LP.toast(res?.message || 'Failed to save', 'error');
      }
    } catch (err) {
      LP.toast('Error: ' + err.message, 'error');
    }
  },

  async testS3Connection() {
    LP.toast('Testing S3 connection...', 'info');
    try {
      const res = await LP.post('/backup/s3/test');
      if (res?.success) {
        LP.toast('S3 connection successful!', 'success');
      } else {
        LP.toast(res?.message || 'S3 connection failed', 'error');
      }
    } catch (err) {
      LP.toast('Error: ' + err.message, 'error');
    }
  },

  // ══════════════════════════════════════════════════════
  //  DISASTER RECOVERY
  // ══════════════════════════════════════════════════════

  async loadDRRemotes() {
    try {
      const res = await LP.get('/backup/rclone');
      if (res?.success) {
        const remotes = res.data?.status?.remotes || [];
        const select = document.getElementById('drRemoteSelect');
        select.innerHTML = '<option value="">Remote...</option>' +
          remotes.map(r => `<option value="${LP.escHtml(r)}">${LP.escHtml(r)}</option>`).join('');
      }
    } catch { /* ignore */ }
  },

  async loadS3Backups() {
    const listEl = document.getElementById('s3BackupsList');
    listEl.innerHTML = '<div style="padding:10px;text-align:center;color:var(--text-muted);"><div class="spinner-border spinner-border-sm me-1"></div> Loading...</div>';

    try {
      const res = await LP.get('/backup/s3/backups');
      if (res?.success) {
        const files = res.data?.files || [];
        if (files.length === 0) {
          listEl.innerHTML = '<div style="padding:10px;text-align:center;color:var(--text-muted);font-size:12px;">No backups found in S3 bucket</div>';
          return;
        }

        listEl.innerHTML = files.map(f => `
          <div class="d-flex justify-content-between align-items-center py-1" style="border-bottom:1px solid rgba(255,255,255,0.03);font-size:11px;">
            <span class="font-mono" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px;">
              <i class="bi bi-file-earmark me-1"></i>${LP.escHtml(f.key)}
            </span>
            <div style="display:flex;gap:4px;flex-shrink:0;">
              <span style="color:var(--text-muted);">${LP.formatBytes(f.size)}</span>
              <button class="btn-lp btn-lp-ghost btn-lp-sm p-0" style="font-size:9px;" onclick="BackupPage.downloadFromS3('${LP.encJsArg(f.key)}')" title="Download to local">
                <i class="bi bi-download"></i>
              </button>
            </div>
          </div>
        `).join('');
      } else {
        listEl.innerHTML = `<div style="padding:10px;text-align:center;color:var(--accent-danger);font-size:12px;">${LP.escHtml(res?.message || 'Failed to load')}</div>`;
      }
    } catch (err) {
      listEl.innerHTML = `<div style="padding:10px;text-align:center;color:var(--accent-danger);font-size:12px;">Error: ${LP.escHtml(err.message)}</div>`;
    }
  },

  async downloadFromS3(key) {
    LP.toast(`Downloading ${key} from S3...`, 'info');
    try {
      const res = await LP.post('/backup/s3/download', { key });
      if (res?.success) {
        LP.toast('Downloaded to local backups!', 'success');
      } else {
        LP.toast(res?.message || 'Download failed', 'error');
      }
    } catch (err) {
      LP.toast('Error: ' + err.message, 'error');
    }
  },

  async loadDRBackups() {
    const remote = document.getElementById('drRemoteSelect').value;
    const path = document.getElementById('drRemotePath').value.trim() || 'backups';
    if (!remote) { LP.toast('Select a remote', 'warning'); return; }

    const listEl = document.getElementById('drRestoreList');
    listEl.innerHTML = '<div style="padding:10px;text-align:center;color:var(--text-muted);font-size:12px;"><div class="spinner-border spinner-border-sm me-1"></div> Loading...</div>';

    try {
      const qs = new URLSearchParams({ remote, path }).toString();
      const res = await LP.get(`/backup/remote-backups?${qs}`);
      if (res?.success) {
        const data = res.data;
        const files = data.files || [];
        const dirs = data.dirs || [];

        let html = '';
        if (dirs.length > 0) {
          html += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;">Directories:</div>';
          html += dirs.map(d =>
            `<div class="py-1" style="font-size:11px;"><i class="bi bi-folder me-1 text-warning"></i>${LP.escHtml(d)}</div>`
          ).join('');
        }

        if (files.length > 0) {
          html += '<div style="font-size:11px;color:var(--text-muted);margin:6px 0;">Files:</div>';
          html += files.slice(0, 30).map(f => {
            const fullPath = `${path ? path + '/' : ''}${f.name}`;
            return `
              <div class="d-flex justify-content-between align-items-center py-1" style="font-size:11px;border-bottom:1px solid rgba(255,255,255,0.03);">
                <span class="font-mono"><i class="bi bi-file-earmark me-1"></i>${LP.escHtml(f.name)}</span>
                <div>
                  <span style="color:var(--text-muted);margin-right:6px;">${LP.formatBytes(f.size)}</span>
                  <button class="btn-lp btn-lp-ghost btn-lp-sm p-0 text-info" style="font-size:9px;" onclick="BackupPage.restoreFromRemote('${LP.encJsArg(remote)}', '${LP.encJsArg(fullPath)}')" title="Restore this file">
                    <i class="bi bi-cloud-download"></i>
                  </button>
                </div>
              </div>
            `;
          }).join('');
        }

        if (!html) {
          html = '<div style="padding:10px;text-align:center;color:var(--text-muted);font-size:12px;">No files found at this path</div>';
        }

        listEl.innerHTML = html;
      } else {
        listEl.innerHTML = `<div style="padding:10px;text-align:center;color:var(--accent-danger);font-size:12px;">${LP.escHtml(res?.message || 'Error')}</div>`;
      }
    } catch (err) {
      listEl.innerHTML = `<div style="padding:10px;text-align:center;color:var(--accent-danger);font-size:12px;">Error: ${LP.escHtml(err.message)}</div>`;
    }
  },

  async restoreFromRemote(remote, remotePath) {
    const localTarget = prompt(`Restore "${remote}:${remotePath}" to local path:`, '/tmp/restore');
    if (!localTarget) return;

    if (!(await LP.confirm(
      `Restore from <strong>${LP.escHtml(remote)}:${LP.escHtml(remotePath)}</strong> to <strong>${LP.escHtml(localTarget)}</strong>?`,
      'Disaster Recovery Restore'
    ))) return;

    try {
      const res = await LP.post('/backup/remote-restore', { remote, remotePath, localTarget });
      if (res?.success) {
        LP.toast('Restore completed!', 'success');
      } else {
        LP.toast(res?.message || 'Restore failed', 'error');
      }
    } catch (err) {
      LP.toast('Error: ' + err.message, 'error');
    }
  },
};

document.addEventListener('DOMContentLoaded', () => BackupPage.init());
