/**
 * Cluster Manager — Client-Side Script
 */

const ClusterPage = (() => {
  // ─── Helpers ──────────────────────────────────────────────────────────────

  function fmtBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function buildHostLabel(node) {
    if (!node.port) return node.ipAddress;
    return `${node.ipAddress}:${node.port}`;
  }

  function buildUrl(node) {
    const port = parseInt(node.port);
    if (!port || port === 443) return `https://${node.ipAddress}`;
    if (port === 80) return `http://${node.ipAddress}`;
    return `http://${node.ipAddress}:${port}`;
  }

  function usageColor(pct) {
    if (pct >= 90) return '#ef4444';
    if (pct >= 70) return '#f59e0b';
    return '#22c55e';
  }

  function miniBar(pct, color) {
    const safe = Math.min(Math.max(pct || 0, 0), 100).toFixed(0);
    return `
      <div style="display:flex; align-items:center; gap:7px;">
        <div style="flex:1; height:5px; background:rgba(255,255,255,0.08); border-radius:99px; overflow:hidden;">
          <div style="width:${safe}%; height:100%; background:${color}; border-radius:99px; transition:width .4s ease;"></div>
        </div>
        <span style="font-size:10px; color:${color}; font-weight:700; min-width:30px; text-align:right;">${safe}%</span>
      </div>`;
  }

  // ─── Node Card Builder ─────────────────────────────────────────────────────

  function buildNodeCard(node, metrics) {
    const isOnline  = node.status === 'online';
    const badgeCls  = isOnline ? 'lp-badge-success' : 'lp-badge-danger';
    const hostLabel = buildHostLabel(node);
    const nodeUrl   = buildUrl(node);
    const updatedAt = new Date(node.updatedAt).toLocaleTimeString();

    // ── Resource rows ──────────────────────────────────────────────────────
    let metricsHtml = '';
    if (isOnline && metrics) {
      const cpuPct   = metrics.cpu?.usage ?? null;
      const ramPct   = metrics.memory ? Math.round((metrics.memory.used / metrics.memory.total) * 100) : null;
      const diskPct  = metrics.disk?.length ? Math.round((metrics.disk[0].used / metrics.disk[0].total) * 100) : null;
      const ramUsed  = metrics.memory ? fmtBytes(metrics.memory.used) : null;
      const ramTotal = metrics.memory ? fmtBytes(metrics.memory.total) : null;
      const diskUsed = metrics.disk?.length ? fmtBytes(metrics.disk[0].used) : null;
      const diskTotal= metrics.disk?.length ? fmtBytes(metrics.disk[0].total) : null;

      const rows = [];

      if (cpuPct !== null) rows.push(`
        <div style="display:grid; grid-template-columns: 52px 1fr; gap:6px; align-items:center;">
          <span style="font-size:10px; color:var(--text-muted); font-family:monospace;">CPU</span>
          ${miniBar(cpuPct, usageColor(cpuPct))}
        </div>`);

      if (ramPct !== null) rows.push(`
        <div style="display:grid; grid-template-columns: 52px 1fr; gap:6px; align-items:center;">
          <span style="font-size:10px; color:var(--text-muted); font-family:monospace;">RAM</span>
          ${miniBar(ramPct, usageColor(ramPct))}
        </div>
        <div style="font-size:9.5px; color:var(--text-muted); text-align:right; margin-top:-4px; margin-bottom:2px; padding-left:58px; font-family:monospace;">${ramUsed} / ${ramTotal}</div>`);

      if (diskPct !== null) rows.push(`
        <div style="display:grid; grid-template-columns: 52px 1fr; gap:6px; align-items:center;">
          <span style="font-size:10px; color:var(--text-muted); font-family:monospace;">Disk</span>
          ${miniBar(diskPct, usageColor(diskPct))}
        </div>
        <div style="font-size:9.5px; color:var(--text-muted); text-align:right; margin-top:-4px; padding-left:58px; font-family:monospace;">${diskUsed} / ${diskTotal}</div>`);

      if (rows.length > 0) {
        metricsHtml = `
          <div id="metrics-${node.id}" style="background:rgba(0,0,0,0.2); border-radius:10px; padding:12px 14px; margin-bottom:14px; display:grid; grid-template-columns: 1fr 1fr; gap:12px; border:1px solid var(--glass-border);">
            <!-- CPU in its own block -->
            <div style="grid-column: span 2; display:flex; flex-direction:column; gap:4px; padding-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.04);">
              <div style="display:flex; justify-content:space-between; font-size:10px; color:var(--text-muted); font-family:monospace; font-weight:700;">
                <span>CPU UTILIZATION</span>
              </div>
              ${miniBar(cpuPct, usageColor(cpuPct))}
            </div>

            <!-- RAM in left col -->
            <div style="display:flex; flex-direction:column; gap:4px;">
              <div style="display:flex; justify-content:space-between; font-size:10px; color:var(--text-muted); font-family:monospace; font-weight:700;">
                <span>RAM</span>
              </div>
              ${miniBar(ramPct, usageColor(ramPct))}
              <div style="font-size:9px; color:var(--text-muted); margin-top:2px; font-family:monospace;">${ramUsed}/${ramTotal}</div>
            </div>

            <!-- Disk in right col -->
            <div style="display:flex; flex-direction:column; gap:4px;">
              <div style="display:flex; justify-content:space-between; font-size:10px; color:var(--text-muted); font-family:monospace; font-weight:700;">
                <span>DISK</span>
              </div>
              ${miniBar(diskPct, usageColor(diskPct))}
              <div style="font-size:9px; color:var(--text-muted); margin-top:2px; font-family:monospace;">${diskUsed}/${diskTotal}</div>
            </div>
          </div>`;
      }
    } else if (isOnline) {
      // Online but metrics not yet loaded — show loading skeleton
      metricsHtml = `
        <div id="metrics-${node.id}" style="background:rgba(0,0,0,0.2); border-radius:10px; padding:12px 14px; margin-bottom:14px; border:1px solid var(--glass-border); display:flex; align-items:center; gap:8px; color:var(--text-muted); font-size:11px;">
          <span class="spinner-border spinner-border-sm" style="width:12px;height:12px;border-width:2px; border-color: var(--accent-primary) transparent var(--accent-primary) transparent;"></span> Mengambil metrics...
        </div>`;
    }

    return `
      <div class="col-12 col-md-6 col-xl-4">
        <div class="lp-glass-card h-100 d-flex flex-column" style="border-radius:16px; padding:20px; position:relative; overflow:hidden; transition: box-shadow .2s ease;">

          <!-- Glow accent top-left when online -->
          ${isOnline ? '<div style="position:absolute;top:0;left:0;width:60px;height:3px;background:linear-gradient(90deg,#22c55e,transparent);border-radius:0 0 8px 0;"></div>' : ''}

          <!-- Header: name + status badge -->
          <div class="d-flex justify-content-between align-items-start mb-3">
            <div onclick="LP.call('ClusterPage.showDetails', '${LP.encJsArg(node.id)}')" style="cursor:pointer;" title="Klik untuk melihat detail info node">
              <h5 class="text-white text-hover-underline" style="font-weight:700; margin:0 0 3px 0; font-size:15px; text-decoration: underline dotted rgba(255,255,255,0.4);">${node.name}</h5>
              <span style="font-size:10px; color:var(--text-muted);">Agent Node <i class="bi bi-info-circle ms-1"></i></span>
            </div>
            <div class="d-flex align-items-center gap-2">
              ${isOnline ? '<span class="status-pulse-green"></span>' : ''}
              <span class="lp-badge ${badgeCls}" id="badge-${node.id}" style="font-size:9px; text-transform:uppercase; font-weight:800; letter-spacing:.5px;">${node.status}</span>
            </div>
          </div>

          <!-- Host row -->
          <div class="mb-3" style="font-family:monospace; font-size:12px; color:var(--text-secondary); background:rgba(0,0,0,0.15); padding:9px 12px; border-radius:8px; border:1px solid var(--glass-border); display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:7px;">
              <i class="bi bi-hdd-network" style="color:var(--text-muted);"></i>
              <span>${hostLabel}</span>
            </div>
            <div class="d-flex gap-1">
              <button class="btn-lp btn-lp-ghost" onclick="LP.call('ClusterPage.copyHost', '${LP.encJsArg(hostLabel)}')" title="Copy host" style="width:28px;height:28px;padding:0;display:flex;align-items:center;justify-content:center;border-radius:6px;font-size:12px;">
                <i class="bi bi-clipboard"></i>
              </button>
              <a href="${nodeUrl}" target="_blank" class="btn-lp btn-lp-ghost" title="Buka di tab baru" style="width:28px;height:28px;padding:0;display:flex;align-items:center;justify-content:center;border-radius:6px;font-size:12px; text-decoration:none;">
                <i class="bi bi-box-arrow-up-right"></i>
              </a>
            </div>
          </div>

          <!-- Metrics -->
          ${metricsHtml}

          <!-- Last updated -->
          <div style="font-size:10.5px; color:var(--text-muted); margin-bottom:14px; flex:1;">
            <i class="bi bi-clock me-1"></i>Last updated: ${updatedAt}
          </div>

          <!-- Actions -->
          <div class="d-flex gap-2 pt-2" style="border-top:1px solid var(--glass-border);">
            <button class="btn-lp btn-lp-ghost" onclick="LP.call('ClusterPage.pingNode', '${LP.encJsArg(node.id)}', this)"
              style="flex:1; font-size:12px; height:34px; padding:0 10px; display:flex; align-items:center; justify-content:center; gap:5px; border-radius:8px;"
              title="Ping node">
              <i class="bi bi-arrow-repeat"></i><span>Ping</span>
            </button>
            <a href="/terminal?nodeId=${node.id}" target="_blank" class="btn-lp btn-lp-ghost"
              style="flex:1; font-size:12px; height:34px; padding:0 10px; display:flex; align-items:center; justify-content:center; gap:5px; border-radius:8px; text-decoration:none; color:var(--text-primary); ${!isOnline ? 'pointer-events:none; opacity:0.5;' : ''}"
              title="Open Remote Terminal">
              <i class="bi bi-terminal"></i><span>Terminal</span>
            </a>
            <button class="btn-lp btn-lp-ghost" onclick="LP.call('ClusterPage.refreshMetrics', '${LP.encJsArg(node.id)}')"
              style="flex:1; font-size:12px; height:34px; padding:0 10px; display:flex; align-items:center; justify-content:center; gap:5px; border-radius:8px;"
              title="Refresh metrics" ${!isOnline ? 'disabled' : ''}>
              <i class="bi bi-activity"></i><span>Metrics</span>
            </button>
            <button class="btn-lp" onclick="LP.call('ClusterPage.deleteNode', '${LP.encJsArg(node.id)}')"
              style="width:34px; height:34px; padding:0; display:flex; align-items:center; justify-content:center; border-radius:8px; border:1px solid rgba(239,68,68,0.3); background:rgba(239,68,68,0.08); color:#ef4444; font-size:13px; transition:all .2s;"
              onmouseover="this.style.background='rgba(239,68,68,0.2)'" onmouseout="this.style.background='rgba(239,68,68,0.08)'"
              title="Hapus node">
              <i class="bi bi-trash3"></i>
            </button>
          </div>
        </div>
      </div>`;
  }

  // ─── Init ──────────────────────────────────────────────────────────────────

  async function init() {
    await LP.init();
    await loadNodes();
  }

  // ─── Load Nodes ────────────────────────────────────────────────────────────

  async function loadNodes() {
    const container = document.getElementById('nodesContainer');
    try {
      const res = await LP.get('/cluster/nodes');
      if (!res?.success) {
        container.innerHTML = `<div class="col-12 text-center text-danger">Gagal memuat nodes: ${LP.escHtml(res?.message || '')}</div>`;
        return;
      }

      const nodes = res.data;
      if (nodes.length === 0) {
        container.innerHTML = `
          <div class="col-12 text-center" style="padding:70px 20px; color:var(--text-muted);">
            <i class="bi bi-diagram-3" style="font-size:52px; display:block; margin-bottom:16px; color:rgba(255,255,255,0.08);"></i>
            <h5 class="text-white" style="font-weight:600; margin-bottom:6px;">Belum Ada Agent Node</h5>
            <p style="font-size:13px; max-width:400px; margin:0 auto 20px;">Tambahkan server sekunder sebagai Agent Node untuk memantau resource-nya dari dashboard ini.</p>
            <button class="btn-lp btn-lp-primary" onclick="ClusterPage.showAddModal()"><i class="bi bi-plus-lg me-1"></i>Tambah Node Pertama</button>
          </div>`;
        return;
      }

      // Render cards (without metrics first for instant render)
      container.innerHTML = nodes.map(n => buildNodeCard(n, null)).join('');

      // Then fetch metrics for online nodes in background
      nodes.filter(n => n.status === 'online').forEach(n => {
        fetchAndRenderMetrics(n);
      });

    } catch (e) {
      container.innerHTML = '<div class="col-12 text-center text-danger">Gagal terhubung ke panel API.</div>';
    }
  }

  // ─── Metrics ───────────────────────────────────────────────────────────────

  async function fetchAndRenderMetrics(node) {
    try {
      const res = await LP.get(`/cluster/nodes/${node.id}/metrics`);
      if (!res?.success) return;
      const metrics = res.data;
      const el = document.getElementById(`metrics-${node.id}`);
      if (!el) return;

      // Extract variables properly from metrics object
      const cpuPct   = metrics?.cpu?.usage ?? null;
      const ramPct   = metrics?.memory ? Math.round((metrics.memory.used / metrics.memory.total) * 100) : null;
      const diskPct  = metrics?.disk?.length ? Math.round((metrics.disk[0].used / metrics.disk[0].total) * 100) : null;
      const ramUsed  = metrics?.memory ? fmtBytes(metrics.memory.used) : null;
      const ramTotal = metrics?.memory ? fmtBytes(metrics.memory.total) : null;
      const diskUsed = metrics?.disk?.length ? fmtBytes(metrics.disk[0].used) : null;
      const diskTotal= metrics?.disk?.length ? fmtBytes(metrics.disk[0].total) : null;

      // Re-build metrics section (Grid 2 columns)
      el.style.display = 'grid';
      el.style.gridTemplateColumns = '1fr 1fr';
      el.style.gap = '12px';

      el.innerHTML = `
        <!-- CPU in its own block -->
        <div style="grid-column: span 2; display:flex; flex-direction:column; gap:4px; padding-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.04);">
          <div style="display:flex; justify-content:space-between; font-size:10px; color:var(--text-muted); font-family:monospace; font-weight:700;">
            <span>CPU UTILIZATION</span>
          </div>
          ${miniBar(cpuPct, usageColor(cpuPct))}
        </div>

        <!-- RAM in left col -->
        <div style="display:flex; flex-direction:column; gap:4px;">
          <div style="display:flex; justify-content:space-between; font-size:10px; color:var(--text-muted); font-family:monospace; font-weight:700;">
            <span>RAM</span>
          </div>
          ${miniBar(ramPct, usageColor(ramPct))}
          <div style="font-size:9px; color:var(--text-muted); margin-top:2px; font-family:monospace;">${ramUsed}/${ramTotal}</div>
        </div>

        <!-- Disk in right col -->
        <div style="display:flex; flex-direction:column; gap:4px;">
          <div style="display:flex; justify-content:space-between; font-size:10px; color:var(--text-muted); font-family:monospace; font-weight:700;">
            <span>DISK</span>
          </div>
          ${miniBar(diskPct, usageColor(diskPct))}
          <div style="font-size:9px; color:var(--text-muted); margin-top:2px; font-family:monospace;">${diskUsed}/${diskTotal}</div>
        </div>
      `;
    } catch { /* silently fail */ }
  }

  async function refreshMetrics(id) {
    const el = document.getElementById(`metrics-${id}`);
    if (el) el.innerHTML = '<span class="spinner-border spinner-border-sm" style="width:12px;height:12px;border-width:2px;"></span> Memuat...';
    try {
      const res = await LP.get(`/cluster/nodes/${id}/metrics`);
      if (res?.success) {
        const _node = { id, status: 'online' };
        await fetchAndRenderMetrics({ id, status: 'online' });
        LP.toast('Metrics diperbarui', 'success');
      } else {
        LP.toast('Gagal mengambil metrics', 'error');
      }
    } catch {
      LP.toast('Gagal mengambil metrics', 'error');
    }
  }

  // ─── Modal ─────────────────────────────────────────────────────────────────

  function showAddModal() {
    document.getElementById('addNodeForm').reset();
    new bootstrap.Modal(document.getElementById('addNodeModal')).show();
  }

  function toggleApiKeyVis() {
    const inp = document.getElementById('nodeApiKey');
    const icon = document.getElementById('apiKeyEyeIcon');
    if (inp.type === 'password') {
      inp.type = 'text';
      icon.className = 'bi bi-eye-slash';
    } else {
      inp.type = 'password';
      icon.className = 'bi bi-eye';
    }
  }

  async function addNode(e) {
    e.preventDefault();
    const name      = document.getElementById('nodeName').value.trim();
    const ipAddress = document.getElementById('nodeIp').value.trim();
    const port      = document.getElementById('nodePort').value.trim(); // may be empty
    const apiKey    = document.getElementById('nodeApiKey').value.trim();

    try {
      const res = await LP.post('/cluster/nodes', { name, ipAddress, port: port || null, apiKey });
      if (res?.success) {
        LP.toast('Agent Node berhasil ditambahkan!', 'success');
        bootstrap.Modal.getInstance(document.getElementById('addNodeModal')).hide();
        loadNodes();
      } else {
        LP.toast(res.message || 'Gagal menambahkan node', 'error');
      }
    } catch {
      LP.toast('Error saat mengirim request', 'error');
    }
  }

  // ─── Actions ───────────────────────────────────────────────────────────────

  async function showDetails(id) {
    document.getElementById('detailNodeName').textContent = 'Loading...';
    document.getElementById('detailSystemInfo').innerHTML = `
      <div class="col-12 text-center py-4">
        <span class="spinner-border spinner-border-sm text-primary me-2"></span> Mengambil detail node...
      </div>`;
    document.getElementById('detailNetworkInfo').innerHTML = `<div class="col-12 text-center text-muted">Loading...</div>`;
    document.getElementById('detailDisksInfo').innerHTML = `<tr><td colspan="5" class="text-center text-muted">Loading...</td></tr>`;

    const modalEl = document.getElementById('nodeDetailsModal');
    const bModal = new bootstrap.Modal(modalEl);
    bModal.show();

    try {
      const nodeRes = await LP.get('/cluster/nodes');
      const nodes = nodeRes?.data || [];
      const nodeObj = nodes.find(n => n.id === id);

      const res = await LP.get(`/cluster/nodes/${id}/metrics`);
      if (!res?.success || !res.data) {
        document.getElementById('detailNodeName').textContent = nodeObj ? nodeObj.name : 'Unknown';
        document.getElementById('detailSystemInfo').innerHTML = `
          <div class="col-12 text-center text-danger py-4">
            <i class="bi bi-exclamation-triangle me-2"></i> Node Offline atau metrics tidak dapat dijangkau.
          </div>`;
        return;
      }

      const m = res.data;
      document.getElementById('detailNodeName').textContent = nodeObj ? `${nodeObj.name} (${nodeObj.ipAddress})` : 'Agent Node';

      // 1. System Info
      const sys = m.system || {};
      const cpu = m.cpu || {};
      const temp = m.temperature?.main ? `${m.temperature.main}°C` : 'N/A';
      const upDays = sys.uptime ? (sys.uptime / 86400).toFixed(1) + ' days' : 'N/A';

      document.getElementById('detailSystemInfo').innerHTML = `
        <div class="col-12 col-md-6">
          <table class="table table-dark table-sm table-borderless m-0" style="background:transparent; font-size:12.5px;">
            <tr><td style="color:var(--text-muted); width:110px;">OS Distro</td><td class="text-white font-mono">${sys.distro || 'Linux'} ${sys.release || ''}</td></tr>
            <tr><td style="color:var(--text-muted);">Kernel</td><td class="text-white font-mono">${sys.kernel || 'N/A'}</td></tr>
            <tr><td style="color:var(--text-muted);">Architecture</td><td class="text-white font-mono">${sys.arch || 'N/A'} (${sys.platform || ''})</td></tr>
            <tr><td style="color:var(--text-muted);">Uptime</td><td class="text-white font-mono">${upDays} (${(sys.uptime || 0).toFixed(0)}s)</td></tr>
          </table>
        </div>
        <div class="col-12 col-md-6">
          <table class="table table-dark table-sm table-borderless m-0" style="background:transparent; font-size:12.5px;">
            <tr><td style="color:var(--text-muted); width:110px;">CPU Cores</td><td class="text-white font-mono">${cpu.cores || 1} core(s) @ ${cpu.speed || 0}MHz</td></tr>
            <tr><td style="color:var(--text-muted);">Load Average</td><td class="text-white font-mono">${cpu.loadAvg ? cpu.loadAvg.join(', ') : 'N/A'}</td></tr>
            <tr><td style="color:var(--text-muted);">Temperature</td><td class="text-white font-mono">${temp}</td></tr>
            <tr><td style="color:var(--text-muted);">Response Time</td><td class="text-white font-mono">${new Date(m.timestamp || Date.now()).toLocaleTimeString()}</td></tr>
          </table>
        </div>
      `;

      // 2. Network Info
      const net = m.network || [];
      if (net.length > 0) {
        document.getElementById('detailNetworkInfo').innerHTML = net.map(n => `
          <div class="col-12 col-md-6">
            <div style="background:rgba(255,255,255,0.03); border:1px solid var(--glass-border); padding:10px 14px; border-radius:8px;">
              <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                <span class="text-white font-mono" style="font-weight:700;">${n.iface}</span>
                <span class="lp-badge lp-badge-success" style="font-size:9.5px;">${n.ip4 || 'No IP'}</span>
              </div>
              <div style="font-size:11px; color:var(--text-muted); display:flex; justify-content:space-between;">
                <span><i class="bi bi-arrow-down-short"></i> In: ${fmtBytes(n.rxTotal)} (${fmtBytes(n.rxSec)}/s)</span>
                <span><i class="bi bi-arrow-up-short"></i> Out: ${fmtBytes(n.txTotal)} (${fmtBytes(n.txSec)}/s)</span>
              </div>
            </div>
          </div>
        `).join('');
      } else {
        document.getElementById('detailNetworkInfo').innerHTML = `<div class="col-12 text-center text-muted">No network interfaces detected.</div>`;
      }

      // 3. Disks Info
      const disks = m.disk || [];
      if (disks.length > 0) {
        document.getElementById('detailDisksInfo').innerHTML = disks.map(d => {
          const usedPct = typeof d.usedPercent === 'number' ? d.usedPercent.toFixed(1) : d.usedPercent;
          return `
            <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
              <td class="font-mono text-white text-truncate" style="max-width:180px;" title="${d.fs}">${d.fs}</td>
              <td class="font-mono text-white text-truncate" style="max-width:120px;" title="${d.mount}">${d.mount}</td>
              <td class="font-mono text-muted">${d.type}</td>
              <td>
                <div style="display:flex; align-items:center; gap:8px;">
                  <div style="width:80px; height:5px; background:rgba(255,255,255,0.08); border-radius:9px; overflow:hidden;">
                    <div style="width:${usedPct}%; height:100%; background:${usageColor(usedPct)};"></div>
                  </div>
                  <span>${usedPct}%</span>
                </div>
              </td>
              <td class="text-end font-mono">${fmtBytes(d.used)} / ${fmtBytes(d.total)}</td>
            </tr>
          `;
        }).join('');
      } else {
        document.getElementById('detailDisksInfo').innerHTML = `<tr><td colspan="5" class="text-center text-muted">No disk partitions detected.</td></tr>`;
      }

    } catch (err) {
      document.getElementById('detailSystemInfo').innerHTML = `<div class="col-12 text-center text-danger">Error: ${LP.escHtml(err.message)}</div>`;
    }
  }

  async function deleteNode(id) {
    if (!(await LP.confirm('Hapus Agent Node ini? Semua data tracking akan hilang.', 'Hapus Node'))) return;
    try {
      const res = await LP.delete(`/cluster/nodes/${id}`);
      if (res?.success) {
        LP.toast('Node berhasil dihapus.', 'success');
        loadNodes();
      } else {
        LP.toast(res.message || 'Gagal menghapus node', 'error');
      }
    } catch {
      LP.toast('Error saat menghapus node', 'error');
    }
  }

  async function pingNode(id, btn) {
    const oldHtml = btn.innerHTML;
    btn.innerHTML = '<i class="bi bi-arrow-clockwise spin"></i> <span>Pinging...</span>';
    btn.disabled = true;

    try {
      const res = await LP.post(`/cluster/nodes/${id}/ping`);
      if (res?.success && res.data) {
        const isOnline = res.data.status === 'online';
        LP.toast(`Node ${isOnline ? '🟢 online' : '🔴 offline'}!`, isOnline ? 'success' : 'error');
        // Update badge in-place
        const badge = document.getElementById(`badge-${id}`);
        if (badge) {
          badge.textContent = res.data.status;
          badge.className = `lp-badge ${isOnline ? 'lp-badge-success' : 'lp-badge-danger'}`;
        }
        if (isOnline) loadNodes(); // reload to refresh metrics too
      } else {
        LP.toast(res?.message || 'Ping gagal', 'error');
      }
    } catch {
      LP.toast('Ping connection error', 'error');
    } finally {
      btn.innerHTML = oldHtml;
      btn.disabled = false;
    }
  }

  async function copyHost(host) {
    try {
      await navigator.clipboard.writeText(host);
      LP.toast('Host disalin ke clipboard', 'success');
    } catch {
      LP.toast('Gagal menyalin', 'error');
    }
  }

  return { init, showAddModal, toggleApiKeyVis, addNode, deleteNode, pingNode, copyHost, refreshMetrics, showDetails };
})();

document.addEventListener('DOMContentLoaded', () => {
  ClusterPage.init();
});
