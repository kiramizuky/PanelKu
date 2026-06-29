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
      const res = await LP.get('/auth/profile');
      if (res.data && res.data.user) {
        const user = res.data.user;
        document.getElementById('profUsername').value = user.username || '';
        document.getElementById('profEmail').value = user.email || '';
        document.getElementById('profRole').value = (user.role?.name || '').toUpperCase();

        // Update live avatar card elements
        document.getElementById('profileCardName').textContent = user.username || 'User';
        document.getElementById('profileCardEmail').textContent = user.email || 'No email set';
        document.getElementById('profileCardBadge').textContent = (user.role?.name || 'User').toUpperCase();
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
      const res = await LP.post('/users/me/password', {
        currentPassword,
        newPassword
      });

      if (res.success) {
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
