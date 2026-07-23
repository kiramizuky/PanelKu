const MAIL = (() => {
  let domModal, accModal;

  async function loadData() {
    try {
      const res = await LP.get('/mail/status');
      if (res?.success) {
        const s = res.data;
        if (s.installed === false) {
          document.getElementById('mailNotInstalled').style.display = 'block';
          document.getElementById('mailContent').style.display = 'none';
          return;
        }
        document.getElementById('mailNotInstalled').style.display = 'none';
        document.getElementById('mailContent').style.display = 'block';
        renderStatusCards(s);
      }
    } catch {}
    await Promise.allSettled([loadDomains(), loadAccounts(), loadQueue(), loadSpamConfig()]);
  }

  function renderStatusCards(s) {
    const cards = [
      { icon:'bi-envelope', label:'Postfix', value:s.postfix ? 'Active' : 'Inactive', color:s.postfix ? '#22c55e' : '#ef4444' },
      { icon:'bi-inbox', label:'Dovecot', value:s.dovecot ? 'Active' : 'Inactive', color:s.dovecot ? '#22c55e' : '#ef4444' },
      { icon:'bi-shield', label:'SpamAssassin', value:s.spamassassin ? 'Active' : 'Inactive', color:s.spamassassin ? '#22c55e' : '#ef4444' },
      { icon:'bi-send', label:'Queue', value:s.queueSize || 0, color:'#6366f1' },
      { icon:'bi-info-circle', label:'Version', value:s.version || '—', color:'#f59e0b' },
    ];
    document.getElementById('mailStatusCards').innerHTML = cards.map(c => `
      <div class="lp-glass-card" style="padding:12px;text-align:center;">
        <i class="bi ${c.icon}" style="font-size:20px;color:${c.color};"></i>
        <div style="font-size:18px;font-weight:700;margin:4px 0;">${c.value}</div>
        <div style="font-size:10px;color:var(--text-muted);">${c.label}</div>
      </div>
    `).join('');
  }

  async function loadDomains() {
    try {
      const res = await LP.get('/mail/domains');
      const body = document.getElementById('mailDomainsBody');
      if (res?.success && Array.isArray(res.data.domains)) {
        if (res.data.domains.length === 0) {
          body.innerHTML = '<tr><td colspan="2" class="text-muted" style="text-align:center;">No mail domains configured.</td></tr>';
          return;
        }
        body.innerHTML = res.data.domains.map(d => `
          <tr><td><strong>${LP.escHtml(d)}</strong></td>
            <td style="text-align:right;"><button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="LP.call('MAIL.removeDomain', '${LP.encJsArg(d)}')"><i class="bi bi-trash"></i></button></td>
          </tr>
        `).join('');
      }
    } catch {}
  }

  async function loadAccounts() {
    try {
      const res = await LP.get('/mail/accounts');
      const body = document.getElementById('mailAccountsBody');
      if (res?.success && Array.isArray(res.data.accounts)) {
        if (res.data.accounts.length === 0) {
          body.innerHTML = '<tr><td colspan="3" class="text-muted" style="text-align:center;">No email accounts.</td></tr>';
          return;
        }
        body.innerHTML = res.data.accounts.map(a => `
          <tr><td><strong>${LP.escHtml(a.email)}</strong></td>
            <td style="font-size:12px;color:var(--text-muted);">${a.mailbox}</td>
            <td style="text-align:right;">
              <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="LP.call('MAIL.deleteAccount', '${LP.encJsArg(a.email)}')"><i class="bi bi-trash"></i></button>
            </td>
          </tr>
        `).join('');
      }
    } catch {}
  }

  async function loadQueue() {
    try {
      const res = await LP.get('/mail/queue');
      if (res?.success) {
        document.getElementById('mailQueueCount').textContent = `(${res.data.total || 0} messages)`;
        document.getElementById('mailQueueContent').textContent = res.data.raw || 'Mail queue is empty.';
      }
    } catch {}
  }

  async function loadSpamConfig() {
    try {
      const res = await LP.get('/mail/spam');
      const el = document.getElementById('spamConfigContent');
      if (res?.success) {
        const c = res.data;
        el.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:12px;">
            <div><span style="font-size:12px;color:var(--text-muted);">Status:</span> ${c.active ? '<span class="text-success">Active</span>' : '<span class="text-danger">Inactive</span>'}</div>
            <div class="lp-form-group">
              <label class="lp-label">Required Score (1.0 — 20.0)</label>
              <div style="display:flex;gap:8px;">
                <input type="number" id="spamScoreInput" class="lp-input" value="${c.requiredScore || 5}" min="1" max="20" step="0.5" style="width:120px;">
                <button class="btn-lp btn-lp-primary btn-lp-sm" onclick="MAIL.updateSpamScore()">Save</button>
              </div>
            </div>
          </div>
        `;
      }
    } catch {}
  }

  async function loadLogs() {
    const svc = document.getElementById('mailLogService').value;
    const lines = document.getElementById('mailLogLines').value;
    const el = document.getElementById('mailLogContent');
    el.textContent = 'Loading...';
    try {
      const res = await LP.get(`/mail/logs?service=${svc}&lines=${lines}`);
      if (res?.success) el.textContent = (res.data.logs || []).join('\n') || 'No logs found.';
      else el.textContent = 'Failed to load logs';
    } catch { el.textContent = 'Error loading logs'; }
  }

  async function install() {
    if (!(await LP.confirm('Install Postfix, Dovecot & SpamAssassin? This may take a few minutes.', 'Install Mail Server'))) return;
    try {
      const res = await LP.post('/mail/install');
      if (res?.success) LP.toast('Mail server installed', 'success');
      else LP.toast('Failed', 'error');
      loadData();
    } catch { LP.toast('Error', 'error'); }
  }

  function showAddDomainModal() {
    if (!domModal) domModal = new bootstrap.Modal(document.getElementById('addDomainModal'));
    document.getElementById('mailDomainInput').value = '';
    domModal.show();
  }

  async function addDomain(e) {
    e.preventDefault();
    const domain = document.getElementById('mailDomainInput').value;
    try {
      const res = await LP.post('/mail/domains', { domain });
      if (res?.success) { LP.toast('Domain added', 'success'); domModal.hide(); loadDomains(); }
      else LP.toast(res?.message || 'Failed', 'error');
    } catch { LP.toast('Error', 'error'); }
  }

  async function removeDomain(domain) {
    if (!(await LP.confirm(`Remove domain "${domain}"?`, 'Remove Domain'))) return;
    try {
      const res = await LP.delete('/mail/domains', { domain });
      if (res?.success) { LP.toast('Domain removed', 'success'); loadDomains(); }
      else LP.toast('Failed', 'error');
    } catch { LP.toast('Error', 'error'); }
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
    const email = document.getElementById('accEmailInput').value;
    const password = document.getElementById('accPasswordInput').value;
    try {
      const res = await LP.post('/mail/accounts', { email, password });
      if (res?.success) { LP.toast('Account created', 'success'); accModal.hide(); loadAccounts(); }
      else LP.toast(res?.message || 'Failed', 'error');
    } catch { LP.toast('Error', 'error'); }
  }

  async function deleteAccount(email) {
    if (!(await LP.confirm(`Delete account "${email}"?`, 'Delete Account'))) return;
    try {
      const res = await LP.delete('/mail/accounts', { email });
      if (res?.success) { LP.toast('Account deleted', 'success'); loadAccounts(); }
      else LP.toast('Failed', 'error');
    } catch { LP.toast('Error', 'error'); }
  }

  async function flushQueue() {
    if (!(await LP.confirm('Flush mail queue?', 'Flush Queue'))) return;
    try {
      const res = await LP.post('/mail/queue/flush');
      if (res?.success) { LP.toast('Queue flushed', 'success'); loadQueue(); }
      else LP.toast('Failed', 'error');
    } catch { LP.toast('Error', 'error'); }
  }

  async function updateSpamScore() {
    const score = document.getElementById('spamScoreInput').value;
    try {
      const res = await LP.post('/mail/spam', { requiredScore: parseFloat(score) });
      if (res?.success) LP.toast('Spam score updated', 'success');
      else LP.toast('Failed', 'error');
    } catch { LP.toast('Error', 'error'); }
  }

  document.addEventListener('DOMContentLoaded', loadData);

  return { loadData, install, loadDomains, loadAccounts, loadQueue, loadLogs, loadSpamConfig,
    showAddDomainModal, addDomain, removeDomain,
    showAddAccountModal, addAccount, deleteAccount,
    flushQueue, updateSpamScore };
})();

window.MAIL = MAIL;
