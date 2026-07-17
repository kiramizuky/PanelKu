const WhatsappPage = (() => {
  let listModal;
  let webhookModal;
  let testMsgModal;
  let activePollInterval = null;

  async function loadData() {
    try {
      const res = await LP.get('/whatsapp/accounts');
      if (res?.success) {
        renderAccounts(res.data.accounts || []);
      }
    } catch (e) {
      console.error(e);
      LP.toast('Failed to load accounts', 'error');
    }
  }

  function renderAccounts(accounts) {
    const tbody = document.getElementById('whatsappTableBody');
    if (accounts.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--text-muted)">No WhatsApp accounts configured yet.</td></tr>`;
      return;
    }      tbody.innerHTML = accounts.map(acc => {
      let badgeClass = 'lp-badge-danger';
      if (acc.status === 'connected') badgeClass = 'lp-badge-success';
      else if (acc.status === 'connecting') badgeClass = 'lp-badge-warning';

      return `
        <tr>
          <td><strong style="color:var(--text-primary)">${LP.escHtml(acc.sessionName)}</strong></td>
          <td><span class="lp-badge ${badgeClass}"><span class="lp-badge-dot"></span>${LP.escHtml(acc.status)}</span></td>
          <td class="font-mono" style="font-size:12px">${acc.webhookUrl ? LP.escHtml(acc.webhookUrl) : '<span class="text-muted">Not configured</span>'}</td>
          <td style="text-align:right">
            ${acc.status !== 'connected' 
              ? `<button class="btn-lp btn-lp-ghost btn-lp-sm text-info" onclick="LP.call('WhatsappPage.startQrScan', '${LP.encJsArg(acc.sessionName)}')" title="Scan QR"><i class="bi bi-qr-code"></i> Scan</button>`
              : `<button class="btn-lp btn-lp-ghost btn-lp-sm text-success" onclick="LP.call('WhatsappPage.showTestModal', '${LP.encJsArg(acc.sessionName)}')" title="Test Send"><i class="bi bi-send-fill"></i> Test</button>`
            }
            <button class="btn-lp btn-lp-ghost btn-lp-sm" onclick="LP.call('WhatsappPage.showWebhookModal', '${LP.encJsArg(acc.sessionName)}', '${LP.encJsArg(acc.webhookUrl || '')}')" title="Webhook"><i class="bi bi-link"></i> Webhook</button>
            <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="LP.call('WhatsappPage.deleteSession', '${LP.encJsArg(acc.sessionName)}')" title="Delete"><i class="bi bi-trash"></i></button>
          </td>
        </tr>
      `;
    }).join('');
  }

  function showCreateModal() {
    listModal = new bootstrap.Modal(document.getElementById('createAccountModal'));
    listModal.show();
  }

  async function createAccount(e) {
    e.preventDefault();
    const name = document.getElementById('accName').value.trim();
    if (!name) return;

    LP.toast('Initializing WhatsApp session...', 'info');
    const res = await LP.post('/whatsapp/accounts', { name });
    if (res?.success) {
      LP.toast('Session initialized. Pulling QR...', 'success');
      listModal.hide();
      document.getElementById('createAccountForm').reset();
      loadData();
      startQrScan(name);
    } else {
      LP.toast(res?.message || 'Failed to initialize session', 'error');
    }
  }

  function startQrScan(sessionName) {
    if (activePollInterval) clearInterval(activePollInterval);

    document.getElementById('qrContainer').style.display = 'block';
    document.getElementById('qrTitle').textContent = `Scan QR: ${sessionName}`;
    document.getElementById('qrImage').src = '';

    // Start status polling
    activePollInterval = setInterval(async () => {
      try {
        const res = await LP.get(`/whatsapp/accounts/${sessionName}`);
        if (res?.success) {
          const data = res.data;
          if (data.status === 'connected') {
            LP.toast('WhatsApp Connected successfully!', 'success');
            document.getElementById('qrContainer').style.display = 'none';
            clearInterval(activePollInterval);
            loadData();
          } else if (data.qrImage) {
            document.getElementById('qrImage').src = data.qrImage;
          }
        }
      } catch (err) {
        clearInterval(activePollInterval);
      }
    }, 3000);
  }

  function showWebhookModal(sessionName, currentUrl) {
    document.getElementById('webhookSessionName').value = sessionName;
    document.getElementById('webhookUrlVal').value = currentUrl;
    document.getElementById('webhookModalTitle').textContent = `Webhook: ${sessionName}`;
    webhookModal = new bootstrap.Modal(document.getElementById('webhookModal'));
    webhookModal.show();
  }

  async function submitWebhook(e) {
    e.preventDefault();
    const name = document.getElementById('webhookSessionName').value;
    const webhookUrl = document.getElementById('webhookUrlVal').value.trim();

    const res = await LP.post(`/whatsapp/accounts/${name}/webhook`, { webhookUrl });
    if (res?.success) {
      LP.toast('Webhook target saved successfully', 'success');
      webhookModal.hide();
      loadData();
    } else {
      LP.toast('Failed to save webhook', 'error');
    }
  }

  function showTestModal(sessionName) {
    document.getElementById('testSessionName').value = sessionName;
    testMsgModal = new bootstrap.Modal(document.getElementById('testMsgModal'));
    testMsgModal.show();
  }

  async function submitTestMessage(e) {
    e.preventDefault();
    const name = document.getElementById('testSessionName').value;
    const to = document.getElementById('testTo').value.trim();
    const message = document.getElementById('testText').value.trim();

    LP.toast('Sending message...', 'info');
    const res = await LP.post(`/whatsapp/accounts/${name}/send`, { to, message });
    if (res?.success) {
      LP.toast('Message sent successfully', 'success');
      testMsgModal.hide();
      document.getElementById('testMsgForm').reset();
    } else {
      LP.toast(res?.message || 'Failed to send message', 'error');
    }
  }

  async function deleteSession(sessionName) {
    if (!(await LP.confirm(`Delete WhatsApp session ${sessionName}?`, 'Delete Session'))) return;

    LP.toast('Deleting session...', 'info');
    const res = await LP.del(`/whatsapp/accounts/${sessionName}`);
    if (res?.success) {
      LP.toast('Session deleted', 'success');
      if (document.getElementById('qrTitle').textContent.includes(sessionName)) {
        document.getElementById('qrContainer').style.display = 'none';
        clearInterval(activePollInterval);
      }
      loadData();
    } else {
      LP.toast('Failed to delete session', 'error');
    }
  }

  return {
    loadData,
    showCreateModal,
    createAccount,
    startQrScan,
    showWebhookModal,
    submitWebhook,
    showTestModal,
    submitTestMessage,
    deleteSession
  };
})();

document.addEventListener('DOMContentLoaded', () => {
  WhatsappPage.loadData();
});
