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
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--accent-danger)">Error: ${LP.escHtml(res?.message || 'Failed to load WAF rules')}</td></tr>`;
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

    try {
      const res = await LP.post('/waf/rules', { type, value, action, description });
      if (res?.success) {
        LP.toast('WAF Rule added successfully', 'success');
        bootstrap.Modal.getInstance(document.getElementById('addRuleModal')).hide();
        document.getElementById('addRuleForm').reset();
        this.loadRules();
      } else {
        LP.toast(res?.message || 'Failed to add WAF rule', 'error');
      }
    } catch {
      LP.toast('Error adding WAF rule', 'error');
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
        LP.toast(res?.message || 'Failed to delete rule', 'error');
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
    listEl.innerHTML = '<p class="text-muted mb-0" style="font-size:13px;"><i class="spinner-border spinner-border-sm me-1"></i> Running comprehensive security & vulnerability scan...</p>';
    
    try {
      const res = await LP.get('/waf/security/scan');
      if (res?.success && res.data) {
        const summary = res.data.summary || {};
        const score = summary.score !== undefined ? summary.score : 100;
        const findings = res.data.findings || [];
        
        const scoreTextEl = document.getElementById('securityScoreText');
        scoreTextEl.textContent = score;
        
        const ringEl = document.getElementById('securityScoreRing');
        if (score >= 90) {
          ringEl.style.borderColor = '#10b981';
          scoreTextEl.style.color = '#10b981';
        } else if (score >= 75) {
          ringEl.style.borderColor = '#3b82f6';
          scoreTextEl.style.color = '#3b82f6';
        } else if (score >= 50) {
          ringEl.style.borderColor = '#f59e0b';
          scoreTextEl.style.color = '#f59e0b';
        } else {
          ringEl.style.borderColor = '#ef4444';
          scoreTextEl.style.color = '#ef4444';
        }
        
        if (findings.length === 0) {
          listEl.innerHTML = '<div class="p-3 rounded" style="background:rgba(16,185,129,0.1); border:1px solid rgba(16,185,129,0.2);"><p class="text-success mb-0" style="font-size:13px;"><i class="bi bi-shield-check me-2"></i><strong>Excellent Security Posture!</strong> No vulnerabilities or configuration flaws detected.</p></div>';
        } else {
          listEl.innerHTML = findings.map(f => {
            const sevBadge = f.severity === 'critical' ? 'badge bg-danger' : (f.severity === 'high' ? 'badge bg-warning text-dark' : 'badge bg-secondary');
            return `
              <div class="d-flex justify-content-between align-items-center p-2 rounded mb-2" style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.06);">
                <div style="flex:1; min-width:0; padding-right:12px;">
                  <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                    <span class="${sevBadge}" style="font-size:9px; text-transform:uppercase;">${LP.escHtml(f.severity)}</span>
                    <span class="badge bg-dark" style="font-size:9px; border:1px solid rgba(255,255,255,0.1);">${LP.escHtml(f.category || 'Security')}</span>
                    <strong style="font-size:12.5px; color:#fff;">${LP.escHtml(f.title)}</strong>
                  </div>
                  <small class="text-muted d-block" style="font-size:11px; margin-top:2px;">${LP.escHtml(f.description)}</small>
                  ${f.recommendation ? `<small class="text-info d-block" style="font-size:10.5px; margin-top:2px;"><i class="bi bi-lightbulb me-1"></i>${LP.escHtml(f.recommendation)}</small>` : ''}
                </div>
                ${f.canAutoFix && f.fixAction ? `
                  <button class="btn-lp btn-lp-primary btn-lp-sm" style="font-size:11px; padding:4px 10px; height:28px; white-space:nowrap;" onclick="LP.call('WAFPage.fixIssue', '${LP.encJsArg(f.fixAction)}')">
                    <i class="bi bi-magic me-1"></i> Auto Fix
                  </button>
                ` : ''}
              </div>
            `;
          }).join('');
        }
      } else {
        listEl.innerHTML = `<p class="text-danger mb-0" style="font-size:13px;">${LP.escHtml(res?.message || 'Failed to load security scan')}</p>`;
      }
    } catch {
      listEl.innerHTML = '<p class="text-danger mb-0" style="font-size:13px;">Failed to execute security audit scan.</p>';
    }
  },

  async fixIssue(fixAction) {
    if (!(await LP.confirm(`Apply automated remediation for this security issue?`, 'Apply Security Fix'))) return;

    LP.toast('Applying security remediation...', 'info');
    try {
      const res = await LP.post('/waf/security/fix', { fixAction });
      if (res?.success) {
        LP.toast(res.message || 'Security fix applied successfully!', 'success');
        this.scanSecurity();
      } else {
        LP.toast(res?.message || 'Failed to apply security fix', 'error');
      }
    } catch {
      LP.toast('Error applying security fix', 'error');
    }
  },

  // ── Real-Time GeoIP Threat Map & Geo-Shield ────────────────
  async loadThreatMap() {
    try {
      const res = await LP.get('/waf/threat-map');
      if (res?.success && res.data) {
        this.renderThreatMap(res.data);
      }
    } catch {
      LP.toast('Failed to load Threat Map data', 'error');
    }
  },

  renderThreatMap(data) {
    document.getElementById('tmTotalThreats').textContent = data.totalThreats || 0;
    document.getElementById('tmUniqueIps').textContent = data.uniqueIps || 0;
    document.getElementById('tmTopCountry').textContent = data.topAttackingCountries[0]?.countryName || 'None';
    document.getElementById('tmBlockedCount').textContent = data.blockedCountriesList?.length || 0;

    // Populate country select dropdown
    const selectEl = document.getElementById('geoBlockCountrySelect');
    if (selectEl && data.allCountryOptions) {
      selectEl.innerHTML = '<option value="">-- Choose Country --</option>' +
        data.allCountryOptions.map(c => `<option value="${c.code}">${LP.escHtml(c.name)} (${c.code})</option>`).join('');
    }

    // Render Country Bars
    const barsEl = document.getElementById('tmCountryBars');
    if (barsEl) {
      if (!data.countries || data.countries.length === 0) {
        barsEl.innerHTML = '<p class="text-muted" style="font-size:12px;">No intrusion events recorded yet.</p>';
      } else {
        barsEl.innerHTML = data.countries.slice(0, 8).map(c => `
          <div>
            <div style="display:flex; justify-content:space-between; font-size:11.5px; margin-bottom:4px;">
              <span style="font-weight:600; color:#fff;">
                <span class="badge bg-secondary me-1" style="font-size:9px;">${LP.escHtml(c.countryCode)}</span>
                ${LP.escHtml(c.countryName)}
              </span>
              <span class="text-muted font-mono">${c.count} threats (${c.percentage}%)</span>
            </div>
            <div class="progress" style="height:6px; background:rgba(255,255,255,0.06); border-radius:3px;">
              <div class="progress-bar bg-danger" style="width: ${c.percentage}%; border-radius:3px;"></div>
            </div>
          </div>
        `).join('');
      }
    }

    // Render Threat Feed Table
    const tbody = document.getElementById('tmThreatsTableBody');
    if (tbody) {
      if (!data.threats || data.threats.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">No recent blocked attacks</td></tr>';
      } else {
        tbody.innerHTML = data.threats.map(t => `
          <tr>
            <td class="font-mono" style="font-weight:600; color:var(--text-primary);">${LP.escHtml(t.ip)}</td>
            <td>
              <span class="badge bg-dark border border-secondary" style="font-size:9.5px; margin-right:4px;">${LP.escHtml(t.countryCode)}</span>
              ${LP.escHtml(t.countryName)}
            </td>
            <td class="font-mono">${t.count}</td>
            <td><span class="lp-badge lp-badge-danger"><span class="lp-badge-dot"></span>BLOCKED</span></td>
            <td style="text-align:right;">
              <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="WAFPage.quickBlockIp('${LP.escHtml(t.ip)}')" style="font-size:11px; padding:2px 8px;" title="Add permanent WAF IP Block">
                <i class="bi bi-slash-circle"></i> Permanent
              </button>
            </td>
          </tr>
        `).join('');
      }
    }
  },

  async quickBlockIp(ip) {
    if (!(await LP.confirm(`Add permanent WAF block rule for ${ip}?`, 'Block IP'))) return;
    try {
      const res = await LP.post('/waf/rules', {
        type: 'ip',
        value: ip,
        action: 'block',
        description: 'Auto-blocked from Threat Map live feed',
      });
      if (res?.success) {
        LP.toast(`IP ${ip} permanently blocked in WAF`, 'success');
        this.loadRules();
      } else {
        LP.toast(res?.message || 'Failed to block IP', 'error');
      }
    } catch {
      LP.toast('Error blocking IP', 'error');
    }
  },

  async submitGeoBlock() {
    const selectEl = document.getElementById('geoBlockCountrySelect');
    const countryCode = selectEl?.value;
    if (!countryCode) {
      LP.toast('Please select a country to block', 'warning');
      return;
    }

    if (!(await LP.confirm(`Are you sure you want to block all incoming traffic from ${countryCode}?`, 'Confirm Geo-Block'))) return;

    try {
      const res = await LP.post('/waf/geo-block', {
        countryCode,
        description: `Geo-Shield 1-click block for ${countryCode}`,
      });
      if (res?.success) {
        LP.toast(`Country ${countryCode} blocked successfully!`, 'success');
        this.loadThreatMap();
        this.loadRules();
      } else {
        LP.toast(res?.message || 'Failed to block country', 'error');
      }
    } catch {
      LP.toast('Error blocking country', 'error');
    }
  }
};

// [FIX] Expose to window for LP.call() resolution
window.WAFPage = WAFPage;

document.addEventListener('DOMContentLoaded', () => {
  WAFPage.init();
});

