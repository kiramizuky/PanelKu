const AuditPage = (() => {
  let allLogs = [];
  let chartLoginsInstance = null;
  let chartCommandsInstance = null;

  async function init() {
    await LP.init();
    await loadStats();
    await loadLogs();
  }

  async function loadStats() {
    try {
      const res = await LP.get('/system/audit/stats');
      if (res?.success && res.data) {
        const data = res.data;
        
        // Sum total logins (7d)
        const totalLogins = data.logins.reduce((sum, item) => sum + item.count, 0);
        document.getElementById('statTotalLogins').textContent = totalLogins;
        
        // Sum total terminal commands (7d)
        const totalCmds = data.terminalCmds.reduce((sum, item) => sum + item.count, 0);
        document.getElementById('statTotalCmds').textContent = totalCmds;

        // Top command
        const topCmd = data.topCommands?.[0]?.cmd || '-';
        document.getElementById('statTopCmd').textContent = topCmd;

        // Render charts
        renderLoginsChart(data.logins);
        renderCommandsChart(data.terminalCmds);
      }
    } catch (err) {
      console.error('Failed to load audit stats:', err);
    }
  }

  async function loadLogs() {
    try {
      const res = await LP.get('/system/audit/logs?limit=150');
      if (res?.success && res.data?.logs) {
        allLogs = res.data.logs;
        renderLogsTable(allLogs);
      }
    } catch (err) {
      console.error('Failed to load audit logs:', err);
      document.getElementById('auditLogsTableBody').innerHTML = `
        <tr>
          <td colspan="5" class="text-center py-4 text-danger">Failed to load audit logs.</td>
        </tr>
      `;
    }
  }

  function renderLogsTable(logs) {
    const tbody = document.getElementById('auditLogsTableBody');
    if (logs.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="text-center py-4 text-muted">No audit logs found matching criteria.</td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = logs.map(log => {
      const isFailed = log.status === 'failure' || log.status === 'failed';
      const rowClass = isFailed ? 'class="audit-row-failed"' : '';
      return `
        <tr ${rowClass}>
          <td>${new Date(log.timestamp).toLocaleString()}</td>
          <td><strong>${log.username || 'system'}</strong></td>
          <td>
            <span class="lp-badge ${log.type === 'terminal' ? 'lp-badge-info' : 'lp-badge-success'}">
              ${log.type.toUpperCase()}
            </span>
          </td>
          <td class="font-mono" style="font-size: 11px;" title="${escHtml(log.action)}">${escHtml(log.action)}</td>
          <td title="${escHtml(log.details)}">${escHtml(log.details)}</td>
        </tr>
      `;
    }).join('');
  }

  function filterLogs() {
    const type = document.getElementById('logTypeFilter').value;
    const query = document.getElementById('logSearch').value.toLowerCase().trim();

    let filtered = allLogs;
    if (type !== 'all') {
      filtered = filtered.filter(l => l.type === type);
    }
    if (query) {
      filtered = filtered.filter(l => 
        (l.username || '').toLowerCase().includes(query) ||
        (l.details || '').toLowerCase().includes(query) ||
        (l.action || '').toLowerCase().includes(query)
      );
    }

    renderLogsTable(filtered);
  }

  function renderLoginsChart(logins) {
    const ctx = document.getElementById('chartLogins').getContext('2d');
    
    // Sort chronological for chart
    const dataSorted = [...logins].reverse();
    const labels = dataSorted.map(item => item.date);
    const dataset = dataSorted.map(item => item.count);

    if (chartLoginsInstance) chartLoginsInstance.destroy();

    chartLoginsInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Login Events',
          data: dataset,
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99,102,241,0.15)',
          fill: true,
          tension: 0.4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 10 } } },
          y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 10 }, stepSize: 1 } }
        }
      }
    });
  }

  function renderCommandsChart(commands) {
    const ctx = document.getElementById('chartCommands').getContext('2d');
    
    const dataSorted = [...commands].reverse();
    const labels = dataSorted.map(item => item.date);
    const dataset = dataSorted.map(item => item.count);

    if (chartCommandsInstance) chartCommandsInstance.destroy();

    chartCommandsInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Commands',
          data: dataset,
          backgroundColor: '#38bdf8',
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 10 } } },
          y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 10 }, stepSize: 1 } }
        }
      }
    });
  }

  function escHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  document.addEventListener('DOMContentLoaded', init);

  return { filterLogs };
})();

window.AuditPage = AuditPage;
