/**
 * Linux Panel — python.js
 * Python Manager frontend
 */

const PythonPage = {
  installBsModal: null,
  createVenvBsModal: null,
  pipInstallBsModal: null,
  wsgiStartBsModal: null,
  supConfigBsModal: null,

  async init() {
    await LP.init();
    if (!LP.state.accessToken) return;
    this.refresh();
  },

  async refresh() {
    await Promise.all([
      this.loadStatus(),
      this.loadLocalVersions(),
      this.loadRemoteVersions(),
      this.loadVirtualEnvs(),
      this.loadPipPackages(),
      this.loadWsgiServers(),
      this.loadSupervisor(),
    ]);
  },

  switchTab(tabId) {
    document.querySelectorAll('.python-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.python-tab-content').forEach(t => t.classList.remove('active'));
    document.querySelector(`.python-tab[data-tab="${tabId}"]`)?.classList.add('active');
    document.getElementById(`tab-${tabId}`)?.classList.add('active');
  },

  // ── Status ───────────────────────────────────────────

  async loadStatus() {
    try {
      const res = await LP.get('/python/status');
      if (res?.success) {
        const { status, info } = res.data;
        document.getElementById('pyCurrentVersion').textContent = status.currentVersion || 'N/A';
        document.getElementById('pyPipVersion').textContent = info.pipVersion || 'N/A';
        document.getElementById('pyPyenvStatus').textContent = status.pyenvInstalled ? `✓ ${status.pyenvRoot || ''}` : 'Not installed';
        const wsgiParts = [];
        if (info.gunicornInstalled) wsgiParts.push('Gunicorn');
        if (info.uvicornInstalled) wsgiParts.push('Uvicorn');
        document.getElementById('pyWsgiStatus').textContent = wsgiParts.length ? wsgiParts.join(' / ') : 'Not installed';
      }
    } catch {}
  },

  // ── Pyenv ────────────────────────────────────────────

  async installPyenv() {
    const btn = document.querySelector('#pyenvNotInstalledBanner .btn-lp-primary');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Installing...'; }
    try {
      const res = await LP.post('/python/pyenv/install');
      if (res?.success) { LP.toast('Pyenv installed!', 'success'); this.refresh(); }
      else { LP.toast(res?.message || 'Install failed', 'error'); }
    } catch { LP.toast('Error installing Pyenv', 'error'); }
    finally { if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-download me-1"></i> Install Pyenv'; } }
  },

  // ── Local Versions ───────────────────────────────────

  async loadLocalVersions() {
    try {
      const res = await LP.get('/python/versions/local');
      if (!res?.success) throw new Error(res?.message);
      const { installed, current, pyenvInstalled } = res.data;
      const container = document.getElementById('installedVersionsList');
      const banner = document.getElementById('pyenvNotInstalledBanner');
      const section = document.getElementById('pyenvAvailableSection');

      if (!pyenvInstalled) {
        if (banner) banner.style.display = 'block';
        if (section) section.style.display = 'none';
        container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">No Python versions found. Install Pyenv first.</div>';
        return;
      }
      if (banner) banner.style.display = 'none';
      if (section) section.style.display = 'block';

      if (!installed || installed.length === 0) {
        container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">No Python versions found via Pyenv.</div>';
        return;
      }

      container.innerHTML = installed.map(ver => {
        const isCurrent = current?.includes(ver) || `v${ver}` === current;
        return `
          <div class="p-3 rounded d-flex justify-content-between align-items-center" style="background:rgba(0,0,0,0.12);border:1px solid var(--glass-border);">
            <div class="d-flex align-items-center gap-3">
              <i class="bi bi-filetype-py ${isCurrent ? 'text-success' : 'text-muted'}" style="font-size:20px;"></i>
              <div>
                <strong style="font-size:15px;color:${isCurrent ? '#10b981' : 'var(--text-primary)'};">${LP.escHtml(ver)}</strong>
                ${isCurrent ? '<span class="lp-badge lp-badge-success" style="font-size:10px;margin-top:3px;display:inline-block;"><span class="lp-badge-dot"></span> Active</span>' : ''}
              </div>
            </div>
            <div class="d-flex gap-2">
              ${!isCurrent && ver !== 'system' ? `<button class="btn-lp btn-lp-ghost btn-lp-sm text-info" onclick="PythonPage.setGlobal('${LP.encJsArg(ver)}')" title="Set global"><i class="bi bi-globe"></i> Global</button>` : ''}
              ${ver !== 'system' ? `<button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="PythonPage.confirmUninstall('${LP.encJsArg(ver)}')" title="Uninstall"><i class="bi bi-trash"></i></button>` : ''}
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      document.getElementById('installedVersionsList').innerHTML = `<div style="padding:20px;text-align:center;color:var(--accent-danger);">${LP.escHtml(err.message)}</div>`;
    }
  },

  // ── Remote Versions ──────────────────────────────────

  async loadRemoteVersions() {
    try {
      const res = await LP.get('/python/versions/remote?filter=stable');
      if (!res?.success) throw new Error(res?.message);
      const versions = res.data.versions || [];
      const container = document.getElementById('remoteVersionsList');

      if (!versions.length) {
        container.innerHTML = '<div style="padding:15px;text-align:center;color:var(--text-muted);font-size:13px;">No remote versions available.</div>';
        return;
      }

      const show = versions.slice(-20).reverse();
      container.innerHTML = show.map(v =>
        `<div class="p-2 px-3 rounded d-flex justify-content-between align-items-center" style="background:rgba(0,0,0,0.08);border:1px solid var(--glass-border);">
          <span style="font-family:monospace;font-size:14px;color:var(--text-primary);">${LP.escHtml(v)}</span>
          <button class="btn-lp btn-lp-ghost btn-lp-sm text-primary" onclick="PythonPage.installSpecific('${LP.encJsArg(v)}')"><i class="bi bi-download"></i> Install</button>
        </div>`
      ).join('');

      this._populateInstallSelect(versions);
    } catch (err) {
      document.getElementById('remoteVersionsList').innerHTML = `<div style="padding:15px;text-align:center;color:var(--accent-danger);font-size:13px;">${LP.escHtml(err.message)}</div>`;
    }
  },

  _populateInstallSelect(versions) {
    const sel = document.getElementById('installPyVersionSelect');
    if (!sel) return;
    sel.innerHTML = '<option value="">Select version...</option>' +
      versions.slice(-15).reverse().map(v => `<option value="${LP.escHtml(v)}">${LP.escHtml(v)}</option>`).join('');
  },

  async installSpecific(version) {
    if (!(await LP.confirm(`Install Python ${version}? This may take several minutes.`, 'Install'))) return;
    LP.toast(`Installing Python ${version}...`, 'info');
    try {
      const res = await LP.post('/python/versions/install', { version });
      if (res?.success) { LP.toast(`Python ${version} installed!`, 'success'); this.loadLocalVersions(); }
      else { LP.toast(res?.message || 'Install failed', 'error'); }
    } catch { LP.toast('Error', 'error'); }
  },

  showInstallModal() {
    if (!this.installBsModal) this.installBsModal = new bootstrap.Modal(document.getElementById('installPyModal'));
    this.loadRemoteVersions();
    this.installBsModal.show();
  },

  async installVersion() {
    const sel = document.getElementById('installPyVersionSelect');
    const custom = document.getElementById('installPyVersionCustom');
    const version = custom.value.trim() || sel.value;
    if (!version) return LP.toast('Select or type a version', 'warning');
    this.installBsModal.hide();
    await this.installSpecific(version);
    custom.value = '';
  },

  async setGlobal(version) {
    try {
      const res = await LP.post('/python/versions/global', { version });
      if (res?.success) { LP.toast(`Python ${version} set as global`, 'success'); this.loadLocalVersions(); }
      else { LP.toast(res?.message || 'Failed', 'error'); }
    } catch { LP.toast('Error', 'error'); }
  },

  async confirmUninstall(version) {
    if (!(await LP.confirm(`Uninstall Python ${version}?`, 'Uninstall'))) return;
    try {
      const res = await LP.post('/python/versions/uninstall', { version });
      if (res?.success) { LP.toast(`Python ${version} uninstalled`, 'success'); this.loadLocalVersions(); }
      else { LP.toast(res?.message || 'Failed', 'error'); }
    } catch { LP.toast('Error', 'error'); }
  },

  // ── Virtual Envs ─────────────────────────────────────

  async loadVirtualEnvs() {
    const tbody = document.getElementById('venvTableBody');
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--text-muted)">Loading...</td></tr>';
    try {
      const res = await LP.get('/python/venvs');
      if (res?.success) {
        const venvs = res.data.venvs || [];
        if (!venvs.length) {
          tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--text-muted)">No virtual environments found.</td></tr>';
          return;
        }
        LP.paginate(venvs, 10, 'venvTableBody', 'venvPagination', v => `
          <tr>
            <td style="font-weight:600;">${LP.escHtml(v.name)}</td>
            <td style="font-family:monospace;font-size:12px;color:var(--text-muted);">${LP.escHtml(v.path)}</td>
            <td>${LP.escHtml(v.pythonVersion)}</td>
            <td style="text-align:right;">
              <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="PythonPage.deleteVenv('${LP.encJsArg(v.name)}')" title="Delete"><i class="bi bi-trash3"></i></button>
            </td>
          </tr>
        `, 'No virtual environments.', 4);
      }
    } catch { tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--accent-danger)">Failed to load</td></tr>'; }
  },

  showVenveateModal() {
    if (!this.createVenvBsModal) this.createVenvBsModal = new bootstrap.Modal(document.getElementById('createVenvModal'));
    document.getElementById('venvName').value = '';
    // Populate version select from installed
    const sel = document.getElementById('venvPythonVersion');
    sel.innerHTML = '<option value="">System default</option>';
    document.getElementById('installedVersionsList')?.querySelectorAll('strong').forEach(el => {
      const v = el.textContent.trim();
      if (v && /^\d/.test(v)) sel.innerHTML += `<option value="${LP.escHtml(v)}">${LP.escHtml(v)}</option>`;
    });
    this.createVenvBsModal.show();
  },

  async createVenv() {
    const name = document.getElementById('venvName').value.trim();
    const pyVer = document.getElementById('venvPythonVersion').value;
    if (!name) return LP.toast('Name is required', 'warning');
    this.createVenvBsModal.hide();
    LP.toast('Creating virtual environment...', 'info');
    try {
      const res = await LP.post('/python/venvs', { name, pythonVersion: pyVer || undefined });
      if (res?.success) { LP.toast(res.message, 'success'); this.loadVirtualEnvs(); }
      else { LP.toast(res?.message || 'Failed', 'error'); }
    } catch { LP.toast('Error', 'error'); }
  },

  async deleteVenv(name) {
    if (!(await LP.confirm(`Delete virtual environment "${name}"? This cannot be undone.`, 'Delete Venv'))) return;
    try {
      const res = await LP.del(`/python/venvs/${encodeURIComponent(name)}`);
      if (res?.success) { LP.toast(`"${name}" deleted`, 'success'); this.loadVirtualEnvs(); }
      else { LP.toast(res?.message || 'Failed', 'error'); }
    } catch { LP.toast('Error', 'error'); }
  },

  // ── Pip Packages ─────────────────────────────────────

  async loadPipPackages() {
    const tbody = document.getElementById('pipTableBody');
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--text-muted)">Loading...</td></tr>';
    try {
      const res = await LP.get('/python/packages');
      if (res?.success) {
        const pkgs = res.data.packages || [];
        if (!pkgs.length) {
          tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--text-muted)">No packages installed globally.</td></tr>';
          return;
        }
        tbody.innerHTML = pkgs.map(p => `
          <tr><td style="font-family:monospace;">${LP.escHtml(p.name)}</td>
          <td style="font-family:monospace;color:var(--text-muted);">${LP.escHtml(p.version)}</td>
          <td style="text-align:right;">
            <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="PythonPage.uninstallPip('${LP.encJsArg(p.name)}')" title="Uninstall"><i class="bi bi-trash3"></i></button>
          </td></tr>
        `).join('');
      }
    } catch { tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--accent-danger)">Failed to load</td></tr>'; }
  },

  showPipInstallModal() {
    if (!this.pipInstallBsModal) this.pipInstallBsModal = new bootstrap.Modal(document.getElementById('installPipModal'));
    document.getElementById('installPipName').value = '';
    this.pipInstallBsModal.show();
  },

  async installPipPackage() {
    const name = document.getElementById('installPipName').value.trim();
    if (!name) return LP.toast('Package name required', 'warning');
    this.pipInstallBsModal.hide();
    LP.toast(`Installing ${name}...`, 'info');
    try {
      const res = await LP.post('/python/packages/install', { name });
      if (res?.success) { LP.toast(`Package "${name}" installed`, 'success'); this.loadPipPackages(); }
      else { LP.toast(res?.message || 'Failed', 'error'); }
    } catch { LP.toast('Error', 'error'); }
  },

  async uninstallPip(name) {
    if (!(await LP.confirm(`Uninstall "${name}"?`, 'Uninstall'))) return;
    try {
      const res = await LP.post('/python/packages/uninstall', { name });
      if (res?.success) { LP.toast(`"${name}" uninstalled`, 'success'); this.loadPipPackages(); }
      else { LP.toast(res?.message || 'Failed', 'error'); }
    } catch { LP.toast('Error', 'error'); }
  },

  // ── WSGI Servers ─────────────────────────────────────

  async loadWsgiServers() {
    const tbody = document.getElementById('wsgiTableBody');
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text-muted)">Loading...</td></tr>';
    try {
      const res = await LP.get('/python/wsgi');
      if (res?.success) {
        const servers = res.data.servers || [];
        if (!servers.length) {
          tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text-muted)">No Gunicorn/Uvicorn servers running.</td></tr>';
          return;
        }
        tbody.innerHTML = servers.map(s => `
          <tr>
            <td><span class="lp-badge ${s.type === 'gunicorn' ? 'lp-badge-primary' : 'lp-badge-info'}" style="font-size:10px;">${LP.escHtml(s.type)}</span></td>
            <td style="font-weight:600;">${LP.escHtml(s.name)}</td>
            <td style="font-family:monospace;font-size:12px;">${s.pid}</td>
            <td>${LP.escHtml(s.user)}</td>
            <td>${s.cpu}%</td>
            <td>${s.mem}%</td>
            <td style="text-align:right;">
              <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="PythonPage.stopWsgi('${s.pid}')" title="Stop"><i class="bi bi-stop-fill"></i></button>
            </td>
          </tr>
        `).join('');
      }
    } catch { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--accent-danger)">Failed to load</td></tr>'; }
  },

  showWsgiStartModal() {
    if (!this.wsgiStartBsModal) this.wsgiStartBsModal = new bootstrap.Modal(document.getElementById('startWsgiModal'));
    this.wsgiStartBsModal.show();
  },

  async startWsgi() {
    const type = document.getElementById('wsgiType').value;
    const appModule = document.getElementById('wsgiModule').value.trim();
    const port = document.getElementById('wsgiPort').value;
    const host = document.getElementById('wsgiHost').value.trim();
    const workers = document.getElementById('wsgiWorkers').value;
    const venvPath = document.getElementById('wsgiVenv').value.trim();

    if (!appModule) return LP.toast('App module is required', 'warning');
    this.wsgiStartBsModal.hide();
    LP.toast(`Starting ${type}...`, 'info');

    try {
      const res = await LP.post('/python/wsgi/start', { type, appModule, port, host, workers, venvPath: venvPath || undefined });
      if (res?.success) { LP.toast(res.message, 'success'); setTimeout(() => this.loadWsgiServers(), 1000); }
      else { LP.toast(res?.message || 'Failed', 'error'); }
    } catch { LP.toast('Error starting server', 'error'); }
  },

  async stopWsgi(pid) {
    if (!(await LP.confirm(`Stop process ${pid}?`, 'Stop Process'))) return;
    try {
      const res = await LP.post('/python/wsgi/stop', { pid: String(pid) });
      if (res?.success) { LP.toast(`Process ${pid} stopped`, 'success'); this.loadWsgiServers(); }
      else { LP.toast(res?.message || 'Failed', 'error'); }
    } catch { LP.toast('Error', 'error'); }
  },

  // ── Supervisor ───────────────────────────────────────

  async loadSupervisor() {
    const tbody = document.getElementById('supervisorTableBody');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted)">Loading...</td></tr>';
    try {
      const res = await LP.get('/python/supervisor');
      if (res?.success) {
        const data = res.data;
        const notInstalled = document.getElementById('supervisorNotInstalled');
        const help = document.getElementById('supervisorHelp');

        if (!data.isInstalled) {
          if (notInstalled) notInstalled.style.display = 'block';
          if (help) help.style.display = 'block';
          tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted)">Supervisor not installed or not running.</td></tr>';
          return;
        }
        if (notInstalled) notInstalled.style.display = 'none';
        if (help) help.style.display = 'none';

        const processes = data.processes || [];
        if (!processes.length) {
          tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted)">No supervisor processes configured.</td></tr>';
          return;
        }

        tbody.innerHTML = processes.map(p => {
          const statusOk = p.status === 'RUNNING';
          return `<tr>
            <td style="font-weight:600;">${LP.escHtml(p.name)}</td>
            <td><span class="lp-badge ${statusOk ? 'lp-badge-success' : 'lp-badge-danger'}"><span class="lp-badge-dot"></span> ${LP.escHtml(p.status)}</span></td>
            <td style="font-family:monospace;font-size:12px;">${p.pid || '-'}</td>
            <td>${LP.escHtml(p.uptime)}</td>
            <td style="text-align:right;">
              <div class="d-flex gap-1 justify-content-end">
                ${!statusOk ? `<button class="btn-lp btn-lp-ghost btn-lp-sm text-success" onclick="PythonPage.supervisorAction('${LP.encJsArg(p.name)}', 'start')" title="Start"><i class="bi bi-play-fill"></i></button>` : ''}
                <button class="btn-lp btn-lp-ghost btn-lp-sm text-warning" onclick="PythonPage.supervisorAction('${LP.encJsArg(p.name)}', 'restart')" title="Restart"><i class="bi bi-arrow-clockwise"></i></button>
                <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="PythonPage.supervisorAction('${LP.encJsArg(p.name)}', 'stop')" title="Stop"><i class="bi bi-stop-fill"></i></button>
              </div>
            </td>
          </tr>`;
        }).join('');
      }
    } catch { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--accent-danger)">Failed to load</td></tr>'; }
  },

  showSupervisorConfigModal() {
    if (!this.supConfigBsModal) this.supConfigBsModal = new bootstrap.Modal(document.getElementById('supervisorConfigModal'));
    document.getElementById('supName').value = '';
    document.getElementById('supCommand').value = '';
    document.getElementById('supDir').value = '';
    document.getElementById('supUser').value = 'www-data';
    document.getElementById('supNumprocs').value = '1';
    document.getElementById('supEnv').value = '';
    this.supConfigBsModal.show();
  },

  async createSupervisorConfig() {
    const name = document.getElementById('supName').value.trim();
    const command = document.getElementById('supCommand').value.trim();
    const directory = document.getElementById('supDir').value.trim();
    const user = document.getElementById('supUser').value.trim();
    const numprocs = document.getElementById('supNumprocs').value;
    const environment = document.getElementById('supEnv').value.trim();

    if (!name) return LP.toast('Program name required', 'warning');
    if (!command) return LP.toast('Command required', 'warning');

    this.supConfigBsModal.hide();
    LP.toast('Creating supervisor config...', 'info');

    try {
      const res = await LP.post('/python/supervisor/config', {
        name, command, user: user || undefined,
        directory: directory || undefined,
        numprocs: parseInt(numprocs) || 1,
        environment: environment || undefined,
      });
      if (res?.success) { LP.toast(res.message, 'success'); this.loadSupervisor(); }
      else { LP.toast(res?.message || 'Failed', 'error'); }
    } catch { LP.toast('Error', 'error'); }
  },

  async supervisorAction(name, action) {
    try {
      const res = await LP.post('/python/supervisor/action', { name, action });
      if (res?.success) { LP.toast(`"${name}" ${action}`, 'success'); setTimeout(() => this.loadSupervisor(), 1000); }
      else { LP.toast(res?.message || 'Failed', 'error'); }
    } catch { LP.toast('Error', 'error'); }
  },
};

document.addEventListener('DOMContentLoaded', () => PythonPage.init());
