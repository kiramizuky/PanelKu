const MAIL = (() => {
  let domModal, accModal, pwdModal;

  async function loadData() {
    const loadingEl = document.getElementById('mailLoading');
    const notInstalledEl = document.getElementById('mailNotInstalled');
    const contentEl = document.getElementById('mailContent');

    if (loadingEl) loadingEl.style.display = 'block';

    try {
      const res = await LP.get('/mail/status');
      if (res?.success) {
        const s = res.data;
        if (!s || s.installed === false) {
          if (notInstalledEl) notInstalledEl.style.display = 'block';
          if (contentEl) contentEl.style.display = 'none';
          return;
        }

        if (notInstalledEl) notInstalledEl.style.display = 'none';
        if (contentEl) contentEl.style.display = 'block';
        renderStatusCards(s);

        await Promise.allSettled([
          loadDomains(),
          loadAccounts(),
          loadQueue(),
          loadSpamConfig(),
          loadDnsHelper()
        ]);
        return;
      }

      // If res not success, fall back to not installed view with informative notice
      if (notInstalledEl) notInstalledEl.style.display = 'block';
      if (contentEl) contentEl.style.display = 'none';
    } catch (err) {
      console.warn('Mail status load error:', err);
      if (notInstalledEl) notInstalledEl.style.display = 'block';
      if (contentEl) contentEl.style.display = 'none';
    } finally {
      if (loadingEl) loadingEl.style.display = 'none';
    }
  }

  function renderStatusCards(s) {
    const container = document.getElementById('mailStatusCards');
    if (!container) return;

    const cards = [
      {
        id: 'postfix',
        name: 'Postfix (MTA)',
        active: !!s.postfix,
        icon: 'bi-envelope-paper',
        desc: 'Port 25 / 587 SMTP'
      },
      {
        id: 'dovecot',
        name: 'Dovecot (IMAP)',
        active: !!s.dovecot,
        icon: 'bi-inbox',
        desc: 'Port 993 IMAPS'
      },
      {
        id: 'spamassassin',
        name: 'SpamAssassin',
        active: !!s.spamassassin,
        icon: 'bi-shield-shaded',
        desc: 'Content Filtering'
      },
      {
        id: 'queue',
        name: 'Mail Queue',
        active: true,
        icon: 'bi-send',
        value: `${s.queueSize || 0} msgs`,
        desc: 'Pending delivery'
      },
      {
        id: 'version',
        name: 'Postfix Version',
        active: true,
        icon: 'bi-info-circle',
        value: s.version ? s.version.replace('mail_version = ', '') : 'Installed',
        desc: 'Core daemon'
      }
    ];

    container.innerHTML = cards.map(c => {
      if (c.value !== undefined) {
        return `
          <div class="mail-stat-card">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <span style="font-size:12px;color:var(--text-muted);">${c.name}</span>
              <i class="bi ${c.icon}" style="font-size:16px;color:#6366f1;"></i>
            </div>
            <div style="font-size:18px;font-weight:700;margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${LP.escHtml(c.value)}</div>
            <div style="font-size:11px;color:var(--text-muted);">${c.desc}</div>
          </div>
        `;
      }

      const statusColor = c.active ? '#22c55e' : '#ef4444';
      const statusText = c.active ? 'Active' : 'Stopped';
      const toggleAction = c.active ? 'restart' : 'start';
      const toggleIcon = c.active ? 'bi-arrow-repeat' : 'bi-play-fill';
      const toggleTitle = c.active ? 'Restart' : 'Start';

      return `
        <div class="mail-stat-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <span style="font-size:12px;color:var(--text-muted);">${c.name}</span>
            <span class="badge" style="background:${c.active ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)'};color:${statusColor};font-size:11px;">
              ${statusText}
            </span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;">
            <div style="font-size:11px;color:var(--text-muted);">${c.desc}</div>
            <div style="display:flex;gap:4px;">
              <button class="btn-lp btn-lp-ghost btn-lp-sm" title="${toggleTitle} ${c.name}" onclick="MAIL.controlService('${c.id}', '${toggleAction}')">
                <i class="bi ${toggleIcon}"></i>
              </button>
              ${c.active ? `
                <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" title="Stop ${c.name}" onclick="MAIL.controlService('${c.id}', 'stop')">
                  <i class="bi bi-stop-fill"></i>
                </button>
              ` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  async function controlService(service, action) {
    try {
      const res = await LP.post('/mail/control', { service, action });
      if (res?.success) {
        LP.toast(`${service} ${action}ed successfully`, 'success');
        loadData();
      } else {
        LP.toast(res?.message || `Failed to ${action} ${service}`, 'error');
      }
    } catch (err) {
      LP.toast(err.message || `Error controlling ${service}`, 'error');
    }
  }

  async function loadDomains() {
    try {
      const res = await LP.get('/mail/domains');
      const body = document.getElementById('mailDomainsBody');
      if (!body) return;

      if (res?.success && Array.isArray(res.data?.domains)) {
        const domains = res.data.domains;
        if (domains.length === 0) {
          body.innerHTML = '<tr><td colspan="3" class="text-muted" style="text-align:center;padding:24px;">No mail domains configured. Click "Add Domain" to register a domain.</td></tr>';
          return;
        }

        // Pre-fill DNS domain input if empty
        const dnsInput = document.getElementById('mailDnsDomainInput');
        if (dnsInput && !dnsInput.value && domains[0]) {
          dnsInput.value = domains[0];
          loadDnsHelper();
        }

        body.innerHTML = domains.map(d => `
          <tr>
            <td><strong><i class="bi bi-globe me-2 text-primary"></i>${LP.escHtml(d)}</strong></td>
            <td><span class="badge bg-success" style="font-size:11px;">Configured</span></td>
            <td style="text-align:right;">
              <button class="btn-lp btn-lp-ghost btn-lp-sm me-1" title="View DNS Records" onclick="LP.call('MAIL.selectDomainForDns', '${LP.encJsArg(d)}')">
                <i class="bi bi-shield-check"></i> DNS
              </button>
              <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" title="Remove Domain" onclick="LP.call('MAIL.removeDomain', '${LP.encJsArg(d)}')">
                <i class="bi bi-trash"></i>
              </button>
            </td>
          </tr>
        `).join('');
      }
    } catch (err) {
      console.warn('loadDomains error:', err);
    }
  }

  async function loadAccounts() {
    try {
      const res = await LP.get('/mail/accounts');
      const body = document.getElementById('mailAccountsBody');
      if (!body) return;

      if (res?.success && Array.isArray(res.data?.accounts)) {
        const accs = res.data.accounts;
        if (accs.length === 0) {
          body.innerHTML = '<tr><td colspan="3" class="text-muted" style="text-align:center;padding:24px;">No email accounts created yet. Click "Add Account" to get started.</td></tr>';
          return;
        }
        body.innerHTML = accs.map(a => `
          <tr>
            <td><strong><i class="bi bi-envelope-at me-2 text-info"></i>${LP.escHtml(a.email)}</strong></td>
            <td style="font-size:12px;color:var(--text-muted);font-family:monospace;">${LP.escHtml(a.mailbox)}</td>
            <td style="text-align:right;">
              <button class="btn-lp btn-lp-ghost btn-lp-sm me-1" title="Change Password" onclick="LP.call('MAIL.showChangePasswordModal', '${LP.encJsArg(a.email)}')">
                <i class="bi bi-key"></i>
              </button>
              <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" title="Delete Account" onclick="LP.call('MAIL.deleteAccount', '${LP.encJsArg(a.email)}')">
                <i class="bi bi-trash"></i>
              </button>
            </td>
          </tr>
        `).join('');
      }
    } catch (err) {
      console.warn('loadAccounts error:', err);
    }
  }

  async function loadDnsHelper() {
    const input = document.getElementById('mailDnsDomainInput');
    const domain = input?.value?.trim() || 'example.com';
    const tbody = document.getElementById('mailDnsTableBody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="5" class="text-muted" style="text-align:center;">Generating recommended DNS templates...</td></tr>';

    try {
      const res = await LP.get(`/mail/dns-helper?domain=${encodeURIComponent(domain)}`);
      if (res?.success && Array.isArray(res.data?.records)) {
        tbody.innerHTML = res.data.records.map(r => `
          <tr>
            <td><strong class="text-info">${LP.escHtml(r.type)}</strong></td>
            <td><code>${LP.escHtml(r.host)}</code></td>
            <td>${r.priority !== null ? `<code>${r.priority}</code>` : '—'}</td>
            <td>
              <div class="dns-code-badge">${LP.escHtml(r.value)}</div>
              <div style="font-size:10px;color:var(--text-muted);margin-top:2px;">${LP.escHtml(r.note || '')}</div>
            </td>
            <td style="text-align:right;">
              <button class="btn-lp btn-lp-ghost btn-lp-sm" title="Copy Record Value" onclick="LP.copy('${LP.escHtml(r.value)}', 'Record copied to clipboard!')">
                <i class="bi bi-clipboard"></i>
              </button>
            </td>
          </tr>
        `).join('');
      } else {
        tbody.innerHTML = '<tr><td colspan="5" class="text-danger" style="text-align:center;">Failed to generate DNS records</td></tr>';
      }
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-danger" style="text-align:center;">Error: ${LP.escHtml(err.message)}</td></tr>`;
    }
  }

  function selectDomainForDns(domain) {
    const input = document.getElementById('mailDnsDomainInput');
    if (input) {
      input.value = domain;
      loadDnsHelper();
      const tabLink = document.querySelector('a[href="#mail-dns"]');
      if (tabLink && window.bootstrap?.Tab) {
        new bootstrap.Tab(tabLink).show();
      }
    }
  }

  function openDnsHelperPreview() {
    const notInstalledEl = document.getElementById('mailNotInstalled');
    const contentEl = document.getElementById('mailContent');
    if (notInstalledEl) notInstalledEl.style.display = 'none';
    if (contentEl) contentEl.style.display = 'block';

    const tabLink = document.querySelector('a[href="#mail-dns"]');
    if (tabLink && window.bootstrap?.Tab) {
      new bootstrap.Tab(tabLink).show();
    }
    loadDnsHelper();
  }

  async function loadQueue() {
    try {
      const res = await LP.get('/mail/queue');
      const badge = document.getElementById('mailQueueCountBadge');
      const countEl = document.getElementById('mailQueueCount');
      const contentEl = document.getElementById('mailQueueContent');

      if (res?.success) {
        const total = res.data?.total || 0;
        if (badge) badge.textContent = total;
        if (countEl) countEl.textContent = `(${total} messages)`;
        if (contentEl) contentEl.textContent = res.data?.raw || 'Mail queue is empty.';
      }
    } catch (err) {
      console.warn('loadQueue error:', err);
    }
  }

  async function loadSpamConfig() {
    try {
      const res = await LP.get('/mail/spam');
      const el = document.getElementById('spamConfigContent');
      if (!el) return;

      if (res?.success) {
        const c = res.data;
        el.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:14px;">
            <div style="display:flex;align-items:center;justify-content:space-between;">
              <span style="font-size:13px;color:var(--text-muted);">SpamAssassin Daemon:</span>
              <span class="badge" style="background:${c.active ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)'};color:${c.active ? '#22c55e' : '#ef4444'};">
                ${c.active ? 'Active' : 'Inactive'}
              </span>
            </div>
            <div class="lp-form-group" style="margin-bottom:0;">
              <label class="lp-label" style="font-size:12px;margin-bottom:6px;">Required Score Threshold (1.0 — 20.0)</label>
              <div style="display:flex;gap:8px;">
                <input type="number" id="spamScoreInput" class="lp-input" value="${c.requiredScore || 5}" min="1" max="20" step="0.5" style="width:120px;">
                <button class="btn-lp btn-lp-primary btn-lp-sm" onclick="MAIL.updateSpamScore()"><i class="bi bi-check-lg"></i> Save Score</button>
              </div>
              <small style="color:var(--text-muted);font-size:11px;display:block;margin-top:4px;">Messages with score higher than this value are tagged as SPAM. Lower is stricter (default 5.0).</small>
            </div>
          </div>
        `;
      }
    } catch (err) {
      console.warn('loadSpamConfig error:', err);
    }
  }

  async function loadLogs() {
    const svc = document.getElementById('mailLogService')?.value || 'postfix';
    const lines = document.getElementById('mailLogLines')?.value || 50;
    const el = document.getElementById('mailLogContent');
    if (!el) return;

    el.textContent = 'Loading logs...';
    try {
      const res = await LP.get(`/mail/logs?service=${svc}&lines=${lines}`);
      if (res?.success) {
        el.textContent = (res.data?.logs || []).join('\n') || 'No logs found.';
      } else {
        el.textContent = 'Failed to load logs';
      }
    } catch {
      el.textContent = 'Error loading logs';
    }
  }

  async function install() {
    if (!(await LP.confirm('Install Postfix, Dovecot & SpamAssassin on this host? This may take several minutes to download and configure.', 'Install Mail Server'))) return;
    const btn = document.getElementById('mailInstallBtn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Installing packages...';
    }
    try {
      const res = await LP.post('/mail/install');
      if (res?.success) {
        LP.toast(res?.message || 'Mail server installed successfully', 'success');
      } else {
        LP.toast(res?.message || 'Failed to install mail server', 'error');
      }
      loadData();
    } catch (err) {
      LP.toast(err.message || 'Error installing mail server', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-download"></i> Install Mail Server (Postfix + Dovecot)';
      }
    }
  }

  function showAddDomainModal() {
    if (!domModal) domModal = new bootstrap.Modal(document.getElementById('addDomainModal'));
    document.getElementById('mailDomainInput').value = '';
    domModal.show();
  }

  async function addDomain(e) {
    e.preventDefault();
    const domain = document.getElementById('mailDomainInput').value.trim();
    try {
      const res = await LP.post('/mail/domains', { domain });
      if (res?.success) {
        LP.toast('Domain added successfully', 'success');
        domModal.hide();
        loadDomains();
      } else {
        LP.toast(res?.message || 'Failed to add domain', 'error');
      }
    } catch (err) {
      LP.toast(err.message || 'Error adding domain', 'error');
    }
  }

  async function removeDomain(domain) {
    if (!(await LP.confirm(`Remove virtual domain "${domain}"?`, 'Remove Domain'))) return;
    try {
      const res = await LP.delete('/mail/domains', { domain });
      if (res?.success) {
        LP.toast('Domain removed', 'success');
        loadDomains();
      } else {
        LP.toast(res?.message || 'Failed to remove domain', 'error');
      }
    } catch (err) {
      LP.toast(err.message || 'Error removing domain', 'error');
    }
  }

  function showAddAccountModal() {
    if (!accModal) accModal = new bootstrap.Modal(document.getElementById('addAccountModal'));
    document.getElementById('addAccountForm')?.reset();
    document.getElementById('accEmailInput').value = '';
    document.getElementById('accPasswordInput').value = '';
    accModal.show();
  }

  async function addAccount(e) {
    e.preventDefault();
    const email = document.getElementById('accEmailInput').value.trim();
    const password = document.getElementById('accPasswordInput').value;
    try {
      const res = await LP.post('/mail/accounts', { email, password });
      if (res?.success) {
        LP.toast('Account created successfully', 'success');
        accModal.hide();
        loadAccounts();
      } else {
        LP.toast(res?.message || 'Failed to create account', 'error');
      }
    } catch (err) {
      LP.toast(err.message || 'Error creating account', 'error');
    }
  }

  function showChangePasswordModal(email) {
    if (!pwdModal) pwdModal = new bootstrap.Modal(document.getElementById('changePasswordModal'));
    document.getElementById('changePasswordForm')?.reset();
    document.getElementById('changePasswordEmail').value = email;
    document.getElementById('changePasswordNew').value = '';
    pwdModal.show();
  }

  async function updatePassword(e) {
    e.preventDefault();
    const email = document.getElementById('changePasswordEmail').value;
    const password = document.getElementById('changePasswordNew').value;
    try {
      const res = await LP.post('/mail/accounts/password', { email, password });
      if (res?.success) {
        LP.toast('Password updated successfully', 'success');
        pwdModal.hide();
      } else {
        LP.toast(res?.message || 'Failed to update password', 'error');
      }
    } catch (err) {
      LP.toast(err.message || 'Error updating password', 'error');
    }
  }

  async function deleteAccount(email) {
    if (!(await LP.confirm(`Delete email account "${email}"? This will remove credentials and authentication.`, 'Delete Account'))) return;
    try {
      const res = await LP.delete('/mail/accounts', { email });
      if (res?.success) {
        LP.toast('Account deleted', 'success');
        loadAccounts();
      } else {
        LP.toast(res?.message || 'Failed to delete account', 'error');
      }
    } catch (err) {
      LP.toast(err.message || 'Error deleting account', 'error');
    }
  }

  async function flushQueue() {
    if (!(await LP.confirm('Flush all queued mail messages for immediate delivery?', 'Flush Queue'))) return;
    try {
      const res = await LP.post('/mail/queue/flush');
      if (res?.success) {
        LP.toast('Queue flushed', 'success');
        loadQueue();
      } else {
        LP.toast(res?.message || 'Failed to flush queue', 'error');
      }
    } catch (err) {
      LP.toast(err.message || 'Error flushing queue', 'error');
    }
  }

  async function updateSpamScore() {
    const score = document.getElementById('spamScoreInput')?.value;
    try {
      const res = await LP.post('/mail/spam', { requiredScore: parseFloat(score) });
      if (res?.success) {
        LP.toast('Spam score updated', 'success');
      } else {
        LP.toast(res?.message || 'Failed to update spam score', 'error');
      }
    } catch (err) {
      LP.toast(err.message || 'Error updating spam score', 'error');
    }
  }

  function copySnippet(text) {
    if (!text) return;
    LP.copy(text, 'Copied to clipboard!');
  }

  document.addEventListener('DOMContentLoaded', async () => {
    await LP.init();
    MAIL.loadData();
  });

  return {
    loadData,
    install,
    controlService,
    loadDomains,
    loadAccounts,
    loadQueue,
    loadLogs,
    loadSpamConfig,
    loadDnsHelper,
    selectDomainForDns,
    openDnsHelperPreview,
    showAddDomainModal,
    addDomain,
    removeDomain,
    showAddAccountModal,
    addAccount,
    showChangePasswordModal,
    updatePassword,
    deleteAccount,
    flushQueue,
    updateSpamScore,
    copySnippet
  };
})();

window.MAIL = MAIL;
