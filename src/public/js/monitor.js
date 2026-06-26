/**
 * Linux Panel — monitor.js
 * Monitoring page with history charts and realtime metrics
 */

const Monitor = (() => {
  let monitorSocket = null;
  const charts = {};

  const chartLineConfig = (color, label) => ({
    type: 'line',
    data: { labels: [], datasets: [{ label, data: [], borderColor: color, backgroundColor: color + '14', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 0 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false },
        y: {
          min: 0,
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#64748b', font: { size: 10 } },
          border: { display: false },
        },
      },
      elements: { point: { radius: 0 } },
    },
  });

  function initCharts() {
    charts.cpu = new Chart(document.getElementById('cpuHistChart'), {
      ...chartLineConfig('#ef4444', 'CPU %'),
      options: { ...chartLineConfig('#ef4444', 'CPU %').options, scales: { ...chartLineConfig('#ef4444', 'CPU %').options.scales, y: { ...chartLineConfig('#ef4444', 'CPU %').options.scales.y, max: 100 } } },
    });

    charts.ram = new Chart(document.getElementById('ramHistChart'), {
      ...chartLineConfig('#f59e0b', 'RAM %'),
    });

    charts.net = new Chart(document.getElementById('netHistChart'), {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          { label: 'RX', data: [], borderColor: '#06b6d4', backgroundColor: '#06b6d414', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 0 },
          { label: 'TX', data: [], borderColor: '#8b5cf6', backgroundColor: '#8b5cf614', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 0 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: true, labels: { color: '#94a3b8', font: { size: 11 } } } },
        scales: {
          x: { display: false },
          y: { min: 0, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#64748b', font: { size: 10 }, callback: v => LP.formatBytes(v * 1024, 0) + '/s' }, border: { display: false } },
        },
        elements: { point: { radius: 0 } },
      },
    });

    charts.disk = new Chart(document.getElementById('diskHistChart'), {
      ...chartLineConfig('#3b82f6', 'Disk I/O'),
    });
  }

  function updateCurrentMetrics(m) {
    document.getElementById('mCpu').textContent = Math.round(m.cpu || 0) + '%';
    document.getElementById('mCpuBar').style.width = (m.cpu || 0) + '%';
    document.getElementById('mRam').textContent = Math.round(m.ramPercent || 0) + '%';
    document.getElementById('mRamBar').style.width = (m.ramPercent || 0) + '%';
    document.getElementById('mRx').textContent = LP.formatBytes(m.networkRx || 0) + '/s';
    document.getElementById('mTx').textContent = LP.formatBytes(m.networkTx || 0) + '/s';
    document.getElementById('mDiskIO').textContent = LP.formatBytes(m.diskRead || 0) + '/s';
    document.getElementById('mDiskW').textContent = LP.formatBytes(m.diskWrite || 0) + '/s';
  }

  async function loadHistory(minutes = 60) {
    try {
      const res = await LP.get(`/monitor/history?minutes=${minutes}`);
      if (!res?.success) return;

      const history = res.data.history || [];
      if (!history.length) return;

      const labels = history.map(h => new Date(h.timestamp).toLocaleTimeString('en', { hour12: false }));
      const cpuVals = history.map(h => h.metrics?.cpu || 0);
      const ramVals = history.map(h => {
        const m = h.metrics;
        return m?.ramTotal ? Math.round((m.ramUsed / m.ramTotal) * 100) : 0;
      });
      const rxVals = history.map(h => (h.metrics?.networkRx || 0) / 1024);
      const txVals = history.map(h => (h.metrics?.networkTx || 0) / 1024);
      const ioVals = history.map(h => ((h.metrics?.diskRead || 0) + (h.metrics?.diskWrite || 0)) / 1024);

      charts.cpu.data.labels = [...labels];
      charts.cpu.data.datasets[0].data = [...cpuVals];
      charts.cpu.update('none');

      charts.ram.data.labels = [...labels];
      charts.ram.data.datasets[0].data = [...ramVals];
      charts.ram.update('none');

      charts.net.data.labels = [...labels];
      charts.net.data.datasets[0].data = [...rxVals];
      charts.net.data.datasets[1].data = [...txVals];
      charts.net.update('none');

      charts.disk.data.labels = [...labels];
      charts.disk.data.datasets[0].data = [...ioVals];
      charts.disk.update('none');
    } catch (err) {
      console.error('Failed to load history:', err);
    }
  }

  async function loadDiskHealth() {
    const res = await LP.get('/monitor/disk');
    if (!res?.success) return;
    const disks = res.data.disks || [];
    const body = document.getElementById('diskHealthBody');
    if (!disks.length) {
      body.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">No disk data</div>';
      return;
    }
    body.innerHTML = `<table class="lp-table">
      <thead><tr><th>Device</th><th>Type</th><th>Size</th><th>Interface</th></tr></thead>
      <tbody>${disks.map(d => `<tr>
        <td class="font-mono">${d.name || '—'}</td>
        <td>${d.type || '—'}</td>
        <td>${LP.formatBytes(d.size || 0)}</td>
        <td>${d.interfaceType || '—'}</td>
      </tr>`).join('')}</tbody>
    </table>`;
  }

  async function loadNetworkStats() {
    const res = await LP.get('/monitor/network');
    if (!res?.success) return;
    const ifaces = res.data.interfaces || [];
    const body = document.getElementById('networkBody');
    if (!ifaces.length) {
      body.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">No network data</div>';
      return;
    }
    body.innerHTML = `<table class="lp-table">
      <thead><tr><th>Interface</th><th>IP</th><th>MAC</th><th>Speed</th></tr></thead>
      <tbody>${ifaces.map(i => `<tr>
        <td class="font-mono">${i.iface || '—'}</td>
        <td class="font-mono">${i.ip4 || i.ip6 || '—'}</td>
        <td class="font-mono" style="font-size:11px">${i.mac || '—'}</td>
        <td>${i.speed ? i.speed + ' Mbps' : '—'}</td>
      </tr>`).join('')}</tbody>
    </table>`;
  }

  function connectSocket() {
    const token = localStorage.getItem('lp_token');
    monitorSocket = io('/monitor', { auth: { token }, transports: ['websocket'] });

    monitorSocket.on('metrics', (metrics) => {
      updateCurrentMetrics(metrics);

      // Append to realtime charts (last MAX points)
      const MAX = 100;
      const now = new Date().toLocaleTimeString('en', { hour12: false });

      [charts.cpu, charts.ram, charts.net, charts.disk].forEach(c => {
        if (c.data.labels.length >= MAX) {
          c.data.labels.shift();
          c.data.datasets.forEach(d => d.data.shift());
        }
      });

      charts.cpu.data.labels.push(now);
      charts.cpu.data.datasets[0].data.push(metrics.cpu || 0);
      charts.cpu.update('none');

      charts.ram.data.labels.push(now);
      charts.ram.data.datasets[0].data.push(metrics.ramPercent || 0);
      charts.ram.update('none');
    });
  }

  return {
    async init() {
      await LP.init();
      if (!LP.state.accessToken) return;
      initCharts();
      connectSocket();
      await Promise.allSettled([loadHistory(60), loadDiskHealth(), loadNetworkStats()]);
    },

    async loadHistory(minutes) {
      await loadHistory(parseInt(minutes));
    },
  };
})();

document.addEventListener('DOMContentLoaded', () => Monitor.init());
window.Monitor = Monitor;
