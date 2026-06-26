const SSLPage = {
  async init() {
    await this.loadCertificates();
  },

  async loadCertificates() {
    const tbody = document.getElementById('sslTableBody');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted)">Loading...</td></tr>';
    
    try {
      const res = await LP.get('/ssl/certificates');
      if (res?.success) {
        const certs = res.data;

        if (certs.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted)">No certificates found</td></tr>';
          return;
        }

        tbody.innerHTML = certs.map(c => {
          const isExpired = new Date(c.expiresAt) < new Date();
          return `
          <tr>
            <td style="font-weight:500;">${c.domain}</td>
            <td><span class="lp-badge lp-badge-primary">${c.provider}</span></td>
            <td>${new Date(c.expiresAt).toLocaleDateString()}</td>
            <td>
              <span class="lp-badge ${isExpired ? 'lp-badge-danger' : 'lp-badge-success'}">
                ${isExpired ? 'Expired' : 'Valid'}
              </span>
            </td>
            <td style="text-align:right">
              <button class="btn-lp btn-lp-ghost btn-lp-sm" onclick="SSLPage.renewCertificate('${c.id}')" style="color:var(--accent-info)">
                <i class="bi bi-arrow-repeat"></i> Renew
              </button>
            </td>
          </tr>
        `}).join('');
      } else {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--accent-danger)">Error: ${res.message}</td></tr>`;
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
        select.innerHTML = res.data.map(w => `<option value="${w._id}">${w.domain} (${w.type})</option>`).join('');
      }
    } catch (err) {
      select.innerHTML = '<option value="">Error loading websites</option>';
    }
  },

  async issueCertificate(e) {
    e.preventDefault();
    const websiteId = document.getElementById('sslWebsiteId').value;
    const btn = e.target.querySelector('button[type="submit"]');
    const oldHtml = btn.innerHTML;

    btn.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Issuing... (This may take a minute)';
    btn.disabled = true;

    try {
      const res = await LP.post('/ssl/issue', { websiteId });
      if (res?.success) {
        LP.showToast('Certificate issued successfully', 'success');
        bootstrap.Modal.getInstance(document.getElementById('issueSslModal')).hide();
        this.loadCertificates();
      } else {
        LP.showToast(res.message, 'error');
      }
    } catch (err) {
      LP.showToast('Connection error', 'error');
    } finally {
      btn.innerHTML = oldHtml;
      btn.disabled = false;
    }
  },

  async renewCertificate(id) {
    if (!confirm('Attempt to renew this certificate?')) return;

    try {
      LP.showToast('Renewing certificate...', 'info');
      const res = await LP.post(`/ssl/renew/${id}`);
      if (res?.success) {
        LP.showToast('Certificate renewed successfully', 'success');
        this.loadCertificates();
      } else {
        LP.showToast(res.message, 'error');
      }
    } catch (err) {
      LP.showToast('Connection error', 'error');
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  SSLPage.init();
});
