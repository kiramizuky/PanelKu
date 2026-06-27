/**
 * Settings - Panel Update logic
 */

const PanelPage = (() => {
  let autoUpdateConfig = { enabled: false, frequency: 'daily' };

  async function init() {
    await LP.init();
    await loadVersionInfo();
    await loadAutoUpdateConfig();
  }

  async function loadVersionInfo() {
    try {
      const res = await LP.get('/system/panel/version');
      if (res?.success) {
        const d = res.data;
        document.getElementById('currentVersion').textContent = d.current || '1.0.0';
        document.getElementById('lastUpdatedAt').value = d.lastUpdated
          ? new Date(d.lastUpdated).toLocaleString()
          : '—';
      }
    } catch (err) {
      console.error('Failed to load version info', err);
    }
  }

  async function checkUpdate() {
    const btn = document.getElementById('btnCheckUpdate');
    btn.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Checking...';
    btn.disabled = true;

    try {
      const res = await LP.get('/system/panel/check-update');
      if (res?.success) {
        const d = res.data;
        document.getElementById('latestVersion').textContent = d.latest || '—';

        const statusEl = document.getElementById('updateStatus');
        if (d.hasUpdate) {
          statusEl.innerHTML = '<span class="lp-badge lp-badge-danger"><span class="lp-badge-dot"></span>Update Available</span>';
          LP.toast(`New version available: ${d.latest}`, 'info', 'Update Available');
        } else {
          statusEl.innerHTML = '<span class="lp-badge lp-badge-success"><span class="lp-badge-dot"></span>Up to Date</span>';
          LP.toast('Panel is up to date!', 'success');
        }
      } else {
        LP.toast(res?.message || 'Failed to check for updates', 'error');
      }
    } catch (err) {
      LP.toast('Failed to check for updates', 'error');
    } finally {
      btn.innerHTML = '<i class="bi bi-arrow-repeat"></i> Check for Updates';
      btn.disabled = false;
    }
  }

  async function runUpdate() {
    if (!(await LP.confirm('This will pull the latest code and restart the panel. Continue?', 'Confirm Update'))) return;

    const method = document.getElementById('updateMethod').value;
    const branch = document.getElementById('updateBranch').value || 'main';

    const btn = document.getElementById('btnUpdate');
    btn.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Updating...';
    btn.disabled = true;

    const logEl = document.getElementById('updateLog');
    logEl.textContent = `Starting ${method} update on branch "${branch}"...\n`;

    try {
      const res = await LP.post('/system/panel/update', { method, branch });
      if (res?.success) {
        logEl.textContent += res.data?.log || 'Update completed.\n';
        logEl.textContent += '\n✅ Panel updated successfully. Restarting...';
        logEl.scrollTop = logEl.scrollHeight;
        LP.toast('Panel updated! Restarting...', 'success');

        // Reload after a few seconds
        setTimeout(() => {
          logEl.textContent += '\n🔄 Reconnecting...';
          window.location.reload();
        }, 5000);
      } else {
        logEl.textContent += `\n❌ Error: ${res?.message || 'Unknown error'}`;
        LP.toast(res?.message || 'Update failed', 'error');
        btn.innerHTML = '<i class="bi bi-cloud-download"></i> Update Panel';
        btn.disabled = false;
      }
    } catch (err) {
      logEl.textContent += `\n❌ Connection error: ${err.message}`;
      LP.toast('Connection error during update', 'error');
      btn.innerHTML = '<i class="bi bi-cloud-download"></i> Update Panel';
      btn.disabled = false;
    }
  }

  async function restartPanel() {
    if (!(await LP.confirm('Are you sure you want to restart the panel?', 'Confirm Restart'))) return;

    const btn = document.getElementById('btnRestart');
    btn.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Restarting...';
    btn.disabled = true;

    try {
      await LP.post('/system/panel/restart');
      LP.toast('Panel is restarting. Reconnecting in 10 seconds...', 'warning');
      setTimeout(() => window.location.reload(), 10000);
    } catch (err) {
      // Expected — server restarted
      LP.toast('Panel is restarting. Reconnecting in 10 seconds...', 'warning');
      setTimeout(() => window.location.reload(), 10000);
    }
  }

  async function loadAutoUpdateConfig() {
    try {
      const res = await LP.get('/system/panel/auto-update');
      if (res?.success) {
        autoUpdateConfig = res.data;
        document.getElementById('autoUpdateToggle').checked = autoUpdateConfig.enabled || false;
        document.getElementById('autoUpdateFreq').value = autoUpdateConfig.frequency || 'daily';
      }
    } catch (err) {
      console.error('Failed to load auto-update config', err);
    }
  }

  async function toggleAutoUpdate() {
    const enabled = document.getElementById('autoUpdateToggle').checked;
    autoUpdateConfig.enabled = enabled;
    await saveAutoUpdateConfig();
  }

  async function saveAutoUpdateConfig() {
    autoUpdateConfig.enabled = document.getElementById('autoUpdateToggle').checked;
    autoUpdateConfig.frequency = document.getElementById('autoUpdateFreq').value;

    try {
      const res = await LP.post('/system/panel/auto-update', autoUpdateConfig);
      if (res?.success) {
        LP.toast(`Auto-update ${autoUpdateConfig.enabled ? 'enabled' : 'disabled'}`, 'success');
      } else {
        LP.toast(res?.message || 'Failed to save setting', 'error');
      }
    } catch (err) {
      LP.toast('Failed to save auto-update config', 'error');
    }
  }

  return { init, checkUpdate, runUpdate, restartPanel, toggleAutoUpdate, saveAutoUpdateConfig };
})();

document.addEventListener('DOMContentLoaded', () => {
  PanelPage.init();
});
