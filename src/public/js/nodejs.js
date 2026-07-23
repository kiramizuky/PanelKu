/**
 * Linux Panel — nodejs.js
 * Node.js Manager frontend
 */

const NodeJSPage = {
  installModal: null,
  pkgInstallModal: null,
  pm2StartBsModal: null,
  pm2LogsBsModal: null,
  installBsModal: null,

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
      this.loadGlobalPackages(),
      this.loadPm2List(),
      this.loadNodeInfo(),
    ]);
  },

  // ── Tab Switching ────────────────────────────────────

  switchTab(tabId) {
    document.querySelectorAll('.nodejs-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nodejs-tab-content').forEach(t => t.classList.remove('active'));

    const tabBtn = document.querySelector(`.nodejs-tab[data-tab="${tabId}"]`);
    if (tabBtn) tabBtn.classList.add('active');

    const tabContent = document.getElementById(`tab-${tabId}`);
    if (tabContent) tabContent.classList.add('active');
  },

  // ── Status Cards ─────────────────────────────────────

  async loadStatus() {
    try {
      const res = await LP.get('/nodejs/status');
      if (res?.success) {
        const { status, nodeInfo } = res.data;

        document.getElementById('nodejsCurrentVersion').textContent = status.currentVersion || 'N/A';
        document.getElementById('nodejsNpmVersion').textContent = nodeInfo.npmVersion || 'N/A';
        document.getElementById('nodejsNvmStatus').textContent = status.nvmInstalled ? `✓ ${status.nvmDir}` : 'Not installed';

        const pm2Status = nodeInfo.pm2Installed
          ? `✓ ${nodeInfo.pm2Version || ''}`
          : 'Not installed';
        document.getElementById('nodejsPm2Status').textContent = pm2Status;
      }
    } catch {
      // Status cards will show "—"
    }
  },

  // ── NVM Management ───────────────────────────────────

  async installNvm() {
    const btn = document.querySelector('#nvmNotInstalledBanner .btn-lp-primary');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Installing...';
    }

    try {
      const res = await LP.post('/nodejs/nvm/install');
      if (res?.success) {
        LP.toast('NVM installed successfully! Refreshing...', 'success');
        this.refresh();
      } else {
        LP.toast(res?.message || 'Installation failed', 'error');
      }
    } catch {
      LP.toast('Error installing NVM', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-download me-1"></i> Install NVM';
      }
    }
  },

  // ── Local Versions ───────────────────────────────────

  async loadLocalVersions() {
    try {
      const res = await LP.get('/nodejs/versions/local');
      if (!res?.success) throw new Error(res?.message);

      const { installed, current, default: defaultVer, nvmInstalled } = res.data;
      const container = document.getElementById('installedVersionsList');

      // Show/hide NVM not installed banner
      const nvmBanner = document.getElementById('nvmNotInstalledBanner');
      const nvmSection = document.getElementById('nvmAvailableSection');
      if (!nvmInstalled) {
        if (nvmBanner) nvmBanner.style.display = 'block';
        if (nvmSection) nvmSection.style.display = 'none';
        container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px;">No Node.js versions installed. Install NVM first, then install a version.</div>';
        return;
      }

      if (nvmBanner) nvmBanner.style.display = 'none';
      if (nvmSection) nvmSection.style.display = 'block';

      if (!installed || installed.length === 0) {
        container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px;">No Node.js versions found via NVM.</div>';
        return;
      }

      container.innerHTML = installed.map(ver => {
        const isCurrent = ver === current || `v${ver}` === current || current?.includes(ver);
        const isDefault = ver === defaultVer;
        return `
          <div class="p-3 rounded d-flex justify-content-between align-items-center" style="background:rgba(0,0,0,0.12);border:1px solid var(--glass-border);">
            <div class="d-flex align-items-center gap-3">
              <i class="bi bi-code-slash ${isCurrent ? 'text-success' : 'text-muted'}" style="font-size:20px;"></i>
              <div>
                <strong style="font-size:15px;color:${isCurrent ? '#10b981' : 'var(--text-primary)'};">${LP.escHtml(ver)}</strong>
                <div style="display:flex;gap:6px;margin-top:3px;">
                  ${isCurrent ? '<span class="lp-badge lp-badge-success" style="font-size:10px;"><span class="lp-badge-dot"></span> Active</span>' : ''}
                  ${isDefault ? '<span class="lp-badge lp-badge-info" style="font-size:10px;">Default</span>' : ''}
                </div>
              </div>
            </div>
            <div class="d-flex gap-2">
              ${!isCurrent ? `<button class="btn-lp btn-lp-ghost btn-lp-sm text-success" onclick="LP.call('NodeJSPage.useVersion', '${LP.encJsArg(ver)}')" title="Use this version"><i class="bi bi-check-circle"></i> Use</button>` : ''}
              ${!isDefault ? `<button class="btn-lp btn-lp-ghost btn-lp-sm text-info" onclick="LP.call('NodeJSPage.setDefault', '${LP.encJsArg(ver)}')" title="Set as default"><i class="bi bi-star"></i> Default</button>` : ''}
              <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="LP.call('NodeJSPage.confirmUninstall', '${LP.encJsArg(ver)}')" title="Uninstall"><i class="bi bi-trash"></i></button>
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      document.getElementById('installedVersionsList').innerHTML =
        `<div style="padding:20px;text-align:center;color:var(--accent-danger);font-size:13px;">Failed to load versions: ${LP.escHtml(err.message)}</div>`;
    }
  },

  // ── Remote Versions ──────────────────────────────────

  async loadRemoteVersions() {
    try {
      const res = await LP.get('/nodejs/versions/remote?filter=lts');
      if (!res?.success) throw new Error(res?.message);

      const versions = res.data.versions || [];
      const container = document.getElementById('remoteVersionsList');

      if (versions.length === 0) {
        container.innerHTML = '<div style="padding:15px;text-align:center;color:var(--text-muted);font-size:13px;">No remote versions available. Check your internet connection.</div>';
        return;
      }

      // Show top 20 LTS versions
      const showVersions = versions.slice(-20).reverse();
      container.innerHTML = showVersions.map(v => `
        <div class="p-2 px-3 rounded d-flex justify-content-between align-items-center" style="background:rgba(0,0,0,0.08);border:1px solid var(--glass-border);">
          <div>
            <span style="font-family:monospace;font-size:14px;color:var(--text-primary);">v${LP.escHtml(v.version)}</span>
            ${v.lts ? `<span class="lp-badge lp-badge-info" style="font-size:9px;margin-left:8px;">${LP.escHtml(v.lts)}</span>` : ''}
          </div>
          <button class="btn-lp btn-lp-ghost btn-lp-sm text-primary" onclick="NodeJSPage.installSpecificVersion('${LP.encJsArg(v.version)}')" title="Install v${LP.escHtml(v.version)}">
            <i class="bi bi-download"></i> Install
          </button>
        </div>
      `).join('');

      // Also populate the install modal select
      this._populateInstallSelect(versions);
    } catch (err) {
      document.getElementById('remoteVersionsList').innerHTML =
        `<div style="padding:15px;text-align:center;color:var(--accent-danger);font-size:13px;">Failed: ${LP.escHtml(err.message)}</div>`;
    }
  },

  _populateInstallSelect(versions) {
    const select = document.getElementById('installVersionSelect');
    if (!select) return;
    const last10 = versions.slice(-10).reverse();
    select.innerHTML = '<option value="">Select LTS version...</option>' +
      last10.map(v =>
        `<option value="${LP.escHtml(v.version)}">v${LP.escHtml(v.version)} ${v.lts ? `— ${LP.escHtml(v.lts)}` : ''}</option>`
      ).join('');
  },

  // ── Version Actions ──────────────────────────────────

  async installSpecificVersion(version) {
    if (!(await LP.confirm(`Install Node.js ${version}? This may take a few minutes.`, 'Install Version'))) return;
    LP.toast(`Installing Node.js ${version}...`, 'info');
    try {
      const res = await LP.post('/nodejs/versions/install', { version });
      if (res?.success) {
        LP.toast(`Node.js ${version} installed!`, 'success');
        this.loadLocalVersions();
      } else {
        LP.toast(res?.message || 'Installation failed', 'error');
      }
    } catch {
      LP.toast('Installation error', 'error');
    }
  },

  showInstallModal() {
    if (!this.installBsModal) {
      this.installBsModal = new bootstrap.Modal(document.getElementById('installNodeModal'));
    }
    this.loadRemoteVersions();
    this.installBsModal.show();
  },

  async installVersion() {
    const select = document.getElementById('installVersionSelect');
    const custom = document.getElementById('installVersionCustom');
    const version = custom.value.trim() || select.value;
    if (!version) return LP.toast('Please select or type a version', 'warning');

    this.installBsModal.hide();
    await this.installSpecificVersion(version);
    custom.value = '';
  },

  async useVersion(version) {
    try {
      const res = await LP.post('/nodejs/versions/use', { version });
      if (res?.success) {
        LP.toast(`Now using Node.js ${version}`, 'success');
        this.loadLocalVersions();
        this.loadStatus();
      } else {
        LP.toast(res?.message || 'Failed to switch version', 'error');
      }
    } catch {
      LP.toast('Error switching version', 'error');
    }
  },

  async setDefault(version) {
    try {
      const res = await LP.post('/nodejs/versions/default', { version });
      if (res?.success) {
        LP.toast(`Node.js ${version} set as default`, 'success');
        this.loadLocalVersions();
      } else {
        LP.toast(res?.message || 'Failed to set default', 'error');
      }
    } catch {
      LP.toast('Error setting default', 'error');
    }
  },

  async confirmUninstall(version) {
    if (!(await LP.confirm(`Are you sure you want to uninstall Node.js ${version}?`, 'Uninstall Version'))) return;
    try {
      const res = await LP.post('/nodejs/versions/uninstall', { version });
      if (res?.success) {
        LP.toast(`Node.js ${version} uninstalled`, 'success');
        this.loadLocalVersions();
      } else {
        LP.toast(res?.message || 'Uninstall failed', 'error');
      }
    } catch {
      LP.toast('Error uninstalling version', 'error');
    }
  },

  // ── NPM Global Packages ──────────────────────────────

  async loadGlobalPackages() {
    const tbody = document.getElementById('globalPackagesTableBody');
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--text-muted)">Loading...</td></tr>';

    try {
      const res = await LP.get('/nodejs/packages');
      if (res?.success) {
        const packages = res.data.packages || [];
        if (packages.length === 0) {
          tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--text-muted)">No global packages installed.</td></tr>';
          return;
        }

        tbody.innerHTML = packages.map(p => `
          <tr>
            <td style="font-family:monospace;">${LP.escHtml(p.name)}</td>
            <td style="font-family:monospace;color:var(--text-muted);">${LP.escHtml(p.version)}</td>
            <td style="text-align:right;">
              <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="NodeJSPage.uninstallGlobalPackage('${LP.encJsArg(p.name)}')" title="Uninstall">
                <i class="bi bi-trash3"></i>
              </button>
            </td>
          </tr>
        `).join('');
      } else {
        tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--accent-danger)">Error: ${LP.escHtml(res?.message || 'Unknown')}</td></tr>`;
      }
    } catch {
      tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--accent-danger)">Failed to load packages</td></tr>';
    }
  },

  showPkgInstallModal() {
    if (!this.pkgInstallBsModal) {
      this.pkgInstallBsModal = new bootstrap.Modal(document.getElementById('installPkgModal'));
    }
    document.getElementById('installPkgName').value = '';
    this.pkgInstallBsModal.show();
  },

  async installGlobalPackage() {
    const name = document.getElementById('installPkgName').value.trim();
    if (!name) return LP.toast('Package name is required', 'warning');

    this.pkgInstallBsModal.hide();
    LP.toast(`Installing ${name}...`, 'info');

    try {
      const res = await LP.post('/nodejs/packages/install', { name });
      if (res?.success) {
        LP.toast(`Package "${name}" installed globally`, 'success');
        this.loadGlobalPackages();
      } else {
        LP.toast(res?.message || 'Installation failed', 'error');
      }
    } catch {
      LP.toast('Error installing package', 'error');
    }
  },

  async uninstallGlobalPackage(name) {
    if (!(await LP.confirm(`Uninstall global package "${name}"?`, 'Uninstall Package'))) return;
    try {
      const res = await LP.post('/nodejs/packages/uninstall', { name });
      if (res?.success) {
        LP.toast(`Package "${name}" uninstalled`, 'success');
        this.loadGlobalPackages();
      } else {
        LP.toast(res?.message || 'Uninstall failed', 'error');
      }
    } catch {
      LP.toast('Error uninstalling package', 'error');
    }
  },

  // ── PM2 Process Manager ──────────────────────────────

  async loadPm2List() {
    const tbody = document.getElementById('pm2TableBody');
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--text-muted)">Loading...</td></tr>';

    try {
      const res = await LP.get('/nodejs/pm2');
      if (res?.success) {
        const data = res.data;
        const pm2Banner = document.getElementById('pm2NotInstalledBanner');

        if (!data.isInstalled) {
          if (pm2Banner) pm2Banner.style.display = 'block';
          tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--text-muted)">PM2 is not installed. Install it globally via the NPM Packages tab.</td></tr>';
          return;
        }

        if (pm2Banner) pm2Banner.style.display = 'none';
        const processes = data.processes || [];

        if (processes.length === 0) {
          tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--text-muted)">No PM2 processes running. Start one using the button above.</td></tr>';
          return;
        }

        tbody.innerHTML = processes.map(p => {
          const isOnline = p.status === 'online';
          return `
            <tr style="vertical-align:middle;">
              <td style="font-weight:600;color:var(--text-primary);">${LP.escHtml(p.name)}</td>
              <td style="font-family:monospace;color:var(--text-muted);font-size:12px;">${p.pid || '-'}</td>
              <td>
                <span class="lp-badge ${isOnline ? 'lp-badge-success' : 'lp-badge-danger'}" style="font-size:11px;">
                  <span class="lp-badge-dot"></span> ${LP.escHtml(p.status)}
                </span>
              </td>
              <td>${p.cpu}%</td>
              <td>${LP.escHtml(p.memory)}</td>
              <td>${p.restarts}</td>
              <td style="color:var(--text-muted);font-size:12px;">${LP.escHtml(p.uptime)}</td>
              <td style="text-align:right;">
                <div class="d-flex gap-1 justify-content-end">
                  <button class="btn-lp btn-lp-ghost btn-lp-sm text-success" onclick="NodeJSPage.pm2Action('${LP.encJsArg(p.name)}', 'restart')" title="Restart"><i class="bi bi-arrow-clockwise"></i></button>
                  <button class="btn-lp btn-lp-ghost btn-lp-sm text-warning" onclick="NodeJSPage.pm2Action('${LP.encJsArg(p.name)}', 'stop')" title="Stop"><i class="bi bi-stop-fill"></i></button>
                  <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="NodeJSPage.pm2Action('${LP.encJsArg(p.name)}', 'delete')" title="Delete"><i class="bi bi-trash3"></i></button>
                  <button class="btn-lp btn-lp-ghost btn-lp-sm text-info" onclick="NodeJSPage.showPm2Logs('${LP.encJsArg(p.name)}')" title="Logs"><i class="bi bi-terminal"></i></button>
                </div>
              </td>
            </tr>
          `;
        }).join('');
      } else {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--accent-danger)">Error: ${LP.escHtml(res?.message || 'Unknown')}</td></tr>`;
      }
    } catch {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--accent-danger)">Failed to load processes</td></tr>';
    }
  },

  async pm2Action(name, action) {
    const actionLabels = { start: 'Started', stop: 'Stopped', restart: 'Restarted', delete: 'Deleted', reload: 'Reloaded' };
    const label = actionLabels[action] || action;

    if (action === 'delete' || action === 'stop') {
      if (!(await LP.confirm(`${label} process "${name}"?`, `PM2 ${label}`))) return;
    }

    try {
      const res = await LP.post('/nodejs/pm2/action', { name, action });
      if (res?.success) {
        LP.toast(`"${name}" ${label}`, 'success');
        setTimeout(() => this.loadPm2List(), 500);
      } else {
        LP.toast(res?.message || 'Action failed', 'error');
      }
    } catch {
      LP.toast('Error executing action', 'error');
    }
  },

  showPm2Logs(name) {
    if (!this.pm2LogsBsModal) {
      this.pm2LogsBsModal = new bootstrap.Modal(document.getElementById('pm2LogsModal'));
    }

    document.getElementById('pm2LogsModalTitle').textContent = `Logs: ${name}`;
    document.getElementById('pm2LogsArea').textContent = 'Loading logs...';
    this.pm2LogsBsModal.show();

    this._fetchPm2Logs(name);
  },

  async _fetchPm2Logs(name) {
    try {
      const res = await LP.get(`/nodejs/pm2/logs?name=${encodeURIComponent(name)}`);
      if (res?.success) {
        document.getElementById('pm2LogsArea').textContent = res.data.logs || 'No logs available.';
      } else {
        document.getElementById('pm2LogsArea').textContent = `Error: ${res?.message || 'Failed to fetch logs'}`;
      }
    } catch {
      document.getElementById('pm2LogsArea').textContent = 'Failed to fetch logs. Network error.';
    }
  },

  showPm2StartModal() {
    if (!this.pm2StartBsModal) {
      this.pm2StartBsModal = new bootstrap.Modal(document.getElementById('pm2StartModal'));
    }
    document.getElementById('pm2StartScript').value = '';
    document.getElementById('pm2StartName').value = '';
    document.getElementById('pm2StartCwd').value = '';
    document.getElementById('pm2StartArgs').value = '';
    this.pm2StartBsModal.show();
  },

  async pm2Start() {
    const script = document.getElementById('pm2StartScript').value.trim();
    if (!script) return LP.toast('Script path is required', 'warning');

    const name = document.getElementById('pm2StartName').value.trim();
    const cwd = document.getElementById('pm2StartCwd').value.trim();
    const args = document.getElementById('pm2StartArgs').value.trim();

    this.pm2StartBsModal.hide();
    LP.toast('Starting process...', 'info');

    try {
      const res = await LP.post('/nodejs/pm2/start', { script, name, args, cwd });
      if (res?.success) {
        LP.toast(res.message || 'Process started', 'success');
        setTimeout(() => this.loadPm2List(), 1000);
      } else {
        LP.toast(res?.message || 'Failed to start', 'error');
      }
    } catch {
      LP.toast('Error starting process', 'error');
    }
  },

  async installPm2() {
    LP.toast('Installing PM2 globally via npm...', 'info');
    try {
      const res = await LP.post('/nodejs/packages/install', { name: 'pm2' });
      if (res?.success) {
        LP.toast('PM2 installed globally!', 'success');
        setTimeout(() => this.loadPm2List(), 1500);
      } else {
        LP.toast(res?.message || 'Installation failed', 'error');
      }
    } catch {
      LP.toast('Error installing PM2', 'error');
    }
  },

  // ── Environment Info ─────────────────────────────────

  async loadNodeInfo() {
    try {
      const res = await LP.get('/nodejs/info');
      if (res?.success) {
        const info = res.data.info;

        const setText = (id, val) => {
          const el = document.getElementById(id);
          if (el) el.textContent = val || '—';
        };

        setText('niVersion', info.version || 'N/A');
        setText('niNpm', info.npmVersion || 'N/A');
        setText('niPath', info.nodePath || 'N/A');
        setText('niArch', info.arch || 'N/A');
        setText('niPlatform', info.platform || 'N/A');
        setText('niNvm', info.nvmInstalled ? `✓ ${info.nvmDir || 'installed'}` : 'Not installed');
        setText('niPm2', info.pm2Installed ? `✓ ${info.pm2Version || 'installed'}` : 'Not installed');
      }
    } catch {
      // Leave as "—"
    }
  },
};

document.addEventListener('DOMContentLoaded', () => NodeJSPage.init());
