/**
 * Panelku — vulnerabilities.js (v3.8.0)
 * Client-side Controller for Vulnerability Scanner & AI Remediation Engine
 */

const VulnerabilitiesPage = {
  activeCategory: 'all',
  activeStatus: 'open',
  searchQuery: '',
  findings: [],
  selectedFindingForFix: null,
  selectedFindingForAI: null,
  remediateModalInstance: null,
  aiModalInstance: null,

  async init() {
    if (typeof LP !== 'undefined') {
      await LP.init();
    }
    this.initModals();
    this.bindEvents();
    await this.loadSummary();
    await this.loadFindings();
  },

  initModals() {
    const remEl = document.getElementById('modalRemediateConfirm');
    if (remEl && typeof bootstrap !== 'undefined') {
      this.remediateModalInstance = new bootstrap.Modal(remEl);
    }
    const aiEl = document.getElementById('modalAskAI');
    if (aiEl && typeof bootstrap !== 'undefined') {
      this.aiModalInstance = new bootstrap.Modal(aiEl);
    }
  },

  bindEvents() {
    // Scan triggers
    const scanTypes = [
      { id: 'actScanFull', type: 'full' },
      { id: 'actScanOS', type: 'os' },
      { id: 'actScanApps', type: 'apps' },
      { id: 'actScanWebsites', type: 'websites' },
      { id: 'actScanPlugins', type: 'plugins' },
    ];
    scanTypes.forEach(({ id, type }) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('click', (e) => {
          e.preventDefault();
          this.startScan(type);
        });
      }
    });

    // Export button
    const btnExp = document.getElementById('btnExportReport');
    if (btnExp) {
      btnExp.addEventListener('click', () => {
        window.open('/api/vulnerabilities/export?format=markdown', '_blank');
      });
    }

    // General Ask AI
    const btnAskGen = document.getElementById('btnAskGeneralAI');
    if (btnAskGen) {
      btnAskGen.addEventListener('click', () => {
        this.openAIModal(null);
      });
    }

    // Filter tabs
    const tabs = document.querySelectorAll('#vulnFilterTabs .vuln-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.activeCategory = tab.getAttribute('data-cat') || 'all';
        this.applyFilter();
      });
    });

    // Status filter
    const statusSelect = document.getElementById('vulnStatusFilter');
    if (statusSelect) {
      statusSelect.addEventListener('change', () => {
        this.activeStatus = statusSelect.value;
        this.loadFindings();
      });
    }

    // Search input
    const searchInput = document.getElementById('vulnSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value.toLowerCase().trim();
        this.applyFilter();
      });
    }

    // Remediation consent checkbox
    const chkConsent = document.getElementById('chkRemediateConsent');
    const btnExec = document.getElementById('btnExecuteRemediation');
    if (chkConsent && btnExec) {
      chkConsent.addEventListener('change', () => {
        btnExec.disabled = !chkConsent.checked;
      });
      btnExec.addEventListener('click', () => {
        this.executeRemediation();
      });
    }

    // AI Q&A
    const btnSendAI = document.getElementById('btnSendAIQuestion');
    const inputAI = document.getElementById('aiQuestionInput');
    if (btnSendAI && inputAI) {
      btnSendAI.addEventListener('click', () => {
        const q = inputAI.value.trim();
        if (q) this.sendAIQuestion(q);
      });
      inputAI.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const q = inputAI.value.trim();
          if (q) this.sendAIQuestion(q);
        }
      });
    }

    // AI Presets
    document.querySelectorAll('.ai-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const q = btn.getAttribute('data-q');
        if (q) {
          const input = document.getElementById('aiQuestionInput');
          if (input) input.value = q;
          this.sendAIQuestion(q);
        }
      });
    });

    // Event delegation on findings container
    const container = document.getElementById('findingsContainer');
    if (container) {
      container.addEventListener('click', (e) => {
        // Copy button
        const copyBtn = e.target.closest('.btn-copy-command');
        if (copyBtn) {
          const rawCmd = copyBtn.getAttribute('data-cmd');
          if (rawCmd) this.copyToClipboard(rawCmd, copyBtn);
          return;
        }

        // Remediate button
        const remBtn = e.target.closest('.btn-auto-remediate');
        if (remBtn) {
          const findingId = remBtn.getAttribute('data-id');
          if (findingId) this.openRemediateModal(findingId);
          return;
        }

        // Ask AI button
        const aiBtn = e.target.closest('.btn-ask-finding-ai');
        if (aiBtn) {
          const findingId = aiBtn.getAttribute('data-id');
          if (findingId) this.openAIModal(findingId);
          return;
        }

        // Ignore button
        const ignBtn = e.target.closest('.btn-ignore-finding');
        if (ignBtn) {
          const findingId = ignBtn.getAttribute('data-id');
          if (findingId && confirm('Apakah Anda yakin ingin mengabaikan kerentanan ini?')) {
            this.ignoreFinding(findingId);
          }
          return;
        }
      });
    }
  },

  async loadSummary() {
    try {
      const res = await LP.get('/vulnerabilities/summary');
      if (res?.success && res.data) {
        const d = res.data;
        const score = d.score !== undefined ? d.score : 100;
        const rating = d.rating || { grade: 'A', label: 'Aman', color: '#10b981' };

        // Circle score
        const circle = document.getElementById('scoreCircle');
        if (circle) {
          circle.textContent = score;
          circle.style.borderColor = rating.color;
          circle.style.color = rating.color;
          circle.style.boxShadow = `0 0 20px ${rating.color}33`;
          circle.style.background = `${rating.color}14`;
        }

        // Badge & description
        const badge = document.getElementById('scoreRatingBadge');
        if (badge) {
          badge.textContent = `${rating.grade} - ${rating.label}`;
          badge.style.background = `${rating.color}22`;
          badge.style.color = rating.color;
          badge.style.border = `1px solid ${rating.color}44`;
        }

        const scoreDesc = document.getElementById('scoreStatusDesc');
        if (scoreDesc) {
          scoreDesc.textContent = score >= 80 ? 'Infrastruktur Terlindungi Baik' : (score >= 60 ? 'Perlu Dilakukan Perbaikan' : 'Risiko Tinggi Terdeteksi');
        }

        const lastScanDesc = document.getElementById('lastScanTimeDesc');
        if (lastScanDesc) {
          if (d.lastScan && d.lastScan.completedAt) {
            const dt = new Date(d.lastScan.completedAt);
            lastScanDesc.textContent = `Terakhir: ${dt.toLocaleDateString()} ${dt.toLocaleTimeString()}`;
          } else {
            lastScanDesc.textContent = 'Belum pernah dipindai';
          }
        }

        // Counts
        const c = d.counts || {};
        const elCrit = document.getElementById('countCritical');
        if (elCrit) elCrit.textContent = c.critical || 0;
        const elHigh = document.getElementById('countHigh');
        if (elHigh) elHigh.textContent = c.high || 0;
        const elMed = document.getElementById('countMedium');
        if (elMed) elMed.textContent = c.medium || 0;
        const elFixed = document.getElementById('countFixed');
        if (elFixed) elFixed.textContent = c.fixed || 0;
      }
    } catch (err) {
      console.error('Failed to load vulnerability summary:', err);
    }
  },

  async loadFindings() {
    const container = document.getElementById('findingsContainer');
    if (!container) return;

    container.innerHTML = `
      <div style="text-align: center; padding: 40px; color: var(--text-muted);">
        <div class="spinner-border spinner-border-sm text-primary me-2"></div>
        Memuat daftar temuan...
      </div>
    `;

    try {
      const params = new URLSearchParams();
      if (this.activeStatus !== 'all') params.append('status', this.activeStatus);

      const res = await LP.get(`/vulnerabilities/findings?${params.toString()}`);
      if (res?.success) {
        this.findings = res.data || [];
        this.applyFilter();
      } else {
        container.innerHTML = `<div class="lp-card p-4 text-center text-muted">Gagal memuat temuan kerentanan.</div>`;
      }
    } catch (err) {
      container.innerHTML = `<div class="lp-card p-4 text-center text-muted">Error memuat data: ${err.message}</div>`;
    }
  },

  applyFilter() {
    const container = document.getElementById('findingsContainer');
    if (!container) return;

    let filtered = this.findings;

    if (this.activeCategory !== 'all') {
      filtered = filtered.filter(f => f.category === this.activeCategory);
    }

    if (this.searchQuery) {
      filtered = filtered.filter(f => {
        const text = `${f.title || ''} ${f.cve_id || ''} ${f.component || ''} ${f.description || ''}`.toLowerCase();
        return text.includes(this.searchQuery);
      });
    }

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="lp-card p-5 text-center" style="background: rgba(20, 25, 45, 0.4); border: 1px dashed var(--glass-border);">
          <i class="bi bi-shield-check text-success" style="font-size: 48px; display: block; margin-bottom: 12px;"></i>
          <h5 style="color: #fff; font-weight: 700; margin-bottom: 6px;">Tidak Ditemukan Kerentanan</h5>
          <p style="color: var(--text-muted); font-size: 13px; max-width: 480px; margin: 0 auto;">
            Kategori ini tidak memiliki temuan aktif dengan filter saat ini. Jalankan scan berkala untuk menjaga sistem tetap terlindungi.
          </p>
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map(f => this.renderFindingCard(f)).join('');
  },

  renderFindingCard(f) {
    const sevColors = {
      critical: { bg: 'rgba(239, 68, 68, 0.1)', text: '#ef4444', border: '#ef4444' },
      high: { bg: 'rgba(249, 115, 22, 0.1)', text: '#f97316', border: '#f97316' },
      medium: { bg: 'rgba(234, 179, 8, 0.1)', text: '#eab308', border: '#eab308' },
      low: { bg: 'rgba(59, 130, 246, 0.1)', text: '#3b82f6', border: '#3b82f6' },
    };
    const c = sevColors[f.severity] || sevColors.low;

    const isFixed = f.status === 'fixed';
    const isIgnored = f.status === 'ignored';

    return `
      <div class="lp-card p-3 p-md-4" style="background: rgba(18, 23, 40, 0.7); border: 1px solid var(--glass-border); border-left: 4px solid ${isFixed ? '#10b981' : c.border}; position: relative;">
        <!-- Top Row: Badges & Status -->
        <div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-2">
          <div class="d-flex align-items-center gap-2 flex-wrap">
            <span class="lp-badge" style="background: ${c.bg}; color: ${c.text}; border: 1px solid ${c.border}55; font-weight: 700;">
              ${f.severity.toUpperCase()}
            </span>
            ${f.cve_id ? `
              <span class="lp-badge lp-badge-ghost" style="font-family: monospace; font-size: 11px;">
                <i class="bi bi-tag-fill me-1"></i>${f.cve_id}
              </span>
            ` : ''}
            ${f.cvss_score ? `
              <span class="lp-badge" style="background: rgba(255,255,255,0.06); color: #cbd5e1; font-size: 11px;">
                CVSS ${f.cvss_score}
              </span>
            ` : ''}
            <span class="lp-badge lp-badge-ghost" style="font-size: 11px; text-transform: uppercase;">
              <i class="bi bi-folder-fill me-1"></i>${f.category}
            </span>
          </div>

          <div>
            ${isFixed ? `
              <span class="lp-badge lp-badge-success"><i class="bi bi-check-all me-1"></i>Telah Diperbaiki</span>
            ` : (isIgnored ? `
              <span class="lp-badge lp-badge-ghost"><i class="bi bi-eye-slash me-1"></i>Diabaikan</span>
            ` : `
              <span class="lp-badge lp-badge-danger"><i class="bi bi-exclamation-circle-fill me-1"></i>Open</span>
            `)}
          </div>
        </div>

        <!-- Title & Affected Component -->
        <h5 style="color: #fff; font-weight: 700; margin: 4px 0 6px;">${f.title}</h5>
        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">
          <i class="bi bi-hdd-network me-1"></i>Komponen Terpengaruh: <strong style="color: #e2e8f0;">${f.component}</strong>
          ${f.installed_version ? ` &bull; Versi terdeteksi: <span style="font-family: monospace; color: #cbd5e1;">${f.installed_version}</span>` : ''}
          ${f.fixed_version ? ` &bull; Versi aman: <span style="font-family: monospace; color: #10b981;">${f.fixed_version}</span>` : ''}
        </div>

        <!-- Description & Impact -->
        <div style="font-size: 13px; color: #cbd5e1; line-height: 1.5; margin-bottom: 8px;">
          ${f.description}
        </div>
        ${f.impact ? `
          <div style="font-size: 12px; color: #f87171; background: rgba(239, 68, 68, 0.06); padding: 8px 12px; border-radius: 6px; margin-bottom: 14px; border: 1px solid rgba(239, 68, 68, 0.15);">
            <strong><i class="bi bi-shield-x me-1"></i>Potensi Dampak:</strong> ${f.impact}
          </div>
        ` : ''}

        <!-- Manual Remediation Command Box -->
        <div style="margin-bottom: 14px;">
          <div class="d-flex justify-content-between align-items-center mb-1">
            <span style="font-size: 11px; text-transform: uppercase; font-weight: 600; color: var(--text-muted); letter-spacing: 0.5px;">
              <i class="bi bi-terminal me-1"></i>Langkah Perbaikan Manual (Terminal)
            </span>
            <button class="lp-btn lp-btn-sm lp-btn-ghost btn-copy-command d-flex align-items-center gap-1" data-cmd="${this.escapeHtml(f.manual_steps)}" style="font-size: 11px; padding: 2px 8px;">
              <i class="bi bi-clipboard"></i> Salin Perintah
            </button>
          </div>
          <pre style="background: #090d16; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 6px; padding: 12px; color: #34d399; font-family: 'Fira Code', monospace; font-size: 12px; overflow-x: auto; margin: 0; white-space: pre-wrap;">${this.escapeHtml(f.manual_steps)}</pre>
        </div>

        <!-- Action Bar -->
        <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 pt-2" style="border-top: 1px solid rgba(255, 255, 255, 0.06);">
          <div class="d-flex align-items-center gap-2">
            ${!isFixed && f.auto_fix_command ? `
              <button class="lp-btn lp-btn-sm lp-btn-primary btn-auto-remediate d-flex align-items-center gap-1" data-id="${f.id}">
                <i class="bi bi-magic"></i> Perbaiki Otomatis
                <span class="lp-badge" style="font-size: 9px; padding: 1px 5px; background: rgba(255,255,255,0.2);">
                  ${f.auto_fix_safe ? 'Safe' : 'Caution'}
                </span>
              </button>
            ` : ''}

            <button class="lp-btn lp-btn-sm lp-btn-ghost btn-ask-finding-ai d-flex align-items-center gap-1" data-id="${f.id}">
              <i class="bi bi-robot text-primary"></i> Tanya AI
            </button>
          </div>

          <div>
            ${!isFixed && !isIgnored ? `
              <button class="lp-btn lp-btn-sm lp-btn-ghost text-muted btn-ignore-finding" data-id="${f.id}" title="Abaikan temuan ini">
                <i class="bi bi-eye-slash"></i> Abaikan
              </button>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  },

  async startScan(type = 'full') {
    const btnText = document.getElementById('scanBtnText');
    const origText = btnText ? btnText.textContent : 'Jalankan Scan';
    if (btnText) btnText.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Scanning...';

    LP.toast(`Memulai pemindaian kerentanan (${type.toUpperCase()})...`, 'info');

    try {
      const res = await LP.post('/vulnerabilities/scan', { type });
      if (res?.success) {
        LP.toast(res.message || 'Pemindaian selesai!', 'success');
        await this.loadSummary();
        await this.loadFindings();
      } else {
        LP.toast(res?.message || 'Pemindaian gagal', 'error');
      }
    } catch (err) {
      LP.toast(`Gagal menjalankan scan: ${err.message}`, 'error');
    } finally {
      if (btnText) btnText.textContent = origText;
    }
  },

  openRemediateModal(findingId) {
    const finding = this.findings.find(f => f.id === findingId);
    if (!finding) return;

    this.selectedFindingForFix = finding;

    const titleEl = document.getElementById('modalTargetTitle');
    const metaEl = document.getElementById('modalTargetMeta');
    const cmdEl = document.getElementById('modalTargetCommand');
    const safeEl = document.getElementById('modalTargetSafety');
    const chk = document.getElementById('chkRemediateConsent');
    const btnExec = document.getElementById('btnExecuteRemediation');

    if (titleEl) titleEl.textContent = finding.title;
    if (metaEl) metaEl.textContent = `${finding.cve_id || 'ID N/A'} • Komponen: ${finding.component} (${finding.severity.toUpperCase()})`;
    if (cmdEl) cmdEl.textContent = finding.auto_fix_command || '# Perintah otomatis tidak tersedia';
    if (safeEl) {
      safeEl.textContent = finding.auto_fix_safe ? 'Safe Automated Fix' : 'Requires Service Reload';
      safeEl.className = finding.auto_fix_safe ? 'lp-badge lp-badge-success' : 'lp-badge lp-badge-warning';
    }

    if (chk) chk.checked = false;
    if (btnExec) btnExec.disabled = true;

    if (this.remediateModalInstance) {
      this.remediateModalInstance.show();
    }
  },

  async executeRemediation() {
    if (!this.selectedFindingForFix) return;

    const btnExec = document.getElementById('btnExecuteRemediation');
    if (btnExec) {
      btnExec.disabled = true;
      btnExec.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Menerapkan Perbaikan...';
    }

    try {
      const res = await LP.post(`/vulnerabilities/remediate/${this.selectedFindingForFix.id}`, { confirmed: true });
      if (res?.success) {
        LP.toast(res.message || 'Perbaikan berhasil diterapkan!', 'success');
        if (this.remediateModalInstance) {
          this.remediateModalInstance.hide();
        }
        await this.loadSummary();
        await this.loadFindings();
      } else {
        LP.toast(res?.message || 'Gagal menerapkan perbaikan', 'error');
      }
    } catch (err) {
      LP.toast(`Gagal eksekusi: ${err.message}`, 'error');
    } finally {
      if (btnExec) {
        btnExec.disabled = false;
        btnExec.innerHTML = '<i class="bi bi-play-circle-fill"></i> Eksekusi Perbaikan Sekarang';
      }
    }
  },

  openAIModal(findingId) {
    const finding = findingId ? this.findings.find(f => f.id === findingId) : null;
    this.selectedFindingForAI = finding;

    const ctxCard = document.getElementById('aiContextCard');
    const ctxText = document.getElementById('aiContextText');
    const respArea = document.getElementById('aiResponseArea');
    const qInput = document.getElementById('aiQuestionInput');

    if (finding) {
      if (ctxCard) ctxCard.style.display = 'block';
      if (ctxText) ctxText.textContent = `${finding.title} (${finding.cve_id || 'ID'}) - Severity: ${finding.severity.toUpperCase()}`;
    } else {
      if (ctxCard) ctxCard.style.display = 'none';
    }

    if (respArea) {
      respArea.innerHTML = `
        <div style="color: var(--text-muted); text-align: center; margin-top: 40px;">
          Silakan ajukan pertanyaan atau pilih salah satu tombol pertanyaan cepat di atas.
        </div>
      `;
    }
    if (qInput) qInput.value = '';

    if (this.aiModalInstance) {
      this.aiModalInstance.show();
    }
  },

  async sendAIQuestion(question) {
    const respArea = document.getElementById('aiResponseArea');
    const qInput = document.getElementById('aiQuestionInput');
    const btnSend = document.getElementById('btnSendAIQuestion');

    if (respArea) {
      respArea.innerHTML = `
        <div class="mb-3">
          <strong style="color: #60a5fa;">Pertanyaan Anda:</strong>
          <div style="color: #fff; margin-top: 4px;">${this.escapeHtml(question)}</div>
        </div>
        <hr style="border-color: rgba(255,255,255,0.1);">
        <div style="color: var(--text-muted);">
          <span class="spinner-border spinner-border-sm text-primary me-2"></span>
          AI Copilot sedang menganalisis kerentanan dan menyusun rekomendasi...
        </div>
      `;
    }

    if (btnSend) btnSend.disabled = true;

    try {
      const payload = {
        question,
        context: {
          finding: this.selectedFindingForAI,
        },
      };

      const res = await LP.post('/vulnerabilities/ask-ai', payload);
      if (res?.success && res.data?.answer) {
        const formatted = this.formatMarkdown(res.data.answer);
        if (respArea) {
          respArea.innerHTML = `
            <div class="mb-3">
              <strong style="color: #60a5fa;">Pertanyaan:</strong>
              <div style="color: #fff; margin-top: 2px;">${this.escapeHtml(question)}</div>
            </div>
            <hr style="border-color: rgba(255,255,255,0.1);">
            <div>${formatted}</div>
          `;
        }
      } else {
        if (respArea) respArea.innerHTML = '<div class="text-danger">Gagal menerima jawaban dari AI Copilot.</div>';
      }
    } catch (err) {
      if (respArea) respArea.innerHTML = `<div class="text-danger">Error: ${err.message}</div>`;
    } finally {
      if (btnSend) btnSend.disabled = false;
      if (qInput) qInput.value = '';
    }
  },

  async ignoreFinding(findingId) {
    try {
      const res = await LP.post(`/vulnerabilities/ignore/${findingId}`);
      if (res?.success) {
        LP.toast('Temuan telah diabaikan.', 'success');
        await this.loadSummary();
        await this.loadFindings();
      }
    } catch (err) {
      LP.toast(`Gagal mengabaikan: ${err.message}`, 'error');
    }
  },

  copyToClipboard(text, btnElement) {
    navigator.clipboard.writeText(text).then(() => {
      const origHtml = btnElement.innerHTML;
      btnElement.innerHTML = '<i class="bi bi-check2 text-success"></i> Tersalin!';
      setTimeout(() => {
        btnElement.innerHTML = origHtml;
      }, 2000);
      LP.toast('Perintah berhasil disalin ke clipboard!', 'success');
    }).catch(() => {
      LP.toast('Gagal menyalin perintah', 'error');
    });
  },

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  formatMarkdown(text) {
    if (!text) return '';
    let out = this.escapeHtml(text);

    // Code blocks
    out = out.replace(/```(?:bash|sh)?\n([\s\S]*?)```/g, (m, code) => {
      return `<pre style="background:#050810; padding:10px; border-radius:6px; color:#10b981; font-family:monospace; margin:8px 0; overflow-x:auto;">${code.trim()}</pre>`;
    });

    // Inline code
    out = out.replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.08); padding:2px 5px; border-radius:4px; color:#93c5fd;">$1</code>');

    // Headers
    out = out.replace(/^### (.*$)/gim, '<h6 style="color:#fff; font-weight:700; margin-top:14px;">$1</h6>');
    out = out.replace(/^## (.*$)/gim, '<h5 style="color:#fff; font-weight:700; margin-top:16px;">$1</h5>');

    // Bold
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Line breaks
    out = out.replace(/\n/g, '<br>');

    return out;
  },
};

window.VulnerabilitiesPage = VulnerabilitiesPage;

