/**
 * Panelku — ai-repair.js
 * AI Auto-Repair & Intelligent Assistant
 * Fase 18: Diagnostics, log analysis, auto-fix, predictive alerts
 */

const AIRepairPage = {
  fixPatterns: [],

  async init() {
    await LP.init();
    await this.loadConfig();
    await this.loadFixPatterns();
    this.runDiagnostic();
  },

  // ── Tab Switching ────────────────────────────────────
  switchTab(tabId) {
    document.querySelectorAll('.air-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.air-tab-content').forEach(t => t.classList.remove('active'));
    const btn = document.querySelector(`.air-tab[data-tab="${tabId}"]`);
    if (btn) btn.classList.add('active');
    const content = document.getElementById(`tab-${tabId}`);
    if (content) content.classList.add('active');
  },

  // ── Config ───────────────────────────────────────────
  async loadConfig() {
    try {
      const res = await LP.get('/ai-repair/config');
      if (res?.success) {
        const d = res.data;
        document.getElementById('airProvider').value = d.provider || 'openai';
        document.getElementById('airModel').value = d.model || '';
        document.getElementById('airAutoFix').checked = d.autoFixEnabled !== false;
        document.getElementById('airPredictive').checked = d.predictiveAlerts !== false;
        document.getElementById('airNotifyFix').checked = d.notifyOnFix !== false;

        const badge = document.getElementById('airConfigBadge');
        if (d.hasApiKey) {
          badge.innerHTML = '<i class="bi bi-wifi me-1"></i>AI: Connected';
          badge.className = 'lp-badge lp-badge-success';
        } else {
          badge.innerHTML = '<i class="bi bi-wifi-off me-1"></i>AI: Not configured';
          badge.className = 'lp-badge lp-badge-ghost';
        }
      }
    } catch { /* ignore */ }
  },

  async saveConfig() {
    const data = {
      provider: document.getElementById('airProvider').value,
      model: document.getElementById('airModel').value.trim(),
      apiKey: document.getElementById('airApiKey').value.trim(),
      autoFixEnabled: document.getElementById('airAutoFix').checked,
      predictiveAlerts: document.getElementById('airPredictive').checked,
      notifyOnFix: document.getElementById('airNotifyFix').checked,
    };

    try {
      const res = await LP.post('/ai-repair/config', data);
      if (res?.success) {
        LP.toast(res.message || 'Configuration saved!', 'success');
        await this.loadConfig();
      } else {
        LP.toast(res?.message || 'Failed to save config', 'error');
      }
    } catch { LP.toast('Error saving config', 'error'); }
  },

  // ── Diagnostics ──────────────────────────────────────
  async runDiagnostic() {
    const container = document.getElementById('diagnosticContent');
    container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted);"><div class="spinner-border spinner-border-sm text-primary me-2"></div>Running full system diagnostic...</div>';

    try {
      const [diagRes, healthRes] = await Promise.all([
        LP.get('/ai-repair/diagnostic'),
        LP.get('/ai-repair/health-score'),
      ]);

      // Update health score cards
      if (healthRes?.success) {
        const h = healthRes.data;
        const score = h.score || 0;
        const ring = document.getElementById('healthScoreRing');
        const colors = score >= 90 ? '#10b981' : (score >= 70 ? '#f59e0b' : (score >= 50 ? '#f97316' : '#ef4444'));
        ring.textContent = score;
        ring.style.color = colors;
        ring.style.background = colors + '20';
        document.getElementById('healthScoreLevel').textContent = h.level || '—';
        document.getElementById('healthIssues').textContent = h.issues || '0';
        document.getElementById('healthServicesDown').textContent = h.servicesDown || '0';
        document.getElementById('healthRecs').textContent = h.recommendations || '0';
      }

      // Render diagnostic results
      if (diagRes?.success) {
        this._renderDiagnostic(diagRes.data);
      } else {
        container.innerHTML = '<div style="color:var(--accent-danger);">Diagnostic failed</div>';
      }
    } catch {
      container.innerHTML = '<div style="color:var(--accent-danger);">Error running diagnostic</div>';
    }
  },

  _renderDiagnostic(data) {
    const container = document.getElementById('diagnosticContent');
    const issueColors = { critical: 'danger', high: 'warning', medium: 'info', low: 'secondary' };

    container.innerHTML = `
      <div class="row g-3">
        <div class="col-12 col-md-6">
          <h6 style="font-size:13px;font-weight:600;margin-bottom:10px;">
            <i class="bi bi-server text-primary me-1"></i> Services (${data.services?.length || 0})
          </h6>
          <div style="max-height:250px;overflow-y:auto;">
            ${(data.services || []).map(s => `
              <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:12px;">
                <span style="color:var(--text-primary);">${s.name}</span>
                <span class="lp-badge lp-badge-${s.status === 'running' ? 'success' : (s.status === 'stopped' ? 'danger' : 'secondary')}" style="font-size:9px;">${s.status}</span>
              </div>
            `).join('') || '<div style="color:var(--text-muted);">No service data</div>'}
          </div>
        </div>
        <div class="col-12 col-md-6">
          <h6 style="font-size:13px;font-weight:600;margin-bottom:10px;">
            <i class="bi bi-activity text-info me-1"></i> Resources
          </h6>
          ${data.resources ? `
            <div style="margin-bottom:8px;">
              <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:2px;">
                <span style="color:var(--text-secondary);">CPU</span><span style="color:${data.resources.cpu > 90 ? '#ef4444' : '#10b981'};font-family:monospace;">${data.resources.cpu || 0}%</span>
              </div>
              <div class="progress" style="height:6px;background:rgba(0,0,0,0.2);">
                <div class="progress-bar ${data.resources.cpu > 90 ? 'bg-danger' : 'bg-success'}" style="width:${Math.min(data.resources.cpu || 0, 100)}%"></div>
              </div>
            </div>
            <div style="margin-bottom:8px;">
              <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:2px;">
                <span style="color:var(--text-secondary);">RAM</span><span style="color:${data.resources.ram > 90 ? '#ef4444' : '#10b981'};font-family:monospace;">${data.resources.ram || 0}%</span>
              </div>
              <div class="progress" style="height:6px;background:rgba(0,0,0,0.2);">
                <div class="progress-bar ${data.resources.ram > 90 ? 'bg-danger' : 'bg-success'}" style="width:${Math.min(data.resources.ram || 0, 100)}%"></div>
              </div>
            </div>
            <div style="margin-bottom:8px;">
              <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:2px;">
                <span style="color:var(--text-secondary);">Disk</span><span style="color:${data.resources.disk > 90 ? '#ef4444' : '#10b981'};font-family:monospace;">${data.resources.disk || 0}%</span>
              </div>
              <div class="progress" style="height:6px;background:rgba(0,0,0,0.2);">
                <div class="progress-bar ${data.resources.disk > 90 ? 'bg-danger' : 'bg-success'}" style="width:${Math.min(data.resources.disk || 0, 100)}%"></div>
              </div>
            </div>
          ` : '<div style="color:var(--text-muted);">No resource data</div>'}
        </div>
        <div class="col-12">
          <h6 style="font-size:13px;font-weight:600;margin-bottom:8px;">
            <i class="bi bi-exclamation-triangle text-warning me-1"></i> Issues Found
          </h6>
          ${(data.issues || []).length === 0
            ? '<div style="font-size:12px;color:var(--text-muted);padding:8px 0;">No issues detected. System is healthy.</div>'
            : data.issues.map(i => `
              <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:12px;">
                <span style="color:var(--text-primary);">
                  <span class="lp-badge lp-badge-${issueColors[i.severity] || 'secondary'}" style="font-size:8px;text-transform:uppercase;margin-right:8px;">${i.severity}</span>
                  ${i.name || i.type}${i.value ? ` (${i.value}%)` : ''}
                </span>
              </div>
            `).join('')
          }
        </div>
        ${(data.recommendations || []).length > 0 ? `
          <div class="col-12">
            <h6 style="font-size:13px;font-weight:600;margin-bottom:8px;">
              <i class="bi bi-lightbulb text-warning me-1"></i> Recommendations
            </h6>
            ${data.recommendations.map(r => `
              <div style="font-size:12px;color:var(--text-secondary);padding:4px 0;">• ${r}</div>
            `).join('')}
          </div>
        ` : ''}
        <div class="col-12">
          <button class="btn-lp btn-lp-ghost btn-sm" onclick="AIRepairPage.runDiagnostic()">
            <i class="bi bi-arrow-clockwise me-1"></i> Refresh Diagnostic
          </button>
        </div>
      </div>
    `;
  },

  // ── Log Analysis ─────────────────────────────────────
  async analyzeLog() {
    const log = document.getElementById('logInput').value.trim();
    if (!log) { LP.toast('Please paste log content first', 'error'); return; }

    const resultEl = document.getElementById('analysisResult');
    const outputEl = document.getElementById('analysisOutput');
    resultEl.style.display = 'block';
    outputEl.innerHTML = '<div class="spinner-border spinner-border-sm text-primary me-2"></div>Analyzing...';

    try {
      const res = await LP.post('/ai-repair/analyze', { log, lines: 200 });
      if (res?.success) {
        const d = res.data;
        let html = '';

        // Issues
        if (d.issues?.length > 0) {
          html += '<div style="margin-bottom:10px;"><strong>🔍 Detected Issues:</strong></div>';
          d.issues.forEach(i => {
            html += `<div style="padding:4px 0;font-size:12px;">• <span style="color:${i.severity === 'critical' ? '#ef4444' : (i.severity === 'high' ? '#f59e0b' : '#3b82f6')};">[${i.severity}]</span> <strong>${i.name}</strong>${i.autoFixable ? ' <span class="lp-badge lp-badge-success" style="font-size:9px;">Auto-fixable</span>' : ''}</div>`;
            if (i.diagnosis) html += `<pre style="margin:4px 0 8px 16px;font-size:11px;color:var(--text-muted);">${LP.escapeHtml(i.diagnosis)}</pre>`;
          });
        }

        // Error counts
        if (d.errorCounts && Object.keys(d.errorCounts).length > 0) {
          html += '<div style="margin-top:10px;"><strong>📊 Error Patterns:</strong></div>';
          Object.entries(d.errorCounts).forEach(([name, count]) => {
            html += `<div style="padding:2px 0;font-size:12px;">• ${name}: <strong>${count}</strong> occurrences</div>`;
          });
        }

        // AI analysis
        if (d.aiAnalysis) {
          html += `<div style="margin-top:12px;padding:10px;background:rgba(99,102,241,0.08);border-radius:8px;font-size:12px;line-height:1.6;">${this._formatAIResponse(d.aiAnalysis)}</div>`;
        }

        // Summary
        html += `<div style="margin-top:10px;font-size:12px;color:var(--text-muted);">${d.summary || ''}</div>`;

        outputEl.innerHTML = html || 'No analysis results';
      } else {
        outputEl.textContent = 'Analysis failed: ' + (res?.message || 'Unknown error');
      }
    } catch (err) {
      outputEl.textContent = 'Error analyzing log: ' + err.message;
    }
  },

  async suggestFix() {
    const log = document.getElementById('logInput').value.trim();
    if (!log) { LP.toast('Please paste log content first', 'error'); return; }

    const resultEl = document.getElementById('analysisResult');
    const outputEl = document.getElementById('analysisOutput');
    resultEl.style.display = 'block';
    outputEl.innerHTML = '<div class="spinner-border spinner-border-sm text-primary me-2"></div>Analyzing for fix suggestions...';

    try {
      const res = await LP.post('/ai-repair/suggest-fix', { log });
      if (res?.success) {
        const d = res.data;
        let html = '';

        if (d.matched) {
          html += `<div style="margin-bottom:8px;"><span class="lp-badge lp-badge-${d.severity === 'critical' ? 'danger' : (d.severity === 'high' ? 'warning' : 'info')}" style="font-size:10px;">${d.severity || 'info'}</span> <strong>${d.name || 'Issue Detected'}</strong></div>`;
          if (d.diagnosis) html += `<pre style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">${LP.escapeHtml(d.diagnosis)}</pre>`;
          if (d.aiAnalysis) html += `<div style="padding:10px;background:rgba(99,102,241,0.08);border-radius:8px;font-size:12px;">${this._formatAIResponse(d.aiAnalysis)}</div>`;
          html += `<div style="margin-top:10px;font-size:12px;">${d.message || ''}</div>`;
          if (d.autoFixable) {
            html += `<button class="btn-lp btn-lp-primary btn-sm mt-2" onclick="AIRepairPage.runFix('${d.fixId}')"><i class="bi bi-wrench me-1"></i> Apply Fix</button>`;
          }
        } else {
          html = `<div style="color:var(--text-muted);">${d.message || 'No matching fix found'}</div>`;
        }

        outputEl.innerHTML = html;
      }
    } catch { outputEl.textContent = 'Error getting fix suggestion'; }
  },

  // ── Auto-Fix ─────────────────────────────────────────
  async loadFixPatterns() {
    try {
      const res = await LP.get('/ai-repair/fix-patterns');
      if (res?.success) {
        this.fixPatterns = res.data || [];
        this._renderFixPatterns();
      }
    } catch { /* ignore */ }
  },

  _renderFixPatterns() {
    const container = document.getElementById('fixPatternsContainer');
    const sevColors = { critical: 'danger', high: 'warning', medium: 'info' };
    container.innerHTML = (this.fixPatterns || []).map(p => `
      <div class="col-md-6">
        <div class="lp-glass-card" style="padding:14px;border-left:3px solid ${p.severity === 'critical' ? '#ef4444' : (p.severity === 'high' ? '#f59e0b' : '#3b82f6')};">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
            <div style="font-weight:600;font-size:13px;color:var(--text-primary);">${p.name}</div>
            <span class="lp-badge lp-badge-${sevColors[p.severity] || 'secondary'}" style="font-size:8px;text-transform:uppercase;">${p.severity}</span>
          </div>
          <div style="font-size:11px;color:var(--text-secondary);margin-bottom:8px;">${p.description}</div>
          <button class="btn-lp btn-lp-ghost btn-lp-sm" onclick="AIRepairPage.runFix('${p.id}')" style="font-size:11px;">
            <i class="bi bi-wrench me-1"></i> Apply Fix Now
          </button>
        </div>
      </div>
    `).join('') || '<div style="color:var(--text-muted);">No fix patterns available</div>';
  },

  async runFix(fixId) {
    const fixParams = {};
    const pattern = (this.fixPatterns || []).find(p => p.id === fixId);

    // Ask for params based on fix type
    if (fixId === 'port.conflict') {
      const port = prompt('Enter the port number to resolve conflict:', '8080');
      if (!port) return;
      fixParams.port = port;
    } else if (fixId === 'service.down') {
      const service = prompt('Enter the service name to restart:', 'nginx');
      if (!service) return;
      fixParams.service = service;
    } else if (fixId === 'permission.denied') {
      const path = prompt('Enter the directory path to fix permissions:', '/var/www');
      if (!path) return;
      fixParams.path = path;
    }

    if (!(await LP.confirm(`Apply auto-fix for "${pattern?.name || fixId}"? This may restart services or kill processes.`, 'Confirm Auto-Fix'))) return;

    const resultArea = document.getElementById('fixResultArea');
    const outputEl = document.getElementById('fixResultOutput');
    resultArea.style.display = 'block';
    outputEl.textContent = 'Applying fix...';

    try {
      const res = await LP.post('/ai-repair/apply-fix', { fixId, ...fixParams });
      if (res?.success) {
        outputEl.textContent = res.data?.result || res.message || 'Fix applied';
        if (res.data?.diagnosis) outputEl.textContent = `Diagnosis:\n${res.data.diagnosis}\n\nResult:\n${res.data.result || res.message}`;
        LP.toast('Fix applied successfully!', 'success');
      } else {
        outputEl.textContent = 'Failed: ' + (res?.message || 'Unknown error');
        LP.toast(res?.message || 'Fix failed', 'error');
      }
    } catch (err) {
      outputEl.textContent = 'Error: ' + err.message;
      LP.toast('Error applying fix', 'error');
    }
  },

  // ── Nginx Test ───────────────────────────────────────
  async loadNginxTest() {
    document.getElementById('logInput').value = '';
    document.getElementById('logInput').placeholder = 'Running nginx config test...';

    try {
      // Get nginx test output
      const _res = await fetch('/api/system/services/manage', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${LP.state.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ service: 'nginx', action: 'status' }),
      });
      document.getElementById('logInput').placeholder = 'Paste your log content here...';
      document.getElementById('logInput').value = 'Run: nginx -t in the Terminal to test Nginx configuration.\nPaste the output here for AI analysis.';
      LP.toast('Please run "nginx -t" in Terminal and paste the output', 'info');
    } catch { /* ignore */ }
  },

  // ── Trends ───────────────────────────────────────────
  async loadTrends() {
    const hours = document.getElementById('trendPeriod').value;
    const container = document.getElementById('trendsContent');
    container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted);"><div class="spinner-border spinner-border-sm text-primary me-2"></div>Analyzing trends...</div>';

    try {
      const res = await LP.get(`/ai-repair/trends?hours=${hours}`);
      if (res?.success) {
        this._renderTrends(res.data);
      } else {
        container.innerHTML = '<div style="color:var(--accent-danger);">Failed to load trends</div>';
      }
    } catch {
      container.innerHTML = '<div style="color:var(--accent-danger);">Error loading trends</div>';
    }
  },

  _renderTrends(data) {
    const container = document.getElementById('trendsContent');
    const trendIcon = (t) => t === 'increasing' ? '<i class="bi bi-arrow-up trend-up"></i>' : (t === 'decreasing' ? '<i class="bi bi-arrow-down trend-down"></i>' : '<i class="bi bi-dash-lg trend-stable"></i>');

    container.innerHTML = `
      <div class="row g-3">
        <div class="col-12 col-md-4">
          <div class="lp-glass-card" style="padding:16px;text-align:center;">
            <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;">CPU ${data.cpu.trend ? trendIcon(data.cpu.trend) : ''}</div>
            <div style="font-size:28px;font-weight:700;color:var(--text-primary);font-family:monospace;">${Math.round(data.cpu.current || 0)}%</div>
            <div style="font-size:11px;color:var(--text-muted);">Avg: ${Math.round(data.cpu.average || 0)}% · ${data.cpu.samples || 0} points</div>
            ${data.cpu.prediction ? `<div style="font-size:11px;color:${data.cpu.trend === 'increasing' ? '#ef4444' : '#10b981'};margin-top:6px;">${data.cpu.prediction}</div>` : ''}
          </div>
        </div>
        <div class="col-12 col-md-4">
          <div class="lp-glass-card" style="padding:16px;text-align:center;">
            <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;">RAM ${data.ram.trend ? trendIcon(data.ram.trend) : ''}</div>
            <div style="font-size:28px;font-weight:700;color:var(--text-primary);font-family:monospace;">${Math.round(data.ram.current || 0)}%</div>
            <div style="font-size:11px;color:var(--text-muted);">Avg: ${Math.round(data.ram.average || 0)}% · ${data.ram.samples || 0} points</div>
            ${data.ram.prediction ? `<div style="font-size:11px;color:${data.ram.trend === 'increasing' ? '#ef4444' : '#10b981'};margin-top:6px;">${data.ram.prediction}</div>` : ''}
          </div>
        </div>
        <div class="col-12 col-md-4">
          <div class="lp-glass-card" style="padding:16px;text-align:center;">
            <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;">Disk ${data.disk.trend ? trendIcon(data.disk.trend) : ''}</div>
            <div style="font-size:28px;font-weight:700;color:var(--text-primary);font-family:monospace;">${Math.round(data.disk.current || 0)}%</div>
            <div style="font-size:11px;color:var(--text-muted);">Avg: ${Math.round(data.disk.average || 0)}% · ${data.disk.samples || 0} points</div>
            ${data.disk.prediction ? `<div style="font-size:11px;color:${data.disk.trend === 'increasing' ? '#ef4444' : '#10b981'};margin-top:6px;">${data.disk.prediction}</div>` : ''}
          </div>
        </div>
        ${(data.warnings || []).length > 0 ? `
          <div class="col-12">
            <div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:8px;padding:12px;">
              <div style="font-weight:600;font-size:13px;color:#ef4444;margin-bottom:6px;"><i class="bi bi-exclamation-triangle me-1"></i> Alerts</div>
              ${data.warnings.map(w => `<div style="font-size:12px;color:var(--text-secondary);padding:2px 0;">• ${w}</div>`).join('')}
            </div>
          </div>
        ` : ''}
        ${(data.recommendations || []).length > 0 ? `
          <div class="col-12">
            <div style="background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2);border-radius:8px;padding:12px;">
              <div style="font-weight:600;font-size:13px;color:#3b82f6;margin-bottom:6px;"><i class="bi bi-lightbulb me-1"></i> Recommendations</div>
              ${data.recommendations.map(r => `<div style="font-size:12px;color:var(--text-secondary);padding:2px 0;">• ${r}</div>`).join('')}
            </div>
          </div>
        ` : ''}
        ${data.aiAssessment ? `
          <div class="col-12">
            <div style="background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2);border-radius:8px;padding:12px;">
              <div style="font-weight:600;font-size:13px;color:#6366f1;margin-bottom:6px;"><i class="bi bi-robot me-1"></i> AI Assessment</div>
              <div style="font-size:12px;color:var(--text-secondary);line-height:1.6;">${this._formatAIResponse(data.aiAssessment)}</div>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  },

  // ── Helpers ──────────────────────────────────────────
  _formatAIResponse(text) {
    if (!text) return '';
    let out = LP.escapeHtml(text);
    out = out.replace(/###\s(.+)/g, '<strong>$1</strong>');
    out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/`([^`]+)`/g, '<code style="background:rgba(0,0,0,0.2);padding:1px 4px;border-radius:3px;font-size:11px;">$1</code>');
    out = out.replace(/\n/g, '<br>');
    return out;
  },
};

document.addEventListener('DOMContentLoaded', () => AIRepairPage.init());
