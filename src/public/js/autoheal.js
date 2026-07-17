/**
 * Panelku — autoheal.js
 * Auto-Healing Dashboard frontend
 */

const AutoHealPage = {
  async init() {
    await LP.init();
    if (!LP.state.accessToken) return;
    this.refresh();
  },

  async refresh() {
    await Promise.all([
      this.loadStatus(),
      this.loadConfig(),
      this.loadIncidents(),
    ]);
  },

  // ── Tab Switching ────────────────────────────────────

  switchTab(tabId) {
    document.querySelectorAll('.ah-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.ah-tab-content').forEach(t => t.classList.remove('active'));
    const tabBtn = document.querySelector(`.ah-tab[data-tab="${tabId}"]`);
    if (tabBtn) tabBtn.classList.add('active');
    const tabContent = document.getElementById(`tab-${tabId}`);
    if (tabContent) tabContent.classList.add('active');

    if (tabId === 'services') this.loadServiceManager();
    if (tabId === 'incidents') this.loadIncidents();
  },

  // ══════════════════════════════════════════════════════
  //  STATUS
  // ══════════════════════════════════════════════════════

  async loadStatus() {
    try {
      const res = await LP.get('/autoheal/status');
      if (!res?.success) throw new Error(res?.message);

      const services = res.data?.status || [];
      let healthy = 0, warning = 0, critical = 0, _disabled = 0;

      services.forEach(s => {
        if (s.status === 'healthy' || s.status === 'running') healthy++;
        else if (s.status === 'warning') warning++;
        else if (s.status === 'critical') critical++;
        else if (s.status === 'disabled') disabled++;
      });

      document.getElementById('ahHealthyCount').textContent = healthy;
      document.getElementById('ahWarningCount').textContent = warning;
      document.getElementById('ahCriticalCount').textContent = critical;

      // Engine status card
      const engineEl = document.getElementById('ahEngineStatus');
      const engineRunning = services.length > 0;
      engineEl.innerHTML = engineRunning
        ? '<span style="color:#10b981;">● Active</span>'
        : '<span style="color:#6b7280;">● Idle</span>';

      // Dashboard grid
      const grid = document.getElementById('ahServiceGrid');
      if (services.length === 0) {
        grid.innerHTML = '<div class="col-12" style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px;">No services monitored</div>';
        return;
      }

      grid.innerHTML = services.map(s => {
        const isHealthy = s.status === 'healthy' || s.status === 'running';
        const isWarning = s.status === 'warning';
        const isCritical = s.status === 'critical';
        const borderColor = isHealthy ? 'var(--accent-success)' : isWarning ? 'var(--accent-warning)' : isCritical ? 'var(--accent-danger)' : 'var(--text-muted)';
        const icon = isHealthy ? 'bi-check-circle-fill' : isCritical ? 'bi-exclamation-triangle-fill' : 'bi-dash-circle';
        const iconColor = isHealthy ? '#10b981' : isCritical ? '#ef4444' : '#6b7280';

        return `
          <div class="col-6 col-md-4 col-lg-3">
            <div class="p-3 rounded d-flex align-items-center gap-2" style="border-left:3px solid ${borderColor};background:rgba(0,0,0,0.08);">
              <i class="bi ${icon}" style="font-size:18px;color:${iconColor};flex-shrink:0;"></i>
              <div style="min-width:0;">
                <div style="font-size:12px;font-weight:600;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${LP.escHtml(s.name)}</div>
                <div style="font-size:10px;color:var(--text-muted);">${LP.escHtml(s.message || s.status)}</div>
              </div>
              ${isCritical ? `<button class="btn-lp btn-lp-ghost btn-lp-sm p-0 ms-auto" style="font-size:10px;color:#ef4444;flex-shrink:0;" onclick="AutoHealPage.healService('${LP.encJsArg(s.serviceName || s.name)}')" title="Restart Service"><i class="bi bi-arrow-clockwise"></i></button>` : ''}
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      console.error('Status error:', err);
    }
  },

  // ══════════════════════════════════════════════════════
  //  CONFIG
  // ══════════════════════════════════════════════════════

  async loadConfig() {
    try {
      const res = await LP.get('/autoheal/config');
      if (!res?.success) return;
      const cfg = res.data?.config;

      document.getElementById('ahEnabled').checked = cfg.enabled !== false;
      document.getElementById('ahInterval').value = cfg.checkInterval || 180;
      document.getElementById('ahMaxRetries').value = cfg.maxRetries || 3;
      document.getElementById('ahCooldown').value = cfg.cooldownMinutes || 15;
      document.getElementById('ahNotifyHeal').checked = cfg.notifyOnHeal !== false;
      document.getElementById('ahNotifyRecovery').checked = cfg.notifyOnRecovery !== false;
      document.getElementById('ahCpuThreshold').value = cfg.cpuThreshold || 90;
      document.getElementById('ahMemThreshold').value = cfg.memoryThreshold || 90;
      document.getElementById('ahDiskThreshold').value = cfg.diskThreshold || 90;
      document.getElementById('ahCheckDocker').checked = cfg.docker !== false;
      document.getElementById('ahCheckWebsites').checked = cfg.websites !== false;
    } catch { /* ignore */ }
  },

  async toggleEngine() {
    // Auto-save when toggle changes
    this.saveConfig();
  },

  async saveConfig() {
    const config = {
      enabled: document.getElementById('ahEnabled').checked,
      checkInterval: parseInt(document.getElementById('ahInterval').value) || 180,
      maxRetries: parseInt(document.getElementById('ahMaxRetries').value) || 3,
      cooldownMinutes: parseInt(document.getElementById('ahCooldown').value) || 15,
      notifyOnHeal: document.getElementById('ahNotifyHeal').checked,
      notifyOnRecovery: document.getElementById('ahNotifyRecovery').checked,
      cpuThreshold: parseInt(document.getElementById('ahCpuThreshold').value) || 90,
      memoryThreshold: parseInt(document.getElementById('ahMemThreshold').value) || 90,
      diskThreshold: parseInt(document.getElementById('ahDiskThreshold').value) || 90,
      docker: document.getElementById('ahCheckDocker').checked,
      websites: document.getElementById('ahCheckWebsites').checked,
    };

    try {
      const res = await LP.post('/autoheal/config', config);
      if (res?.success) {
        LP.toast('Auto-Healing config saved!', 'success');
      } else {
        LP.toast(res?.message || 'Failed to save config', 'error');
      }
    } catch (err) {
      LP.toast('Error saving config: ' + err.message, 'error');
    }
  },

  // ══════════════════════════════════════════════════════
  //  SERVICE MANAGER
  // ══════════════════════════════════════════════════════

  async loadServiceManager() {
    try {
      const res = await LP.get('/autoheal/config');
      if (!res?.success) throw new Error(res?.message);

      const services = res.data?.config?.services || [];
      const container = document.getElementById('ahServiceManagerList');

      if (services.length === 0) {
        container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px;">No services configured</div>';
        return;
      }

      container.innerHTML = services.map((svc, idx) => `
        <div class="d-flex justify-content-between align-items-center py-2 px-3 rounded mb-1" style="background:rgba(0,0,0,0.08);border:1px solid var(--glass-border);">
          <div style="display:flex;align-items:center;gap:10px;">
            <div class="form-check" style="margin:0;">
              <input class="form-check-input" type="checkbox" ${svc.enabled ? 'checked' : ''} id="svc_${idx}" onchange="AutoHealPage.toggleService(${idx}, this.checked)" style="cursor:pointer;">
            </div>
            <div>
              <strong style="font-size:14px;color:var(--text-primary);">${LP.escHtml(svc.displayName || svc.name)}</strong>
              <div style="font-size:11px;color:var(--text-muted);">
                <code>${LP.escHtml(svc.name)}</code> · ${svc.type || 'systemd'}
                ${svc.critical ? '· <span class="text-warning">Critical</span>' : ''}
              </div>
            </div>
          </div>
          <div style="display:flex;gap:5px;">
            <button class="btn-lp btn-lp-ghost btn-lp-sm text-info" onclick="AutoHealPage.healService('${LP.encJsArg(svc.name)}')" title="Restart ${LP.escHtml(svc.name)}" style="font-size:11px;">
              <i class="bi bi-arrow-clockwise"></i> Restart
            </button>
            <button class="btn-lp btn-lp-ghost btn-lp-sm" onclick="AutoHealPage.checkService('${LP.encJsArg(svc.name)}')" title="Check ${LP.escHtml(svc.name)} status" style="font-size:11px;">
              <i class="bi bi-search"></i>
            </button>
          </div>
        </div>
      `).join('');
    } catch (err) {
      document.getElementById('ahServiceManagerList').innerHTML =
        `<div style="padding:20px;text-align:center;color:var(--accent-danger);font-size:13px;">Error: ${LP.escHtml(err.message)}</div>`;
    }
  },

  async toggleService(idx, enabled) {
    try {
      const res = await LP.get('/autoheal/config');
      const services = res.data?.config?.services || [];
      if (services[idx]) {
        services[idx].enabled = enabled;
        await LP.post('/autoheal/config', { ...res.data.config, services });
        LP.toast(`Service monitoring ${enabled ? 'enabled' : 'disabled'}`, 'success');
      }
    } catch (err) {
      LP.toast('Error: ' + err.message, 'error');
    }
  },

  // ══════════════════════════════════════════════════════
  //  ACTIONS
  // ══════════════════════════════════════════════════════

  async runCheck() {
    LP.toast('Running health check...', 'info');
    try {
      const res = await LP.post('/autoheal/check');
      if (res?.success) {
        LP.toast('Health check complete', 'success');
        this.refresh();
      } else {
        LP.toast(res?.message || 'Check failed', 'error');
      }
    } catch (err) {
      LP.toast('Error: ' + err.message, 'error');
    }
  },

  async healService(serviceName) {
    if (!serviceName) return;
    LP.toast(`Attempting to restart ${serviceName}...`, 'info');
    try {
      const res = await LP.post('/autoheal/heal', { name: serviceName });
      if (res?.success) {
        LP.toast(res.message || `${serviceName} restarted`, 'success');
        setTimeout(() => this.loadStatus(), 2000);
      } else {
        LP.toast(res?.message || `Failed to restart ${serviceName}`, 'error');
      }
    } catch (err) {
      LP.toast('Error: ' + err.message, 'error');
    }
  },

  async checkService(serviceName) {
    LP.toast(`Checking ${serviceName}...`, 'info');
    try {
      const _statusEl = document.querySelector(`[onclick*="healService('${serviceName}')"]`)?.closest('.d-flex');
      const res = await LP.get('/autoheal/status');
      const svc = res.data?.status?.find(s => s.serviceName === serviceName || s.name === serviceName);
      if (svc) {
        LP.toast(`${serviceName}: ${svc.status} — ${svc.message}`, svc.status === 'healthy' ? 'success' : 'warning');
      } else {
        LP.toast(`${serviceName}: Unknown`, 'info');
      }
    } catch (err) {
      LP.toast('Error: ' + err.message, 'error');
    }
  },

  // ══════════════════════════════════════════════════════
  //  INCIDENTS
  // ══════════════════════════════════════════════════════

  async loadIncidents() {
    try {
      const res = await LP.get('/autoheal/incidents?limit=50');
      if (!res?.success) throw new Error(res?.message);

      const incidents = res.data?.incidents || [];
      const container = document.getElementById('ahIncidentList');

      if (incidents.length === 0) {
        container.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text-muted);font-size:13px;">No incidents recorded. The system is healthy! <i class="bi bi-emoji-smile ms-1"></i></div>';
        return;
      }

      container.innerHTML = incidents.map(inc => {
        const isAlert = inc.type === 'alert' || inc.title?.toLowerCase().includes('alert') || inc.title?.toLowerCase().includes('critical');
        const icon = isAlert ? 'bi-exclamation-triangle-fill text-danger' : 'bi-info-circle-fill text-info';
        const time = inc.created ? new Date(inc.created).toLocaleString() : '';

        return `
          <div class="d-flex gap-3 py-2 px-3 rounded mb-1" style="background:rgba(0,0,0,0.06);border:1px solid var(--glass-border);">
            <div style="flex-shrink:0;margin-top:2px;"><i class="bi ${icon}" style="font-size:14px;"></i></div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:12px;font-weight:600;color:var(--text-primary);">${LP.escHtml(inc.title || 'Incident')}</div>
              <div style="font-size:11px;color:var(--text-muted);">${LP.escHtml(inc.message || '')}</div>
            </div>
            <div style="font-size:10px;color:var(--text-muted);flex-shrink:0;white-space:nowrap;">${time}</div>
          </div>
        `;
      }).join('');
    } catch (err) {
      document.getElementById('ahIncidentList').innerHTML =
        `<div style="padding:20px;text-align:center;color:var(--accent-danger);font-size:13px;">Error: ${LP.escHtml(err.message)}</div>`;
    }
  },
};

document.addEventListener('DOMContentLoaded', () => AutoHealPage.init());
