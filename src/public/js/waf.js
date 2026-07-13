const WAFPage = {
  async init() {
    await this.loadRules();
    await this.loadFail2BanLogs();
  },

  async loadRules() {
    const tbody = document.getElementById('wafTableBody');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted)">Loading...</td></tr>';
    
    try {
      const res = await LP.get('/waf/rules');
      if (res?.success) {
        const rules = res.data;

        LP.paginate(rules, 10, 'wafTableBody', 'wafPagination', r => `
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
        `, 'No WAF rules found', 5);
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
      LP.toast('WAF Rule added successfully', 'success');
      bootstrap.Modal.getInstance(document.getElementById('addRuleModal')).hide();
      document.getElementById('addRuleForm').reset();
      this.loadRules();
    } else {
      LP.toast(res.message, 'error');
    }
  },

  async deleteRule(id) {
    if (!(await LP.confirm('Are you sure you want to delete this rule?', 'Delete Rule'))) return;
    
    try {
      const res = await LP.delete(`/waf/rules/${id}`);
      if (res?.success) {
        LP.toast('Rule deleted', 'success');
        this.loadRules();
      } else {
        LP.toast(res.message, 'error');
      }
    } catch (err) {
      LP.toast('Connection error', 'error');
    }
  },

  async loadFail2BanLogs() {
    const logsEl = document.getElementById('fail2banLogs');
    logsEl.textContent = 'Loading Fail2Ban logs...';
    try {
      const res = await LP.get('/waf/fail2ban/logs');
      if (res?.success && Array.isArray(res.data)) {
        logsEl.textContent = res.data.join('\n');
      } else {
        logsEl.textContent = 'Failed to load Fail2Ban logs.';
      }
    } catch {
      logsEl.textContent = 'Error loading Fail2Ban logs.';
    }
  },

  askAILog() {
    const logs = document.getElementById('fail2banLogs').textContent;
    window.askAI("Tolong jelaskan log Fail2Ban ini dan rekomendasinya.", { logType: 'fail2ban', logText: logs });
  }
};

document.addEventListener('DOMContentLoaded', () => {
  WAFPage.init();
});
