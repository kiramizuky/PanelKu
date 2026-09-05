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

    // Store threat list for pagination & filtering
    this._allThreats = data.threats || [];
    this._filteredThreats = [...this._allThreats];
    this._threatsPage = 1;
    this.renderThreatFeed();
  },

  _formatThreatTime(ts) {
    if (!ts) return 'Just now';
    try {
      const d = new Date(ts);
      if (isNaN(d.getTime())) return ts;
      const now = new Date();
      const diffSec = Math.floor((now - d) / 1000);
      if (diffSec < 60) return `${Math.max(1, diffSec)}s ago`;
      if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
      if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return ts;
    }
  },

  _formatFullTimestamp(ts) {
    if (!ts) return '-';
    try {
      const d = new Date(ts);
      if (isNaN(d.getTime())) return ts;
      return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return ts;
    }
  },

  filterThreats(keyword) {
    const q = (keyword || '').trim().toLowerCase();
    if (!q) {
      this._filteredThreats = [...this._allThreats];
    } else {
      this._filteredThreats = this._allThreats.filter(t => 
        (t.ip && t.ip.toLowerCase().includes(q)) ||
        (t.countryName && t.countryName.toLowerCase().includes(q)) ||
        (t.countryCode && t.countryCode.toLowerCase().includes(q)) ||
        (t.target && t.target.toLowerCase().includes(q)) ||
        (t.category && t.category.toLowerCase().includes(q)) ||
        (t.reason && t.reason.toLowerCase().includes(q))
      );
    }
    this._threatsPage = 1;
    this.renderThreatFeed();
  },

  changeThreatsPage(newPage) {
    const totalPages = Math.ceil(this._filteredThreats.length / (this._threatsPerPage || 10)) || 1;
    if (newPage < 1 || newPage > totalPages) return;
    this._threatsPage = newPage;
    this.renderThreatFeed();
  },

  toggleThreatDetail(id) {
    if (!this._openThreatIds) this._openThreatIds = new Set();
    const detailRow = document.getElementById(`threatDetail-${id}`);
    const chevron = document.getElementById(`threatChevron-${id}`);
    if (!detailRow) return;

    if (this._openThreatIds.has(id)) {
      this._openThreatIds.delete(id);
      detailRow.style.display = 'none';
      if (chevron) chevron.className = 'bi bi-chevron-right text-muted';
    } else {
      this._openThreatIds.add(id);
      detailRow.style.display = 'table-row';
      if (chevron) chevron.className = 'bi bi-chevron-down text-primary';
    }
  },

  renderThreatFeed() {
    const tbody = document.getElementById('tmThreatsTableBody');
    const pagContainer = document.getElementById('tmThreatsPagination');
    const countBadge = document.getElementById('tmThreatCountBadge');

    if (!this._openThreatIds) this._openThreatIds = new Set();
    const perPage = this._threatsPerPage || 10;

    if (countBadge) {
      countBadge.textContent = `${this._allThreats.length} THREATS`;
    }

    if (!tbody) return;

    if (!this._filteredThreats || this._filteredThreats.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4"><i class="bi bi-shield-check text-success me-2"></i>No recent blocked attacks matching filter</td></tr>';
      if (pagContainer) pagContainer.innerHTML = '';
      return;
    }

    const totalPages = Math.ceil(this._filteredThreats.length / perPage) || 1;
    if (this._threatsPage > totalPages) this._threatsPage = totalPages;

    const start = (this._threatsPage - 1) * perPage;
    const end = start + perPage;
    const pageItems = this._filteredThreats.slice(start, end);

    tbody.innerHTML = pageItems.map(t => {
      const isOpen = this._openThreatIds.has(t.id);
      const chevronClass = isOpen ? 'bi bi-chevron-down text-primary' : 'bi bi-chevron-right text-muted';
      const detailDisplay = isOpen ? 'table-row' : 'none';

      return `
        <tr class="threat-main-row" onclick="WAFPage.toggleThreatDetail('${t.id}')" style="cursor:pointer; transition: background .15s;">
          <td style="text-align:center; padding-left:12px; width:32px;">
            <i class="bi ${chevronClass}" id="threatChevron-${t.id}" style="font-size:12px;"></i>
          </td>
          <td class="font-mono" style="font-weight:600; color:var(--text-primary); white-space:nowrap;">
            ${LP.escHtml(t.ip)}
          </td>
          <td style="white-space:nowrap;">
            <span class="badge bg-dark border border-secondary" style="font-size:9.5px; margin-right:4px;">${LP.escHtml(t.countryCode)}</span>
            ${LP.escHtml(t.countryName)}
          </td>
          <td>
            <span class="badge" style="background:rgba(255,255,255,0.08); font-size:10.5px; max-width:140px; text-overflow:ellipsis; overflow:hidden; display:inline-block; vertical-align:middle;" title="${LP.escHtml(t.target || '')}">
              ${LP.escHtml(t.target || t.category || 'Intrusion')}
            </span>
          </td>
          <td style="font-size:11px; color:var(--text-muted); white-space:nowrap;" title="${LP.escHtml(t.timestamp || '')}">
            ${this._formatThreatTime(t.timestamp || t.lastSeen)}
          </td>
          <td class="font-mono" style="font-weight:700;">${t.count}</td>
          <td>
            <span class="lp-badge lp-badge-danger" style="font-size:10px;"><span class="lp-badge-dot"></span>${LP.escHtml(t.action || 'BLOCKED')}</span>
          </td>
          <td style="text-align:right; white-space:nowrap;" onclick="event.stopPropagation()">
            <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="WAFPage.quickBlockIp('${LP.escHtml(t.ip)}')" style="font-size:11px; padding:2px 8px;" title="Permanent IP Block">
              <i class="bi bi-slash-circle me-1"></i> Block
            </button>
          </td>
        </tr>
        <tr id="threatDetail-${t.id}" class="threat-detail-row" style="display:${detailDisplay}; background:rgba(15,23,42,0.65); border-left:3px solid var(--danger-color, #ef4444);">
          <td colspan="8" style="padding:16px 20px;">
            <div class="row g-3" style="font-size:11.5px;">
              <div class="col-12 col-md-4">
                <div class="text-muted mb-1" style="font-size:10.5px; text-transform:uppercase; font-weight:600;"><i class="bi bi-clock me-1 text-info"></i> Timestamp</div>
                <div class="font-mono text-white">${this._formatFullTimestamp(t.timestamp || t.lastSeen)}</div>
                <div class="text-muted" style="font-size:10.5px;">Relative: ${this._formatThreatTime(t.timestamp || t.lastSeen)}</div>
              </div>
              <div class="col-12 col-md-4">
                <div class="text-muted mb-1" style="font-size:10.5px; text-transform:uppercase; font-weight:600;"><i class="bi bi-crosshair me-1 text-warning"></i> Target / Probe Path</div>
                <div class="font-mono text-warning" style="word-break:break-all;">${LP.escHtml(t.target || '/')}</div>
                <div class="text-muted" style="font-size:10.5px;">Category: ${LP.escHtml(t.category || 'Intrusion')}</div>
              </div>
              <div class="col-12 col-md-4">
                <div class="text-muted mb-1" style="font-size:10.5px; text-transform:uppercase; font-weight:600;"><i class="bi bi-geo-alt me-1 text-danger"></i> Geo Origin &amp; Location</div>
                <div class="text-white">${LP.escHtml(t.countryName)} (${LP.escHtml(t.countryCode)})</div>
                <div class="text-muted font-mono" style="font-size:10.5px;">Lat/Lng: ${t.lat}, ${t.lng}</div>
              </div>
              <div class="col-12 col-md-8">
                <div class="text-muted mb-1" style="font-size:10.5px; text-transform:uppercase; font-weight:600;"><i class="bi bi-laptop me-1 text-secondary"></i> Client User-Agent</div>
                <div class="font-mono" style="background:#090d16; padding:6px 10px; border-radius:6px; font-size:10.5px; color:#cbd5e1; border:1px solid rgba(255,255,255,0.08); word-break:break-all;">
                  ${LP.escHtml(t.userAgent || 'Unknown')}
                </div>
              </div>
              <div class="col-12 col-md-4">
                <div class="text-muted mb-1" style="font-size:10.5px; text-transform:uppercase; font-weight:600;"><i class="bi bi-shield-exclamation me-1 text-danger"></i> Block Reason</div>
                <div class="text-danger" style="font-weight:600;">${LP.escHtml(t.reason || 'Automated Intrusion Block')}</div>
                <div class="mt-2 d-flex gap-2">
                  <button class="btn-lp btn-lp-sm btn-lp-ghost text-info" onclick="navigator.clipboard.writeText('${LP.encJsArg(t.ip)}'); LP.toast('IP Copied to clipboard!', 'info');" style="font-size:11px; padding:3px 8px;">
                    <i class="bi bi-clipboard me-1"></i> Copy IP
                  </button>
                </div>
              </div>
              ${t.payload ? `
              <div class="col-12">
                <div class="text-muted mb-1" style="font-size:10.5px; text-transform:uppercase; font-weight:600;"><i class="bi bi-file-earmark-code me-1 text-info"></i> Payload / Request Fragment</div>
                <pre class="font-mono mb-0" style="background:#090d16; padding:8px 12px; border-radius:6px; font-size:11px; color:#f87171; border:1px solid rgba(255,255,255,0.08); overflow-x:auto;">${LP.escHtml(t.payload)}</pre>
              </div>` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');

    if (pagContainer) {
      if (totalPages > 1) {
        pagContainer.innerHTML = `
          <div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
            <span class="text-muted" style="font-size:11.5px;">
              Showing <strong>${start + 1}</strong> to <strong>${Math.min(end, this._filteredThreats.length)}</strong> of <strong>${this._filteredThreats.length}</strong> attacks
            </span>
            <div class="btn-group" style="gap:4px;">
              <button class="btn-lp btn-lp-sm btn-lp-ghost" ${this._threatsPage === 1 ? 'disabled' : ''} onclick="WAFPage.changeThreatsPage(${this._threatsPage - 1})">
                <i class="bi bi-chevron-left me-1"></i> Prev
              </button>
              <span class="btn-lp btn-lp-sm btn-lp-ghost" style="pointer-events:none; font-weight:600;">
                Page ${this._threatsPage} / ${totalPages}
              </span>
              <button class="btn-lp btn-lp-sm btn-lp-ghost" ${this._threatsPage === totalPages ? 'disabled' : ''} onclick="WAFPage.changeThreatsPage(${this._threatsPage + 1})">
                Next <i class="bi bi-chevron-right ms-1"></i>
              </button>
            </div>
          </div>
        `;
      } else {
        pagContainer.innerHTML = `
          <div class="text-muted" style="font-size:11px;">
            Showing all <strong>${this._filteredThreats.length}</strong> recorded attack events
          </div>
        `;
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
  },

  // ── CrowdSec Community Shield Logic ───────────────────────────

  async loadCrowdSec() {
    const tbody = document.getElementById('crowdsecDecisionsTableBody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">Loading CrowdSec decisions...</td></tr>';

    try {
      const [statusRes, decisionsRes] = await Promise.all([
        LP.get('/waf/crowdsec/status'),
        LP.get('/waf/crowdsec/decisions'),
      ]);

      if (statusRes?.success && statusRes.data) {
        const s = statusRes.data;
        const statusBadge = document.getElementById('csStatusBadge');
        if (statusBadge) {
          statusBadge.textContent = s.running ? 'ACTIVE' : 'STOPPED';
          statusBadge.style.color = s.running ? 'var(--accent-success)' : 'var(--accent-danger)';
        }

        const countEl = document.getElementById('csCommunityCount');
        if (countEl) countEl.textContent = (s.communityBlocklistCount || 0).toLocaleString();

        const decEl = document.getElementById('csActiveDecisions');
        if (decEl) decEl.textContent = (s.activeDecisions || 0).toLocaleString();

        const bouncersEl = document.getElementById('csBouncersCount');
        if (bouncersEl && Array.isArray(s.bouncers)) {
          bouncersEl.textContent = `${s.bouncers.length} Active`;
        }
      }

      if (decisionsRes?.success && tbody) {
        const decisions = decisionsRes.data?.decisions || [];
        if (decisions.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">No active ban decisions</td></tr>';
          return;
        }

        tbody.innerHTML = decisions.map(d => `
          <tr>
            <td class="font-mono" style="font-weight:600; color:var(--text-primary);">${LP.escHtml(d.ip)}</td>
            <td><span class="lp-badge lp-badge-info" style="font-size:10px;">${LP.escHtml(d.origin)}</span></td>
            <td class="font-mono" style="font-size:11px;">${LP.escHtml(d.scenario)}</td>
            <td><span class="lp-badge lp-badge-warning" style="font-size:10px;">${LP.escHtml(d.duration)}</span></td>
            <td style="font-size:11px; color:var(--text-muted);">${new Date(d.createdAt).toLocaleString()}</td>
            <td style="text-align:right;">
              <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="WAFPage.deleteCrowdSecDecision('${LP.encJsArg(d.ip)}')" title="Unban IP">
                <i class="bi bi-trash"></i> Unban
              </button>
            </td>
          </tr>
        `).join('');
      }
    } catch (err) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="text-center py-3 text-danger">${LP.escHtml(err.message || 'Error loading CrowdSec')}</td></tr>`;
    }
  },

  showAddCrowdSecModal() {
    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('addCrowdSecModal'));
    modal.show();
  },

  async submitAddCrowdSec(e) {
    e.preventDefault();
    const ip = document.getElementById('csBanIp').value.trim();
    const duration = document.getElementById('csBanDuration').value;
    const reason = document.getElementById('csBanReason').value.trim();

    if (!ip) {
      LP.toast('IP is required', 'warning');
      return;
    }

    try {
      const res = await LP.post('/waf/crowdsec/decisions', { ip, duration, reason });
      if (res?.success) {
        LP.toast(`IP ${ip} banned via CrowdSec`, 'success');
        bootstrap.Modal.getInstance(document.getElementById('addCrowdSecModal')).hide();
        document.getElementById('addCrowdSecForm').reset();
        this.loadCrowdSec();
        this.loadRules();
      } else {
        LP.toast(res?.message || 'Failed to add CrowdSec ban', 'error');
      }
    } catch {
      LP.toast('Error adding CrowdSec decision', 'error');
    }
  },

  async deleteCrowdSecDecision(ip) {
    if (!(await LP.confirm(`Remove ban for IP ${ip}?`, 'Unban IP'))) return;
    try {
      const res = await LP.delete(`/waf/crowdsec/decisions/${encodeURIComponent(ip)}`);
      if (res?.success) {
        LP.toast(`IP ${ip} unbanned`, 'success');
        this.loadCrowdSec();
        this.loadRules();
      } else {
        LP.toast(res?.message || 'Failed to unban IP', 'error');
      }
    } catch {
      LP.toast('Error unbanning IP', 'error');
    }
  },

  async syncCrowdSec() {
    LP.toast('Syncing CrowdSec Hub & Community threat blocklists...', 'info');
    try {
      const res = await LP.post('/waf/crowdsec/sync', {});
      if (res?.success) {
        LP.toast(res?.message || 'CrowdSec Hub synchronized!', 'success');
        this.loadCrowdSec();
      } else {
        LP.toast(res?.message || 'Sync failed', 'error');
      }
    } catch (err) {
      LP.toast(err.message || 'Error syncing CrowdSec', 'error');
    }
  },

  // ── Honeypot Bot Trap Logic ───────────────────────────────────

  async loadHoneypot() {
    const tbody = document.getElementById('honeypotHitsTableBody');
    const pills = document.getElementById('honeypotTrapsPills');
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">Loading honeypot hits...</td></tr>';

    try {
      const res = await LP.get('/waf/honeypot/hits');
      if (res?.success && res.data) {
        const { hits, traps } = res.data;

        if (pills && Array.isArray(traps)) {
          pills.innerHTML = traps.map(t => `
            <span class="badge bg-dark border border-secondary font-mono" style="font-size:10.5px; padding:6px 10px;">
              <i class="bi bi-shield-lock-fill text-warning me-1"></i>${LP.escHtml(t)}
            </span>
          `).join('');
        }

        if (tbody) {
          if (!hits || hits.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">No bot attacks recorded yet. Traps are active and monitoring.</td></tr>';
            return;
          }

          tbody.innerHTML = hits.map(h => `
            <tr>
              <td class="font-mono" style="font-weight:600; color:var(--accent-danger);">${LP.escHtml(h.ip)}</td>
              <td class="font-mono" style="font-weight:600; color:#fff;">${LP.escHtml(h.path)}</td>
              <td style="font-size:11px; color:var(--text-muted); max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${LP.escHtml(h.user_agent || '')}">${LP.escHtml(h.user_agent || 'Unknown')}</td>
              <td><span class="lp-badge lp-badge-danger"><span class="lp-badge-dot"></span>AUTO-BANNED</span></td>
              <td style="font-size:11px; color:var(--text-muted);">${new Date(h.created_at).toLocaleString()}</td>
              <td style="text-align:right;">
                <button class="btn-lp btn-lp-ghost btn-lp-sm text-success" onclick="WAFPage.deleteCrowdSecDecision('${LP.encJsArg(h.ip)}')" title="Unban this IP">
                  <i class="bi bi-unlock"></i> Unban
                </button>
              </td>
            </tr>
          `).join('');
        }
      }
    } catch (err) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="text-center py-3 text-danger">${LP.escHtml(err.message || 'Error loading Honeypot data')}</td></tr>`;
    }
  },

  async clearHoneypotHits() {
    if (!(await LP.confirm('Clear all recorded honeypot hits history?', 'Clear Honeypot Logs'))) return;
    try {
      const res = await LP.post('/waf/honeypot/clear', {});
      if (res?.success) {
        LP.toast('Honeypot hits cleared', 'success');
        this.loadHoneypot();
      } else {
        LP.toast(res?.message || 'Failed to clear hits', 'error');
      }
    } catch {
      LP.toast('Error clearing honeypot hits', 'error');
    }
  },

  // ── 1-Click System Hardening ──────────────────────────────────

  async applyAutoHardening() {
    if (!(await LP.confirm('Apply 1-Click System Hardening? This will enforce UFW firewall defaults, activate Fail2Ban jails, synchronize CrowdSec blocklists, and activate all WAF Core Rule Sets.', '1-Click Auto-Harden'))) return;

    LP.toast('Applying security hardening across firewall, fail2ban, and WAF CRS...', 'info');
    try {
      const res = await LP.post('/waf/harden', {});
      if (res?.success) {
        LP.toast('System security hardened successfully!', 'success');
        await this.scanSecurity();
        await this.loadRules();
      } else {
        LP.toast(res?.message || 'Failed to harden system', 'error');
      }
    } catch (err) {
      LP.toast(err.message || 'Error applying hardening', 'error');
    }
  }
};

// [FIX] Expose to window for LP.call() resolution
window.WAFPage = WAFPage;

document.addEventListener('DOMContentLoaded', () => {
  WAFPage.init();
});

