const FirewallPage = {
  async init() {
    await this.loadStatus();
  },

  async loadStatus() {
    const tbody = document.getElementById('firewallTableBody');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted)">Loading...</td></tr>';
    
    try {
      const res = await LP.get('/firewall/status');
      if (res?.success) {
        const { isActive, rules } = res.data;
        
        const toggle = document.getElementById('firewallToggle');
        const text = document.getElementById('firewallStatusText');
        toggle.checked = isActive;
        
        if (isActive) {
          text.textContent = 'Active';
          text.style.color = 'var(--accent-success)';
        } else {
          text.textContent = 'Disabled';
          text.style.color = 'var(--text-muted)';
        }

        LP.paginate(rules, 10, 'firewallTableBody', 'firewallPagination', r => `
          <tr>
            <td><span style="font-family:var(--font-mono);color:var(--text-muted)">[${r.id}]</span></td>
            <td><span class="lp-badge lp-badge-primary" style="font-size:12px">${r.to}</span></td>
            <td>
              <span class="lp-badge ${r.action.toLowerCase() === 'allow' ? 'lp-badge-success' : 'lp-badge-danger'}">
                ${r.action} ${r.direction}
              </span>
            </td>
            <td style="color:var(--text-secondary)">${r.from}</td>
            <td style="text-align:right">
              <button class="btn-lp btn-lp-ghost btn-lp-sm" onclick="FirewallPage.deleteRule('${r.id}')" style="color:var(--accent-danger)">
                <i class="bi bi-trash"></i> Delete
              </button>
            </td>
          </tr>
        `, 'No active rules', 5);
      } else {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--accent-danger)">Error: ${res.message}</td></tr>`;
      }
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--accent-danger)">Failed to load firewall status</td></tr>';
    }
  },

  async toggleFirewall(el) {
    const enable = el.checked;
    if (!(await LP.confirm(`Are you sure you want to ${enable ? 'enable' : 'disable'} the firewall?`, 'Toggle Firewall'))) {
      el.checked = !enable;
      return;
    }
    try {
      const res = await LP.post('/firewall/toggle', { enable });
      if (res?.success) {
        LP.toast(`Firewall ${enable ? 'enabled' : 'disabled'}`, 'success');
        this.loadStatus();
      } else {
        el.checked = !enable;
        LP.toast(res.message, 'error');
      }
    } catch (err) {
      el.checked = !enable;
      LP.toast('Connection error', 'error');
    }
  },

  showAddModal() {
    new bootstrap.Modal(document.getElementById('addRuleModal')).show();
  },

  async addRule(e) {
    e.preventDefault();
    const port = document.getElementById('rulePort').value;
    const protocol = document.getElementById('ruleProtocol').value;
    const action = document.getElementById('ruleAction').value;

    const res = await LP.post('/firewall/rules', { port, protocol, action });
    if (res?.success) {
      LP.toast('Rule added', 'success');
      bootstrap.Modal.getInstance(document.getElementById('addRuleModal')).hide();
      document.getElementById('addRuleForm').reset();
      this.loadStatus();
    } else {
      LP.toast(res.message, 'error');
    }
  },

  async deleteRule(id) {
    if (!(await LP.confirm(`Are you sure you want to delete rule [${id}]?`, 'Delete Rule'))) return;
    
    const res = await LP.delete(`/firewall/rules/${id}`);
    if (res?.success) {
      LP.toast('Rule deleted', 'success');
      this.loadStatus();
    } else {
      LP.toast(res.message, 'error');
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  FirewallPage.init();
});
