/**
 * Linux Panel — dashboard.js
 * Realtime dashboard with Socket.IO and Chart.js
 */

const Dashboard = (() => {
  // Chart data buffers
  const MAX_POINTS = 60;
  const labels = [];
  const cpuData = [];
  const ramData = [];
  const diskIOData = [];
  const rxData = [];
  const txData = [];

  let realtimeChart = null;
  let networkChart = null;
  let monitorSocket = null;
  let serverInfoLoaded = false;

  // ── Chart Setup ─────────────────────────────────────
  const chartDefaults = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
    scales: {
      x: {
        display: false,
        grid: { display: false },
      },
      y: {
        min: 0, max: 100,
        grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false },
        ticks: { color: '#64748b', font: { size: 10 }, callback: (v) => v + '%' },
        border: { display: false },
      },
    },
    elements: {
      line: { tension: 0.4, borderWidth: 2 },
      point: { radius: 0, hoverRadius: 4 },
    },
  };

  function initCharts() {
    const ctx1 = document.getElementById('realtimeChart')?.getContext('2d');
    if (!ctx1) return;

    realtimeChart = new Chart(ctx1, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'CPU %',
            data: cpuData,
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239,68,68,0.08)',
            fill: true,
          },
          {
            label: 'RAM %',
            data: ramData,
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245,158,11,0.06)',
            fill: true,
          },
          {
            label: 'Disk IO KB/s',
            data: diskIOData,
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59,130,246,0.06)',
            fill: true,
            yAxisID: 'y',
          },
        ],
      },
      options: { ...chartDefaults },
    });

    // Network chart
    const ctx2 = document.getElementById('networkChart')?.getContext('2d');
    if (!ctx2) return;

    networkChart = new Chart(ctx2, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'RX KB/s',
            data: rxData,
            borderColor: '#06b6d4',
            backgroundColor: 'rgba(6,182,212,0.08)',
            fill: true,
          },
          {
            label: 'TX KB/s',
            data: txData,
            borderColor: '#8b5cf6',
            backgroundColor: 'rgba(139,92,246,0.06)',
            fill: true,
          },
        ],
      },
      options: {
        ...chartDefaults,
        scales: {
          ...chartDefaults.scales,
          y: {
            ...chartDefaults.scales.y,
            max: undefined,
            min: 0,
            ticks: {
              ...chartDefaults.scales.y.ticks,
              callback: (v) => LP.formatBytes(v * 1024, 0) + '/s',
            },
          },
        },
      },
    });
  }

  // ── Data Push ────────────────────────────────────────
  function pushData(metrics) {
    const now = new Date().toLocaleTimeString('en', { hour12: false });

    labels.push(now);
    cpuData.push(metrics.cpu || 0);
    ramData.push(metrics.ramPercent || 0);
    diskIOData.push(Math.min((metrics.diskRead + metrics.diskWrite) / 1024, 100) || 0);
    rxData.push((metrics.networkRx / 1024) || 0);
    txData.push((metrics.networkTx / 1024) || 0);

    // Trim to max points
    if (labels.length > MAX_POINTS) {
      labels.shift(); cpuData.shift(); ramData.shift();
      diskIOData.shift(); rxData.shift(); txData.shift();
    }

    realtimeChart?.update('none');
    networkChart?.update('none');
  }

  // ── UI Update ────────────────────────────────────────
  function updateStatCards(metrics) {
    // CPU
    const cpuPct = Math.round(metrics.cpu || 0);
    document.getElementById('cpuPct').textContent = cpuPct + '%';
    const cpuBar = document.getElementById('cpuBar');
    cpuBar.style.width = cpuPct + '%';

    // RAM
    const ramPct = metrics.ramPercent || 0;
    document.getElementById('ramPct').textContent = ramPct + '%';
    document.getElementById('ramUsed').textContent =
      LP.formatBytes(metrics.ramUsed) + ' / ' + LP.formatBytes(metrics.ramTotal);
    document.getElementById('ramBar').style.width = ramPct + '%';

    // Disk
    const diskPct = Math.round(metrics.diskPercent || 0);
    document.getElementById('diskPct').textContent = diskPct + '%';
    document.getElementById('diskUsed').textContent =
      LP.formatBytes(metrics.diskUsed) + ' / ' + LP.formatBytes(metrics.diskTotal);
    const dBar = document.getElementById('diskBar');
    dBar.style.width = diskPct + '%';
    const dColor = LP.progressColor(diskPct);
    dBar.className = `lp-progress-bar ${dColor}`;

    // Temperature
    const temp = metrics.cpuTemp;
    document.getElementById('tempVal').textContent = temp ? `${Math.round(temp)}°C` : 'N/A';

    // Load avg
    const load = metrics.loadAvg || [0, 0, 0];
    document.getElementById('loadAvg').textContent = load.map(l => l.toFixed(2)).join(' / ');

    // Uptime
    document.getElementById('uptimeDisplay').textContent = LP.formatUptime(metrics.uptime || 0) + ' uptime';

    // Last update
    document.getElementById('lastUpdate').textContent = 'Updated ' + new Date().toLocaleTimeString();
  }

  function updateSystemInfo(info) {
    const s = info.system || {};
    document.getElementById('infoHostname').textContent = s.hostname || '—';
    document.getElementById('infoOS').textContent = `${s.distro || ''} ${s.release || ''}`.trim();
    document.getElementById('infoKernel').textContent = s.kernel || '—';
    document.getElementById('infoArch').textContent = s.arch || '—';
    document.getElementById('infoPublicIP').textContent = info.publicIp || '—';

    const sysInfo = document.getElementById('sysInfo');
    sysInfo.textContent = `${s.hostname} · ${s.distro} · Kernel ${s.kernel}`;

    // Swap
    const metrics = info.metrics || {};
    document.getElementById('infoSwap').textContent =
      LP.formatBytes(metrics.swapUsed || 0) + ' / ' + LP.formatBytes(metrics.swapTotal || 0);

    // Services
    const services = info.services || [];
    const tbl = document.getElementById('servicesTable');
    if (services.length) {
      tbl.innerHTML = services.slice(0, 8).map(s =>
        `<tr><td style="color:var(--text-secondary)">${LP.escHtml(s.name || '—')}</td>
         <td><span class="lp-badge lp-badge-success"><span class="lp-badge-dot"></span>running</span></td></tr>`
      ).join('');
    } else {
      tbl.innerHTML = '<tr><td colspan="2" style="text-align:center;color:var(--text-muted);padding:20px">No service data</td></tr>';
    }

    // Docker status
    const docker = info.docker || {};
    const fw = info.firewall || {};
    tbl.innerHTML += `
      <tr><td style="color:var(--text-muted)">Docker</td><td>
        <span class="lp-badge ${docker.running ? 'lp-badge-success' : 'lp-badge-danger'}">
          <span class="lp-badge-dot"></span>${docker.running ? docker.containers + ' containers' : 'not running'}
        </span></td></tr>
      <tr><td style="color:var(--text-muted)">Firewall</td><td>
        <span class="lp-badge ${fw.enabled ? 'lp-badge-success' : 'lp-badge-warning'}">
          <span class="lp-badge-dot"></span>${fw.enabled ? 'Active (' + fw.tool + ')' : 'Inactive'}
        </span></td></tr>
    `;
  }

  function updateDiskPartitions(disks) {
    const container = document.getElementById('diskPartitions');
    if (!disks?.length) {
      container.innerHTML = '<div style="text-align:center;color:var(--text-muted)">No disk data</div>';
      return;
    }

    container.innerHTML = disks.slice(0, 5).map(d => `
      <div style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
          <span class="font-mono" style="color:var(--text-secondary)">${d.mount}</span>
          <span style="color:var(--text-muted)">${LP.formatBytes(d.used)} / ${LP.formatBytes(d.total)}</span>
        </div>
        <div class="lp-progress">
          <div class="lp-progress-bar ${LP.progressColor(d.usedPercent)}" style="width:${d.usedPercent}%"></div>
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${d.fs} · ${Math.round(d.usedPercent)}% used</div>
      </div>
    `).join('');
  }

  // ── Socket Connection ────────────────────────────────
  function connectSocket() {
    const token = localStorage.getItem('lp_token');
    if (!token) return;

    monitorSocket = io('/monitor', {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 2000,
    });

    monitorSocket.on('connect', () => {
      updateConnectionStatus(true);
      monitorSocket.emit('request:metrics');
    });

    monitorSocket.on('metrics', (metrics) => {
      updateStatCards(metrics);
      pushData(metrics);

      // Load server info once
      if (!serverInfoLoaded) {
        loadServerInfo(metrics);
        serverInfoLoaded = true;
      }
    });

    monitorSocket.on('system:alert', (alert) => {
      LP.toast(`${alert.type.toUpperCase()} at ${alert.value}%`, 'alert', 'System Alert');
    });

    monitorSocket.on('disconnect', () => {
      updateConnectionStatus(false);
    });

    monitorSocket.on('connect_error', (err) => {
      console.error('Monitor socket error:', err.message);
      updateConnectionStatus(false);
    });
  }

  async function loadServerInfo(metrics) {
    try {
      const res = await LP.get('/dashboard/info');
      if (res?.success) {
        updateSystemInfo({ ...res.data, metrics });
        updateDiskPartitions(res.data.metrics?.disk || []);
      }
    } catch (err) {
      console.error('Failed to load server info:', err);
    }
  }

  function updateConnectionStatus(online) {
    const el = document.getElementById('connStatus');
    const label = document.getElementById('connLabel');
    if (online) {
      el.className = 'lp-status lp-status-online';
      label.textContent = 'Live';
    } else {
      el.className = 'lp-status lp-status-offline';
      label.textContent = 'Offline';
    }
  }

  // ── Public API ────────────────────────────────────────
  return {
    async init() {
      // Verify auth
      await LP.init();
      if (!LP.state.accessToken) return;

      initCharts();
      connectSocket();
      this.fetchWebserverStatus();

      // Fallback HTTP polling if socket fails
      setTimeout(async () => {
        if (!monitorSocket?.connected) {
          const res = await LP.get('/dashboard/metrics');
          if (res?.success) {
            updateStatCards(res.data);
            pushData(res.data);
          }
        }
      }, 3000);
    },

    refresh() {
      if (monitorSocket?.connected) {
        monitorSocket.emit('request:metrics');
        serverInfoLoaded = false;
      } else {
        this.init();
      }
      this.fetchWebserverStatus();
    },

    activeWebserver: null,

    async fetchWebserverStatus() {
      try {
        const res = await LP.get('/system/services/status');
        if (res?.success) {
          const { nginx, apache2 } = res.data;
          
          let name = 'Not Installed';
          let status = false;
          
          if (nginx || apache2) {
            name = nginx ? 'Nginx' : 'Apache2';
            status = true;
            this.activeWebserver = name.toLowerCase();
          } else {
            // Check if installed but offline, we'll try to find out by checking info but for now fallback to Nginx
            this.activeWebserver = 'nginx';
          }
          
          document.getElementById('wsName').textContent = this.activeWebserver === 'nginx' ? 'Nginx' : (this.activeWebserver === 'apache2' ? 'Apache' : 'Webserver');
          document.getElementById('wsStatusSpan').innerHTML = status 
            ? '<span class="lp-badge lp-badge-success"><span class="lp-badge-dot"></span>Online</span>' 
            : '<span class="lp-badge lp-badge-danger"><span class="lp-badge-dot"></span>Offline</span>';
        }
      } catch (err) {
        console.error('Failed to load webserver status', err);
      }
    },

    async controlWebserver(action) {
      if (!this.activeWebserver) return;
      if (!(await LP.confirm(`Are you sure you want to ${action} ${this.activeWebserver}?`, 'Confirm Action'))) return;
      
      const res = await LP.post('/system/services', { service: this.activeWebserver, action });
      if (res?.success) {
        LP.toast(`Service ${this.activeWebserver} ${action}ed successfully.`, 'success');
        setTimeout(() => this.fetchWebserverStatus(), 1000);
      } else {
        LP.toast(res?.message || 'Action failed', 'error');
      }
    }
  };
})();

document.addEventListener('DOMContentLoaded', () => Dashboard.init());
window.Dashboard = Dashboard;
