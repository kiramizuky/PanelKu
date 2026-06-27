/**
 * Settings - Roles logic
 */

const RolesPage = (() => {
  let roleModal = null;
  let allResources = [];
  const ACTIONS = ['read', 'create', 'update', 'delete', 'execute'];

  async function init() {
    await LP.init();
    
    roleModal = new bootstrap.Modal(document.getElementById('roleModal'));
    
    await fetchResources();
    await fetchRoles();
  }

  async function fetchResources() {
    try {
      const res = await LP.get('/roles/resources');
      allResources = res.data?.resources || [];
      renderPermissionsMatrix();
    } catch (err) {
      console.error('Failed to load resources', err);
    }
  }

  function renderPermissionsMatrix() {
    const container = document.getElementById('permissionsContainer');
    if (!container) return;

    let html = `
      <div class="table-responsive">
        <table class="table table-borderless table-sm mb-0" style="color: var(--text-primary);">
          <thead>
            <tr>
              <th style="color:var(--text-secondary);font-weight:600;font-size:12px;padding-bottom:15px;">Resource</th>
              ${ACTIONS.map(a => `<th style="text-align:center;color:var(--text-secondary);font-weight:600;font-size:12px;text-transform:capitalize;padding-bottom:15px;">${a}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
    `;

    allResources.forEach(res => {
      html += `<tr>
        <td style="padding:8px 0;">
          <span class="badge bg-primary bg-opacity-10 text-primary border border-primary border-opacity-25" style="font-size:11px;font-weight:600;letter-spacing:0.5px;">${res.resource.toUpperCase()}</span>
        </td>`;
      
      ACTIONS.forEach(action => {
        const id = `perm_${res.resource}_${action}`;
        html += `
          <td style="text-align:center;padding:10px 0;">
            <div class="form-check d-flex justify-content-center m-0">
              <input class="form-check-input perm-checkbox" type="checkbox" id="${id}" data-resource="${res.resource}" data-action="${action}">
            </div>
          </td>
        `;
      });
      html += `</tr>`;
    });

    html += `</tbody></table></div>`;
    container.innerHTML = html;
  }

  async function fetchRoles() {
    try {
      const res = await LP.get('/roles');
      const roles = res.data?.roles || [];
      const tbody = document.getElementById('rolesTableBody');
      
      if (roles.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted py-4">No roles found</td></tr>';
        return;
      }

      tbody.innerHTML = roles.map(r => {
        const editBtn = `<button class="btn-lp btn-lp-ghost text-primary" onclick="RolesPage.editRole('${r._id}')" title="Edit"><i class="bi bi-pencil"></i></button>`;
        const delBtn = r.isSystem 
          ? `<button class="btn-lp btn-lp-ghost text-muted" disabled title="System Role"><i class="bi bi-trash"></i></button>`
          : `<button class="btn-lp btn-lp-ghost text-danger" onclick="RolesPage.deleteRole('${r._id}')" title="Delete"><i class="bi bi-trash"></i></button>`;

        return `
          <tr>
            <td>
              <span style="font-weight:600;color:var(--text-primary)">${r.name}</span>
              ${r.isSystem ? '<span class="badge bg-danger bg-opacity-10 text-danger border border-danger border-opacity-25 ms-2">System</span>' : ''}
            </td>
            <td><span class="text-muted" style="font-size:13px">${r.description || '-'}</span></td>
            <td class="text-end" style="white-space:nowrap">
              ${editBtn}
              ${delBtn}
            </td>
          </tr>
        `;
      }).join('');
      
    } catch (err) {
      LP.toast(err.message || 'Failed to load roles', 'error');
    }
  }

  function showCreateModal() {
    document.getElementById('roleForm').reset();
    document.getElementById('roleId').value = '';
    document.getElementById('roleName').disabled = false;
    document.getElementById('roleModalTitle').innerText = 'Add Role';
    
    // Uncheck all
    document.querySelectorAll('.perm-checkbox').forEach(cb => cb.checked = false);
    
    roleModal.show();
  }

  async function editRole(id) {
    try {
      const res = await LP.get(`/roles/${id}`);
      const role = res.data?.role;
      if (!role) throw new Error('Role not found');

      document.getElementById('roleId').value = role._id;
      document.getElementById('roleName').value = role.name;
      document.getElementById('roleName').disabled = role.isSystem;
      document.getElementById('roleDesc').value = role.description || '';
      document.getElementById('roleModalTitle').innerText = 'Edit Role';
      
      // Uncheck all first
      document.querySelectorAll('.perm-checkbox').forEach(cb => cb.checked = false);

      // Check corresponding
      (role.permissions || []).forEach(perm => {
        perm.actions.forEach(act => {
          const cb = document.getElementById(`perm_${perm.resource}_${act}`);
          if (cb) cb.checked = true;
        });
      });

      roleModal.show();
    } catch (err) {
      LP.toast(err.message || 'Failed to load role', 'error');
    }
  }

  async function saveRole(e) {
    e.preventDefault();
    const id = document.getElementById('roleId').value;
    const name = document.getElementById('roleName').value;
    const description = document.getElementById('roleDesc').value;
    
    // Gather permissions
    const permMap = {};
    document.querySelectorAll('.perm-checkbox:checked').forEach(cb => {
      const res = cb.dataset.resource;
      const act = cb.dataset.action;
      if (!permMap[res]) permMap[res] = [];
      permMap[res].push(act);
    });

    const permissions = Object.keys(permMap).map(res => ({
      resource: res,
      actions: permMap[res]
    }));

    const payload = { name, description, permissions };

    try {
      if (id) {
        await LP.put(`/roles/${id}`, payload);
        LP.toast('Role updated successfully', 'success');
      } else {
        await LP.post('/roles', payload);
        LP.toast('Role created successfully', 'success');
      }
      roleModal.hide();
      fetchRoles();
    } catch (err) {
      LP.toast(err.message || 'Failed to save role', 'error');
    }
  }

  async function deleteRole(id) {
    if (await LP.confirm('Are you sure you want to delete this role?')) {
      try {
        await LP.delete(`/roles/${id}`);
        LP.toast('Role deleted successfully', 'success');
        fetchRoles();
      } catch (err) {
        LP.toast(err.message || 'Failed to delete role', 'error');
      }
    }
  }

  return { init, showCreateModal, editRole, saveRole, deleteRole };
})();

document.addEventListener('DOMContentLoaded', () => {
  RolesPage.init();
});
