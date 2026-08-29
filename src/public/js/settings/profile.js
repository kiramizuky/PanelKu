/**
 * Settings - Profile logic
 */

const ProfilePage = (() => {
  async function init() {
    await LP.init();
    await loadProfile();
    await loadAiSettings();
    await loadPasskeys();
    await loadPushStatus();
  }

  // ── WebAuthn / Passkey Helper Functions ──
  function b64urlToBuf(b64url) {
    const padding = '='.repeat((4 - (b64url.length % 4)) % 4);
    const base64 = (b64url + padding).replace(/\-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const arr = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) arr[i] = rawData.charCodeAt(i);
    return arr.buffer;
  }

  function bufToB64url(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  async function loadPasskeys() {
    const container = document.getElementById('passkeyList');
    if (!container) return;

    try {
      const res = await LP.get('/auth/passkey/list');
      if (res?.data?.passkeys && res.data.passkeys.length > 0) {
        container.innerHTML = res.data.passkeys.map(k => `
          <div class="d-flex align-items-center justify-content-between p-2 rounded" style="background:rgba(0,0,0,0.25); border:1px solid var(--glass-border);">
            <div style="display:flex; align-items:center; gap:8px; overflow:hidden;">
              <i class="bi bi-shield-check text-primary" style="font-size:16px;"></i>
              <div style="min-width:0;">
                <div style="font-size:12px; font-weight:600; color:#fff; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${LP.escHtml(k.deviceName)}</div>
                <small class="text-muted" style="font-size:10px;">Added: ${new Date(k.createdAt).toLocaleDateString()}</small>
              </div>
            </div>
            <button class="btn-lp btn-lp-ghost text-danger btn-lp-sm" onclick="ProfilePage.deletePasskey('${k.id}')" title="Delete Passkey" style="padding:2px 6px;">
              <i class="bi bi-trash"></i>
            </button>
          </div>
        `).join('');
      } else {
        container.innerHTML = '<p class="text-muted mb-0" style="font-size:11.5px;">No passkeys registered yet.</p>';
      }
    } catch {
      container.innerHTML = '<p class="text-danger mb-0" style="font-size:11px;">Failed to load passkeys.</p>';
    }
  }

  async function registerPasskey() {
    if (!window.PublicKeyCredential) {
      LP.toast('Passkeys / WebAuthn is not supported on this browser.', 'error');
      return;
    }

    const deviceName = prompt('Enter a friendly name for this passkey (e.g. MacBook Touch ID, YubiKey 5):', 'Security Key / Device');
    if (!deviceName) return;

    LP.toast('Follow your device prompt to register passkey...', 'info');

    try {
      const optRes = await LP.get('/auth/passkey/register-options');
      if (!optRes?.data) throw new Error(optRes?.message || 'Failed to get registration options');

      const options = optRes.data;
      const publicKeyOpts = {
        ...options,
        challenge: b64urlToBuf(options.challenge),
        user: {
          ...options.user,
          id: b64urlToBuf(options.user.id),
        },
      };
      if (publicKeyOpts.excludeCredentials) {
        publicKeyOpts.excludeCredentials = publicKeyOpts.excludeCredentials.map(c => ({
          ...c,
          id: b64urlToBuf(c.id),
        }));
      }

      const credential = await navigator.credentials.create({ publicKey: publicKeyOpts });
      if (!credential) throw new Error('Passkey registration cancelled');

      const responsePayload = {
        id: credential.id,
        rawId: bufToB64url(credential.rawId),
        type: credential.type,
        response: {
          clientDataJSON: bufToB64url(credential.response.clientDataJSON),
          attestationObject: bufToB64url(credential.response.attestationObject),
          transports: credential.response.getTransports ? credential.response.getTransports() : ['internal'],
        },
      };

      const verifyRes = await LP.post('/auth/passkey/register-verify', {
        response: responsePayload,
        deviceName,
      });

      if (verifyRes?.success) {
        LP.toast('Passkey registered successfully!', 'success');
        loadPasskeys();
      } else {
        throw new Error(verifyRes?.message || 'Verification failed');
      }
    } catch (err) {
      if (err.name !== 'NotAllowedError') {
        LP.toast(err.message || 'Error registering passkey', 'error');
      }
    }
  }

  async function deletePasskey(id) {
    if (!(await LP.confirm('Delete this passkey? You will no longer be able to log in with this device.', 'Delete Passkey'))) return;

    try {
      const res = await LP.del(`/auth/passkey/${id}`);
      if (res?.success) {
        LP.toast('Passkey deleted', 'success');
        loadPasskeys();
      } else {
        LP.toast(res?.message || 'Failed to delete passkey', 'error');
      }
    } catch {
      LP.toast('Error deleting passkey', 'error');
    }
  }

  // ── WebPush Notification Management ──
  async function loadPushStatus() {
    const badge = document.getElementById('pushBadge');
    const btnToggle = document.getElementById('btnTogglePush');
    const btnTest = document.getElementById('btnTestPush');
    if (!badge || !btnToggle) return;

    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      badge.textContent = 'Unsupported';
      badge.className = 'lp-badge lp-badge-secondary';
      btnToggle.disabled = true;
      btnToggle.textContent = 'Push Not Supported';
      return;
    }

    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();

      if (sub) {
        badge.textContent = 'Active';
        badge.className = 'lp-badge lp-badge-success';
        btnToggle.textContent = 'Disable Push Alerts';
        btnToggle.className = 'btn-lp btn-lp-ghost text-danger flex-1';
        if (btnTest) btnTest.style.display = 'inline-flex';
      } else {
        badge.textContent = 'Disabled';
        badge.className = 'lp-badge lp-badge-secondary';
        btnToggle.textContent = 'Enable Push Alerts';
        btnToggle.className = 'btn-lp btn-lp-primary flex-1';
        if (btnTest) btnTest.style.display = 'none';
      }
    } catch {
      badge.textContent = 'Error';
    }
  }

  async function togglePushSubscription() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();

    if (sub) {
      // Unsubscribe
      try {
        await LP.post('/alerts/webpush/unsubscribe', { endpoint: sub.endpoint });
        await sub.unsubscribe();
        LP.toast('Push alerts disabled on this device', 'info');
        loadPushStatus();
      } catch (err) {
        LP.toast('Failed to unsubscribe', 'error');
      }
    } else {
      // Subscribe
      if (!window.Notification) {
        LP.toast('Notifications are not supported by this browser', 'error');
        return;
      }
      const perm = await window.Notification.requestPermission();
      if (perm !== 'granted') {
        LP.toast('Notification permission was denied in browser settings', 'error');
        return;
      }

      try {
        const keyRes = await LP.get('/alerts/webpush/vapid-public-key');
        if (!keyRes?.data?.publicKey) {
          throw new Error('VAPID public key not available from server');
        }

        const applicationServerKey = b64urlToBuf(keyRes.data.publicKey);
        const newSub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });

        const subJson = newSub.toJSON();
        const saveRes = await LP.post('/alerts/webpush/subscribe', {
          subscription: subJson,
        });

        if (saveRes?.success) {
          LP.toast('Push notifications enabled successfully!', 'success');
          loadPushStatus();
        } else {
          throw new Error(saveRes?.message || 'Failed to save push subscription');
        }
      } catch (err) {
        LP.toast(err.message || 'Failed to subscribe to push notifications', 'error');
      }
    }
  }

  async function sendTestPush() {
    try {
      LP.toast('Dispatching test push notification...', 'info');
      const res = await LP.post('/alerts/test');
      if (res?.success) {
        LP.toast('Test notification dispatched!', 'success');
      } else {
        LP.toast(res?.message || 'Failed to send test alert', 'error');
      }
    } catch {
      LP.toast('Error sending test notification', 'error');
    }
  }

  async function loadProfile() {
    try {
      const res = await LP.get('/auth/profile');
      if (res.data && res.data.user) {
        const user = res.data.user;
        document.getElementById('profUsername').value = user.username || '';
        document.getElementById('profEmail').value = user.email || '';
        document.getElementById('profRole').value = (user.role?.name || '').toUpperCase();

        // [LOW-2 FIX] Show must-change-password banner if user hasn't changed default password
        const banner = document.getElementById('mustChangePwBanner');
        if (banner && user.mustChangePassword) {
          banner.style.display = 'block';
          banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

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

  // [LOW-1 FIX] Password strength checker with visual progress bar
  function checkPasswordStrength() {
    const pw = document.getElementById('newPassword').value;
    const bar = document.getElementById('pwStrengthFill');
    const text = document.getElementById('pwStrengthText');
    if (!bar || !text) return;

    let score = 0;
    if (pw.length >= 12) score += 25;
    else if (pw.length >= 8) score += 10;
    if (/[A-Z]/.test(pw)) score += 25;
    if (/[a-z]/.test(pw)) score += 20;
    if (/[0-9]/.test(pw)) score += 15;
    if (/[^A-Za-z0-9]/.test(pw)) score += 15;

    bar.style.width = Math.min(score, 100) + '%';
    if (score < 40) {
      bar.className = 'progress-bar bg-danger';
      text.textContent = 'Weak — need uppercase, lowercase, number & special character (12+ chars)';
      text.style.color = '#f87171';
    } else if (score < 70) {
      bar.className = 'progress-bar bg-warning';
      text.textContent = 'Moderate — add more character variety or length';
      text.style.color = '#fbbf24';
    } else {
      bar.className = 'progress-bar bg-success';
      text.textContent = 'Strong password!';
      text.style.color = '#34d399';
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

    if (newPassword.length < 12) {
      LP.toast('Password must be at least 12 characters long.', 'error');
      return;
    }

    try {
      const res = await LP.post('/users/me/password', {
        currentPassword,
        newPassword
      });

      if (res?.success) {
        LP.toast('Password updated successfully', 'success');
        e.target.reset(); // Clear the form
      } else {
        LP.toast(res?.message || 'Failed to update password', 'error');
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

  return {
    init,
    updateProfile,
    changePassword,
    checkPasswordStrength,
    regenerateApiKey,
    toggleApiKeyVisibility,
    copyApiKey,
    toggle2FA,
    confirmEnable2FA,
    toggleAiFields,
    saveAiSettings,
    loadAiSettings,
    registerPasskey,
    deletePasskey,
    loadPasskeys,
    togglePushSubscription,
    sendTestPush,
  };
})();

window.ProfilePage = ProfilePage;

document.addEventListener('DOMContentLoaded', () => {
  ProfilePage.init();
});
