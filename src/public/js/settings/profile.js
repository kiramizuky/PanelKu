/**
 * Settings - Profile logic
 */

const ProfilePage = (() => {
  async function init() {
    await LP.init();
    await loadProfile();
  }

  async function loadProfile() {
    try {
      const res = await LP.api.get('/auth/profile');
      if (res.data) {
        document.getElementById('profUsername').value = res.data.username || '';
        document.getElementById('profEmail').value = res.data.email || '';
        document.getElementById('profRole').value = (res.data.role?.name || '').toUpperCase();
      }
    } catch (err) {
      LP.toast('Failed to load profile details.', 'error');
    }
  }

  async function changePassword(e) {
    e.preventDefault();
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    if (newPassword !== confirmPassword) {
      LP.toast('New passwords do not match.', 'error');
      return;
    }

    try {
      const res = await LP.api.post('/users/me/password', {
        currentPassword,
        newPassword
      });

      if (res.status === 'success') {
        LP.toast('Password updated successfully', 'success');
        e.target.reset(); // Clear the form
      } else {
        LP.toast(res.message || 'Failed to update password', 'error');
      }
    } catch (err) {
      LP.toast(err.message || 'Error updating password', 'error');
    }
  }

  return { init, changePassword };
})();

document.addEventListener('DOMContentLoaded', () => {
  ProfilePage.init();
});
