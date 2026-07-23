/**
 * Settings - Users logic
 */

const UsersPage = (() => {
  let userModal = null;
  let allRoles = [];

  async function init() {
    await LP.init();
    
    userModal = new bootstrap.Modal(document.getElementById('userModal'));
    
    await fetchRoles();
    await fetchUsers();
  }

  async function fetchRoles() {
    try {
      const res = await LP.get('/roles');
      if (res.data && res.data.roles) {
        allRoles = res.data.roles;
        const roleSelect = document.getElementById('role');
        roleSelect.innerHTML = allRoles.map(r => `<option value="${LP.escHtml(r.slug)}">${LP.escHtml(r.name)}</option>`).join('');
      }
    } catch (err) {
      console.error('Failed to load roles', err);
    }
  }

  async function fetchUsers() {
    try {
      const res = await LP.get('/users');
      const users = Array.isArray(res.data) ? res.data : (res.data?.users || res.data?.data || []);
      
      LP.paginate(
        users, 
        10, 
        'usersTableBody', 
        'usersPagination', 
        (u) => {
          const userId = u._id || u.id;
          const isActive = u.isActive !== false && u.status !== 'inactive';
          const statusBadge = isActive 
            ? '<span class="badge bg-success bg-opacity-10 text-success border border-success border-opacity-25">Active</span>'
            : '<span class="badge bg-danger bg-opacity-10 text-danger border border-danger border-opacity-25">Inactive</span>';

          const toggleBtn = isActive
            ? `<button class="btn-lp btn-lp-ghost text-warning me-1" onclick="UsersPage.toggleStatus('${LP.encJsArg(userId)}', 'inactive')" title="Deactivate"><i class="bi bi-pause-circle"></i></button>`
            : `<button class="btn-lp btn-lp-ghost text-success me-1" onclick="UsersPage.toggleStatus('${LP.encJsArg(userId)}', 'active')" title="Activate"><i class="bi bi-play-circle"></i></button>`;

          return `
            <tr>
              <td><strong>${LP.escHtml(u.username)}</strong> ${u.isSuperAdmin ? '<span class="badge bg-warning text-dark ms-1" style="font-size:9px">SUPERADMIN</span>' : ''}</td>
              <td>${LP.escHtml(u.email || '-')}</td>
              <td><span style="text-transform:uppercase;font-size:12px;font-weight:600;color:var(--accent-primary)">${LP.escHtml(u.role?.name || u.role?.slug || u.role || '-')}</span></td>
              <td>${statusBadge}</td>
              <td class="text-end" style="white-space:nowrap">
                ${toggleBtn}
                <button class="btn-lp btn-lp-ghost text-primary me-1" onclick="UsersPage.editUser('${LP.escHtml(userId)}')" title="Edit"><i class="bi bi-pencil"></i> Edit</button>
                <button class="btn-lp btn-lp-ghost text-danger" onclick="UsersPage.deleteUser('${LP.escHtml(userId)}')" title="Delete"><i class="bi bi-trash"></i> Delete</button>
              </td>
            </tr>
          `;
        },
        'No users found',
        5
      );
    } catch (err) {
      LP.toast(err.message || 'Failed to load users', 'error');
    }
  }

  function showCreateModal() {
    document.getElementById('userForm').reset();
    document.getElementById('userId').value = '';
    document.getElementById('userModalTitle').innerText = 'Add User';
    document.getElementById('password').required = true;
    document.getElementById('passwordHelp').innerText = 'Password is required for new users.';
    if (!userModal) userModal = new bootstrap.Modal(document.getElementById('userModal'));
    userModal.show();
  }

  async function editUser(id) {
    id = String(id || '').replace(/^"|"$/g, '').trim();
    try {
      const res = await LP.get(`/users/${id}`);
      const user = res.data?.user || res.data;
      if (!user) throw new Error('User not found');

      const userId = String(user._id || user.id || id).replace(/^"|"$/g, '').trim();
      document.getElementById('userId').value = userId;
      document.getElementById('username').value = user.username || '';
      document.getElementById('email').value = user.email || '';
      
      const roleSlug = user.role?.slug || (typeof user.role === 'string' ? user.role : 'super_admin');
      const roleSelect = document.getElementById('role');
      if (roleSelect) roleSelect.value = roleSlug;

      const isActive = user.isActive !== false && user.status !== 'inactive';
      document.getElementById('status').value = isActive ? 'active' : 'inactive';
      
      document.getElementById('userModalTitle').innerText = `Edit User: ${user.username}`;
      document.getElementById('password').required = false;
      document.getElementById('password').value = '';
      document.getElementById('passwordHelp').innerText = 'Leave blank to keep current password. Enter new password to change.';

      if (!userModal) userModal = new bootstrap.Modal(document.getElementById('userModal'));
      userModal.show();
    } catch (err) {
      LP.toast(err.message || 'Failed to load user', 'error');
    }
  }

  async function saveUser(e) {
    e.preventDefault();
    const id = String(document.getElementById('userId').value || '').replace(/^"|"$/g, '').trim();
    
    const payload = {
      username: document.getElementById('username').value.trim(),
      email: document.getElementById('email').value.trim(),
      role: document.getElementById('role').value,
      status: document.getElementById('status').value
    };

    const password = document.getElementById('password').value.trim();
    if (password) {
      payload.password = password;
    }

    try {
      if (id) {
        await LP.put(`/users/${id}`, payload);
        LP.toast('User updated successfully', 'success');
      } else {
        await LP.post('/users', payload);
        LP.toast('User created successfully', 'success');
      }
      if (userModal) userModal.hide();
      fetchUsers();
    } catch (err) {
      LP.toast(err.message || 'Failed to save user', 'error');
    }
  }

  async function deleteUser(id) {
    id = String(id || '').replace(/^"|"$/g, '').trim();
    if (await LP.confirm('Are you sure you want to delete this user?')) {
      try {
        await LP.delete(`/users/${id}`);
        LP.toast('User deleted successfully', 'success');
        fetchUsers();
      } catch (err) {
        LP.toast(err.message || 'Failed to delete user', 'error');
      }
    }
  }

  async function toggleStatus(id, newStatus) {
    id = String(id || '').replace(/^"|"$/g, '').trim();
    try {
      await LP.patch(`/users/${id}/toggle`, { status: newStatus });
      LP.toast('User status updated', 'success');
      fetchUsers();
    } catch (err) {
      LP.toast(err.message || 'Failed to update user status', 'error');
    }
  }

  return { init, showCreateModal, editUser, saveUser, deleteUser, toggleStatus };
})();

window.UsersPage = UsersPage;

document.addEventListener('DOMContentLoaded', () => {
  UsersPage.init();
});
