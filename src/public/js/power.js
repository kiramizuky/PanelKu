const POWER = (() => {
  async function loadData() {
    await Promise.allSettled([
      loadCpuInfo(),
      loadPowerProfiles(),
      loadThermal(),
      loadFans(),
    ]);
  }

  // ── CPU Governor ─────────────────────────────────────

  async function loadCpuInfo() {
    const el = document.getElementById('cpuGovernorContent');
    try {
      const res = await LP.get('/power/cpu');
      if (res?.success && res.data) {
        const info = res.data;
        let html = `
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-bottom:15px;">
            <div class="lp-glass-card" style="padding:12px;text-align:center;">
              <div style="font-size:20px;font-weight:600;">${info.totalCores || '—'}</div>
              <div style="font-size:11px;color:var(--text-muted);">Cores/Threads</div>
            </div>
            <div class="lp-glass-card" style="padding:12px;text-align:center;">
              <div style="font-size:16px;font-weight:600;">${info.model ? info.model.substring(0, 30) + '...' : '—'}</div>
              <div style="font-size:11px;color:var(--text-muted);">Model</div>
            </div>
            <div class="lp-glass-card" style="padding:12px;text-align:center;">
              <div style="font-size:16px;font-weight:600;color:var(--accent-primary);">${info.currentGovernor || '—'}</div>
              <div style="font-size:11px;color:var(--text-muted);">Current Governor</div>
            </div>
          </div>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            <label class="lp-label" style="margin:0;">Set Governor:</label>
            <select id="governorSelect" class="lp-input" style="width:auto;font-size:12px;margin:0;">
              ${(info.availableGovernors || []).map(g => `<option value="${g}" ${g === info.currentGovernor ? 'selected' : ''}>${g}</option>`).join('')}
            </select>
            <button class="btn-lp btn-lp-primary btn-lp-sm" onclick="POWER.setGovernor()">Apply</button>
            <label class="lp-label" style="margin:0 0 0 15px;">Set Freq (MHz):</label>
            <input type="number" id="freqInput" class="lp-input" style="width:100px;font-size:12px;margin:0;" placeholder="e.g. 2400">
            <button class="btn-lp btn-lp-ghost btn-lp-sm" onclick="POWER.setFrequency()">Set</button>
          </div>
          <details style="margin-top:15px;">
            <summary style="font-size:11px;color:var(--text-muted);cursor:pointer;">Per-Core Details (${info.cpus?.length || 0} cores)</summary>
            <table class="lp-table" style="font-size:11px;margin-top:8px;">
              <thead><tr><th>Core</th><th>Status</th><th>Governor</th><th>Current Freq</th><th>Min Freq</th><th>Max Freq</th></tr></thead>
              <tbody>${(info.cpus || []).map(c => `
                <tr>
                  <td>CPU${c.index}</td>
                  <td>${c.online !== false ? '<span class="text-success">Online</span>' : '<span class="text-danger">Offline</span>'}</td>
                  <td>${c.governor || '—'}</td>
                  <td>${c.currentFreq ? (c.currentFreq / 1000000).toFixed(2) + ' GHz' : '—'}</td>
                  <td>${c.minFreq ? (c.minFreq / 1000000).toFixed(2) + ' GHz' : '—'}</td>
                  <td>${c.maxFreq ? (c.maxFreq / 1000000).toFixed(2) + ' GHz' : '—'}</td>
                </tr>
              `).join('')}</tbody>
            </table>
          </details>
        `;
        el.innerHTML = html;
      } else {
        el.innerHTML = '<p class="text-warning">CPU frequency scaling info not available. Ensure cpufreq drivers are loaded.</p>';
      }
    } catch {
      el.innerHTML = '<p class="text-danger">Failed to load CPU info</p>';
    }
  }

  async function setGovernor() {
    const gov = document.getElementById('governorSelect').value;
    try {
      const res = await LP.post('/power/cpu/governor', { governor: gov });
      if (res?.success) { LP.toast(`Governor set to ${gov}`, 'success'); loadCpuInfo(); }
      else LP.toast('Failed', 'error');
    } catch { LP.toast('Error', 'error'); }
  }

  async function setFrequency() {
    const mhz = document.getElementById('freqInput').value;
    if (!mhz) { LP.toast('Enter frequency in MHz', 'error'); return; }
    const khz = parseInt(mhz) * 1000;
    try {
      const res = await LP.post('/power/cpu/frequency', { khz });
      if (res?.success) LP.toast(`Frequency set to ${mhz} MHz`, 'success');
      else LP.toast('Failed', 'error');
    } catch { LP.toast('Error', 'error'); }
  }

  // ── Power Profiles ───────────────────────────────────

  async function loadPowerProfiles() {
    const el = document.getElementById('powerProfilesContent');
    try {
      const res = await LP.get('/power/profiles');
      if (res?.success && res.data) {
        const { available, current, profiles } = res.data;
        if (!available) {
          el.innerHTML = '<p class="text-muted">Power profiles daemon (power-profiles-daemon) not available.</p>';
          return;
        }
        el.innerHTML = `
          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            ${(profiles || []).map(p => `
              <button class="btn-lp ${p === current ? 'btn-lp-primary' : 'btn-lp-ghost'}" onclick="POWER.setProfile('${p}')" style="text-transform:capitalize;">
                <i class="bi ${p === 'performance' ? 'bi-lightning-charge' : p === 'power-saver' ? 'bi-battery' : 'bi-sliders'} me-1"></i>
                ${p.replace('-', ' ')}
              </button>
            `).join('')}
          </div>
          <div style="margin-top:10px;font-size:11px;color:var(--text-muted);">
            Current: <strong style="color:var(--accent-primary);">${current}</strong>
          </div>
        `;
      } else {
        el.innerHTML = '<p class="text-muted">Power profiles not available.</p>';
      }
    } catch {
      el.innerHTML = '<p class="text-danger">Failed to load profiles</p>';
    }
  }

  async function setProfile(profile) {
    try {
      const res = await LP.post('/power/profiles', { profile });
      if (res?.success) { LP.toast(`Profile: ${profile}`, 'success'); loadPowerProfiles(); }
      else LP.toast('Failed', 'error');
    } catch { LP.toast('Error', 'error'); }
  }

  // ── Thermal ──────────────────────────────────────────

  async function loadThermal() {
    const el = document.getElementById('thermalContent');
    try {
      const res = await LP.get('/power/thermal');
      if (res?.success && res.data) {
        const { zones, maxTemp, criticalZones } = res.data;
        if (zones.length === 0) {
          el.innerHTML = '<p class="text-muted">No thermal zones available.</p>';
          return;
        }
        el.innerHTML = `
          <div style="margin-bottom:10px;text-align:center;">
            <span style="font-size:28px;font-weight:700;${maxTemp > 80 ? 'color:var(--accent-danger)' : maxTemp > 60 ? 'color:#f59e0b' : 'color:#22c55e'}">${maxTemp.toFixed(1)}°C</span>
            <div style="font-size:11px;color:var(--text-muted);">Max Temp</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            ${zones.map(z => {
              const pct = Math.min(z.tempCelsius / 100 * 100, 100);
              return `
                <div>
                  <div style="display:flex;justify-content:space-between;font-size:11px;">
                    <span>${z.type} (${z.zone})</span>
                    <span style="${z.tempCelsius > 80 ? 'color:var(--accent-danger)' : z.tempCelsius > 60 ? 'color:#f59e0b' : ''}">${z.tempCelsius.toFixed(1)}°C</span>
                  </div>
                  <div class="power-gauge"><div class="power-gauge-bar" style="width:${pct}%;background:${z.tempCelsius > 80 ? '#ef4444' : z.tempCelsius > 60 ? '#f59e0b' : '#22c55e'};"></div></div>
                </div>
              `;
            }).join('')}
          </div>
          ${criticalZones.length > 0 ? `<div style="margin-top:10px;padding:8px;background:rgba(239,68,68,0.15);border-radius:8px;font-size:11px;color:var(--accent-danger);"><i class="bi bi-exclamation-triangle"></i> ${criticalZones.length} zone(s) above 85°C threshold!</div>` : ''}
        `;
      } else {
        el.innerHTML = '<p class="text-muted">No thermal data available.</p>';
      }
    } catch {
      el.innerHTML = '<p class="text-danger">Failed to load thermal info</p>';
    }
  }

  // ── Fans ─────────────────────────────────────────────

  async function loadFans() {
    const el = document.getElementById('fansContent');
    try {
      const res = await LP.get('/power/fans');
      if (res?.success) {
        const fans = res.data.fans || [];
        if (fans.length === 0) {
          el.innerHTML = '<p class="text-muted">No fan sensors detected.</p>';
          return;
        }
        el.innerHTML = fans.map(f => `
          <div class="lp-glass-card" style="padding:10px;margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;font-size:12px;">
              <span>${f.label}</span>
              <span style="font-weight:600;">${f.rpm} RPM</span>
            </div>
          </div>
        `).join('');
      } else {
        el.innerHTML = '<p class="text-muted">No fan data.</p>';
      }
    } catch {
      el.innerHTML = '<p class="text-danger">Failed to load fan info</p>';
    }
  }

  // ── System Sleep ─────────────────────────────────────

  async function systemAction(action) {
    const labels = { suspend: 'Suspend', hibernate: 'Hibernate', 'hybrid-sleep': 'Hybrid Sleep' };
    if (!(await LP.confirm(`Send system to ${labels[action]}?`, 'Confirm Action'))) return;

    try {
      const res = await LP.post(`/power/${action}`);
      if (res?.success) LP.toast(`${labels[action]} initiated`, 'success');
      else LP.toast('Failed', 'error');
    } catch { LP.toast('Error', 'error'); }
  }

  document.addEventListener('DOMContentLoaded', loadData);

  return { loadData, setGovernor, setFrequency, setProfile, systemAction };
})();

window.POWER = POWER;
