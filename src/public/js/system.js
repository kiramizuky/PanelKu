const SystemPage = {
  async init() {
    await this.loadServices();
    await this.loadAutoUpdate();
    await this.loadPMInfo();
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
            <td style="font-weight:500;">${svc}</td>
            <td>
              <span class="lp-badge ${statuses[svc] ? 'lp-badge-success' : 'lp-badge-danger'}">
                ${statuses[svc] ? 'Running' : 'Stopped'}
              </span>
            </td>
            <td style="text-align:right">
              <button class="btn-lp btn-lp-ghost btn-lp-sm" onclick="SystemPage.manageService('${svc}', 'restart')" style="color:var(--accent-info)">
                <i class="bi bi-arrow-repeat"></i> Restart
              </button>
              ${statuses[svc] ? `
              <button class="btn-lp btn-lp-ghost btn-lp-sm" onclick="SystemPage.manageService('${svc}', 'stop')" style="color:var(--accent-danger)">
                <i class="bi bi-stop-circle"></i> Stop
              </button>` : `
              <button class="btn-lp btn-lp-ghost btn-lp-sm" onclick="SystemPage.manageService('${svc}', 'start')" style="color:var(--accent-success)">
                <i class="bi bi-play-circle"></i> Start
              </button>`}
            </td>
          </tr>
        `).join('');
      } else {
        tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--accent-danger)">Error: ${res.message}</td></tr>`;
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
