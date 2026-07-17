/**
 * Linux Panel — ssl.js
 * SSL Certificate management frontend
 */

const SSLPage = {
  async init() {
    await LP.init();
    if (!LP.state.accessToken) return;
    await this.loadCertificates();
  },

  async loadCertificates() {
    const tbody = document.getElementById('sslTableBody');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted)">Loading...</td></tr>';

    try {
      const res = await LP.get('/ssl/certificates');
      if (res?.success) {
        const certs = res.data;

        LP.paginate(certs, 10, 'sslTableBody', 'sslPagination', c => {
          const isExpired = new Date(c.expiresAt) < new Date();
          const daysLeft = Math.ceil((new Date(c.expiresAt) - Date.now()) / 86400000);
          return `
            <tr>
              <td style="font-weight:500;">${LP.escHtml(c.domain)}</td>
              <td><span class="lp-badge lp-badge-primary">${LP.escHtml(c.provider)}</span></td>
              <td>${new Date(c.expiresAt).toLocaleDateString()}</td>
              <td>
                <span class="lp-badge ${isExpired ? 'lp-badge-danger' : daysLeft <= 14 ? 'lp-badge-warning' : 'lp-badge-success'}">
                  <span class="lp-badge-dot"></span>
                  ${isExpired ? 'Expired' : `Valid (${daysLeft}d)`}
                </span>
              </td>
              <td style="text-align:right">
                <button class="btn-lp btn-lp-ghost btn-lp-sm" onclick="LP.call('SSLPage.renewCertificate', '${LP.encJsArg(c.id)}')" style="color:var(--accent-info)" title="Renew">
                  <i class="bi bi-arrow-repeat"></i>
                </button>
              </td>
            </tr>
          `;
        }, 'No certificates found. Issue one using the button above.', 5);
      } else {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--accent-danger)">Error: ${res?.message || 'Unknown error'}</td></tr>`;
      }
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--accent-danger)">Failed to load certificates</td></tr>';
    }
  },

  async showIssueModal() {
    const select = document.getElementById('sslWebsiteId');
    select.innerHTML = '<option value="">Loading...</option>';
    new bootstrap.Modal(document.getElementById('issueSslModal')).show();

    try {
      const res = await LP.get('/websites');
      if (res?.success) {
        const websites = res.data?.websites || res.data || [];
        select.innerHTML = websites.length
          ? websites.map(w => `<option value="${w._id}">${w.domain} (${w.type})</option>`).join('')
          : '<option value="">No websites found. Create a website first.</option>';
      }
    } catch (err) {
      select.innerHTML = '<option value="">Error loading websites</option>';
    }
  },

  async issueCertificate(e) {
    e.preventDefault();
    const websiteId = document.getElementById('sslWebsiteId').value;
    if (!websiteId) return LP.toast('Please select a website', 'warning');

    const btn = e.target.querySelector('button[type="submit"]');
    const oldHtml = btn.innerHTML;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Issuing... (may take a minute)';
    btn.disabled = true;

    try {
      const res = await LP.post('/ssl/issue', { websiteId });
      if (res?.success) {
        LP.toast('Certificate issued successfully!', 'success');
        bootstrap.Modal.getInstance(document.getElementById('issueSslModal')).hide();
        this.loadCertificates();
      } else {
        LP.toast(res?.message || 'Failed to issue certificate', 'error');
      }
    } catch (err) {
      LP.toast('Connection error', 'error');
    } finally {
      btn.innerHTML = oldHtml;
      btn.disabled = false;
    }
  },

  async renewCertificate(id) {
    if (!(await LP.confirm('Attempt to renew this certificate?', 'Renew SSL'))) return;
    LP.toast('Renewing certificate...', 'info');
    try {
      const res = await LP.post(`/ssl/renew/${id}`);
      if (res?.success) {
        LP.toast('Certificate renewed successfully!', 'success');
        this.loadCertificates();
      } else {
        LP.toast(res?.message || 'Renewal failed', 'error');
      }
    } catch (err) {
      LP.toast('Connection error', 'error');
    }
  }
};

document.addEventListener('DOMContentLoaded', () => SSLPage.init());
