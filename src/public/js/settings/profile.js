/**
 * Settings - Profile logic
 */

const ProfilePage = (() => {
  async function init() {
    await LP.init();
    await loadProfile();
    await loadAiSettings();
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

        // Update 2FA state
        const badge = document.getElementById('2faBadge');
        const btnToggle = document.getElementById('btnToggle2FA');
        const setupContainer = document.getElementById('2faSetupContainer');
        
        if (user.twoFactorEnabled) {
          badge.textContent = 'Enabled';
          badge.className = 'lp-badge lp-badge-success mt-1';
          btnToggle.textContent = 'Disable 2FA';
          btnToggle.className = 'btn-lp btn-lp-ghost text-danger';
          setupContainer.style.display = 'none';
        } else {
          badge.textContent = 'Disabled';
          badge.className = 'lp-badge lp-badge-danger mt-1';
          btnToggle.textContent = 'Enable 2FA';
          btnToggle.className = 'btn-lp btn-lp-primary';
        }
        ProfilePage.twoFactorEnabled = user.twoFactorEnabled;
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

  let rawApiKey = '';

  async function regenerateApiKey() {
    if (!(await LP.confirm('Are you sure you want to generate a new API key? Any apps using the old key will lose access.', 'Generate API Key'))) return;
    
    const btn = document.getElementById('btnRegenApiKey');
    const oldHtml = btn.innerHTML;
    btn.innerHTML = '<i class="bi bi-arrow-clockwise spin"></i> ...';
    btn.disabled = true;

    try {
      const res = await LP.post('/users/me/api-key');
      if (res?.success && res.data?.apiKey) {
        rawApiKey = res.data.apiKey;
        
        const input = document.getElementById('profApiKey');
        input.value = rawApiKey;
        input.type = 'text'; // Show it initially
        
        // Enable visibility and copy buttons
        document.getElementById('btnToggleApiKey').disabled = false;
        document.getElementById('btnCopyApiKey').disabled = false;
        
        // Update eye icon state
        const eyeIcon = document.getElementById('btnToggleApiKey').querySelector('i');
        eyeIcon.className = 'bi bi-eye-slash';

        LP.toast('New API key generated successfully!', 'success');
      } else {
        LP.toast(res?.message || 'Failed to generate API key', 'error');
      }
    } catch (err) {
      LP.toast('Error generating API key', 'error');
    } finally {
      btn.innerHTML = oldHtml;
      btn.disabled = false;
    }
  }

  function toggleApiKeyVisibility() {
    const input = document.getElementById('profApiKey');
    const eyeIcon = document.getElementById('btnToggleApiKey').querySelector('i');
    
    if (input.type === 'password') {
      input.type = 'text';
      input.value = rawApiKey;
      eyeIcon.className = 'bi bi-eye-slash';
    } else {
      input.type = 'password';
      input.value = '••••••••••••••••••••••••••••••••';
      eyeIcon.className = 'bi bi-eye';
    }
  }

  async function copyApiKey() {
    if (!rawApiKey) return;
    try {
      await navigator.clipboard.writeText(rawApiKey);
      const btn = document.getElementById('btnCopyApiKey');
      const oldHtml = btn.innerHTML;
      btn.innerHTML = '<i class="bi bi-check2"></i>';
      LP.toast('API Key copied to clipboard', 'success');
      setTimeout(() => {
        btn.innerHTML = oldHtml;
      }, 2000);
    } catch (err) {
      LP.toast('Failed to copy to clipboard', 'error');
    }
  }

  async function toggle2FA() {
    const setupContainer = document.getElementById('2faSetupContainer');
    
    if (ProfilePage.twoFactorEnabled) {
      const password = await LP.prompt('Enter your current password to disable 2FA:', 'password', 'Disable 2FA');
      if (!password) return;
      
      try {
        const res = await LP.post('/auth/2fa/disable', { password });
        if (res?.success) {
          LP.toast('2FA has been disabled.', 'success');
          loadProfile();
        } else {
          LP.toast(res?.message || 'Failed to disable 2FA', 'error');
        }
      } catch (err) {
        LP.toast('Error disabling 2FA', 'error');
      }
    } else {
      if (setupContainer.style.display === 'none') {
        try {
          const res = await LP.post('/auth/2fa/setup');
          if (res?.success && res.data) {
            document.getElementById('2faQrCode').src = res.data.qrCode;
            document.getElementById('2faSecretKey').value = res.data.secret;
            setupContainer.style.display = 'block';
          } else {
            LP.toast(res?.message || 'Failed to initiate 2FA setup', 'error');
          }
        } catch (err) {
          LP.toast('Error initiating 2FA setup', 'error');
        }
      } else {
        setupContainer.style.display = 'none';
      }
    }
  }

  async function confirmEnable2FA() {
    const otp = document.getElementById('2faOtpCode').value.trim();
    if (!otp) {
      LP.toast('Please enter the authenticator OTP code.', 'error');
      return;
    }
    
    try {
      const res = await LP.post('/auth/2fa/enable', { otp });
      if (res?.success) {
        LP.toast('2FA has been successfully enabled!', 'success');
        document.getElementById('2faOtpCode').value = '';
        loadProfile();
      } else {
        LP.toast(res?.message || 'Failed to verify OTP', 'error');
      }
    } catch (err) {
      LP.toast('Error verifying OTP', 'error');
    }
  }

  async function loadAiSettings() {
    try {
      const res = await LP.get('/users/me/ai');
      if (res?.success && res.data?.aiSettings) {
        const settings = res.data.aiSettings;
        document.getElementById('aiProvider').value = settings.provider || 'built-in';
        document.getElementById('aiApiKey').value = settings.apiKey || '';
        document.getElementById('aiModel').value = settings.model || '';
        toggleAiFields();
      }
    } catch (e) {
      console.error('Failed to load AI settings', e);
    }
  }

  function toggleAiFields() {
    const provider = document.getElementById('aiProvider').value;
    const keyGroup = document.getElementById('aiKeyGroup');
    const modelGroup = document.getElementById('aiModelGroup');

    if (provider === 'built-in') {
      keyGroup.style.display = 'none';
      modelGroup.style.display = 'none';
    } else {
      keyGroup.style.display = 'block';
      modelGroup.style.display = 'block';
      
      const modelInput = document.getElementById('aiModel');
      if (provider === 'openai') {
        modelInput.placeholder = 'gpt-4o-mini';
      } else if (provider === 'gemini') {
        modelInput.placeholder = 'gemini-1.5-flash';
      } else if (provider === 'openrouter') {
        modelInput.placeholder = 'google/gemini-2.5-flash';
      }
    }
  }

  async function saveAiSettings() {
    const provider = document.getElementById('aiProvider').value;
    const apiKey = document.getElementById('aiApiKey').value.trim();
    const model = document.getElementById('aiModel').value.trim() || document.getElementById('aiModel').placeholder;

    try {
      const res = await LP.put('/users/me/ai', { provider, apiKey, model });
      if (res?.success) {
        LP.toast('AI settings saved successfully', 'success');
        loadAiSettings();
      } else {
        LP.toast(res?.message || 'Failed to save settings', 'error');
      }
    } catch (err) {
      LP.toast('Error saving AI settings', 'error');
    }
  }

  async function updateProfile(e) {
    e.preventDefault();
    const btn = document.getElementById('btnSaveProfile');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Saving...';
    }
    const username = document.getElementById('profUsername').value.trim();
    const email = document.getElementById('profEmail').value.trim();

    try {
      const res = await LP.put('/users/me/profile', { username, email });
      if (res?.success) {
        LP.toast('Account details updated successfully!', 'success');
        loadProfile();
      } else {
        LP.toast(res?.message || 'Failed to update profile', 'error');
      }
    } catch (err) {
      LP.toast(err.message || 'Error updating profile', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-check-lg me-1"></i> Save Account Details';
      }
    }
  }

  return { init, updateProfile, changePassword, regenerateApiKey, toggleApiKeyVisibility, copyApiKey, toggle2FA, confirmEnable2FA, toggleAiFields, saveAiSettings, loadAiSettings };
})();

window.ProfilePage = ProfilePage;

document.addEventListener('DOMContentLoaded', () => {
  ProfilePage.init();
});
