const WAFPage = {
  async init() {
    await this.loadRules();
  },

  async loadRules() {
    const tbody = document.getElementById('wafTableBody');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted)">Loading...</td></tr>';
    
    try {
      const res = await LP.get('/waf/rules');
      if (res?.success) {
        const rules = res.data;

        if (rules.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted)">No WAF rules found</td></tr>';
          return;
        }

        tbody.innerHTML = rules.map(r => `
          <tr>
            <td style="font-weight:500;text-transform:uppercase;">${r.type.replace('_', ' ')}</td>
            <td><span class="lp-badge lp-badge-primary" style="font-family:var(--font-mono);">${r.value}</span></td>
            <td>
              <span class="lp-badge ${r.action === 'allow' ? 'lp-badge-success' : 'lp-badge-danger'}">
                ${r.action}
              </span>
            </td>
            <td style="color:var(--text-secondary);font-size:12px;">${r.description || '-'}</td>
            <td style="text-align:right">
              <button class="btn-lp btn-lp-ghost btn-lp-sm" onclick="WAFPage.deleteRule('${r._id}')" style="color:var(--accent-danger)">
                <i class="bi bi-trash"></i> Delete
              </button>
            </td>
          </tr>
        `).join('');
      } else {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--accent-danger)">Error: ${res.message}</td></tr>`;
      }
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--accent-danger)">Failed to load WAF rules</td></tr>';
    }
  },

  showAddModal() {
    new bootstrap.Modal(document.getElementById('addRuleModal')).show();
  },

  async addRule(e) {
    e.preventDefault();
    const type = document.getElementById('ruleType').value;
    const value = document.getElementById('ruleValue').value;
    const action = document.getElementById('ruleAction').value;
    const description = document.getElementById('ruleDescription').value;

    const res = await LP.post('/waf/rules', { type, value, action, description });
    if (res?.success) {
      LP.showToast('WAF Rule added successfully', 'success');
      bootstrap.Modal.getInstance(document.getElementById('addRuleModal')).hide();
      document.getElementById('addRuleForm').reset();
      this.loadRules();
    } else {
      LP.showToast(res.message, 'error');
    }
  },

  async deleteRule(id) {
    if (!confirm('Are you sure you want to delete this rule?')) return;
    
    try {
      const res = await LP.delete(`/waf/rules/${id}`);
      if (res?.success) {
        LP.showToast('Rule deleted', 'success');
        this.loadRules();
      } else {
        LP.showToast(res.message, 'error');
      }
    } catch (err) {
      LP.showToast('Connection error', 'error');
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  WAFPage.init();
});
