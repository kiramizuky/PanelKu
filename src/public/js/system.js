const SystemPage = {
  async init() {
    await this.loadServices();
    await this.loadAutoUpdate();
    await this.loadPMInfo();
    await this.loadSshKeys();
    await this.loadSshConfig();
    await this.loadPHPConfig();
  },

  async loadAutoUpdate() {
    try {
      const res = await LP.get('/system/auto-update');
      if (res?.success) {
        document.getElementById('autoUpdateToggle').checked = res.data.enabled;
      }
    } catch (e) {
      console.error('Failed to load auto-update setting');
    }
  },

  async loadPMInfo() {
    try {
      const res = await LP.get('/system/package-manager/info');
      if (res?.success) {
        const info = res.data;
        document.getElementById('pmTitle').textContent = `Package Manager (${info.name})`;
        document.getElementById('btnUpdate').innerHTML = `<i class="bi bi-arrow-repeat"></i> ${info.updateName}`;
        document.getElementById('btnUpgrade').innerHTML = `<i class="bi bi-download"></i> ${info.upgradeName}`;
        document.getElementById('pmLogModalTitle').textContent = `${info.name} Log`;
        this.pmInfo = info;
      }
    } catch (e) {
      console.error('Failed to load package manager info');
    }
  },

  async toggleAutoUpdate() {
    const enabled = document.getElementById('autoUpdateToggle').checked;
    try {
      const res = await LP.post('/system/auto-update', { enabled });
      if (res?.success) {
        LP.toast(res.message, 'success');
      } else {
        LP.toast('Failed to change auto-update setting', 'error');
        document.getElementById('autoUpdateToggle').checked = !enabled; // revert
      }
    } catch (e) {
      LP.toast('Connection error', 'error');
      document.getElementById('autoUpdateToggle').checked = !enabled; // revert
    }
  },

  async loadServices() {
    const tbody = document.getElementById('servicesTableBody');
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--text-muted)">Loading...</td></tr>';
    
    try {
      const res = await LP.get('/system/services');
      if (res?.success) {
        const statuses = res.data;
        const services = Object.keys(statuses);

        if (services.length === 0) {
          tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--text-muted)">No services found</td></tr>';
          return;
        }

        tbody.innerHTML = services.map(svc => `
          <tr>
            <td style="font-weight:500;">${LP.escHtml(svc)}</td>
            <td>
              <span class="lp-badge ${statuses[svc] ? 'lp-badge-success' : 'lp-badge-danger'}">
                ${statuses[svc] ? 'Running' : 'Stopped'}
              </span>
            </td>
            <td style="text-align:right">
              <button class="btn-lp btn-lp-ghost btn-lp-sm" onclick="LP.call('SystemPage.manageService', '${LP.encJsArg(svc)}', '${LP.encJsArg('restart')}')" style="color:var(--accent-info)">
                <i class="bi bi-arrow-repeat"></i> Restart
              </button>
              ${statuses[svc] ? `
              <button class="btn-lp btn-lp-ghost btn-lp-sm" onclick="LP.call('SystemPage.manageService', '${LP.encJsArg(svc)}', '${LP.encJsArg('stop')}')" style="color:var(--accent-danger)">
                <i class="bi bi-stop-circle"></i> Stop
              </button>` : `
              <button class="btn-lp btn-lp-ghost btn-lp-sm" onclick="LP.call('SystemPage.manageService', '${LP.encJsArg(svc)}', '${LP.encJsArg('start')}')" style="color:var(--accent-success)">
                <i class="bi bi-play-circle"></i> Start
              </button>`}
            </td>
          </tr>
        `).join('');
      } else {
        tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--accent-danger)">Error: ${LP.escHtml(res.message)}</td></tr>`;
      }
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--accent-danger)">Failed to load services</td></tr>';
    }
  },

  async manageService(service, action) {
    const btn = event.currentTarget;
    const oldHtml = btn.innerHTML;
    btn.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> ...';
    btn.disabled = true;

    try {
      const res = await LP.post('/system/services/manage', { service, action });
      if (res?.success) {
        LP.toast(`Service ${service} ${action}ed`, 'success');
        this.loadServices();
      } else {
        LP.toast(res.message, 'error');
        btn.innerHTML = oldHtml;
        btn.disabled = false;
      }
    } catch (err) {
      LP.toast('Connection error', 'error');
      btn.innerHTML = oldHtml;
      btn.disabled = false;
    }
  },

  async runPM(action) {
    const btn = document.getElementById(action === 'update' ? 'btnUpdate' : 'btnUpgrade');
    const oldHtml = btn.innerHTML;
    btn.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Running...';
    btn.disabled = true;

    try {
      const res = await LP.post(`/system/package-manager/${action}`);
      if (res?.success) {
        document.getElementById('aptLogContent').textContent = res.data.log || 'No output';
        new bootstrap.Modal(document.getElementById('aptLogModal')).show();
        LP.toast(`${this.pmInfo ? this.pmInfo.name : 'Package Manager'} ${action} completed`, 'success');
      } else {
        LP.toast(res.message, 'error');
      }
    } catch (err) {
      LP.toast('Connection error', 'error');
    } finally {
      btn.innerHTML = oldHtml;
      btn.disabled = false;
    }
  },

  async runApt(action) {
    return this.runPM(action);
  },

  async restartPanel() {
    if (!(await LP.confirm('Are you sure you want to restart the panel? Operations will pause briefly.', 'Restart Panel'))) return;

    try {
      const res = await LP.post('/system/panel/restart');
      if (res?.success) {
        LP.toast('Panel is restarting. Page will reload automatically...', 'warning');
        setTimeout(() => window.location.reload(), 4000);
      } else {
        LP.toast(res.message, 'error');
      }
    } catch (err) {
      // Net connection drops are expected during restart
      LP.toast('Restart initiated. Reloading page...', 'warning');
      setTimeout(() => window.location.reload(), 4000);
    }
  },

  async loadSshKeys() {
    const tbody = document.getElementById('sshKeysTableBody');
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:15px; color:var(--text-muted);">Loading SSH Keys...</td></tr>';
    try {
      const res = await LP.get('/system/ssh/keys');
      if (res?.success) {
        const keys = res.data;
        if (keys.length === 0) {
          tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:15px; color:var(--text-muted);">No authorized SSH keys found.</td></tr>';
          return;
        }
        tbody.innerHTML = keys.map(k => `
          <tr style="border-bottom: 1px solid rgba(255,255,255,0.03); height:36px; vertical-align:middle;">
            <td style="font-family:monospace; color:var(--accent-info); font-size:11px;">${LP.escHtml(k.type)}</td>
            <td style="word-break:break-all; font-size:11px; padding-right:10px;" title="${LP.escHtml(k.key.substring(0,30))}...">${LP.escHtml(k.comment)}</td>
            <td style="text-align:right;">
              <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger p-0" onclick="LP.call('SystemPage.deleteSshKey', '${LP.encJsArg(k.id)}')" title="Delete Key"><i class="bi bi-trash"></i></button>
            </td>
          </tr>
        `).join('');
      } else {
        tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:15px; color:var(--accent-danger);">Error: ${res.message}</td></tr>`;
      }
    } catch {
      tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:15px; color:var(--accent-danger);">Failed to load SSH keys.</td></tr>';
    }
  },

  async loadSshConfig() {
    try {
      const res = await LP.get('/system/ssh/config');
      if (res?.success) {
        document.getElementById('sshPort').value = res.data.port;
        document.getElementById('sshPasswordAuth').checked = res.data.passwordAuth;
      }
    } catch {
      console.error('Failed to load SSH configuration');
    }
  },

  showAddSshKeyModal() {
    document.getElementById('sshPublicKeyInput').value = '';
    const modal = new bootstrap.Modal(document.getElementById('addSshKeyModal'));
    modal.show();
  },

  async addSshKey() {
    const key = document.getElementById('sshPublicKeyInput').value.trim();
    if (!key) {
      LP.toast('Please paste your public SSH key.', 'error');
      return;
    }
    try {
      const res = await LP.post('/system/ssh/keys', { key });
      if (res?.success) {
        LP.toast('SSH public key added successfully!', 'success');
        bootstrap.Modal.getInstance(document.getElementById('addSshKeyModal')).hide();
        this.loadSshKeys();
      } else {
        LP.toast(res.message || 'Failed to add SSH key', 'error');
      }
    } catch {
      LP.toast('Error adding SSH key', 'error');
    }
  },

  async deleteSshKey(id) {
    if (!(await LP.confirm('Are you sure you want to delete this authorized SSH key? You might lose SSH access if you do not have other keys.', 'Delete SSH Key'))) return;
    try {
      const res = await LP.post('/system/ssh/keys/delete', { id });
      if (res?.success) {
        LP.toast('SSH key deleted successfully.', 'success');
        this.loadSshKeys();
      } else {
        LP.toast(res.message || 'Failed to delete SSH key', 'error');
      }
    } catch {
      LP.toast('Error deleting SSH key', 'error');
    }
  },

  async saveSshConfig() {
    const port = parseInt(document.getElementById('sshPort').value);
    const passwordAuth = document.getElementById('sshPasswordAuth').checked;

    if (isNaN(port) || port < 1 || port > 65535) {
      LP.toast('Please enter a valid port number (1-65535).', 'error');
      return;
    }

    if (!(await LP.confirm('Are you sure you want to save this config? The SSH service will restart immediately.', 'Save SSH Config'))) return;

    try {
      const res = await LP.post('/system/ssh/config', { port, passwordAuth });
      if (res?.success) {
        LP.toast('SSH configuration updated and daemon restarted.', 'success');
        this.loadSshConfig();
      } else {
        LP.toast(res.message || 'Failed to save config', 'error');
      }
    } catch {
      LP.toast('Error saving config', 'error');
    }
  },

  async loadPHPConfig() {
    try {
      const res = await LP.get('/system/php-config');
      if (res?.success) {
        document.getElementById('phpMaxChildren').value = res.data.max_children;
        document.getElementById('phpStartServers').value = res.data.start_servers;
        document.getElementById('phpMinSpare').value = res.data.min_spare_servers;
        document.getElementById('phpMaxSpare').value = res.data.max_spare_servers;
      }
    } catch {
      console.error('Failed to load PHP FPM configuration');
    }
  },

  async savePHPConfig() {
    const max_children = parseInt(document.getElementById('phpMaxChildren').value);
    const start_servers = parseInt(document.getElementById('phpStartServers').value);
    const min_spare_servers = parseInt(document.getElementById('phpMinSpare').value);
    const max_spare_servers = parseInt(document.getElementById('phpMaxSpare').value);

    if (isNaN(max_children) || isNaN(start_servers) || isNaN(min_spare_servers) || isNaN(max_spare_servers)) {
      LP.toast('Please enter valid numbers for all parameters.', 'error');
      return;
    }

    try {
      const res = await LP.post('/system/php-config', { max_children, start_servers, min_spare_servers, max_spare_servers });
      if (res?.success) {
        LP.toast('PHP-FPM pool configuration saved and reloaded.', 'success');
        this.loadPHPConfig();
      } else {
        LP.toast(res.message || 'Failed to save config', 'error');
      }
    } catch {
      LP.toast('Error saving PHP FPM config', 'error');
    }
  },

  async reboot() {
    if (!(await LP.confirm('WARNING: Are you sure you want to reboot the server? All services will go down temporarily.', 'Reboot System'))) return;
    
    try {
      const res = await LP.post('/system/reboot');
      if (res?.success) {
        LP.toast('Server is rebooting. You will be disconnected...', 'warning');
        setTimeout(() => window.location.reload(), 15000); // Try reload after 15s
      } else {
        LP.toast(res.message, 'error');
      }
    } catch (err) {
      LP.toast('Failed to initiate reboot', 'error');
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  SystemPage.init();
});
window.SystemPage = SystemPage;
window.System = SystemPage;
window.SystemManager = SystemPage;
