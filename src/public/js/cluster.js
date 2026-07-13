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
      const diskPct  = metrics.disk?.length ? Math.round((metrics.disk[0].used / metrics.disk[0].size) * 100) : null;
      const ramUsed  = metrics.memory ? fmtBytes(metrics.memory.used * 1024 * 1024) : null;
      const ramTotal = metrics.memory ? fmtBytes(metrics.memory.total * 1024 * 1024) : null;
      const diskUsed = metrics.disk?.length ? fmtBytes(metrics.disk[0].used * 1024 * 1024 * 1024) : null;
      const diskTotal= metrics.disk?.length ? fmtBytes(metrics.disk[0].size * 1024 * 1024 * 1024) : null;

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
        <div style="font-size:9.5px; color:var(--text-muted); text-align:right; margin-top:-4px; margin-bottom:2px; padding-left:58px;">${ramUsed} / ${ramTotal}</div>`);

      if (diskPct !== null) rows.push(`
        <div style="display:grid; grid-template-columns: 52px 1fr; gap:6px; align-items:center;">
          <span style="font-size:10px; color:var(--text-muted); font-family:monospace;">Disk</span>
          ${miniBar(diskPct, usageColor(diskPct))}
        </div>
        <div style="font-size:9.5px; color:var(--text-muted); text-align:right; margin-top:-4px; padding-left:58px;">${diskUsed} / ${diskTotal}</div>`);

      if (rows.length > 0) {
        metricsHtml = `
          <div id="metrics-${node.id}" style="background:rgba(0,0,0,0.2); border-radius:10px; padding:12px 14px; margin-bottom:14px; display:flex; flex-direction:column; gap:8px; border:1px solid var(--glass-border);">
            ${rows.join('')}
          </div>`;
      }
    } else if (isOnline) {
      // Online but metrics not yet loaded — show loading skeleton
      metricsHtml = `
        <div id="metrics-${node.id}" style="background:rgba(0,0,0,0.2); border-radius:10px; padding:12px 14px; margin-bottom:14px; border:1px solid var(--glass-border); display:flex; align-items:center; gap:8px; color:var(--text-muted); font-size:11px;">
          <span class="spinner-border spinner-border-sm" style="width:12px;height:12px;border-width:2px;"></span> Mengambil metrics...
        </div>`;
    }

    return `
      <div class="col-12 col-md-6 col-xl-4">
        <div class="lp-glass-card h-100 d-flex flex-column" style="border-radius:16px; padding:20px; position:relative; overflow:hidden; transition: box-shadow .2s ease;">

          <!-- Glow accent top-left when online -->
          ${isOnline ? '<div style="position:absolute;top:0;left:0;width:60px;height:3px;background:linear-gradient(90deg,#22c55e,transparent);border-radius:0 0 8px 0;"></div>' : ''}

          <!-- Header: name + status badge -->
          <div class="d-flex justify-content-between align-items-start mb-3">
            <div>
              <h5 class="text-white" style="font-weight:700; margin:0 0 3px 0; font-size:15px;">${node.name}</h5>
              <span style="font-size:10px; color:var(--text-muted);">Agent Node</span>
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
              <button class="btn-lp btn-lp-ghost" onclick="ClusterPage.copyHost('${hostLabel}')" title="Copy host" style="width:28px;height:28px;padding:0;display:flex;align-items:center;justify-content:center;border-radius:6px;font-size:12px;">
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
            <button class="btn-lp btn-lp-ghost" onclick="ClusterPage.pingNode('${node.id}', this)"
              style="flex:1; font-size:12px; height:34px; padding:0 10px; display:flex; align-items:center; justify-content:center; gap:5px; border-radius:8px;"
              title="Ping node">
              <i class="bi bi-arrow-repeat"></i><span>Ping</span>
            </button>
            <button class="btn-lp btn-lp-ghost" onclick="ClusterPage.refreshMetrics('${node.id}')"
              style="flex:1; font-size:12px; height:34px; padding:0 10px; display:flex; align-items:center; justify-content:center; gap:5px; border-radius:8px;"
              title="Refresh metrics" ${!isOnline ? 'disabled' : ''}>
              <i class="bi bi-activity"></i><span>Metrics</span>
            </button>
            <button class="btn-lp" onclick="ClusterPage.deleteNode('${node.id}')"
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
        container.innerHTML = `<div class="col-12 text-center text-danger">Gagal memuat nodes: ${res?.message || ''}</div>`;
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

      // Re-build metrics section
      const cpuPct   = metrics?.cpu?.usage ?? null;
      const ramPct   = metrics?.memory ? Math.round((metrics.memory.used / metrics.memory.total) * 100) : null;
      const diskPct  = metrics?.disk?.length ? Math.round((metrics.disk[0].used / metrics.disk[0].size) * 100) : null;
      const ramUsed  = metrics?.memory ? fmtBytes(metrics.memory.used * 1024 * 1024) : null;
      const ramTotal = metrics?.memory ? fmtBytes(metrics.memory.total * 1024 * 1024) : null;
      const diskUsed = metrics?.disk?.length ? fmtBytes(metrics.disk[0].used * 1024 * 1024 * 1024) : null;
      const diskTotal= metrics?.disk?.length ? fmtBytes(metrics.disk[0].size * 1024 * 1024 * 1024) : null;

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
        <div style="font-size:9.5px; color:var(--text-muted); text-align:right; margin-top:-4px; margin-bottom:2px; padding-left:58px;">${ramUsed} / ${ramTotal}</div>`);
      if (diskPct !== null) rows.push(`
        <div style="display:grid; grid-template-columns: 52px 1fr; gap:6px; align-items:center;">
          <span style="font-size:10px; color:var(--text-muted); font-family:monospace;">Disk</span>
          ${miniBar(diskPct, usageColor(diskPct))}
        </div>
        <div style="font-size:9.5px; color:var(--text-muted); text-align:right; margin-top:-4px; padding-left:58px;">${diskUsed} / ${diskTotal}</div>`);

      el.innerHTML = rows.length > 0 ? rows.join('') : '<span style="font-size:11px; color:var(--text-muted);">Metrics tidak tersedia</span>';
    } catch { /* silently fail */ }
  }

  async function refreshMetrics(id) {
    const el = document.getElementById(`metrics-${id}`);
    if (el) el.innerHTML = '<span class="spinner-border spinner-border-sm" style="width:12px;height:12px;border-width:2px;"></span> Memuat...';
    try {
      const res = await LP.get(`/cluster/nodes/${id}/metrics`);
      if (res?.success) {
        const node = { id, status: 'online' };
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

  return { init, showAddModal, toggleApiKeyVis, addNode, deleteNode, pingNode, copyHost, refreshMetrics };
})();

document.addEventListener('DOMContentLoaded', () => {
  ClusterPage.init();
});
