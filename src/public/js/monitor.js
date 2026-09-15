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
        document.getElementById('sys-cpuModel').textContent = d.cpu?.manufacturer + ' ' + d.cpu?.brand || '—';
        document.getElementById('sys-cpuCores').textContent = d.cpu?.cores || '—';
      }
    } catch (err) {
      console.error('Failed to load sysinfo:', err);
    }
  }

  function renderDisks(disks) {
    const container = document.getElementById('disksContainer');
    if (!disks || !disks.length) {
      container.innerHTML = '<div class="text-center text-muted">No disk data</div>';
      return;
    }
    container.innerHTML = disks.slice(0, 5).map(d => {
      const usedPct = d.usedPercent || Math.round((d.used / (d.total || 1)) * 100);
      return `
        <div class="mb-3">
          <div class="d-flex justify-content-between mb-1" style="font-size:12px;">
            <span class="font-mono" style="color: #cbd5e1;">${LP.escHtml(d.fs || d.mount)}</span>
            <span style="color: #f8fafc;">${usedPct}% (${LP.formatBytes(d.used)} / ${LP.formatBytes(d.total)})</span>
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
    if (!networks || !networks.length) {
      container.innerHTML = '<div class="text-center text-muted">No network data</div>';
      return;
    }
    container.innerHTML = networks.map(n => {
      const isUp = n.operstate === 'up' || (n.rxSec > 0 || n.txSec > 0) || (n.ip4 && n.ip4 !== 'No IP');
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
    if (isPaused) return;
    try {
      const res = await LP.get('/monitor/metrics');
      if (res?.success) {
        const d = res.data;
        
        // Update Uptime
        document.getElementById('sys-uptime').textContent = formatUptime(d.system?.uptime || d.os?.uptime || 0);

        // Update Load Averages
        if (d.cpu?.loadAvg) {
          document.getElementById('load-1m').textContent = (d.cpu.loadAvg[0] || 0).toFixed(2);
          document.getElementById('load-5m').textContent = (d.cpu.loadAvg[1] || 0).toFixed(2);
          document.getElementById('load-15m').textContent = (d.cpu.loadAvg[2] || 0).toFixed(2);
        }

        // Update CPU Chart
        const cpuPct = Math.round(d.cpu?.usage || 0);
        document.getElementById('cpuValue').textContent = cpuPct + '%';
        chartData.cpu.push(cpuPct);
        chartData.cpu.shift();
        cpuChartInstance.update();

        // Update Mem Chart
        const memPct = d.memory?.total ? Math.round((d.memory.used / d.memory.total) * 100) : 0;
        document.getElementById('memValue').textContent = memPct + '%';
        chartData.mem.push(memPct);
        chartData.mem.shift();
        memChartInstance.update();

        // Update Disks
        renderDisks(d.disk || []);

        // Update Network
        renderNetwork(Array.isArray(d.network) ? d.network : [d.network].filter(Boolean));
      }
    } catch (err) {
      console.error('Failed to poll metrics:', err);
    }
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
          <button class="btn btn-sm btn-outline-danger py-0 px-2" style="font-size: 11px;" onclick="MonitorPage.killProcess('${p.pid}')" title="Kill Process"><i class="bi bi-x-circle"></i></button>
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
  let currentInterval = 3000;
  let isPaused = false;

  function setRefreshInterval(val) {
    if (val === 'pause') {
      isPaused = true;
      document.getElementById('streamStatusBadge').className = 'spinner-grow spinner-grow-sm text-warning me-2';
      document.getElementById('streamStatusText').textContent = 'PAUSED';
      if (_pollInterval) clearInterval(_pollInterval);
    } else {
      isPaused = false;
      currentInterval = parseInt(val, 10);
      document.getElementById('streamStatusBadge').className = 'spinner-grow spinner-grow-sm text-success me-2';
      document.getElementById('streamStatusText').textContent = 'LIVE';
      if (_pollInterval) clearInterval(_pollInterval);
      _pollInterval = setInterval(pollMetrics, currentInterval);
      pollMetrics();
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
    await pollMetrics();
    _pollInterval = setInterval(pollMetrics, currentInterval);
  }

  return { init, openProcessesModal, sortProcesses, setRefreshInterval, filterProcesses, toggleMemFormat, killProcess };
})();

// [FIX] Expose to window for LP.call() resolution
window.MonitorPage = MonitorPage;

document.addEventListener('DOMContentLoaded', () => {
  MonitorPage.init();
});
