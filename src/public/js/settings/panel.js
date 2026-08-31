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
        const curVer = document.getElementById('currentVersion');
        if (curVer) curVer.textContent = d.current || '1.0.0';
        const lastUp = document.getElementById('lastUpdatedAt');
        if (lastUp) {
          lastUp.value = d.lastUpdated ? new Date(d.lastUpdated).toLocaleString() : '—';
        }
      }
    } catch (err) {
      console.error('Failed to load version info', err);
    }
  }

  async function checkUpdate() {
    const btn = document.getElementById('btnCheckUpdate');
    if (btn) {
      btn.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Checking...';
      btn.disabled = true;
    }

    try {
      const res = await LP.get('/system/panel/check-update');
      if (res?.success) {
        const d = res.data;
        const latestVer = document.getElementById('latestVersion');
        if (latestVer) latestVer.textContent = d.latest || '—';

        const statusEl = document.getElementById('updateStatus');
        if (statusEl) {
          if (d.hasUpdate) {
            statusEl.innerHTML = '<span class="lp-badge lp-badge-danger"><span class="lp-badge-dot"></span>Update Available</span>';
            LP.toast(`New version available: ${d.latest}`, 'info', 'Update Available');
          } else {
            statusEl.innerHTML = '<span class="lp-badge lp-badge-success"><span class="lp-badge-dot"></span>Up to Date</span>';
            LP.toast('Panel is up to date!', 'success');
          }
        }
      } else {
        LP.toast(res?.message || 'Failed to check for updates', 'error');
      }
    } catch (err) {
      LP.toast('Failed to check for updates', 'error');
    } finally {
      if (btn) {
        btn.innerHTML = '<i class="bi bi-arrow-repeat"></i> Check for Updates';
        btn.disabled = false;
      }
    }
  }

  async function runUpdate() {
    if (!(await LP.confirm('This will pull the latest code and restart the panel. Continue?', 'Confirm Update'))) return;

    const method = document.getElementById('updateMethod')?.value || 'git';
    const branch = document.getElementById('updateBranch')?.value || 'main';

    const btn = document.getElementById('btnUpdate');
    if (btn) {
      btn.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Updating...';
      btn.disabled = true;
    }

    const logEl = document.getElementById('updateLog');
    if (logEl) logEl.textContent = `Starting ${method} update on branch "${branch}"...\n`;

    try {
      const res = await LP.post('/system/panel/update', { method, branch });
      if (res?.success) {
        if (logEl) {
          logEl.textContent += res.data?.log || 'Update completed.\n';
          logEl.textContent += '\n✅ Panel updated successfully.';
          logEl.textContent += '\n⏳ Waiting for panel to restart (this may take 10-20 seconds)...';
          logEl.scrollTop = logEl.scrollHeight;
        }
        LP.toast('Panel updated! Waiting for restart...', 'success');

        // Poll until server is back up, then reload
        startReconnectPolling(logEl);
      } else {
        if (logEl) logEl.textContent += `\n❌ Error: ${res?.message || 'Unknown error'}`;
        LP.toast(res?.message || 'Update failed', 'error');
        if (btn) {
          btn.innerHTML = '<i class="bi bi-cloud-download"></i> Update Panel';
          btn.disabled = false;
        }
      }
    } catch (err) {
      if (logEl) logEl.textContent += `\n❌ Connection error: ${err.message}`;
      LP.toast('Connection error during update', 'error');
      if (btn) {
        btn.innerHTML = '<i class="bi bi-cloud-download"></i> Update Panel';
        btn.disabled = false;
      }
    }
  }

  async function restartPanel() {
    if (!(await LP.confirm('Are you sure you want to restart the panel?', 'Confirm Restart'))) return;

    const btn = document.getElementById('btnRestart');
    if (btn) {
      btn.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Restarting...';
      btn.disabled = true;
    }

    const logEl = document.getElementById('updateLog');
    if (logEl) logEl.textContent = '⏳ Sending restart signal...';

    try {
      await LP.post('/system/panel/restart');
    } catch {
      // Expected — server may close connection immediately
    }

    if (logEl) logEl.textContent += '\n⏳ Waiting for panel to come back online...';
    LP.toast('Panel is restarting...', 'warning');
    startReconnectPolling(logEl);
  }

  async function loadAutoUpdateConfig() {
    try {
      const res = await LP.get('/system/panel/auto-update');
      if (res?.success) {
        autoUpdateConfig = res.data;
        const toggle = document.getElementById('autoUpdateToggle');
        if (toggle) toggle.checked = autoUpdateConfig.enabled || false;
        const freq = document.getElementById('autoUpdateFreq');
        if (freq) freq.value = autoUpdateConfig.frequency || 'daily';
      }
    } catch (err) {
      console.error('Failed to load auto-update config', err);
    }
  }

  async function toggleAutoUpdate() {
    const toggle = document.getElementById('autoUpdateToggle');
    const enabled = toggle ? toggle.checked : false;
    autoUpdateConfig.enabled = enabled;
    await saveAutoUpdateConfig();
  }

  async function saveAutoUpdateConfig() {
    const toggle = document.getElementById('autoUpdateToggle');
    const freq = document.getElementById('autoUpdateFreq');
    if (toggle) autoUpdateConfig.enabled = toggle.checked;
    if (freq) autoUpdateConfig.frequency = freq.value;

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

  /**
   * Poll /api/health until the server responds, then reload.
   * Waits up to 60 seconds before giving up.
   */
  function startReconnectPolling(logEl) {
    const maxWait = 60000;   // 60s max
    const interval = 2000;   // check every 2s
    const start = Date.now();
    let _dots = 0;

    const poll = setInterval(async () => {
      _dots++;
      const elapsed = Math.round((Date.now() - start) / 1000);

      if (Date.now() - start > maxWait) {
        clearInterval(poll);
        logEl.textContent += `\n❌ Server did not come back online after ${maxWait / 1000}s. Please check PM2/server logs.`;
        return;
      }

      try {
        const r = await fetch('/api/health', { signal: AbortSignal.timeout(3000) });
        if (r.ok) {
          clearInterval(poll);
          logEl.textContent += `\n✅ Panel is back online after ${elapsed}s! Reloading...`;
          if (logEl) logEl.scrollTop = logEl.scrollHeight;
          setTimeout(() => window.location.reload(), 800);
        }
      } catch {
        // Server still down — keep polling
        if (logEl) {
          const lastNl = logEl.textContent.lastIndexOf('\n');
          const base = logEl.textContent.substring(0, lastNl + 1);
          logEl.textContent = base + `🔄 Waiting for restart... ${elapsed}s`;
          logEl.scrollTop = logEl.scrollHeight;
        }
      }
    }, interval);
  }

  return { init, checkUpdate, runUpdate, restartPanel, toggleAutoUpdate, saveAutoUpdateConfig };
})();
// [FIX] Expose to window for LP.call() resolution
window.PanelPage = PanelPage;

document.addEventListener('DOMContentLoaded', () => {
  PanelPage.init();
});
