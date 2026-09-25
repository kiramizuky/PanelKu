/**
 * Settings - Users logic
 */

const UsersPage = (() => {
  let userModal = null;
  let sessionsModal = null;
  let currentSessionsUserId = null;
  let allRoles = [];

  async function init() {
    await LP.init();
    
    const modalEl = document.getElementById('userModal');
    if (modalEl) {
      userModal = new bootstrap.Modal(modalEl);
    }

    const sessModalEl = document.getElementById('userSessionsModal');
    if (sessModalEl) {
      sessionsModal = new bootstrap.Modal(sessModalEl);
    }
    
    await fetchRoles();
    await fetchUsers();
  }

  async function fetchRoles() {
    try {
      const res = await LP.get('/roles');
      const roles = res?.data?.roles || (Array.isArray(res?.data) ? res.data : []);
      if (roles && roles.length > 0) {
        allRoles = roles;
        const roleSelect = document.getElementById('role');
        if (roleSelect) {
          roleSelect.innerHTML = allRoles.map(r => `<option value="${LP.escHtml(r.slug)}">${LP.escHtml(r.name)}</option>`).join('');
        }
      }
    } catch (err) {
      console.error('Failed to load roles', err);
    }
  }

  async function fetchUsers() {
    try {
      const res = await LP.get('/users?limit=100');
      const users = Array.isArray(res?.data) ? res.data : (res?.data?.users || res?.data?.data || []);
      
      LP.paginate(
        users, 
        10, 
        'usersTableBody', 
        'usersPagination', 
        (u) => {
          const userId = u._id || u.id;
          const isActive = u.isActive !== false && u.status !== 'inactive';
          const statusBadge = isActive 
            ? '<span class="badge bg-success bg-opacity-10 text-success border border-success border-opacity-25"><i class="bi bi-check-circle me-1"></i>Active</span>'
            : '<span class="badge bg-danger bg-opacity-10 text-danger border border-danger border-opacity-25"><i class="bi bi-x-circle me-1"></i>Inactive</span>';

          const roleName = u.role?.name || u.role?.slug || u.role || 'Member';
          const roleColor = u.role?.color || 'var(--accent-primary)';

          const toggleBtn = isActive
            ? `<button class="btn-lp btn-lp-ghost text-warning me-1" onclick="LP.call('UsersPage.toggleStatus', '${LP.encJsArg(userId)}', 'inactive')" title="Deactivate"><i class="bi bi-pause-circle"></i></button>`
            : `<button class="btn-lp btn-lp-ghost text-success me-1" onclick="LP.call('UsersPage.toggleStatus', '${LP.encJsArg(userId)}', 'active')" title="Activate"><i class="bi bi-play-circle"></i></button>`;

          return `
            <tr>
              <td>
                <strong>${LP.escHtml(u.username)}</strong>
                ${u.isSuperAdmin ? '<span class="badge bg-warning text-dark ms-1" style="font-size:9px">SUPERADMIN</span>' : ''}
              </td>
              <td>${LP.escHtml(u.email || '-')}</td>
              <td><span style="text-transform:uppercase;font-size:11px;font-weight:700;color:${roleColor}">${LP.escHtml(roleName)}</span></td>
              <td>${statusBadge}</td>
              <td class="text-end" style="white-space:nowrap">
                ${toggleBtn}
                <button class="btn-lp btn-lp-ghost text-info me-1" onclick="UsersPage.showSessionsModal('${LP.escHtml(userId)}', '${LP.escHtml(u.username)}')" title="Active Sessions"><i class="bi bi-shield-check"></i></button>
                <button class="btn-lp btn-lp-ghost text-primary me-1" onclick="UsersPage.editUser('${LP.escHtml(userId)}')" title="Edit"><i class="bi bi-pencil"></i> Edit</button>
                ${u.isSuperAdmin ? '' : `<button class="btn-lp btn-lp-ghost text-danger" onclick="UsersPage.deleteUser('${LP.escHtml(userId)}')" title="Delete"><i class="bi bi-trash"></i> Delete</button>`}
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
    const form = document.getElementById('userForm');
    if (form) form.reset();

    document.getElementById('userId').value = '';
    document.getElementById('userModalTitle').innerHTML = '<i class="bi bi-person-plus text-primary me-1"></i> Add User';
    
    const pwdInput = document.getElementById('password');
    pwdInput.required = true;
    pwdInput.type = 'password';
    pwdInput.value = '';

    const eyeIcon = document.getElementById('passwordEyeIcon');
    if (eyeIcon) eyeIcon.className = 'bi bi-eye';

    document.getElementById('passwordHelp').innerText = 'Min. 12 characters, including uppercase, lowercase, number, and special character.';
    
    if (!userModal) userModal = new bootstrap.Modal(document.getElementById('userModal'));
    userModal.show();
  }

  async function editUser(id) {
    id = String(id || '').replace(/^"|"$/g, '').trim();
    try {
      const res = await LP.get(`/users/${id}`);
      const user = res?.data?.user || res?.data;
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
      
      document.getElementById('userModalTitle').innerHTML = `<i class="bi bi-pencil-square text-primary me-1"></i> Edit User: ${LP.escHtml(user.username)}`;
      
      const pwdInput = document.getElementById('password');
      pwdInput.required = false;
      pwdInput.type = 'password';
      pwdInput.value = '';

      const eyeIcon = document.getElementById('passwordEyeIcon');
      if (eyeIcon) eyeIcon.className = 'bi bi-eye';

      document.getElementById('passwordHelp').innerText = 'Leave blank to keep current password. Enter new password to change (min. 12 chars).';

      if (!userModal) userModal = new bootstrap.Modal(document.getElementById('userModal'));
      userModal.show();
    } catch (err) {
      LP.toast(err.message || 'Failed to load user', 'error');
    }
  }

  function togglePasswordVisibility() {
    const pwdInput = document.getElementById('password');
    const eyeIcon = document.getElementById('passwordEyeIcon');
    if (!pwdInput) return;

    if (pwdInput.type === 'password') {
      pwdInput.type = 'text';
      if (eyeIcon) eyeIcon.className = 'bi bi-eye-slash';
    } else {
      pwdInput.type = 'password';
      if (eyeIcon) eyeIcon.className = 'bi bi-eye';
    }
  }

  function generatePassword() {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghijkmnopqrstuvwxyz';
    const nums = '23456789';
    const special = '!@#$%^&*()-_=+';
    const all = upper + lower + nums + special;

    let pwd = '';
    pwd += upper.charAt(Math.floor(Math.random() * upper.length));
    pwd += lower.charAt(Math.floor(Math.random() * lower.length));
    pwd += nums.charAt(Math.floor(Math.random() * nums.length));
    pwd += special.charAt(Math.floor(Math.random() * special.length));

    for (let i = pwd.length; i < 16; i++) {
      pwd += all.charAt(Math.floor(Math.random() * all.length));
    }

    // Shuffle characters
    pwd = pwd.split('').sort(() => 0.5 - Math.random()).join('');

    const pwdInput = document.getElementById('password');
    if (pwdInput) {
      pwdInput.value = pwd;
      pwdInput.type = 'text';
      const eyeIcon = document.getElementById('passwordEyeIcon');
      if (eyeIcon) eyeIcon.className = 'bi bi-eye-slash';
    }

    LP.copy(pwd, 'Strong password generated & copied to clipboard!');
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

    const saveBtn = document.getElementById('saveUserBtn');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Saving...';
    }

    try {
      let res;
      if (id) {
        res = await LP.put(`/users/${id}`, payload);
      } else {
        res = await LP.post('/users', payload);
      }

      if (!res || res.success === false) {
        LP.toast(res?.message || (id ? 'Failed to update user' : 'Failed to create user'), 'error');
        return;
      }

      LP.toast(res.message || (id ? 'User updated successfully' : 'User created successfully'), 'success');
      if (userModal) userModal.hide();
      await fetchUsers();
    } catch (err) {
      LP.toast(err.message || 'Failed to save user', 'error');
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="bi bi-check2-circle"></i> Save';
      }
    }
  }

  async function deleteUser(id) {
    id = String(id || '').replace(/^"|"$/g, '').trim();
    if (await LP.confirm('Are you sure you want to delete this user?')) {
      try {
        const res = await LP.delete(`/users/${id}`);
        if (!res || res.success === false) {
          LP.toast(res?.message || 'Failed to delete user', 'error');
          return;
        }
        LP.toast(res.message || 'User deleted successfully', 'success');
        await fetchUsers();
      } catch (err) {
        LP.toast(err.message || 'Failed to delete user', 'error');
      }
    }
  }

  async function toggleStatus(id, newStatus) {
    id = String(id || '').replace(/^"|"$/g, '').trim();
    try {
      const res = await LP.patch(`/users/${id}/toggle`, { status: newStatus });
      if (!res || res.success === false) {
        LP.toast(res?.message || 'Failed to update user status', 'error');
        return;
      }
      LP.toast(res.message || 'User status updated', 'success');
      await fetchUsers();
    } catch (err) {
      LP.toast(err.message || 'Failed to update user status', 'error');
    }
  }

  // ── Session Management ───────────────────────────────

  function showSessionsModal(userId, username) {
    currentSessionsUserId = userId;
    const titleEl = document.getElementById('sessionsModalTitle');
    if (titleEl) {
      titleEl.innerHTML = `<i class="bi bi-shield-check text-info me-1"></i> Active Sessions: <span class="text-primary">${LP.escHtml(username)}</span>`;
    }
    if (sessionsModal) {
      sessionsModal.show();
    }
    loadSessions(userId);
  }

  async function loadSessions(userId) {
    const tbody = document.getElementById('userSessionsTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted);">Loading active sessions...</td></tr>';

    try {
      const res = await LP.get(`/users/${userId}/sessions`);
      if (!res?.success) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--accent-danger);">Failed to load sessions: ${LP.escHtml(res?.message || 'Error')}</td></tr>`;
        return;
      }

      const sessions = res.data?.sessions || [];
      if (sessions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted);">No active sessions found for this user.</td></tr>';
        return;
      }

      tbody.innerHTML = sessions.map(s => {
        const createdDate = s.createdAt ? new Date(s.createdAt).toLocaleString() : '-';
        const lastActiveDate = s.lastActive ? new Date(s.lastActive).toLocaleString() : '-';

        return `
          <tr>
            <td>
              <i class="bi bi-laptop text-info me-1"></i>
              <strong>${LP.escHtml(s.deviceInfo)}</strong>
              <div class="text-muted" style="font-size:11px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${LP.escHtml(s.userAgent)}</div>
            </td>
            <td><code class="font-mono text-warning">${LP.escHtml(s.ip)}</code></td>
            <td style="font-size:12px;color:var(--text-muted);">${LP.escHtml(createdDate)}</td>
            <td style="font-size:12px;color:var(--text-secondary);">${LP.escHtml(lastActiveDate)}</td>
            <td style="text-align:right;">
              <button class="btn-lp btn-lp-danger btn-lp-sm" onclick="UsersPage.revokeSession('${LP.escHtml(s.id)}')">
                <i class="bi bi-x-circle me-1"></i> Revoke
              </button>
            </td>
          </tr>
        `;
      }).join('');
    } catch {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--accent-danger);">Connection error loading sessions.</td></tr>';
    }
  }

  function refreshSessions() {
    if (currentSessionsUserId) {
      loadSessions(currentSessionsUserId);
    }
  }

  async function revokeSession(sessionId) {
    if (!await LP.confirm('Revoke this active session? The user will be logged out on that device.', 'Revoke Session')) {
      return;
    }

    try {
      const res = await LP.delete(`/users/${currentSessionsUserId}/sessions/${sessionId}`);
      if (res?.success) {
        LP.toast('Session revoked successfully', 'success');
        refreshSessions();
      } else {
        LP.toast(res?.message || 'Failed to revoke session', 'error');
      }
    } catch {
      LP.toast('Error revoking session', 'error');
    }
  }

  async function revokeAllSessions() {
    if (!await LP.confirm('Revoke ALL active sessions for this user? All their logged in devices will be terminated.', 'Revoke All Sessions')) {
      return;
    }

    try {
      const res = await LP.delete(`/users/${currentSessionsUserId}/sessions`);
      if (res?.success) {
        LP.toast('All sessions revoked successfully', 'success');
        refreshSessions();
      } else {
        LP.toast(res?.message || 'Failed to revoke sessions', 'error');
      }
    } catch {
      LP.toast('Error revoking sessions', 'error');
    }
  }

  return { 
    init, 
    showCreateModal, 
    editUser, 
    saveUser, 
    deleteUser, 
    toggleStatus, 
    generatePassword, 
    togglePasswordVisibility,
    showSessionsModal,
    refreshSessions,
    revokeSession,
    revokeAllSessions
  };
})();

window.UsersPage = UsersPage;

document.addEventListener('DOMContentLoaded', () => {
  UsersPage.init();
});
