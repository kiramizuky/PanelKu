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
          const websiteId = c.websiteId || c.id;
          return `
            <tr>
              <td style="font-weight:600;"><a href="https://${c.domain}" target="_blank" style="color:inherit;text-decoration:none">${LP.escHtml(c.domain)} <i class="bi bi-box-arrow-up-right" style="font-size:10px;color:var(--text-muted)"></i></a></td>
              <td><span class="lp-badge lp-badge-primary">${LP.escHtml(c.provider || 'letsencrypt')}</span></td>
              <td>${new Date(c.expiresAt).toLocaleDateString()}</td>
              <td>
                <span class="lp-badge ${isExpired ? 'lp-badge-danger' : daysLeft <= 14 ? 'lp-badge-warning' : 'lp-badge-success'}">
                  <span class="lp-badge-dot"></span>
                  ${isExpired ? 'Expired' : `Valid (${daysLeft}d)`}
                </span>
              </td>
              <td style="text-align:right">
                <button class="btn-lp btn-lp-ghost btn-lp-sm" onclick="LP.call('SSLPage.renewCertificate', '${LP.encJsArg(websiteId)}')" style="color:var(--accent-info)" title="Renew Certificate">
                  <i class="bi bi-arrow-repeat"></i>
                </button>
                <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="LP.call('SSLPage.disableCertificate', '${LP.encJsArg(websiteId)}')" title="Disable SSL">
                  <i class="bi bi-shield-x"></i>
                </button>
              </td>
            </tr>
          `;
        }, 'No certificates found. Issue one using the button above.', 5);
      } else {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--accent-danger)">Error: ${LP.escHtml(res?.message || 'Unknown error')}</td></tr>`;
      }
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--accent-danger)">Failed to load certificates</td></tr>';
    }
  },

  toggleProviderFields() {
    const provider = document.getElementById('sslProvider').value;
    const infoLetsEncrypt = document.getElementById('sslInfoLetsEncrypt');
    const infoSelfSigned = document.getElementById('sslInfoSelfSigned');
    const customFields = document.getElementById('sslCustomFields');

    if (infoLetsEncrypt) infoLetsEncrypt.style.display = provider === 'letsencrypt' ? 'block' : 'none';
    if (infoSelfSigned) infoSelfSigned.style.display = provider === 'selfsigned' ? 'block' : 'none';
    if (customFields) customFields.style.display = provider === 'custom' ? 'block' : 'none';
  },

  async showIssueModal() {
    const select = document.getElementById('sslWebsiteId');
    select.innerHTML = '<option value="">Loading...</option>';
    document.getElementById('issueSslForm').reset();
    this.toggleProviderFields();
    new bootstrap.Modal(document.getElementById('issueSslModal')).show();

    try {
      const res = await LP.get('/websites');
      if (res?.success) {
        const websites = res.data?.websites || res.data || [];
        select.innerHTML = websites.length
          ? websites.map(w => `<option value="${w._id}">${w.domain} (${w.type}${w.ssl?.enabled ? ' - Current: SSL Active' : ''})</option>`).join('')
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

    const provider = document.getElementById('sslProvider').value;
    const payload = { websiteId, provider };

    if (provider === 'custom') {
      payload.certificate = document.getElementById('sslCustomCertInput').value.trim();
      payload.privateKey = document.getElementById('sslCustomKeyInput').value.trim();
      if (!payload.certificate || !payload.privateKey) {
        return LP.toast('Both Certificate and Private Key PEM are required for custom SSL', 'warning');
      }
    }

    const btn = document.getElementById('btnSubmitIssue');
    const oldHtml = btn.innerHTML;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Processing SSL...';
    btn.disabled = true;

    try {
      const res = await LP.post('/ssl/issue', payload);
      if (res?.success) {
        LP.toast('Certificate issued successfully and Nginx reloaded!', 'success');
        bootstrap.Modal.getInstance(document.getElementById('issueSslModal')).hide();
        this.loadCertificates();
      } else {
        const errMsg = res?.message || 'Failed to issue certificate';
        LP.toast(errMsg, 'error');
        console.error('SSL Issue error:', res);
      }
    } catch (err) {
      LP.toast(err.message || 'Connection error', 'error');
    } finally {
      btn.innerHTML = oldHtml;
      btn.disabled = false;
    }
  },

  async renewCertificate(id) {
    if (!(await LP.confirm('Attempt to renew this certificate and reload Nginx?', 'Renew SSL'))) return;
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
      LP.toast(err.message || 'Connection error', 'error');
    }
  },

  async disableCertificate(id) {
    if (!(await LP.confirm('Disable SSL for this website? It will revert to HTTP port 80 only.', 'Disable SSL'))) return;
    LP.toast('Disabling SSL...', 'info');
    try {
      const res = await LP.post(`/ssl/disable/${id}`);
      if (res?.success) {
        LP.toast('SSL disabled and Nginx reverted to HTTP', 'success');
        this.loadCertificates();
      } else {
        LP.toast(res?.message || 'Failed to disable SSL', 'error');
      }
    } catch (err) {
      LP.toast(err.message || 'Connection error', 'error');
    }
  }
};

window.SSLPage = SSLPage;

document.addEventListener('DOMContentLoaded', () => SSLPage.init());
