/**
 * Settings - SSO & LDAP Configuration
 */

const AuthConfig = (() => {
  // ── Init ──────────────────────────────────────────────
  async function init() {
    await LP.init();
    await loadSSO();
    await loadLDAP();

    // Toggle show/hide config fields based on enabled state
    document.querySelectorAll('[data-provider]').forEach(chk => {
      chk.addEventListener('change', () => {
        const provider = chk.dataset.provider;
        const fields = document.getElementById(`${provider}ConfigFields`);
        if (fields) {
          fields.style.opacity = chk.checked ? '1' : '0.4';
          fields.querySelectorAll('input').forEach(inp => {
            inp.disabled = !chk.checked;
          });
        }
      });
    });
  }

  // ── SSO ───────────────────────────────────────────────
  async function loadSSO() {
    try {
      const res = await LP.get('/auth/sso/config');
      if (res?.success && res.data?.config) {
        const config = res.data.config;
        for (const [provider, cfg] of Object.entries(config)) {
          document.getElementById(`${provider}Enabled`).checked = cfg.enabled;
          document.getElementById(`${provider}ClientId`).value = cfg.clientId || '';
          document.getElementById(`${provider}RedirectUri`).value = cfg.redirectUri || '';

          // Hide secret (backend already masks it)
          const secretField = document.getElementById(`${provider}ClientSecret`);
          if (secretField) secretField.value = '';

          const fields = document.getElementById(`${provider}ConfigFields`);
          if (fields) {
            fields.style.opacity = cfg.enabled ? '1' : '0.4';
            fields.querySelectorAll('input').forEach(inp => {
              inp.disabled = !cfg.enabled;
            });
          }
        }

        updateRedirectUris();
      }
    } catch (err) {
      LP.toast('Failed to load SSO configuration', 'error');
    }
  }

  function updateRedirectUris() {
    const baseUrl = window.location.origin;
    const googleUri = document.getElementById('googleRedirectUri');
    const githubUri = document.getElementById('githubRedirectUri');
    if (googleUri) googleUri.value = `${baseUrl}/api/auth/sso/google/callback`;
    if (githubUri) githubUri.value = `${baseUrl}/api/auth/sso/github/callback`;
  }

  async function saveSSO() {
    const btn = document.querySelector('#sso-panel .btn-lp-primary');
    const oldHtml = btn.innerHTML;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Saving...';
    btn.disabled = true;

    try {
      const config = {};

      for (const provider of ['google', 'github']) {
        const enabled = document.getElementById(`${provider}Enabled`).checked;
        const clientId = document.getElementById(`${provider}ClientId`).value.trim();
        const clientSecret = document.getElementById(`${provider}ClientSecret`).value.trim();
        const redirectUri = `${window.location.origin}/api/auth/sso/${provider}/callback`;

        config[provider] = {
          enabled,
          clientId,
          clientSecret,
          redirectUri,
          scope: provider === 'google' ? 'openid email profile' : 'read:user user:email',
        };
      }

      const res = await LP.post('/auth/sso/config', config);
      if (res?.success) {
        LP.toast('SSO configuration saved successfully', 'success');
        await loadSSO();
      } else {
        LP.toast(res?.message || 'Failed to save SSO config', 'error');
      }
    } catch (err) {
      LP.toast('Error saving SSO configuration', 'error');
    } finally {
      btn.innerHTML = oldHtml;
      btn.disabled = false;
    }
  }

  // ── LDAP ──────────────────────────────────────────────
  async function loadLDAP() {
    try {
      const res = await LP.get('/auth/ldap/config');
      if (res?.success && res.data?.config) {
        const c = res.data.config;
        document.getElementById('ldapEnabled').checked = c.enabled;
        document.getElementById('ldapUrl').value = c.url || '';
        document.getElementById('ldapBindDn').value = c.bindDn || '';
        document.getElementById('ldapBindPassword').value = '';
        document.getElementById('ldapBaseDn').value = c.baseDn || '';
        document.getElementById('ldapUserFilter').value = c.userFilter || '(uid={{username}})';
        document.getElementById('ldapUsernameAttr').value = c.usernameAttribute || 'uid';
        document.getElementById('ldapEmailAttr').value = c.emailAttribute || 'mail';
        document.getElementById('ldapDisplayNameAttr').value = c.displayNameAttribute || 'displayName';
        document.getElementById('ldapFirstNameAttr').value = c.firstNameAttribute || 'givenName';
        document.getElementById('ldapLastNameAttr').value = c.lastNameAttribute || 'sn';
        document.getElementById('ldapDefaultRole').value = c.defaultRole || 'read_only';
        document.getElementById('ldapAutoCreate').checked = c.autoCreate !== false;
        document.getElementById('ldapTls').checked = !!c.tls;

        const fields = document.getElementById('ldapConfigFields');
        if (fields) {
          fields.style.opacity = c.enabled ? '1' : '0.4';
          fields.querySelectorAll('input').forEach(inp => {
            inp.disabled = !c.enabled;
          });
        }
      }
    } catch (err) {
      LP.toast('Failed to load LDAP configuration', 'error');
    }
  }

  async function saveLDAP() {
    const btn = document.querySelector('#ldap-panel .btn-lp-primary');
    const oldHtml = btn.innerHTML;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Saving...';
    btn.disabled = true;

    try {
      const config = {
        enabled: document.getElementById('ldapEnabled').checked,
        url: document.getElementById('ldapUrl').value.trim(),
        bindDn: document.getElementById('ldapBindDn').value.trim(),
        bindPassword: document.getElementById('ldapBindPassword').value,
        baseDn: document.getElementById('ldapBaseDn').value.trim(),
        userFilter: document.getElementById('ldapUserFilter').value.trim() || '(uid={{username}})',
        usernameAttribute: document.getElementById('ldapUsernameAttr').value.trim() || 'uid',
        emailAttribute: document.getElementById('ldapEmailAttr').value.trim() || 'mail',
        displayNameAttribute: document.getElementById('ldapDisplayNameAttr').value.trim() || 'displayName',
        firstNameAttribute: document.getElementById('ldapFirstNameAttr').value.trim() || 'givenName',
        lastNameAttribute: document.getElementById('ldapLastNameAttr').value.trim() || 'sn',
        defaultRole: document.getElementById('ldapDefaultRole').value.trim() || 'read_only',
        autoCreate: document.getElementById('ldapAutoCreate').checked,
        tls: document.getElementById('ldapTls').checked,
      };

      const res = await LP.post('/auth/ldap/config', config);
      if (res?.success) {
        LP.toast('LDAP configuration saved successfully', 'success');
        await loadLDAP();
      } else {
        LP.toast(res?.message || 'Failed to save LDAP config', 'error');
      }
    } catch (err) {
      LP.toast('Error saving LDAP configuration', 'error');
    } finally {
      btn.innerHTML = oldHtml;
      btn.disabled = false;
    }
  }

  async function testLDAP() {
    const btn = document.querySelector('#ldap-panel .btn-lp-info');
    const oldHtml = btn.innerHTML;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Testing...';
    btn.disabled = true;

    try {
      const res = await LP.post('/auth/ldap/test');
      if (res?.success) {
        LP.toast('LDAP connection successful!', 'success');
      } else {
        LP.toast(res?.message || 'LDAP connection failed', 'error');
      }
    } catch (err) {
      LP.toast(err.message || 'LDAP connection test error', 'error');
    } finally {
      btn.innerHTML = oldHtml;
      btn.disabled = false;
    }
  }

  // ── Public API ────────────────────────────────────────
  return { init, loadSSO, saveSSO, loadLDAP, saveLDAP, testLDAP };
})();

document.addEventListener('DOMContentLoaded', () => {
  AuthConfig.init();
});

window.AuthConfig = AuthConfig;
