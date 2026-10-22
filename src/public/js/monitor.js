/**
 * Linux Panel — monitor.js
 * Realtime system metrics and information
 */

const MonitorPage = (() => {
  let cpuChartInstance = null;
  let memChartInstance = null;

  const chartData = {
    labels: Array(30).fill(''),
    cpu: Array(30).fill(0),
    mem: Array(30).fill(0),
  };

  const chartConfig = (color, label, dataArr) => ({
    type: 'line',
    data: {
      labels: chartData.labels,
      datasets: [{
        label: label,
        data: dataArr,
        borderColor: color,
        backgroundColor: color + '20',
        fill: true,
        tension: 0.4,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 0 },
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false },
        y: { 
          min: 0, 
          max: 100, 
          grid: { color: 'rgba(255,255,255,0.05)' },
          border: { display: false },
          ticks: { color: '#64748b' }
        }
      }
    }
  });

  async function loadSysInfo() {
    try {
      const res = await LP.get('/monitor/sysinfo');
      if (res?.success) {
        const d = res.data;
        document.getElementById('sys-hostname').textContent = d.os?.hostname || '—';
        document.getElementById('sys-os').textContent = d.os?.distro || '—';
        document.getElementById('sys-platform').textContent = d.os?.platform || '—';
        document.getElementById('sys-kernel').textContent = d.os?.kernel || '—';
        const cpuModel = [d.cpu?.manufacturer, d.cpu?.brand].filter(Boolean).join(' ');
        document.getElementById('sys-cpuModel').textContent = cpuModel || '—';
        document.getElementById('sys-cpuCores').textContent = d.cpu?.cores || '—';
      }
    } catch (err) {
      console.error('Failed to load sysinfo:', err);
    }
  }

  function renderDisks(disks) {
    const container = document.getElementById('disksContainer');
    if (!container) return;
    if (!disks || !disks.length) {
      container.innerHTML = '<div class="text-center text-muted">No disk data</div>';
      return;
    }
    container.innerHTML = disks.slice(0, 5).map(d => {
      const total = d.total || d.size || 0;
      const used = d.used || 0;
      const usedPct = Number.isFinite(d.usedPercent)
        ? d.usedPercent
        : (Number.isFinite(d.use) ? d.use : Math.round((used / (total || 1)) * 100));
      return `
        <div class="mb-3">
          <div class="d-flex justify-content-between mb-1" style="font-size:12px;">
            <span class="font-mono" style="color: #cbd5e1;">${LP.escHtml(d.fs || d.mount)}</span>
            <span style="color: #f8fafc;">${usedPct}% (${LP.formatBytes(used)} / ${LP.formatBytes(total)})</span>
          </div>
          <div class="progress" style="height:6px; background:rgba(255,255,255,0.1)">
            <div class="progress-bar ${usedPct > 80 ? 'bg-danger' : usedPct > 60 ? 'bg-warning' : 'bg-primary'}" style="width:${usedPct}%"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderNetwork(networks) {
    const container = document.getElementById('networkContainer');
    if (!container) return;
    if (!networks || !networks.length) {
      container.innerHTML = '<div class="text-center text-muted">No network data</div>';
      return;
    }
    container.innerHTML = networks.map(n => {
      const isUp = n.operstate === 'up' || (n.rxSec > 0 || n.txSec > 0);
      const stateBadge = isUp
        ? '<span class="badge bg-success-subtle text-success border border-success-subtle py-0 px-1" style="font-size:10px;">UP</span>'
        : '<span class="badge bg-secondary-subtle text-muted border border-secondary-subtle py-0 px-1" style="font-size:10px;">DOWN</span>';

      return `
        <div class="d-flex justify-content-between align-items-center mb-2" style="font-size:13px; padding: 9px 12px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); border-radius:8px;">
          <div>
            <div class="d-flex align-items-center gap-2">
              <i class="bi bi-ethernet text-info" style="font-size:14px;"></i>
              <strong style="color:#f8fafc; font-size:13.5px;">${LP.escHtml(n.iface)}</strong>
              ${stateBadge}
            </div>
            <div class="font-mono" style="font-size:11px; color:#cbd5e1; margin-top:2px;">
              IP: ${LP.escHtml(n.ip4 || 'No IP')} ${n.mac ? `<span style="opacity:0.6;">(${LP.escHtml(n.mac)})</span>` : ''}
            </div>
          </div>
          <div class="text-end" style="font-size:12px; font-family:var(--font-mono);">
            <div><span class="text-info"><i class="bi bi-arrow-down-short"></i></span> ${LP.formatBytes(n.rxSec || n.rx_sec || 0)}/s</div>
            <div><span class="text-warning"><i class="bi bi-arrow-up-short"></i></span> ${LP.formatBytes(n.txSec || n.tx_sec || 0)}/s</div>
          </div>
        </div>
      `;
    }).join('');
  }

  function formatUptime(seconds) {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor(seconds % (3600 * 24) / 3600);
    const m = Math.floor(seconds % 3600 / 60);
    return `${d}d ${h}h ${m}m`;
  }

  async function pollMetrics() {
    if (isPaused || document.hidden || wsHealthy()) return;
    try {
      // Pump the same normalized payload the WS namespace broadcasts. This
      // endpoint is the fallback, not a second poll that runs in parallel.
      const res = await LP.get('/monitor/current');
      if (res?.success) applyMetrics(res.data);
    } catch (err) {
      console.error('Failed to poll metrics:', err);
    }
  }

  /**
   * Apply either the flat realtime payload (WS + /monitor/current) or the
   * legacy dashboard shape. Keeps chart/UI updates in one place.
   */
  function applyMetrics(d) {
    if (!d) return;

    const cpuPct = Math.round(typeof d.cpu === 'number' ? d.cpu : (d.cpu?.usage || 0));
    const load = d.loadAvg || d.cpu?.loadAvg || [0, 0, 0];
    const memUsed = d.ramUsed ?? d.memory?.used ?? 0;
    const memTotal = d.ramTotal ?? d.memory?.total ?? 0;
    const memPct = d.ramPercent ?? d.memory?.percent
      ?? (memTotal ? Math.round((memUsed / memTotal) * 100) : 0);
    const uptime = d.uptime ?? d.system?.uptime ?? d.os?.uptime ?? 0;
    const disks = d.disks || d.disk || [];
    const networks = d.networks || d.network || [];

    const uptimeEl = document.getElementById('sys-uptime');
    if (uptimeEl) uptimeEl.textContent = formatUptime(uptime);

    const loadEls = ['load-1m', 'load-5m', 'load-15m'].map(id => document.getElementById(id));
    loadEls.forEach((el, i) => {
      if (el) el.textContent = (load[i] || 0).toFixed(2);
    });

    const cpuEl = document.getElementById('cpuValue');
    if (cpuEl) cpuEl.textContent = cpuPct + '%';
    if (cpuChartInstance) {
      chartData.cpu.push(cpuPct);
      chartData.cpu.shift();
      cpuChartInstance.update();
    }

    const memEl = document.getElementById('memValue');
    if (memEl) memEl.textContent = memPct + '%';
    if (memChartInstance) {
      chartData.mem.push(memPct);
      chartData.mem.shift();
      memChartInstance.update();
    }

    renderDisks(disks);
    renderNetwork(Array.isArray(networks) ? networks : [networks].filter(Boolean));
  }

  let processesList = [];
  let currentSortField = 'cpu';
  let processesModalInstance = null;
  let searchTerm = '';
  let showMemMB = false;

  function filterProcesses() {
    searchTerm = (document.getElementById('processSearch').value || '').toLowerCase();
    renderProcessesTable();
  }

  function toggleMemFormat() {
    showMemMB = document.getElementById('memFormatToggle').checked;
    renderProcessesTable();
  }

  async function killProcess(pid, signal = 'SIGTERM') {
    if (!confirm(`Are you sure you want to send ${signal} to process ${pid}?`)) return;
    
    try {
      const res = await LP.post(`/monitor/processes/${pid}/kill`, { signal });
      if (res?.success) {
        LP.toast('success', res.message || `Process ${pid} killed`);
        setTimeout(fetchProcesses, 1000);
      } else {
        LP.toast('error', res?.message || 'Failed to kill process');
      }
    } catch (err) {
      LP.toast('error', 'Error killing process');
    }
  }

  async function openProcessesModal(sortField = 'cpu') {
    currentSortField = sortField;
    
    if (!processesModalInstance) {
      processesModalInstance = new bootstrap.Modal(document.getElementById('processesModal'));
    }
    
    processesModalInstance.show();
    await fetchProcesses();
  }

  async function fetchProcesses() {
    const tbody = document.getElementById('processesTableBody');
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4"><span class="spinner-border spinner-border-sm me-2" role="status"></span>Loading processes...</td></tr>`;
    
    try {
      const res = await LP.get('/monitor/processes');
      if (res?.success) {
        processesList = res.data || [];
        renderProcessesTable();
      } else {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-4">Failed to fetch processes: ${LP.escHtml(res?.message || 'Unknown error')}</td></tr>`;
      }
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-4">Error loading processes.</td></tr>`;
    }
  }

  function renderProcessesTable() {
    const tbody = document.getElementById('processesTableBody');
    if (!processesList.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">No processes running</td></tr>`;
      return;
    }

    let filtered = processesList;
    if (searchTerm) {
      filtered = filtered.filter(p => p.name.toLowerCase().includes(searchTerm) || String(p.pid).includes(searchTerm));
    }

    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">No matching processes found</td></tr>`;
      return;
    }

    const sorted = [...filtered].sort((a, b) => {
      const valA = parseFloat(a[currentSortField]) || 0;
      const valB = parseFloat(b[currentSortField]) || 0;
      return valB - valA;
    });

    const btnSortCpu = document.getElementById('btnSortCpu');
    const btnSortMem = document.getElementById('btnSortMem');
    if (btnSortCpu && btnSortMem) {
      if (currentSortField === 'cpu') {
        btnSortCpu.className = 'btn btn-light btn-sm';
        btnSortMem.className = 'btn btn-outline-light btn-sm';
      } else {
        btnSortCpu.className = 'btn btn-outline-light btn-sm';
        btnSortMem.className = 'btn btn-light btn-sm';
      }
    }

    tbody.innerHTML = sorted.map(p => {
      let memDisplay = (p.mem || 0).toFixed(1) + '%';
      if (showMemMB && p.memRss) {
        memDisplay = (p.memRss / 1024).toFixed(1) + ' MB';
      }
      return `
      <tr style="border-bottom: 1px solid rgba(255,255,255,0.03); vertical-align: middle;">
        <td style="font-family: monospace; font-weight: 600; color: var(--text-muted);">${p.pid}</td>
        <td style="font-weight: 600; color: var(--text-primary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 180px;" title="${LP.escHtml(p.name)}">${LP.escHtml(p.name)}</td>
        <td class="font-mono ${currentSortField === 'cpu' ? 'text-success font-weight-bold' : ''}">${(p.cpu || 0).toFixed(1)}%</td>
        <td class="font-mono ${currentSortField === 'mem' ? 'text-info font-weight-bold' : ''}">${memDisplay}</td>
        <td style="color: var(--text-muted);">${LP.escHtml(p.user || 'root')}</td>
        <td><span class="badge bg-dark text-muted" style="font-size:10px;">${p.state || 'running'}</span></td>
        <td class="text-end">
          <button class="btn btn-sm btn-outline-danger py-0 px-2" style="font-size: 11px;" data-lp-on-click="${LP.registerInlineHandler('click', function (_event) { MonitorPage.killProcess((p.pid))
    })}" title="Kill Process"><i class="bi bi-x-circle"></i></button>
        </td>
      </tr>
      `;
    }).join('');
  }

  function sortProcesses(field) {
    currentSortField = field;
    renderProcessesTable();
  }

  let _pollInterval = null;
  let _fallbackTimer = null;
  let _wsSocket = null;
  let _wsConnected = false;
  let _lastWsAt = 0;
  let _visibilityBound = false;
  let currentInterval = 3000;
  let isPaused = false;

  function setStreamStatus(text, color = 'text-success') {
    const badge = document.getElementById('streamStatusBadge');
    const label = document.getElementById('streamStatusText');
    if (badge) badge.className = `spinner-grow spinner-grow-sm ${color} me-2`;
    if (label) label.textContent = text;
  }

  function wsHealthy() {
    if (!_wsConnected) return false;
    const staleMs = Math.max(15000, currentInterval * 3);
    return Date.now() - _lastWsAt < staleMs;
  }

  function connectSocket() {
    if (isPaused || document.hidden || _wsSocket || typeof io === 'undefined') return;
    const token = LP.state?.accessToken
      || (typeof localStorage !== 'undefined' ? localStorage.getItem('lp_token') : null);
    if (!token) return;

    _wsSocket = io('/monitor', {
      auth: (cb) => cb({
        token: LP.state?.accessToken || localStorage.getItem('lp_token'),
      }),
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
    });

    _wsSocket.on('connect', () => {
      _wsConnected = true;
      _lastWsAt = 0;
      setStreamStatus('LIVE', 'text-success');
      _wsSocket.emit('request:metrics');
    });

    _wsSocket.on('metrics', (data) => {
      _lastWsAt = Date.now();
      setStreamStatus('LIVE', 'text-success');
      applyMetrics(data);
    });

    _wsSocket.on('disconnect', () => {
      _wsConnected = false;
      if (!isPaused && !document.hidden) setStreamStatus('RECONNECTING', 'text-warning');
    });

    _wsSocket.on('connect_error', (err) => {
      _wsConnected = false;
      if (!isPaused && !document.hidden) setStreamStatus('FALLBACK', 'text-warning');
      const message = String(err?.message || '').toLowerCase();
      if (message.includes('auth') || message.includes('token') || message.includes('unauthorized')) {
        LP.refreshToken().then((ok) => {
          if (ok && _wsSocket) {
            _wsSocket.auth = { token: LP.state.accessToken };
            _wsSocket.connect();
          }
        }).catch(() => {});
      }
    });
  }

  function disconnectSocket() {
    if (_wsSocket) {
      try { _wsSocket.disconnect(); } catch (_) {}
      _wsSocket = null;
    }
    _wsConnected = false;
    _lastWsAt = 0;
  }

  function stopUpdates() {
    if (_pollInterval) clearInterval(_pollInterval);
    if (_fallbackTimer) clearTimeout(_fallbackTimer);
    _pollInterval = null;
    _fallbackTimer = null;
  }

  function startUpdates() {
    if (isPaused || document.hidden) return;
    stopUpdates();
    connectSocket();

    // WS is the primary path. REST is only used when no metrics frame has
    // arrived yet, or when the socket has been stale/disconnected.
    _fallbackTimer = setTimeout(() => {
      if (!wsHealthy() && !isPaused && !document.hidden) pollMetrics();
    }, 2000);
    _pollInterval = setInterval(pollMetrics, currentInterval);
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      stopUpdates();
      disconnectSocket();
      if (!isPaused) setStreamStatus('PAUSED', 'text-warning');
    } else if (!isPaused) {
      startUpdates();
    }
  }

  function setRefreshInterval(val) {
    if (val === 'pause') {
      isPaused = true;
      stopUpdates();
      disconnectSocket();
      setStreamStatus('PAUSED', 'text-warning');
    } else {
      isPaused = false;
      currentInterval = Math.max(1000, parseInt(val, 10) || 3000);
      if (document.hidden) {
        setStreamStatus('PAUSED', 'text-warning');
      } else {
        startUpdates();
      }
    }
  }

  async function init() {
    await LP.init();
    
    // Init Charts
    const cpuCtx = document.getElementById('cpuChart');
    if (cpuCtx) cpuChartInstance = new Chart(cpuCtx, chartConfig('#ef4444', 'CPU %', chartData.cpu));
    
    const memCtx = document.getElementById('memChart');
    if (memCtx) memChartInstance = new Chart(memCtx, chartConfig('#06b6d4', 'RAM %', chartData.mem));

    await loadSysInfo();

    if (!_visibilityBound) {
      document.addEventListener('visibilitychange', handleVisibilityChange);
      _visibilityBound = true;
    }
    startUpdates();
  }

  return { init, openProcessesModal, sortProcesses, setRefreshInterval, filterProcesses, toggleMemFormat, killProcess };
})();

// [FIX] Expose to window for LP.call() resolution
window.MonitorPage = MonitorPage;

document.addEventListener('DOMContentLoaded', () => {
  MonitorPage.init();
});
