const IOT = (() => {
  async function loadData() {
    await Promise.allSettled([
      loadMqtt(),
      loadHa(),
      loadNodeRed(),
      loadMetrics(),
    ]);
  }

  // ── MQTT Broker ──────────────────────────────────────

  async function loadMqtt() {
    try {
      const res = await LP.get('/iot/mqtt/status');
      if (res?.success) {
        const s = res.data;
        const el = document.getElementById('mqttStatus');
        el.innerHTML = `
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;">
            <div class="lp-glass-card" style="padding:10px;text-align:center;">
              <i class="bi bi-check-circle" style="color:${s.active ? '#22c55e' : '#ef4444'};font-size:20px;"></i>
              <div style="font-size:14px;font-weight:600;">${s.active ? 'Active' : 'Inactive'}</div>
              <div style="font-size:10px;color:var(--text-muted);">Mosquitto</div>
            </div>
            <div class="lp-glass-card" style="padding:10px;text-align:center;">
              <div style="font-size:18px;font-weight:600;">${s.port || '—'}</div>
              <div style="font-size:10px;color:var(--text-muted);">Port</div>
            </div>
            <div class="lp-glass-card" style="padding:10px;text-align:center;">
              <div style="font-size:18px;font-weight:600;">${s.clientCount || 0}</div>
              <div style="font-size:10px;color:var(--text-muted);">Clients</div>
            </div>
            <div class="lp-glass-card" style="padding:10px;text-align:center;">
              <div style="font-size:12px;font-weight:600;">${s.version || '—'}</div>
              <div style="font-size:10px;color:var(--text-muted);">Version</div>
            </div>
          </div>
        `;

        const ctrlEl = document.getElementById('mqttControls');
        if (s.installed) {
          ctrlEl.innerHTML = `
            <button class="btn-lp btn-lp-success btn-lp-sm" onclick="IOT.mqttAction('start')"><i class="bi bi-play"></i> Start</button>
            <button class="btn-lp btn-lp-danger btn-lp-sm" onclick="IOT.mqttAction('stop')"><i class="bi bi-stop"></i> Stop</button>
            <button class="btn-lp btn-lp-warning btn-lp-sm" onclick="IOT.mqttAction('restart')"><i class="bi bi-arrow-clockwise"></i> Restart</button>`;
        } else {
          ctrlEl.innerHTML = `<button class="btn-lp btn-lp-primary" onclick="IOT.installMosquitto()"><i class="bi bi-download"></i> Install Mosquitto</button>`;
        }

        // Load config
        const cfg = await LP.get('/iot/mqtt/config');
        if (cfg?.success) document.getElementById('mqttConfigInput').value = cfg.data.config || '';

        // Load users
        const usr = await LP.get('/iot/mqtt/users');
        const usrList = document.getElementById('mqttUsersList');
        if (usr?.success && usr.data.users?.length > 0) {
          usrList.innerHTML = usr.data.users.map(u => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px;border-bottom:1px solid rgba(255,255,255,0.05);">
              <span>${LP.escHtml(u.username)}</span>
              <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="IOT.deleteMqttUser('${LP.encJsArg(u.username)}')"><i class="bi bi-trash"></i></button>
            </div>
          `).join('');
        } else usrList.innerHTML = '<p class="text-muted">No MQTT users configured.</p>';
      }
    } catch {}
  }

  async function installMosquitto() {
    if (!(await LP.confirm('Install Mosquitto MQTT broker?', 'Install Mosquitto'))) return;
    try {
      const res = await LP.post('/iot/mqtt/install');
      if (res?.success) { LP.toast('Mosquitto installed', 'success'); loadMqtt(); }
      else LP.toast('Failed', 'error');
    } catch { LP.toast('Error', 'error'); }
  }

  async function mqttAction(action) {
    try {
      const res = await LP.post('/iot/mqtt/control', { action });
      if (res?.success) { LP.toast(`Mosquitto ${action}ed`, 'success'); loadMqtt(); }
      else LP.toast('Failed', 'error');
    } catch { LP.toast('Error', 'error'); }
  }

  async function saveMqttConfig() {
    const config = document.getElementById('mqttConfigInput').value;
    try {
      const res = await LP.post('/iot/mqtt/config', { config });
      if (res?.success) LP.toast('Config saved & restarted', 'success');
      else LP.toast('Failed', 'error');
    } catch { LP.toast('Error', 'error'); }
  }

  async function addMqttUser() {
    const username = document.getElementById('mqttUserInput').value.trim();
    const password = document.getElementById('mqttPassInput').value;
    if (!username || !password) { LP.toast('Fill username & password', 'error'); return; }
    try {
      const res = await LP.post('/iot/mqtt/users', { username, password });
      if (res?.success) {
        LP.toast('User added', 'success');
        document.getElementById('mqttUserInput').value = '';
        document.getElementById('mqttPassInput').value = '';
        loadMqtt();
      } else LP.toast(res?.message || 'Failed', 'error');
    } catch { LP.toast('Error', 'error'); }
  }

  async function deleteMqttUser(username) {
    if (!(await LP.confirm(`Delete user "${username}"?`, 'Delete User'))) return;
    try {
      const res = await LP.delete('/iot/mqtt/users', { username });
      if (res?.success) { LP.toast('User deleted', 'success'); loadMqtt(); }
      else LP.toast('Failed', 'error');
    } catch { LP.toast('Error', 'error'); }
  }

  async function publish() {
    const topic = document.getElementById('mqttTopicInput').value.trim();
    const message = document.getElementById('mqttMsgInput').value.trim();
    const qos = document.getElementById('mqttQosInput').value;
    if (!topic || !message) { LP.toast('Enter topic & message', 'error'); return; }
    try {
      const res = await LP.post('/iot/mqtt/publish', { topic, message, qos: parseInt(qos) });
      if (res?.success) LP.toast('Message published', 'success');
      else LP.toast('Failed', 'error');
    } catch { LP.toast('Error', 'error'); }
  }

  // ── Home Assistant ───────────────────────────────────

  async function loadHa() {
    const el = document.getElementById('haStatus');
    try {
      const res = await LP.get('/iot/homeassistant');
      if (res?.success) {
        const s = res.data;
        el.innerHTML = `
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:15px;">
            <div class="lp-glass-card" style="padding:10px;text-align:center;">
              <i class="bi bi-check-circle" style="color:${s.active ? '#22c55e' : '#888'};font-size:20px;"></i>
              <div style="font-size:14px;font-weight:600;">${s.active ? 'Running' : 'Not Running'}</div>
              <div style="font-size:10px;color:var(--text-muted);">Status</div>
            </div>
            <div class="lp-glass-card" style="padding:10px;text-align:center;">
              <div style="font-size:14px;font-weight:600;">${s.port || '—'}</div>
              <div style="font-size:10px;color:var(--text-muted);">Port</div>
            </div>
          </div>
          ${s.active ? `<a href="http://${location.hostname}:${s.port || 8123}" target="_blank" class="btn-lp btn-lp-primary"><i class="bi bi-box-arrow-up-right"></i> Open Home Assistant</a>` : ''}
          ${!s.installed ? `<button class="btn-lp btn-lp-primary" onclick="IOT.installHa()"><i class="bi bi-download"></i> Install Docker</button>` : ''}
        `;
      } else el.innerHTML = '<p class="text-muted">Home Assistant not detected.</p>';
    } catch { el.innerHTML = '<p class="text-danger">Failed</p>'; }
  }

  async function installHa() {
    if (!(await LP.confirm('Install Home Assistant (Docker)? This may take a few minutes.', 'Install HA'))) return;
    try {
      const res = await LP.post('/iot/homeassistant/install');
      if (res?.success) { LP.toast('Home Assistant installed', 'success'); loadHa(); }
      else LP.toast('Failed', 'error');
    } catch { LP.toast('Error', 'error'); }
  }

  // ── Node-RED ─────────────────────────────────────────

  async function loadNodeRed() {
    const el = document.getElementById('nrStatus');
    try {
      const res = await LP.get('/iot/nodered');
      if (res?.success) {
        const s = res.data;
        el.innerHTML = `
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:15px;">
            <div class="lp-glass-card" style="padding:10px;text-align:center;">
              <i class="bi bi-check-circle" style="color:${s.active ? '#22c55e' : '#888'};font-size:20px;"></i>
              <div style="font-size:14px;font-weight:600;">${s.active ? 'Running' : 'Not Running'}</div>
              <div style="font-size:10px;color:var(--text-muted);">Status</div>
            </div>
            <div class="lp-glass-card" style="padding:10px;text-align:center;">
              <div style="font-size:14px;font-weight:600;">${s.port || '—'}</div>
              <div style="font-size:10px;color:var(--text-muted);">Port</div>
            </div>
          </div>
          ${s.active ? `<a href="http://${location.hostname}:${s.port || 1880}" target="_blank" class="btn-lp btn-lp-primary"><i class="bi bi-box-arrow-up-right"></i> Open Node-RED</a>` : ''}
          ${!s.installed ? `<button class="btn-lp btn-lp-primary" onclick="IOT.installNodeRed()"><i class="bi bi-download"></i> Install Node-RED</button>` : ''}
        `;
      } else el.innerHTML = '<p class="text-muted">Node-RED not detected.</p>';
    } catch { el.innerHTML = '<p class="text-danger">Failed</p>'; }
  }

  async function installNodeRed() {
    if (!(await LP.confirm('Install Node-RED (Docker)?', 'Install Node-RED'))) return;
    try {
      const res = await LP.post('/iot/nodered/install');
      if (res?.success) { LP.toast('Node-RED installed', 'success'); loadNodeRed(); }
      else LP.toast('Failed', 'error');
    } catch { LP.toast('Error', 'error'); }
  }

  // ── Device Discovery ─────────────────────────────────

  async function discover() {
    const subnet = document.getElementById('discoverSubnet').value.trim();
    const el = document.getElementById('devicesList');
    el.innerHTML = '<p class="text-muted">Scanning network...</p>';

    try {
      const res = await LP.post('/iot/discover', { subnet });
      if (res?.success && Array.isArray(res.data.devices)) {
        if (res.data.devices.length === 0) {
          el.innerHTML = '<p class="text-muted">No devices found.</p>';
          return;
        }
        el.innerHTML = `<div style="font-size:12px;margin-bottom:8px;color:var(--text-muted);">Found ${res.data.count} devices</div>
          <table class="lp-table" style="font-size:12px;"><thead><tr><th>IP Address</th><th>Hostname</th></tr></thead>
          <tbody>${res.data.devices.map(d => `<tr><td>${d.ip}</td><td>${LP.escHtml(d.hostname)}</td></tr>`).join('')}</tbody></table>`;
      } else el.innerHTML = '<p class="text-danger">Failed to scan</p>';
    } catch { el.innerHTML = '<p class="text-danger">Error scanning network</p>'; }
  }

  // ── Metrics ──────────────────────────────────────────

  async function loadMetrics() {
    const el = document.getElementById('iotMetricsContent');
    try {
      const res = await LP.get('/iot/metrics');
      if (res?.success) {
        el.innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="lp-glass-card" style="padding:15px;text-align:center;">
            <div style="font-size:24px;font-weight:600;color:#6366f1;">${res.data.messagesSent || 0}</div>
            <div style="font-size:11px;color:var(--text-muted);">Messages Sent</div>
          </div>
          <div class="lp-glass-card" style="padding:15px;text-align:center;">
            <div style="font-size:24px;font-weight:600;color:#22c55e;">${res.data.bytesSent ? (res.data.bytesSent / 1024).toFixed(1) : 0} KB</div>
            <div style="font-size:11px;color:var(--text-muted);">Data Transferred</div>
          </div>
        </div>`;
      } else el.innerHTML = '<p class="text-muted">No metrics available.</p>';
    } catch { el.innerHTML = '<p class="text-danger">Failed</p>'; }
  }

  document.addEventListener('DOMContentLoaded', loadData);

  return { loadData,
    installMosquitto, mqttAction, saveMqttConfig, addMqttUser, deleteMqttUser, publish,
    loadHa, installHa, loadNodeRed, installNodeRed, discover, loadMetrics };
})();

window.IOT = IOT;
