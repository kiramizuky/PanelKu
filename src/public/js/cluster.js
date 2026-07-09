/**
 * Cluster Manager Client-Side Script
 */

const ClusterPage = (() => {
  async function init() {
    await LP.init();
    await loadNodes();
  }

  async function loadNodes() {
    const container = document.getElementById('nodesContainer');
    try {
      const res = await LP.get('/cluster/nodes');
      if (res?.success) {
        const nodes = res.data;
        if (nodes.length === 0) {
          container.innerHTML = `
            <div class="col-12 text-center" style="padding:60px 20px; color:var(--text-muted);">
              <i class="bi bi-diagram-3" style="font-size: 48px; display:block; margin-bottom:15px; color: rgba(255,255,255,0.1);"></i>
              <h5 class="text-white" style="font-weight:600; margin-bottom:5px;">No Agent Nodes Configured</h5>
              <p style="font-size:13px; max-width:400px; margin:0 auto 20px;">You can monitor and manage multiple secondary servers directly from this panel by adding them as Agent Nodes.</p>
              <button class="btn-lp btn-lp-primary" onclick="ClusterPage.showAddModal()"><i class="bi bi-plus-lg me-1"></i> Add Your First Node</button>
            </div>
          `;
          return;
        }

        container.innerHTML = nodes.map(node => {
          const isOnline = node.status === 'online';
          const badgeClass = isOnline ? 'lp-badge-success' : 'lp-badge-danger';
          const pulse = isOnline ? '<span class="status-pulse-green"></span>' : '';
          
          return `
            <div class="col-12 col-md-6 col-lg-4">
              <div class="lp-glass-card h-100 d-flex flex-column justify-content-between" style="border-radius:16px; padding:22px; position:relative; overflow:hidden;">
                <div>
                  <div class="d-flex justify-content-between align-items-start mb-3">
                    <h5 class="text-white" style="font-weight:700; margin:0; font-size:16px;">${node.name}</h5>
                    <div class="d-flex align-items-center gap-2">
                      ${pulse}
                      <span class="lp-badge ${badgeClass}" id="badge-${node.id}" style="font-size:9.5px; text-transform:uppercase; font-weight:700;">${node.status}</span>
                    </div>
                  </div>
                  
                  <div class="mb-3" style="font-family: monospace; font-size:12px; color: var(--text-secondary); background:rgba(0,0,0,0.15); padding:10px; border-radius:8px; border: 1px solid var(--glass-border); display:flex; justify-content:space-between; align-items:center;">
                    <span>${node.ipAddress}:${node.port}</span>
                    <button class="btn-lp btn-lp-ghost btn-lp-sm p-0" onclick="ClusterPage.copyIp('${node.ipAddress}:${node.port}')" title="Copy Host" style="width:24px; height:24px; display:flex; align-items:center; justify-content:center;"><i class="bi bi-clipboard"></i></button>
                  </div>
                  
                  <div style="font-size:11px; color:var(--text-muted); margin-bottom:15px;">
                    <i class="bi bi-clock me-1"></i> Last updated: ${new Date(node.updatedAt).toLocaleTimeString()}
                  </div>
                </div>

                <div class="d-flex gap-2 pt-2" style="border-top: 1px solid var(--glass-border);">
                  <button class="btn-lp btn-lp-ghost flex-fill" onclick="ClusterPage.pingNode('${node.id}', this)" style="font-size:12px; height:34px; padding:0;"><i class="bi bi-arrow-repeat me-1"></i> Ping</button>
                  <button class="btn-lp btn-lp-ghost text-danger" onclick="ClusterPage.deleteNode('${node.id}')" style="width:36px; height:34px; padding:0;" title="Delete Node"><i class="bi bi-trash"></i></button>
                </div>
              </div>
            </div>
          `;
        }).join('');
      } else {
        container.innerHTML = `<div class="col-12 text-center text-danger">Failed to load nodes: ${res.message}</div>`;
      }
    } catch {
      container.innerHTML = '<div class="col-12 text-center text-danger">Failed to connect to panel API.</div>';
    }
  }

  function showAddModal() {
    document.getElementById('addNodeForm').reset();
    new bootstrap.Modal(document.getElementById('addNodeModal')).show();
  }

  async function addNode(e) {
    e.preventDefault();
    const name = document.getElementById('nodeName').value.trim();
    const ipAddress = document.getElementById('nodeIp').value.trim();
    const port = document.getElementById('nodePort').value.trim();
    const apiKey = document.getElementById('nodeApiKey').value.trim();

    try {
      const res = await LP.post('/cluster/nodes', { name, ipAddress, port, apiKey });
      if (res?.success) {
        LP.toast('Agent Node added successfully!', 'success');
        bootstrap.Modal.getInstance(document.getElementById('addNodeModal')).hide();
        loadNodes();
      } else {
        LP.toast(res.message || 'Failed to add node', 'error');
      }
    } catch {
      LP.toast('Error sending request', 'error');
    }
  }

  async function deleteNode(id) {
    if (!(await LP.confirm('Are you sure you want to remove this Agent Node? You will lose its real-time tracking.', 'Delete Node'))) return;
    try {
      const res = await LP.delete(`/cluster/nodes/${id}`);
      if (res?.success) {
        LP.toast('Node removed successfully.', 'success');
        loadNodes();
      } else {
        LP.toast(res.message || 'Failed to delete node', 'error');
      }
    } catch {
      LP.toast('Error removing node', 'error');
    }
  }

  async function pingNode(id, btn) {
    const oldHtml = btn.innerHTML;
    btn.innerHTML = '<i class="bi bi-arrow-clockwise spin"></i>';
    btn.disabled = true;

    try {
      const res = await LP.post(`/cluster/nodes/${id}/ping`);
      if (res?.success && res.data) {
        LP.toast(`Node ping successful! Status: ${res.data.status}`, 'success');
        loadNodes();
      } else {
        LP.toast(res.message || 'Ping failed', 'error');
      }
    } catch {
      LP.toast('Ping connection error', 'error');
    } finally {
      btn.innerHTML = oldHtml;
      btn.disabled = false;
    }
  }

  async function copyIp(ip) {
    try {
      await navigator.clipboard.writeText(ip);
      LP.toast('Host copied to clipboard', 'success');
    } catch {
      LP.toast('Failed to copy', 'error');
    }
  }

  return { init, showAddModal, addNode, deleteNode, pingNode, copyIp };
})();

document.addEventListener('DOMContentLoaded', () => {
  ClusterPage.init();
});
