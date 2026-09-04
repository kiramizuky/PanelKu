/**
 * Panelku — backup.js
 * Backup & Disaster Recovery frontend
 */

const BackupPage = {
  createJobBsModal: null,
  createLocalBsModal: null,
  jobLogBsModal: null,
  createSnapshotBsModal: null,

  async init() {
    await LP.init();
    if (!LP.state.accessToken) return;
    this.createJobBsModal = new bootstrap.Modal(document.getElementById('createJobModal'));
    this.createLocalBsModal = new bootstrap.Modal(document.getElementById('createLocalBackupModal'));
    this.jobLogBsModal = new bootstrap.Modal(document.getElementById('jobLogModal'));
    if (document.getElementById('createSnapshotModal')) {
      this.createSnapshotBsModal = new bootstrap.Modal(document.getElementById('createSnapshotModal'));
    }
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
      this.loadSnapshots(),
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

    if (tabId === 'snapshots') {
      this.loadSnapshots();
    }
  },

  showS3Modal() {
    this.switchTab('s3');
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
                <button class="btn-lp btn-lp-ghost btn-lp-sm ${j.lastOutput ? 'text-info' : 'text-muted'}" onclick="LP.call('BackupPage.showJobLog', '${LP.encJsArg(j.name)}', '${LP.encJsArg(j.lastOutput || 'No output')}')" title="View Log">
                  <i class="bi bi-journal-text"></i>
                </button>
                <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="LP.call('BackupPage.deleteJob', '${LP.encJsArg(j.id)}', '${LP.encJsArg(j.name)}')" title="Delete">
                  <i class="bi bi-trash"></i>
                </button>
              </div>
            </div>
            <div style="font-size:12px;color:var(--text-muted);display:flex;flex-wrap:wrap;gap:15px;">
              <span><strong>Source:</strong> <code>${LP.escHtml(j.source)}</code></span>
              <span><strong>Dest:</strong> <code>${LP.escHtml(j.remote)}:${LP.escHtml(j.destPath)}</code></span>
              <span><strong>Type:</strong> ${j.type || 'sync'}</span>
              <span><strong>Schedule:</strong> <span class="text-info font-mono">${LP.escHtml(this.parseCronToText(j.schedule))}</span> <code style="font-size:10px;opacity:0.7;">(${LP.escHtml(j.schedule)})</code></span>
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

  parseCronToText(cronStr) {
    if (!cronStr) return '-';
    const parts = cronStr.trim().split(/\s+/);
    if (parts.length !== 5) return cronStr;
    const [min, hour, day, month, dow] = parts;

    if (min === '0' && hour === '*' && day === '*' && month === '*' && dow === '*') {
      return 'Tiap Jam';
    }
    if (min === '0' && hour.startsWith('*/') && day === '*' && month === '*' && dow === '*') {
      return `Setiap ${hour.substring(2)} Jam`;
    }
    if (!min.includes('*') && !hour.includes('*') && day === '*' && month === '*' && dow === '*') {
      return `Setiap Hari pukul ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
    }
    if (!min.includes('*') && !hour.includes('*') && day.startsWith('*/') && month === '*' && dow === '*') {
      return `Setiap ${day.substring(2)} Hari pukul ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
    }
    if (!min.includes('*') && !hour.includes('*') && day !== '*' && month.startsWith('*/') && dow === '*') {
      const intervalBln = month.substring(2);
      return `Setiap Tanggal ${day} (Tiap ${intervalBln} Bulan) pukul ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
    }
    if (!min.includes('*') && !hour.includes('*') && day !== '*' && month === '*' && dow === '*') {
      return `Setiap Tanggal ${day} (Tiap Bulan) pukul ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
    }
    if (!min.includes('*') && !hour.includes('*') && day !== '*' && month !== '*' && dow === '*') {
      const months = ['','Jan','Feb','Mar','Apr','Mei','Jun','Jul','Ags','Sep','Okt','Nov','Des'];
      return `Setiap Tanggal ${day} ${months[month] || month} pukul ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
    }
    if (!min.includes('*') && !hour.includes('*') && day === '*' && month === '*' && dow !== '*') {
      const days = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
      return `Setiap Hari ${days[dow] || dow} pukul ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
    }
    return cronStr;
  },

  toggleCronType() {
    const type = document.getElementById('cjCronType')?.value || 'tiap_hari';
    const optNjam = document.getElementById('cjOptNjam');
    const optTime = document.getElementById('cjOptTime');
    const optNhari = document.getElementById('cjOptNhari');
    const optNbulan = document.getElementById('cjOptNbulan');

    if (optNjam) optNjam.style.display = type === 'n_jam' ? 'block' : 'none';
    if (optTime) optTime.style.display = ['tiap_hari', 'n_hari', 'n_bulan'].includes(type) ? 'block' : 'none';
    if (optNhari) optNhari.style.display = type === 'n_hari' ? 'block' : 'none';
    if (optNbulan) optNbulan.style.display = type === 'n_bulan' ? 'block' : 'none';

    this.updateCalculatedCron();
  },

  updateCalculatedCron() {
    const type = document.getElementById('cjCronType')?.value || 'tiap_hari';
    const schedInput = document.getElementById('cjSchedule');
    const previewEl = document.getElementById('cjSchedulePreview');

    if (!schedInput) return;

    if (type === 'manual') {
      schedInput.readOnly = false;
      const text = this.parseCronToText(schedInput.value);
      if (previewEl) previewEl.textContent = text;
      return;
    }

    schedInput.readOnly = true;
    let expr = '0 2 * * *';

    if (type === 'tiap_jam') {
      expr = '0 * * * *';
    } else if (type === 'n_jam') {
      const nJam = parseInt(document.getElementById('cjInpNjam')?.value) || 6;
      expr = `0 */${nJam} * * *`;
    } else {
      const timeVal = document.getElementById('cjInpTime')?.value || '02:00';
      const [h, m] = timeVal.split(':');
      const hour = parseInt(h, 10) || 0;
      const min = parseInt(m, 10) || 0;

      if (type === 'tiap_hari') {
        expr = `${min} ${hour} * * *`;
      } else if (type === 'n_hari') {
        const nHari = parseInt(document.getElementById('cjInpNhari')?.value) || 2;
        expr = `${min} ${hour} */${nHari} * *`;
      } else if (type === 'n_bulan') {
        const tgl = parseInt(document.getElementById('cjInpTanggal')?.value) || 1;
        const bInterval = parseInt(document.getElementById('cjInpBulanInterval')?.value) || 1;
        if (bInterval <= 1) {
          expr = `${min} ${hour} ${tgl} * *`;
        } else {
          expr = `${min} ${hour} ${tgl} */${bInterval} *`;
        }
      }
    }

    schedInput.value = expr;
    const text = this.parseCronToText(expr);
    if (previewEl) previewEl.textContent = text;
  },

  showCreateJobModal() {
    document.getElementById('cjName').value = '';
    document.getElementById('cjSource').value = '';
    document.getElementById('cjDestPath').value = 'backups';
    document.getElementById('cjType').value = 'sync';
    document.getElementById('cjCronType').value = 'tiap_hari';
    document.getElementById('cjInpTime').value = '02:00';
    document.getElementById('cjSchedule').value = '0 2 * * *';
    document.getElementById('cjRetention').value = '7';
    document.getElementById('cjExclude').value = '';
    this.toggleCronType();
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
            <button class="btn-lp btn-lp-ghost btn-lp-sm text-primary" onclick="LP.call('BackupPage.showRestoreModal', '${LP.encJsArg(b.name)}')" title="Restore">
              <i class="bi bi-clock-history"></i>
            </button>
            <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="LP.call('BackupPage.deleteLocalBackup', '${LP.encJsArg(b.name)}')" title="Delete">
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

  _dbListCache: null,

  async showCreateLocalBackupModal() {
    document.getElementById('lbType').value = 'mysql';
    document.getElementById('lbTarget').value = '';
    await this.fetchDatabasesForBackup();
    this.onLocalBackupTypeChange();
    this.createLocalBsModal.show();
  },

  async fetchDatabasesForBackup() {
    try {
      const res = await LP.get('/database');
      if (res?.success) {
        this._dbListCache = res.data;
      }
    } catch (_) {}
  },

  onLocalBackupTypeChange() {
    const type = document.getElementById('lbType')?.value;
    const selectEl = document.getElementById('lbTargetSelect');
    const inputEl = document.getElementById('lbTarget');
    const hintEl = document.getElementById('lbTargetHint');
    if (!selectEl || !inputEl) return;

    if (['mysql', 'postgres', 'sqlite'].includes(type)) {
      selectEl.style.display = 'block';
      inputEl.style.display = 'none';
      const dbs = (this._dbListCache && this._dbListCache[type]) || [];

      if (dbs.length === 0) {
        selectEl.innerHTML = '<option value="">-- No database found --</option>';
        if (hintEl) hintEl.textContent = `No ${type.toUpperCase()} database found. Create one in the Database page first.`;
      } else {
        selectEl.innerHTML = dbs.map(d => `<option value="${LP.escHtml(d)}">${LP.escHtml(d)}</option>`).join('');
        if (hintEl) hintEl.textContent = `Select ${type.toUpperCase()} database to backup.`;
      }
    } else {
      selectEl.style.display = 'none';
      inputEl.style.display = 'block';
      if (type === 'files') {
        inputEl.placeholder = 'folder name inside /var/www (e.g. html)';
        if (hintEl) hintEl.textContent = 'Folder name inside /var/www to backup.';
      } else {
        inputEl.placeholder = 'panel';
        inputEl.value = 'panel';
        if (hintEl) hintEl.textContent = 'Backups panel database and system configs.';
      }
    }
  },

  async createLocalBackup() {
    const type = document.getElementById('lbType').value;
    const selectEl = document.getElementById('lbTargetSelect');
    const inputEl = document.getElementById('lbTarget');

    let target = '';
    if (['mysql', 'postgres', 'sqlite'].includes(type) && selectEl.style.display !== 'none') {
      target = selectEl.value;
    } else {
      target = inputEl.value.trim();
    }

    if (!target) { LP.toast('Please select or specify a backup target', 'error'); return; }

    try {
      const res = await LP.post('/backup', { type, target });
      if (res?.success) {
        LP.toast('Backup created successfully!', 'success');
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

  async showRestoreModal(filename) {
    const target = await LP.prompt('Enter target database name or directory path to restore to:', '', 'Restore Backup');
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

      // Config hint (e.g., using config from another user)
      const configHintEl = document.getElementById('rcloneConfigHint');
      if (status.configHint) {
        configHintEl.style.display = 'block';
        configHintEl.innerHTML = `<i class="bi bi-exclamation-triangle-fill me-1"></i> ${LP.escHtml(status.configHint)}`;
      } else {
        configHintEl.style.display = 'none';
      }

      // Config path display + copy button
      const configPathRow = document.getElementById('rcloneConfigPathRow');
      const configPathValue = document.getElementById('rcloneConfigPathValue');
      if (status.configPath) {
        configPathRow.style.display = 'block';
        configPathValue.textContent = status.configPath;
      } else {
        configPathRow.style.display = 'none';
      }

      // Custom config path row — show only when rclone is installed
      const customConfigRow = document.getElementById('rcloneCustomConfigRow');
      customConfigRow.style.display = 'block';

      // If API returned customConfigPath, populate the input
      if (status.customConfigPath) {
        document.getElementById('rcloneCustomConfigInput').value = status.customConfigPath;
        const statusEl = document.getElementById('rcloneCustomConfigStatus');
        statusEl.innerHTML = '<span style="color:#10b981;"><i class="bi bi-check-circle-fill me-1"></i>Using custom config path</span>';
      }

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
              <button class="btn-lp btn-lp-ghost btn-lp-sm text-info" onclick="LP.call('BackupPage.testRemote', '${LP.encJsArg(r)}')" title="Test Connection" style="padding:2px 6px;font-size:10px;">
                <i class="bi bi-lightning-fill"></i>
              </button>
              <button class="btn-lp btn-lp-ghost btn-lp-sm" onclick="LP.call('BackupPage.browseRemote', '${LP.encJsArg(r)}')" style="padding:2px 6px;font-size:10px;" title="Browse">
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
        const errMsg = res?.message || 'Installation failed';
        LP.toast(errMsg, 'error');
        LP.showManualInstallModal('Rclone', errMsg, 'sudo apt update && sudo apt install -y rclone');
      }
    } catch (err) {
      const errMsg = err?.message || 'Installation error';
      LP.toast(errMsg, 'error');
      LP.showManualInstallModal('Rclone', errMsg, 'sudo apt update && sudo apt install -y rclone');
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

  async saveCustomConfigPath() {
    const input = document.getElementById('rcloneCustomConfigInput');
    const statusEl = document.getElementById('rcloneCustomConfigStatus');
    const path = input.value.trim();

    if (!path) {
      await this.clearCustomConfigPath();
      return;
    }

    statusEl.innerHTML = '<span style="color:#f59e0b;"><i class="bi bi-hourglass me-1"></i>Saving...</span>';
    try {
      const res =      await LP.post('/backup/rclone/config-path', { path });
      if (res?.success) {
        statusEl.innerHTML = '<span style="color:#10b981;"><i class="bi bi-check-circle-fill me-1"></i>Saved! Refreshing...</span>';
        LP.toast('Custom config path saved!', 'success');
        await this.loadRcloneStatus();
      } else {
        statusEl.innerHTML = `<span style="color:#ef4444;"><i class="bi bi-x-circle-fill me-1"></i>${LP.escHtml(res?.message || 'Failed')}</span>`;
        LP.toast(res?.message || 'Failed to save', 'error');
      }
    } catch (err) {
      statusEl.innerHTML = `<span style="color:#ef4444;"><i class="bi bi-x-circle-fill me-1"></i>${LP.escHtml(err.message)}</span>`;
      LP.toast('Error: ' + err.message, 'error');
    }
  },

  async testCustomConfigPath() {
    const input = document.getElementById('rcloneCustomConfigInput');
    const statusEl = document.getElementById('rcloneCustomConfigStatus');
    const path = input.value.trim();

    if (!path) {
      statusEl.innerHTML = '<span style="color:#f59e0b;"><i class="bi bi-exclamation-triangle-fill me-1"></i>Enter a path first</span>';
      return;
    }

    statusEl.innerHTML = '<span style="color:#f59e0b;"><i class="bi bi-hourglass me-1"></i>Testing...</span>';
    try {
      const res = await LP.post('/backup/rclone/config-path/test', { path });
      if (res?.success) {
        const data = res.data;
        statusEl.innerHTML = `<span style="color:#10b981;"><i class="bi bi-check-circle-fill me-1"></i>Valid: ${data.count} remote(s) found (${LP.escHtml(data.remotes.join(', '))})</span>`;
        LP.toast(`Found ${data.count} remote(s)!`, 'success');
      } else {
        statusEl.innerHTML = `<span style="color:#ef4444;"><i class="bi bi-x-circle-fill me-1"></i>${LP.escHtml(res?.message || 'Test failed')}</span>`;
        LP.toast(res?.message || 'Test failed', 'error');
      }
    } catch (err) {
      statusEl.innerHTML = `<span style="color:#ef4444;"><i class="bi bi-x-circle-fill me-1"></i>${LP.escHtml(err.message)}</span>`;
      LP.toast('Error: ' + err.message, 'error');
    }
  },

  async clearCustomConfigPath() {
    const input = document.getElementById('rcloneCustomConfigInput');
    const statusEl = document.getElementById('rcloneCustomConfigStatus');

    statusEl.innerHTML = '<span style="color:#f59e0b;"><i class="bi bi-hourglass me-1"></i>Clearing...</span>';
    try {
      const res =      await LP.post('/backup/rclone/config-path', { path: null });
      if (res?.success) {
        input.value = '';
        statusEl.innerHTML = '<span style="color:var(--text-muted);">Custom config path cleared. Using default.</span>';
        LP.toast('Custom config path cleared', 'success');
        await this.loadRcloneStatus();
      } else {
        statusEl.innerHTML = `<span style="color:#ef4444;"><i class="bi bi-x-circle-fill me-1"></i>${LP.escHtml(res?.message || 'Failed')}</span>`;
      }
    } catch (err) {
      statusEl.innerHTML = `<span style="color:#ef4444;"><i class="bi bi-x-circle-fill me-1"></i>${LP.escHtml(err.message)}</span>`;
      LP.toast('Error: ' + err.message, 'error');
    }
  },

  copyConfigPath() {
    const pathEl = document.getElementById('rcloneConfigPathValue');
    const path = pathEl?.textContent?.trim();
    if (!path || path === '—') {
      LP.toast('No config path available', 'warning');
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(path).then(() => {
        LP.toast('Config path copied!', 'success');
      }).catch(() => {
        this._fallbackCopy(path);
      });
    } else {
      this._fallbackCopy(path);
    }
  },

  _fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      LP.toast('Config path copied!', 'success');
    } catch {
      LP.toast('Failed to copy. Path: ' + text, 'info');
    }
    document.body.removeChild(ta);
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
              <button class="btn-lp btn-lp-ghost btn-lp-sm p-0" style="font-size:9px;" onclick="LP.call('BackupPage.downloadFromS3', '${LP.encJsArg(f.key)}')" title="Download to local">
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
                  <button class="btn-lp btn-lp-ghost btn-lp-sm p-0 text-info" style="font-size:9px;" onclick="LP.call('BackupPage.restoreFromRemote', '${LP.encJsArg(remote)}', '${LP.encJsArg(fullPath)}')" title="Restore this file">
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
    const localTarget = await LP.prompt(`Restore "${remote}:${remotePath}" to local path:`, '/tmp/restore', 'Disaster Recovery Restore');
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

  // ── Volume Snapshots & Rollback (Fase 4) ─────────────

  async loadSnapshots() {
    const tbody = document.getElementById('snapshotTableBody');
    if (!tbody) return;

    try {
      const res = await LP.get('/backup/snapshots');
      const snapshots = res?.data?.snapshots || [];

      if (snapshots.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">No snapshot recovery points created yet.</td></tr>';
        return;
      }

      tbody.innerHTML = snapshots.map(s => `
        <tr>
          <td>
            <div class="fw-bold text-white"><i class="bi bi-camera text-info me-1"></i> ${LP.escHtml(s.name)}</div>
            ${s.description ? `<small class="text-muted">${LP.escHtml(s.description)}</small>` : ''}
          </td>
          <td><code class="font-mono text-white">${LP.escHtml(s.targetPath)}</code></td>
          <td><span class="lp-badge lp-badge-info">${s.sizeMb} MB</span></td>
          <td class="text-secondary small">${new Date(s.createdAt).toLocaleString()}</td>
          <td><span class="lp-badge lp-badge-success"><i class="bi bi-check-circle me-1"></i> Verified</span></td>
          <td class="text-end">
            <div class="d-flex justify-content-end gap-1">
              <button class="btn-lp btn-lp-sm btn-lp-primary" onclick="BackupPage.rollbackSnapshot('${LP.escHtml(s.id)}', '${LP.escHtml(s.name)}')" title="Rollback to this snapshot">
                <i class="bi bi-arrow-counterclockwise me-1"></i> Rollback
              </button>
              <button class="btn-lp btn-lp-sm btn-lp-ghost text-danger" onclick="BackupPage.deleteSnapshot('${LP.escHtml(s.id)}', '${LP.escHtml(s.name)}')" title="Delete">
                <i class="bi bi-trash"></i>
              </button>
            </div>
          </td>
        </tr>
      `).join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-4">Error loading snapshots: ${LP.escHtml(err.message)}</td></tr>`;
    }
  },

  showCreateSnapshotModal() {
    if (this.createSnapshotBsModal) {
      document.getElementById('snapName').value = `snapshot_${Date.now()}`;
      this.createSnapshotBsModal.show();
    }
  },

  async createSnapshot() {
    const name = document.getElementById('snapName')?.value?.trim();
    const targetPath = document.getElementById('snapTarget')?.value?.trim() || '/var/www';
    const description = document.getElementById('snapDesc')?.value?.trim() || '';

    if (!name) {
      LP.toast('Snapshot name is required', 'error');
      return;
    }

    try {
      LP.loading(true);
      const res = await LP.post('/backup/snapshots', { name, targetPath, description });
      LP.loading(false);
      if (res?.success) {
        LP.toast('Volume snapshot created successfully!', 'success');
        if (this.createSnapshotBsModal) this.createSnapshotBsModal.hide();
        this.loadSnapshots();
      } else {
        LP.toast(res?.message || 'Failed to create snapshot', 'error');
      }
    } catch (err) {
      LP.loading(false);
      LP.toast(err.message || 'Snapshot creation error', 'error');
    }
  },

  async rollbackSnapshot(id, name) {
    if (!(await LP.confirm(
      `Are you sure you want to rollback to snapshot <strong>${LP.escHtml(name)}</strong>? Target files will be restored to this snapshot point.`,
      'Confirm Snapshot Rollback'
    ))) return;

    try {
      LP.loading(true);
      const res = await LP.post(`/backup/snapshots/${id}/rollback`, {});
      LP.loading(false);
      if (res?.success) {
        LP.toast('Rollback completed successfully!', 'success');
      } else {
        LP.toast(res?.message || 'Rollback failed', 'error');
      }
    } catch (err) {
      LP.loading(false);
      LP.toast(err.message || 'Rollback error', 'error');
    }
  },

  async deleteSnapshot(id, name) {
    if (!(await LP.confirm(
      `Delete snapshot <strong>${LP.escHtml(name)}</strong>? This cannot be undone.`,
      'Delete Snapshot'
    ))) return;

    try {
      const res = await LP.delete(`/backup/snapshots/${id}`);
      if (res?.success) {
        LP.toast('Snapshot deleted', 'success');
        this.loadSnapshots();
      } else {
        LP.toast(res?.message || 'Failed to delete snapshot', 'error');
      }
    } catch (err) {
      LP.toast(err.message || 'Delete error', 'error');
    }
  },
};

document.addEventListener('DOMContentLoaded', () => BackupPage.init());
window.BackupPage = BackupPage;
window.Backup = BackupPage;
window.BackupManager = BackupPage;

