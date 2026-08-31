/**
 * Password Policy Settings Page Controller
 */
const PasswordPolicyPage = {
  _loading: false,

  async load() {
    if (this._loading) return;
    this._loading = true;
    const saveBtn = document.getElementById('btnSavePolicy');
    if (saveBtn) saveBtn.disabled = true;

    try {
      const res = await LP.api('/api/system/password-policy');
      const { data } = res;

      document.getElementById('policyMinLength').value = data.minLength;
      document.getElementById('policyExpiryDays').value = data.expiryDays;
      document.getElementById('policyReminderDays').value = data.reminderDays;
      document.getElementById('policyRequireUppercase').checked = data.requireUppercase;
      document.getElementById('policyRequireLowercase').checked = data.requireLowercase;
      document.getElementById('policyRequireNumber').checked = data.requireNumber;
      document.getElementById('policyRequireSpecial').checked = data.requireSpecial;
      document.getElementById('policyExpiryEnabled').checked = data.expiryEnabled;

      this._updatePreview();
    } catch (err) {
      LP.error('Failed to load password policy: ' + (err.message || err));
    } finally {
      this._loading = false;
      if (saveBtn) saveBtn.disabled = false;
    }
  },

  async save() {
    const saveBtn = document.getElementById('btnSavePolicy');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Saving...';

    try {
      const policy = {
        minLength: parseInt(document.getElementById('policyMinLength').value) || 12,
        expiryDays: parseInt(document.getElementById('policyExpiryDays').value) || 90,
        reminderDays: parseInt(document.getElementById('policyReminderDays').value) || 7,
        requireUppercase: document.getElementById('policyRequireUppercase').checked,
        requireLowercase: document.getElementById('policyRequireLowercase').checked,
        requireNumber: document.getElementById('policyRequireNumber').checked,
        requireSpecial: document.getElementById('policyRequireSpecial').checked,
        expiryEnabled: document.getElementById('policyExpiryEnabled').checked,
      };

      await LP.api('/api/system/password-policy', 'PUT', policy);
      LP.success('Password policy saved successfully');
      this._updatePreview();
    } catch (err) {
      LP.error('Failed to save password policy: ' + (err.message || err));
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="bi bi-check2-circle me-1"></i> Save Policy';
    }
  },

  async reset() {
    if (!(await LP.confirm('Reset password policy to system defaults? This cannot be undone.', 'Reset Password Policy'))) return;

    const resetBtn = document.getElementById('btnResetPolicy');
    resetBtn.disabled = true;
    resetBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Resetting...';

    try {
      const res = await LP.api('/api/system/password-policy/reset', 'POST');
      const data = res.data || res;

      document.getElementById('policyMinLength').value = data.minLength;
      document.getElementById('policyExpiryDays').value = data.expiryDays;
      document.getElementById('policyReminderDays').value = data.reminderDays;
      document.getElementById('policyRequireUppercase').checked = data.requireUppercase;
      document.getElementById('policyRequireLowercase').checked = data.requireLowercase;
      document.getElementById('policyRequireNumber').checked = data.requireNumber;
      document.getElementById('policyRequireSpecial').checked = data.requireSpecial;
      document.getElementById('policyExpiryEnabled').checked = data.expiryEnabled;

      this._updatePreview();
      LP.success('Password policy reset to defaults');
    } catch (err) {
      LP.error('Failed to reset password policy: ' + (err.message || err));
    } finally {
      resetBtn.disabled = false;
      resetBtn.innerHTML = '<i class="bi bi-arrow-counterclockwise me-1"></i> Reset to Defaults';
    }
  },

  _updatePreview() {
    const minLength = parseInt(document.getElementById('policyMinLength').value) || 12;
    const uppercase = document.getElementById('policyRequireUppercase').checked;
    const lowercase = document.getElementById('policyRequireLowercase').checked;
    const number = document.getElementById('policyRequireNumber').checked;
    const special = document.getElementById('policyRequireSpecial').checked;
    const expiryEnabled = document.getElementById('policyExpiryEnabled').checked;
    const expiryDays = parseInt(document.getElementById('policyExpiryDays').value) || 90;
    const reminderDays = parseInt(document.getElementById('policyReminderDays').value) || 7;

    const parts = [`min ${minLength} chars`];
    if (uppercase) parts.push('uppercase');
    if (lowercase) parts.push('lowercase');
    if (number) parts.push('number');
    if (special) parts.push('special char');

    const previewEl = document.getElementById('policyPreview');
    if (previewEl) {
      let html = `<code style="background:rgba(255,255,255,0.05); padding:8px 12px; border-radius:6px; display:inline-block; font-size:12px;">${parts.join(', ')}</code>`;
      if (expiryEnabled) {
        html += `<span style="margin-left:10px; font-size:12px; color:var(--text-secondary);">Expires in <strong>${expiryDays}d</strong>, reminder <strong>${reminderDays}d</strong> before</span>`;
      } else {
        html += `<span style="margin-left:10px; font-size:12px; color:var(--text-muted);">Password expiry <strong>disabled</strong></span>`;
      }
      previewEl.innerHTML = html;
    }
  },

  /**
   * Test a sample password against current policy settings.
   */
  async testPassword() {
    const password = document.getElementById('testPassword').value;
    if (!password) {
      LP.warning('Enter a password to test');
      return;
    }

    try {
      const res = await LP.api('/api/system/password-policy/validate', 'POST', { password });
      const result = res.data || res;
      const resultEl = document.getElementById('testPasswordResult');

      if (result.valid) {
        resultEl.className = 'alert alert-success mt-2';
        resultEl.style.cssText = 'display:block; background:rgba(34,197,94,0.12); color:#22c55e; border:1px solid rgba(34,197,94,0.25); font-size:12px; padding:8px 12px; border-radius:8px;';
        resultEl.innerHTML = '<i class="bi bi-check-circle-fill me-1"></i> Strong password! Meets all requirements.';
      } else {
        resultEl.className = 'alert alert-danger mt-2';
        resultEl.style.cssText = 'display:block; background:rgba(239,68,68,0.12); color:#ef4444; border:1px solid rgba(239,68,68,0.25); font-size:12px; padding:8px 12px; border-radius:8px;';
        resultEl.innerHTML = '<i class="bi bi-x-circle-fill me-1"></i> ' + (result.errors || []).join('<br>');
      }
      resultEl.style.display = 'block';
    } catch (err) {
      LP.error('Validation error: ' + (err.message || err));
    }
  },

  /**
   * Fetch password policy from a remote URL for preview/import.
   */
  _urlImportData: null,

  async fetchFromUrl() {
    const url = document.getElementById('remoteUrlInput').value.trim();
    if (!url) {
      LP.warning('Enter a URL first');
      return;
    }

    const fetchBtn = document.getElementById('btnFetchUrl');
    const resultContainer = document.getElementById('urlPreviewContainer');
    fetchBtn.disabled = true;
    fetchBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Fetching...';
    resultContainer.style.display = 'none';

    try {
      const res = await LP.api('/api/system/password-policy/preview-url?url=' + encodeURIComponent(url));
      const result = res.data;

      // Store for later import
      this._urlImportData = result.data;

      // Build preview
      const d = result.data;
      const schemaVersion = result.schema?.version || '1 (legacy)';
      const complexity = ['requireUppercase','requireLowercase','requireNumber','requireSpecial'].filter(k => d[k]).join(', ') || 'none';

      resultContainer.innerHTML = `
        <div style="background:rgba(0,0,0,0.2); border-radius:10px; padding:12px 16px; margin-top:12px; border:1px solid var(--glass-border);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <div>
              <span class="lp-badge lp-badge-success" style="font-size:9px;">Fetched</span>
              <span style="font-size:11px; color:var(--text-muted); margin-left:8px;">from ${LP.escHtml(url)}</span>
            </div>
            <span style="font-size:10px; color:var(--text-muted);">Schema v${schemaVersion}</span>
          </div>
          <div style="display:flex; flex-wrap:wrap; gap:8px; font-size:12px;">
            <code style="background:rgba(255,255,255,0.05); padding:4px 8px; border-radius:4px;">min ${d.minLength} chars</code>
            <code style="background:rgba(255,255,255,0.05); padding:4px 8px; border-radius:4px;">${complexity}</code>
            <code style="background:rgba(255,255,255,0.05); padding:4px 8px; border-radius:4px;">${d.expiryEnabled ? `Expiry ${d.expiryDays}d` : 'No expiry'}</code>
          </div>
          <button class="btn-lp btn-lp-primary w-100 mt-2" onclick="PasswordPolicyPage.importFromUrl()" id="btnImportUrl" style="padding:8px; font-weight:600; font-size:12px;">
            <i class="bi bi-download me-1"></i> Import This Policy
          </button>
        </div>
      `;
      resultContainer.style.display = 'block';
      LP.success('Policy fetched successfully — review and click Import to apply');
    } catch (err) {
      LP.error('Failed to fetch policy: ' + (err.message || err));
    } finally {
      fetchBtn.disabled = false;
      fetchBtn.innerHTML = '<i class="bi bi-cloud-download me-1"></i> Fetch from URL';
    }
  },

  async importFromUrl() {
    if (!this._urlImportData) {
      LP.warning('No policy data to import. Fetch from URL first.');
      return;
    }

    const d = this._urlImportData;
    const complexity = ['requireUppercase','requireLowercase','requireNumber','requireSpecial'].filter(k => d[k]).join(', ') || 'none';

    if (!(await LP.confirm(`Import password policy from remote server?<br><br>This will <strong>REPLACE</strong> the current policy.<br>• Min Length: ${d.minLength}<br>• Expiry Days: ${d.expiryDays ?? 'N/A'}<br>• Reminder Days: ${d.reminderDays ?? 'N/A'}<br>• Complexity: ${complexity}<br>• Expiry: ${d.expiryEnabled ? `${d.expiryDays}d` : 'disabled'}`, 'Import Password Policy'))) {
      return;
    }

    // Show loading state on the import button
    const importBtn = document.getElementById('btnImportUrl');
    if (importBtn) {
      importBtn.disabled = true;
      importBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Importing...';
    }

    try {
      const res = await LP.api('/api/system/password-policy/import', 'POST', this._urlImportData);
      const data = res.data || res;

      // Update UI with imported values
      document.getElementById('policyMinLength').value = data.minLength;
      document.getElementById('policyExpiryDays').value = data.expiryDays;
      document.getElementById('policyReminderDays').value = data.reminderDays;
      document.getElementById('policyRequireUppercase').checked = data.requireUppercase;
      document.getElementById('policyRequireLowercase').checked = data.requireLowercase;
      document.getElementById('policyRequireNumber').checked = data.requireNumber;
      document.getElementById('policyRequireSpecial').checked = data.requireSpecial;
      document.getElementById('policyExpiryEnabled').checked = data.expiryEnabled;

      this._updatePreview();
      this._urlImportData = null;
      document.getElementById('urlPreviewContainer').style.display = 'none';
      document.getElementById('remoteUrlInput').value = '';
      LP.success('Password policy imported from remote server');
    } catch (err) {
      LP.error('Failed to import remote policy: ' + (err.message || err));
    } finally {
      if (importBtn) {
        importBtn.disabled = false;
        importBtn.innerHTML = '<i class="bi bi-download me-1"></i> Import This Policy';
      }
    }
  },

  /**
   * Export password policy as a downloadable JSON file.
   */
  async exportJSON() {
    try {
      const res = await LP.api('/api/system/password-policy/export');
      const policy = res.data;
      const blob = new Blob([JSON.stringify(policy, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'password-policy.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      LP.success('Password policy exported as password-policy.json');
    } catch (err) {
      LP.error('Failed to export password policy: ' + (err.message || err));
    }
  },

  /**
   * Import password policy from a JSON file.
   */
  importJSON() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const policy = JSON.parse(text);

        // Validate it looks like a password policy
        if (typeof policy !== 'object' || policy.minLength === undefined) {
          throw new Error('Invalid password policy JSON file');
        }

        // Extract schema version for display
        const schemaVersion = policy._schema?.version || '1 (legacy)';

        if (!(await LP.confirm(`Import password policy from "${LP.escHtml(file.name)}"?<br><br>• Schema: v${schemaVersion}<br>• Min Length: ${policy.minLength}<br>• Expiry Days: ${policy.expiryDays ?? 'N/A'}<br>• Reminder Days: ${policy.reminderDays ?? 'N/A'}<br>• Complexity: ${['requireUppercase','requireLowercase','requireNumber','requireSpecial'].filter(k => policy[k]).join(', ') || 'none'}<br>• Expiry: ${policy.expiryEnabled ? `${policy.expiryDays}d` : 'disabled'}<br><br>This will <strong>REPLACE</strong> the current policy.`, 'Import Password Policy'))) {
          return;
        }

        const res = await LP.api('/api/system/password-policy/import', 'POST', policy);
        const data = res.data || res;

        // Update UI with imported values
        document.getElementById('policyMinLength').value = data.minLength;
        document.getElementById('policyExpiryDays').value = data.expiryDays;
        document.getElementById('policyReminderDays').value = data.reminderDays;
        document.getElementById('policyRequireUppercase').checked = data.requireUppercase;
        document.getElementById('policyRequireLowercase').checked = data.requireLowercase;
        document.getElementById('policyRequireNumber').checked = data.requireNumber;
        document.getElementById('policyRequireSpecial').checked = data.requireSpecial;
        document.getElementById('policyExpiryEnabled').checked = data.expiryEnabled;

        this._updatePreview();
        LP.success(`Password policy imported from "${file.name}"`);
      } catch (err) {
        LP.error('Failed to import password policy: ' + (err.message || 'Invalid JSON file'));
      }
    };
    input.click();
  },
};

// Auto-load on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  PasswordPolicyPage.load();
});

// Expose for inline onclick handlers
window.PasswordPolicyPage = PasswordPolicyPage;
