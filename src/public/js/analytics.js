/**
 * Panelku — analytics.js
 * Analytics Dashboard with Metrics, Logs, Services, Processes, Network
 */

const AnalyticsPage = {
  charts: {},

  async init() {
    await LP.init();
    if (!LP.state.accessToken) return;
    this.refresh();
  },

  async refresh() {
    const hours = parseInt(document.getElementById('anlTimeRange').value) || 24;
    await this.loadOverview(hours);
    await this.loadMetricsCharts(hours);
  },

  // ── Tab Switching ────────────────────────────────────

  switchTab(tabId) {
    document.querySelectorAll('.anl-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.anl-tab-content').forEach(t => t.classList.remove('active'));

    const tabBtn = document.querySelector(`.anl-tab[data-tab="${tabId}"]`);
    if (tabBtn) tabBtn.classList.add('active');

    const tabContent = document.getElementById(`tab-${tabId}`);
    if (tabContent) tabContent.classList.add('active');

    // Load tab-specific data on demand
    if (tabId === 'overview') this.loadOverview(parseInt(document.getElementById('anlTimeRange').value) || 24);
    if (tabId === 'metrics') this.loadMetricsCharts(parseInt(document.getElementById('anlTimeRange').value) || 24);
    if (tabId === 'logs') this.loadLogs();
    if (tabId === 'services') this.loadServices();
    if (tabId === 'processes') this.loadProcesses('cpu');
    if (tabId === 'network') this.loadNetwork();
  },

  // ══════════════════════════════════════════════════════
  //  OVERVIEW TAB
  // ══════════════════════════════════════════════════════

  async loadOverview(hours) {
    try {
      const res = await LP.get(`/analytics/metrics/history?hours=${hours}`);
      if (!res?.success) throw new Error(res?.message);

      const data = res.data;
      const stats = data.stats || {};

      // Stats cards
      document.getElementById('ovAvgCpu').textContent = (stats.cpu?.avg ?? 0) + '%';
      document.getElementById('ovAvgRam').textContent = (stats.ram?.avg ?? 0) + '%';
      document.getElementById('ovAvgDisk').textContent = (stats.disk?.avg ?? 0) + '%';

      // Combined chart
      this._renderCombinedChart(data.series || []);

      // Load services count
      this._loadServicesQuick();
      this._loadProcessesQuick();
    } catch (err) {
      console.error('Overview error:', err);
    }
  },

  async _loadServicesQuick() {
    try {
      const res = await LP.get('/analytics/services');
      if (res?.success && res.data?.stats) {
        const s = res.data.stats;
        document.getElementById('ovServicesUp').textContent = `${s.running || 0}/${s.total || 0}`;
      }
    } catch { /* ignore */ }
  },

  async _loadProcessesQuick() {
    try {
      const [svcRes, procRes] = await Promise.all([
        LP.get('/analytics/services'),
        LP.get('/analytics/processes?sort=cpu&limit=5'),
      ]);

      if (svcRes?.success) {
        const services = svcRes.data.services || [];
        const el = document.getElementById('ovTopServices');
        if (services.length === 0) {
          el.innerHTML = '<div style="padding:10px;color:var(--text-muted);font-size:12px;">No services</div>';
        } else {
          el.innerHTML = services.slice(0, 5).map(s => {
            const statusIcon = s.active === 'active' ? 'bi-check-circle-fill text-success' : 'bi-x-circle-fill text-danger';
            return `
              <div class="d-flex justify-content-between py-1" style="border-bottom:1px solid rgba(255,255,255,0.03);">
                <span><i class="bi ${statusIcon} me-1" style="font-size:10px;"></i> ${s.name.replace('.service', '')}</span>
                <span style="color:var(--text-muted);font-size:11px;">CPU: ${s.cpu || 0}%</span>
              </div>
            `;
          }).join('');
        }
      }

      if (procRes?.success) {
        const processes = procRes.data || [];
        const el = document.getElementById('ovTopProcesses');
        if (processes.length === 0) {
          el.innerHTML = '<div style="padding:10px;color:var(--text-muted);font-size:12px;">No data</div>';
        } else {
          el.innerHTML = processes.slice(0, 5).map(p => `
            <div class="d-flex justify-content-between py-1" style="border-bottom:1px solid rgba(255,255,255,0.03);">
              <span style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${LP.escHtml(p.name)}</span>
              <span style="color:var(--text-muted);font-size:11px;">${p.cpu}% CPU</span>
            </div>
          `).join('');
        }
      }
    } catch { /* ignore */ }
  },

  _renderCombinedChart(series) {
    const ctx = document.getElementById('ovCombinedChart');
    if (!ctx) return;
    if (this.charts.combined) this.charts.combined.destroy();

    const labels = series.map(s => {
      const d = new Date(s.t);
      return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
    });

    this.charts.combined = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'CPU %',
            data: series.map(s => s.cpu),
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59,130,246,0.1)',
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 2,
          },
          {
            label: 'RAM %',
            data: series.map(s => s.ramPercent),
            borderColor: '#10b981',
            backgroundColor: 'rgba(16,185,129,0.1)',
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 2,
            yAxisID: 'y',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { labels: { color: '#94a3b8', font: { size: 11 } } },
        },
        scales: {
          x: {
            grid: { color: 'rgba(255,255,255,0.03)' },
            ticks: { color: '#64748b', font: { size: 10 }, maxTicksLimit: 12 },
          },
          y: {
            min: 0,
            max: 100,
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: { color: '#64748b', font: { size: 10 } },
          },
        },
      },
    });
  },

  // ══════════════════════════════════════════════════════
  //  METRICS TAB
  // ══════════════════════════════════════════════════════

  async loadMetricsCharts(hours) {
    try {
      const res = await LP.get(`/analytics/metrics/history?hours=${hours}`);
      if (!res?.success) throw new Error(res?.message);

      const { series, stats } = res.data;

      if (!series || series.length === 0) {
        document.querySelectorAll('#tab-metrics canvas').forEach(c => {
          const parent = c.parentElement;
          parent.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px;">No historical data available for this period.</div>';
        });
        return;
      }

      const labels = series.map(s => {
        const d = new Date(s.t);
        return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
      });

      this._renderMetricChart('mtCpuChart', labels, series.map(s => s.cpu), '#ef4444', 'rgba(239,68,68,0.1)');
      this._renderMetricChart('mtRamChart', labels, series.map(s => s.ramPercent), '#06b6d4', 'rgba(6,182,212,0.1)');
      this._renderMetricChart('mtDiskChart', labels, series.map(s => s.diskPercent), '#f59e0b', 'rgba(245,158,11,0.1)');
      this._renderNetChart('mtNetChart', labels,
        series.map(s => +(s.networkRx / 1024 / 1024).toFixed(2)),
        series.map(s => +(s.networkTx / 1024 / 1024).toFixed(2))
      );

      // Stats
      if (stats) {
        const fmtStat = (s) => `Avg: ${s.avg}% | Max: ${s.max}% | Min: ${s.min}% | Now: ${s.current}%`;
        document.getElementById('mtCpuStats').innerHTML = `<span>${fmtStat(stats.cpu || {})}</span>`;
        document.getElementById('mtRamStats').innerHTML = `<span>${fmtStat(stats.ram || {})}</span>`;
        document.getElementById('mtDiskStats').innerHTML = `<span>${fmtStat(stats.disk || {})}</span>`;
      }
    } catch (err) {
      console.error('Metrics error:', err);
    }
  },

  _renderMetricChart(canvasId, labels, data, borderColor, bgColor) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    if (this.charts[canvasId]) this.charts[canvasId].destroy();

    this.charts[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: '%',
          data,
          borderColor,
          backgroundColor: bgColor,
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        plugins: { legend: { display: false } },
        scales: {
          x: { display: false },
          y: {
            min: 0, max: 100,
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: { color: '#64748b', font: { size: 9 } },
          },
        },
      },
    });
  },

  _renderNetChart(canvasId, labels, rxData, txData) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    if (this.charts[canvasId]) this.charts[canvasId].destroy();

    this.charts[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'RX MB/s',
            data: rxData,
            borderColor: '#10b981',
            backgroundColor: 'rgba(16,185,129,0.1)',
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 2,
          },
          {
            label: 'TX MB/s',
            data: txData,
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59,130,246,0.1)',
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        plugins: {
          legend: { labels: { color: '#94a3b8', font: { size: 10 }, boxWidth: 10 } },
        },
        scales: {
          x: { display: false },
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: { color: '#64748b', font: { size: 9 } },
          },
        },
      },
    });
  },

  // ══════════════════════════════════════════════════════
  //  LOGS TAB
  // ══════════════════════════════════════════════════════

  toggleLogSource() {
    this.loadLogs();
  },

  async loadLogs() {
    const source = document.getElementById('logSource').value;
    const outputPre = document.getElementById('logOutputPre');
    const pathEl = document.getElementById('logSourcePath');
    const errorCountEl = document.getElementById('logErrorCount');

    outputPre.textContent = 'Loading...';
    pathEl.textContent = '';
    errorCountEl.textContent = '';

    try {
      let res;

      if (source.startsWith('web-')) {
        const parts = source.split('-');
        const service = parts[1];
        const logType = parts[2];
        res = await LP.get(`/analytics/logs/web?service=${service}&logType=${logType}`);
      } else {
        res = await LP.get(`/analytics/logs/system?type=${source}`);
      }

      if (!res?.success) throw new Error(res?.message);

      const data = res.data;
      pathEl.textContent = `📄 ${data.logFile || 'No file'}`;

      const lines = data.lines || [];

      // Count errors
      const errors = lines.filter(l => l.level === 'error' || l.status >= 400);
      if (errors.length > 0) {
        errorCountEl.innerHTML = `<span style="color:#ef4444;">⚠ ${errors.length} errors</span>`;
      } else {
        errorCountEl.innerHTML = '<span style="color:#10b981;">✓ No errors</span>';
      }

      if (lines.length === 0) {
        outputPre.textContent = '[No log entries found]';
        return;
      }

      // Render with color coding
      outputPre.innerHTML = lines.map(l => {
        const color = l.level === 'error' ? '#ef4444' : l.level === 'warn' ? '#f59e0b' : '#94a3b8';
        return `<span style="color:${color};">${LP.escHtml(l.raw || l.message)}</span>`;
      }).join('\n');

    } catch (err) {
      outputPre.textContent = `[Error: ${err.message}]`;
    }
  },

  // ══════════════════════════════════════════════════════
  //  SERVICES TAB
  // ══════════════════════════════════════════════════════

  async loadServices() {
    try {
      const res = await LP.get('/analytics/services');
      if (!res?.success) throw new Error(res?.message);

      const { services, stats } = res.data;
      const tbody = document.getElementById('servicesTableBody');

      if (stats) {
        document.getElementById('svcTotal').textContent = `Total: ${stats.total}`;
        document.getElementById('svcRunning').textContent = `Running: ${stats.running}`;
        document.getElementById('svcFailed').textContent = `Failed: ${stats.failed}`;
      }

      if (!services || services.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px;">No service data</td></tr>';
        return;
      }

      tbody.innerHTML = services.map(s => {
        const activeIcon = s.active === 'active' ? '<span class="lp-badge lp-badge-success"><span class="lp-badge-dot"></span> active</span>'
          : s.active === 'failed' ? '<span class="lp-badge lp-badge-danger"><span class="lp-badge-dot"></span> failed</span>'
          : `<span class="lp-badge lp-badge-warning">${s.active}</span>`;
        return `
          <tr>
            <td><strong style="font-size:13px;">${LP.escHtml(s.name.replace('.service', ''))}</strong></td>
            <td>${activeIcon}</td>
            <td style="color:var(--text-muted);font-size:12px;">${s.sub || '—'}</td>
            <td class="font-mono" style="font-size:12px;">${s.cpu ?? '—'}%</td>
            <td class="font-mono" style="font-size:12px;">${s.mem ?? '—'}%</td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      document.getElementById('servicesTableBody').innerHTML =
        `<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--accent-danger);">Error: ${LP.escHtml(err.message)}</td></tr>`;
    }
  },

  // ══════════════════════════════════════════════════════
  //  PROCESSES TAB
  // ══════════════════════════════════════════════════════

  async loadProcesses(sortBy = 'cpu') {
    document.querySelectorAll('#sortCpuBtn, #sortMemBtn').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById(sortBy === 'cpu' ? 'sortCpuBtn' : 'sortMemBtn');
    if (btn) btn.classList.add('active');

    try {
      const res = await LP.get(`/analytics/processes?sort=${sortBy}&limit=30`);
      if (!res?.success) throw new Error(res?.message);

      const processes = res.data || [];
      const tbody = document.getElementById('processesTableBody');

      if (processes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted);">No process data</td></tr>';
        return;
      }

      tbody.innerHTML = processes.map(p => {
        const stateColor = p.state === 'running' ? '#10b981' : p.state === 'sleeping' ? '#3b82f6' : '#6b7280';
        return `
          <tr>
            <td class="font-mono" style="color:var(--text-muted);font-size:12px;">${p.pid}</td>
            <td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${LP.escHtml(p.command || p.name)}">
              <strong>${LP.escHtml(p.name)}</strong>
            </td>
            <td class="font-mono ${sortBy === 'cpu' ? 'text-success fw-bold' : ''}">${p.cpu}%</td>
            <td class="font-mono ${sortBy === 'mem' ? 'text-info fw-bold' : ''}">${p.mem}%</td>
            <td style="color:var(--text-muted);font-size:12px;">${p.user || '?'}</td>
            <td><span style="color:${stateColor};font-size:12px;">● ${p.state || '?'}</span></td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      document.getElementById('processesTableBody').innerHTML =
        `<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--accent-danger);">Error: ${LP.escHtml(err.message)}</td></tr>`;
    }
  },

  // ══════════════════════════════════════════════════════
  //  NETWORK TAB
  // ══════════════════════════════════════════════════════

  async loadNetwork() {
    try {
      const res = await LP.get('/analytics/network');
      if (!res?.success) throw new Error(res?.message);

      const data = res.data;

      // Interfaces
      const ifacesEl = document.getElementById('netInterfaces');
      const ifaces = data.interfaces || [];
      if (ifaces.length === 0) {
        ifacesEl.innerHTML = '<div style="padding:10px;color:var(--text-muted);font-size:12px;">No interfaces</div>';
      } else {
        ifacesEl.innerHTML = ifaces.map(i => `
          <div class="d-flex justify-content-between py-2" style="border-bottom:1px solid rgba(255,255,255,0.04);">
            <div>
              <strong>${LP.escHtml(i.name)}</strong>
              <div style="font-size:11px;color:var(--text-muted);">${LP.escHtml(i.ip4 || 'No IP')}</div>
            </div>
            <div style="font-size:11px;color:var(--text-muted);text-align:right;">
              <div>${LP.escHtml(i.type || '?')}</div>
              ${i.speed ? `<div>${LP.escHtml(String(i.speed))} Mbps</div>` : ''}
            </div>
          </div>
        `).join('');
      }

      // Traffic
      const traffic = data.traffic || [];
      if (traffic.length > 0) {
        const t = traffic[0];
        const trafficHtml = `
          <div class="d-flex justify-content-around py-2">
            <div style="text-align:center;">
              <div style="font-size:10px;color:var(--text-muted);">RX Rate</div>
              <div style="font-size:20px;font-weight:700;color:#10b981;">${LP.formatBytes(t.rxSec || 0)}<span style="font-size:12px;">/s</span></div>
            </div>
            <div style="text-align:center;">
              <div style="font-size:10px;color:var(--text-muted);">TX Rate</div>
              <div style="font-size:20px;font-weight:700;color:#3b82f6;">${LP.formatBytes(t.txSec || 0)}<span style="font-size:12px;">/s</span></div>
            </div>
            <div style="text-align:center;">
              <div style="font-size:10px;color:var(--text-muted);">RX Total</div>
              <div style="font-size:16px;font-weight:600;color:var(--text-primary);">${LP.formatBytes(t.rxTotal || 0)}</div>
            </div>
            <div style="text-align:center;">
              <div style="font-size:10px;color:var(--text-muted);">TX Total</div>
              <div style="font-size:16px;font-weight:600;color:var(--text-primary);">${LP.formatBytes(t.txTotal || 0)}</div>
            </div>
          </div>
        `;
        ifacesEl.innerHTML += `<hr style="border-color:var(--glass-border);margin:8px 0;">${trafficHtml}`;
      }

      // Connections
      const connsEl = document.getElementById('netConnections');
      const conn = data.connections || {};
      const byState = conn.byState || {};
      const stateKeys = Object.keys(byState);
      if (stateKeys.length === 0) {
        connsEl.innerHTML = '<div style="padding:10px;color:var(--text-muted);font-size:12px;">No connections</div>';
      } else {
        connsEl.innerHTML = `
          <div style="font-size:14px;font-weight:700;color:var(--text-primary);margin-bottom:10px;">
            Total: ${conn.total || 0} connections
          </div>
          ${stateKeys.map(state => `
            <div class="d-flex justify-content-between py-1" style="border-bottom:1px solid rgba(255,255,255,0.03);">
              <span style="color:var(--text-muted);font-size:12px;">${LP.escHtml(state)}</span>
              <span style="font-weight:600;">${byState[state]}</span>
            </div>
          `).join('')}
        `;
      }

      // Listening ports
      const portsEl = document.getElementById('netListeningPorts');
      const ports = conn.listeningPorts || [];
      if (ports.length === 0) {
        portsEl.innerHTML = '<div style="padding:10px;color:var(--text-muted);font-size:12px;">No listening ports</div>';
      } else {
        portsEl.innerHTML = ports.map(p => `
          <span class="lp-badge" style="font-size:11px;margin:3px;background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.2);">
            :${p.port} <span style="color:var(--text-muted);font-size:10px;">${LP.escHtml(p.process)}</span>
          </span>
        `).join('');
      }
    } catch (err) {
      console.error('Network error:', err);
    }
  },
};

document.addEventListener('DOMContentLoaded', () => AnalyticsPage.init());
