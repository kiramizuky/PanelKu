const WAFPage = {
  async init() {
    await this.loadRules();
    await this.loadFail2BanLogs();
    await this.scanSecurity();
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
            <td style="font-weight:500;text-transform:uppercase;">${LP.escHtml(r.type.replace('_', ' '))}</td>
            <td><span class="lp-badge lp-badge-primary" style="font-family:var(--font-mono);">${LP.escHtml(r.value)}</span></td>
            <td>
              <span class="lp-badge ${r.action === 'allow' ? 'lp-badge-success' : 'lp-badge-danger'}">
                ${LP.escHtml(r.action)}
              </span>
            </td>
            <td style="color:var(--text-secondary);font-size:12px;">${LP.escHtml(r.description || '-')}</td>
            <td style="text-align:right">
              <button class="btn-lp btn-lp-ghost btn-lp-sm" onclick="LP.call('WAFPage.deleteRule', '${LP.encJsArg(r._id)}')" style="color:var(--accent-danger)">
                <i class="bi bi-trash"></i> Delete
              </button>
            </td>
          </tr>
        `, 'No WAF rules found', 5);
      } else {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--accent-danger)">Error: ${LP.escHtml(res.message)}</td></tr>`;
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
  },

  async scanSecurity() {
    const listEl = document.getElementById('securityAdvisorList');
    listEl.innerHTML = '<p class="text-muted mb-0" style="font-size:13px;"><i class="spinner-border spinner-border-sm me-1"></i> Scanning system security configuration...</p>';
    
    try {
      const res = await LP.get('/system/security/scan');
      if (res?.success && res.data) {
        const score = res.data.score;
        const issues = res.data.issues;
        
        const scoreTextEl = document.getElementById('securityScoreText');
        scoreTextEl.textContent = score;
        
        const ringEl = document.getElementById('securityScoreRing');
        if (score >= 90) {
          ringEl.style.borderColor = 'var(--accent-success)';
          scoreTextEl.style.color = 'var(--accent-success)';
        } else if (score >= 70) {
          ringEl.style.borderColor = 'var(--accent-warning)';
          scoreTextEl.style.color = 'var(--accent-warning)';
        } else {
          ringEl.style.borderColor = 'var(--accent-danger)';
          scoreTextEl.style.color = 'var(--accent-danger)';
        }
        
        if (issues.length === 0) {
          listEl.innerHTML = '<p class="text-muted mb-0" style="font-size:13px;"><i class="bi bi-check2-circle text-success me-1"></i> No security vulnerabilities found. Your server is well-configured!</p>';
        } else {
          listEl.innerHTML = issues.map(issue => `
            <div class="d-flex justify-content-between align-items-center p-2 rounded mb-2" style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.05);">
              <div>
                <span class="d-block" style="font-size:12.5px; font-weight:600; color:#fff;">
                  <span class="badge bg-${issue.severity === 'danger' ? 'danger' : 'warning'} me-1" style="font-size:9px;">${issue.severity.toUpperCase()}</span>
                  ${issue.title}
                </span>
                <small class="text-muted d-block" style="font-size:11px; margin-top:2px;">${issue.description}</small>
                <small class="text-info d-block" style="font-size:11px; margin-top:2px;"><i class="bi bi-lightbulb"></i> Recommendation: ${issue.recommendation}</small>
              </div>
              ${issue.fixable ? `
                <button class="btn-lp btn-lp-primary btn-lp-sm" style="font-size:11px; padding:4px 8px; height: 28px;" onclick="LP.call('WAFPage.fixIssue', '${LP.encJsArg(issue.id)}')"><i class="bi bi-wrench"></i> Fix</button>
              ` : ''}
            </div>
          `).join('');
        }
      }
    } catch (e) {
      listEl.innerHTML = '<p class="text-danger mb-0" style="font-size:13px;">Failed to execute security scan.</p>';
    }
  },

  async fixIssue(id) {
    try {
      const res = await LP.post('/system/security/fix', { id });
      if (res?.success) {
        LP.toast(res.message || 'Issue resolved successfully', 'success');
        this.scanSecurity();
      } else {
        LP.toast(res?.message || 'Failed to fix issue', 'error');
      }
    } catch {
      LP.toast('Connection error', 'error');
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  WAFPage.init();
});
