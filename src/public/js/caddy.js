/**
 * Panelku — caddy.js
 * Caddy Server Manager frontend
 */

const CaddyPage = {
  createSiteBsModal: null,
  siteConfigBsModal: null,

  async init() {
    await LP.init();
    if (!LP.state.accessToken) return;

    this.createSiteBsModal = new bootstrap.Modal(document.getElementById('createSiteModal'));
    this.siteConfigBsModal = new bootstrap.Modal(document.getElementById('siteConfigModal'));
    this.refresh();
  },

  async refresh() {
    try {
      const res = await LP.get('/caddy/status');
      if (!res?.success) {
        this._showNotInstalled();
        return;
      }
      const { status } = res.data;
      if (!status.installed) {
        this._showNotInstalled();
        return;
      }
      this._showInstalled(status);
      await Promise.all([
        this.loadSites(),
        this.loadCaddyfile(),
        this.loadLogs(),
        this.loadCertificates(),
      ]);
    } catch {
      this._showNotInstalled();
    }
  },

  _showNotInstalled() {
    document.getElementById('caddyNotInstalled').style.display = 'block';
    document.getElementById('caddyContent').style.display = 'none';
  },

  _showInstalled(status) {
    document.getElementById('caddyNotInstalled').style.display = 'none';
    document.getElementById('caddyContent').style.display = 'block';

    const statusEl = document.getElementById('caddyStatusValue');
    if (status.running) {
      statusEl.innerHTML = '<span style="color:#10b981;"><span class="spinner-grow spinner-grow-sm me-1" style="width:8px;height:8px;"></span> Running</span>';
    } else {
      statusEl.innerHTML = '<span style="color:#ef4444;"><span class="spinner-grow spinner-grow-sm me-1" style="width:8px;height:8px;"></span> Stopped</span>';
    }

    document.getElementById('caddyVersionValue').textContent = status.version || 'N/A';
    document.getElementById('caddySitesValue').textContent = (status.loadedSites || 0) + ' served';
    document.getElementById('caddyPortsValue').textContent = (status.listeningPorts || []).join(', ') || 'N/A';

    document.getElementById('ciBinary').textContent = status.binary || 'N/A';
    document.getElementById('ciAdminApi').textContent = status.adminApiAvailable ? 'Connected' : 'Unavailable';
    document.getElementById('ciPid').textContent = status.pid || 'N/A';
    document.getElementById('ciPorts').textContent = (status.listeningPorts || []).join(', ') || 'N/A';
    document.getElementById('ciModules').textContent = (status.modules?.length || 0) + ' loaded';
  },

  // ── Tab Switching ────────────────────────────────────

  switchTab(tabId) {
    document.querySelectorAll('.caddy-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.caddy-tab-content').forEach(t => t.classList.remove('active'));

    const tabBtn = document.querySelector(`.caddy-tab[data-tab="${tabId}"]`);
    if (tabBtn) tabBtn.classList.add('active');

    const tabContent = document.getElementById(`tab-${tabId}`);
    if (tabContent) tabContent.classList.add('active');
  },

  // ── Install ──────────────────────────────────────────

  async installCaddy() {
    if (!(await LP.confirm('Install Caddy web server? This may take a few minutes.', 'Install Caddy'))) return;

    const btn = document.querySelector('#caddyNotInstalled .btn-lp-primary');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Installing...'; }

    try {
      const res = await LP.post('/caddy/install');
      if (res?.success) {
        LP.toast('Caddy installed successfully!', 'success');
        this.refresh();
      } else {
        LP.toast(res?.message || 'Installation failed', 'error');
      }
    } catch (err) {
      LP.toast('Error installing Caddy: ' + err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-download me-2"></i> Install Caddy'; }
    }
  },

  async uninstallCaddy() {
    if (!(await LP.confirm('Uninstall Caddy? This will remove the binary but keep config files.', 'Uninstall Caddy'))) return;

    try {
      const res = await LP.post('/caddy/uninstall');
      if (res?.success) {
        LP.toast('Caddy uninstalled', 'success');
        this.refresh();
      } else {
        LP.toast(res?.message || 'Uninstall failed', 'error');
      }
    } catch (err) {
      LP.toast('Error uninstalling Caddy: ' + err.message, 'error');
    }
  },

  // ── Service Control ──────────────────────────────────

  async serviceAction(action) {
    try {
      const res = await LP.post('/caddy/service', { action });
      if (res?.success) {
        LP.toast(`Caddy ${action}ed successfully`, 'success');
        this.refresh();
      } else {
        LP.toast(res?.message || `Failed to ${action} Caddy`, 'error');
      }
    } catch {
      LP.toast(`Error ${action} Caddy`, 'error');
    }
  },

  // ── Sites ────────────────────────────────────────────

  async loadSites() {
    try {
      const res = await LP.get('/caddy/sites');
      if (!res?.success) throw new Error(res?.message);

      const sites = res.data?.sites || [];
      const tbody = document.getElementById('sitesTableBody');

      if (sites.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--text-muted);font-size:13px;">No sites configured. Click "Add Site" to create one.</td></tr>';
        return;
      }

      tbody.innerHTML = sites.map(s => {
        const typeColors = { static: 'info', proxy: 'primary', php: 'success', redirect: 'warning', 'file-server': 'purple' };
        const typeColor = typeColors[s.type] || 'secondary';
        const typeIcon = s.type === 'proxy' ? 'bi-arrow-left-right' : (s.type === 'php' ? 'bi-filetype-php' : (s.type === 'redirect' ? 'bi-arrow-right' : 'bi-globe2'));

        const target = s.proxyTarget || s.rootDir || '—';
        const httpsLabel = s.domain.includes('*') ? 'Wildcard' : 'Auto HTTPS';

        return `<tr>
          <td><strong style="color:var(--text-primary);">${LP.escapeHtml(s.domain)}</strong></td>
          <td><span class="lp-badge lp-badge-${typeColor}"><i class="bi ${typeIcon} me-1"></i>${s.type}</span></td>
          <td style="font-size:12px;color:var(--text-secondary);font-family:monospace;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${LP.escapeHtml(target)}">${LP.escapeHtml(target)}</td>
          <td><span class="lp-badge lp-badge-success"><i class="bi bi-lock-fill me-1"></i>${httpsLabel}</span></td>
          <td style="text-align:right;white-space:nowrap;">
            <button class="btn-lp btn-lp-ghost btn-lp-sm text-info" onclick="CaddyPage.viewSiteConfig('${LP.encJsArg(s.name)}')" title="View Config"><i class="bi bi-file-earmark-text"></i></button>
            <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="CaddyPage.deleteSite('${LP.encJsArg(s.name)}')" title="Delete"><i class="bi bi-trash"></i></button>
          </td>
        </tr>`;
      }).join('');
    } catch {
      document.getElementById('sitesTableBody').innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--accent-danger);">Failed to load sites</td></tr>';
    }
  },

  filterSites() {
    const query = document.getElementById('siteFilterInput').value.toLowerCase();
    document.querySelectorAll('#sitesTableBody tr').forEach(row => {
      row.style.display = row.textContent.toLowerCase().includes(query) ? '' : 'none';
    });
  },

  showCreateSiteModal() {
    document.getElementById('csDomain').value = '';
    document.getElementById('csName').value = '';
    document.getElementById('csType').value = 'static';
    document.getElementById('csRootDir').value = '';
    document.getElementById('csPort').value = '8080';
    document.getElementById('csPhpSocket').value = '/var/run/php/php8.2-fpm.sock';
    document.getElementById('csRedirectTarget').value = 'https://{http.request.host}{http.request.uri}';
    document.getElementById('csRedirectCode').value = '301';
    document.getElementById('csAuthUser').value = '';
    document.getElementById('csAuthPass').value = '';
    this.toggleCreateSiteFields();
    this.createSiteBsModal.show();
  },

  toggleCreateSiteFields() {
    const type = document.getElementById('csType').value;
    document.getElementById('csRootGroup').style.display = (type !== 'proxy' && type !== 'redirect') ? 'block' : 'none';
    document.getElementById('csPortGroup').style.display = type === 'proxy' ? 'block' : 'none';
    document.getElementById('csPhpGroup').style.display = type === 'php' ? 'block' : 'none';
    document.getElementById('csRedirectGroup').style.display = type === 'redirect' ? 'block' : 'none';
    document.getElementById('csAuthGroup').style.display = type === 'file-server' ? 'block' : 'none';
  },

  async createSite() {
    const domain = document.getElementById('csDomain').value.trim();
    if (!domain) { LP.toast('Domain is required', 'error'); return; }

    const data = {
      domain,
      name: document.getElementById('csName').value.trim() || undefined,
      type: document.getElementById('csType').value,
      rootDir: document.getElementById('csRootDir').value.trim() || undefined,
      port: parseInt(document.getElementById('csPort').value) || 8080,
      phpSocket: document.getElementById('csPhpSocket').value.trim() || undefined,
      redirectTarget: document.getElementById('csRedirectTarget').value.trim() || undefined,
      redirectCode: document.getElementById('csRedirectCode').value,
    };

    if (document.getElementById('csAuthUser').value.trim()) {
      data.basicAuthUser = document.getElementById('csAuthUser').value.trim();
      data.basicAuthPass = document.getElementById('csAuthPass').value.trim() || 'password';
    }

    try {
      const res = await LP.post('/caddy/sites', data);
      if (res?.success) {
        LP.toast('Site created successfully!', 'success');
        this.createSiteBsModal.hide();
        this.loadSites();
      } else {
        LP.toast(res?.message || 'Failed to create site', 'error');
      }
    } catch (err) {
      LP.toast('Error creating site: ' + err.message, 'error');
    }
  },

  async viewSiteConfig(name) {
    document.getElementById('siteConfigTitle').textContent = name;
    document.getElementById('siteConfigContent').textContent = 'Loading...';
    this.siteConfigBsModal.show();

    try {
      const res = await LP.get(`/caddy/sites/${encodeURIComponent(name)}`);
      if (res?.success && res.data?.site) {
        document.getElementById('siteConfigTitle').textContent = name;
        document.getElementById('siteConfigContent').textContent = res.data.site.content || 'No content';
      } else {
        document.getElementById('siteConfigContent').textContent = 'Failed to load site config';
      }
    } catch {
      document.getElementById('siteConfigContent').textContent = 'Error loading site config';
    }
  },

  async deleteSite(name) {
    if (!(await LP.confirm(`Delete site "${name}"? This will remove the Caddy config file.`, 'Delete Site'))) return;

    try {
      const res = await LP.del(`/caddy/sites/${encodeURIComponent(name)}`);
      if (res?.success) {
        LP.toast('Site deleted', 'success');
        this.loadSites();
      } else {
        LP.toast(res?.message || 'Failed to delete site', 'error');
      }
    } catch {
      LP.toast('Error deleting site', 'error');
    }
  },

  // ── Caddyfile ────────────────────────────────────────

  async loadCaddyfile() {
    try {
      const res = await LP.get('/caddy/caddyfile');
      if (res?.success && res.data?.caddyfile) {
        const cf = res.data.caddyfile;
        document.getElementById('caddyfilePath').textContent = cf.path || '/etc/caddy/Caddyfile';
        document.getElementById('caddyfileEditor').value = cf.content || '';
      }
    } catch {
      document.getElementById('caddyfilePath').textContent = 'Failed to load Caddyfile';
    }
  },

  async saveCaddyfile() {
    const content = document.getElementById('caddyfileEditor').value;
    if (!content) { LP.toast('Caddyfile content is empty', 'error'); return; }

    const btn = document.querySelector('#tab-caddyfile .btn-lp-primary');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Saving...'; }

    try {
      const res = await LP.put('/caddy/caddyfile', { content });
      if (res?.success) {
        LP.toast('Caddyfile saved and validated!', 'success');
        document.getElementById('caddyfileValidationResult').style.display = 'block';
        document.getElementById('caddyfileValidationResult').style.background = 'rgba(16,185,129,0.1)';
        document.getElementById('caddyfileValidationResult').style.color = '#10b981';
        document.getElementById('caddyfileValidationResult').style.border = '1px solid rgba(16,185,129,0.3)';
        document.getElementById('caddyfileValidationResult').textContent = '✅ Caddyfile saved and validated successfully.';
      } else {
        LP.toast(res?.message || 'Failed to save Caddyfile', 'error');
      }
    } catch (err) {
      LP.toast('Error saving Caddyfile: ' + err.message, 'error');
      document.getElementById('caddyfileValidationResult').style.display = 'block';
      document.getElementById('caddyfileValidationResult').style.background = 'rgba(239,68,68,0.1)';
      document.getElementById('caddyfileValidationResult').style.color = '#ef4444';
      document.getElementById('caddyfileValidationResult').style.border = '1px solid rgba(239,68,68,0.3)';
      document.getElementById('caddyfileValidationResult').textContent = '❌ ' + err.message;
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-floppy me-1"></i> Save'; }
    }
  },

  async formatCaddyfile() {
    try {
      const res = await LP.post('/caddy/caddyfile/format');
      if (res?.success && res.data?.content) {
        document.getElementById('caddyfileEditor').value = res.data.content;
        LP.toast('Caddyfile formatted', 'success');
      } else {
        LP.toast(res?.message || 'Format failed', 'error');
      }
    } catch {
      LP.toast('Error formatting Caddyfile', 'error');
    }
  },

  async validateConfig() {
    try {
      const res = await LP.get('/caddy/validate');
      if (res?.success) {
        const isValid = res.data?.valid;
        LP.toast(res.data?.message || (isValid ? 'Configuration is valid' : 'Configuration has errors'), isValid ? 'success' : 'error');
        document.getElementById('caddyfileValidationResult').style.display = 'block';
        document.getElementById('caddyfileValidationResult').style.background = isValid ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)';
        document.getElementById('caddyfileValidationResult').style.color = isValid ? '#10b981' : '#ef4444';
        document.getElementById('caddyfileValidationResult').style.border = isValid ? '1px solid rgba(16,185,129,0.3)' : '1px solid rgba(239,68,68,0.3)';
        document.getElementById('caddyfileValidationResult').textContent = res.data?.output || (isValid ? '✅ Valid' : '❌ Invalid');
      } else {
        LP.toast(res?.message || 'Validation failed', 'error');
      }
    } catch {
      LP.toast('Validation error', 'error');
    }
  },

  // ── Certificates ─────────────────────────────────────

  async loadCertificates() {
    try {
      const res = await LP.get('/caddy/certificates');
      const container = document.getElementById('certsContainer');

      if (!res?.success || !res.data?.certificates || res.data.certificates.length === 0) {
        container.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-muted);background:rgba(0,0,0,0.1);border-radius:10px;"><i class="bi bi-patch-check" style="font-size:32px;display:block;margin-bottom:8px;"></i>No certificates yet. Certificates are automatically provisioned when a site is accessed via HTTPS.</div>';
        return;
      }

      container.innerHTML = res.data.certificates.map(c =>
        `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.04);">
          <div>
            <span style="font-weight:600;color:var(--text-primary);">${LP.escapeHtml(c.domain)}</span>
            <span style="font-size:11px;color:var(--text-muted);margin-left:10px;">${c.fileCount} file(s)</span>
          </div>
          <span class="lp-badge lp-badge-success"><i class="bi bi-lock-fill me-1"></i> Auto</span>
        </div>`
      ).join('');
    } catch {
      document.getElementById('certsContainer').innerHTML = '<div style="padding:20px;color:var(--accent-danger);">Failed to load certificates</div>';
    }
  },

  // ── Logs ─────────────────────────────────────────────

  async loadLogs() {
    const type = document.getElementById('logTypeSelect').value;
    const area = document.getElementById('logOutputArea');
    const pathEl = document.getElementById('logFilePath');

    area.textContent = 'Loading logs...';
    pathEl.textContent = '';

    try {
      const res = await LP.get(`/caddy/logs?type=${type}&lines=100`);
      if (res?.success) {
        pathEl.textContent = res.data.logFile || '';
        area.textContent = (res.data.lines || []).map(l =>
          l.toLowerCase().includes('error') || l.toLowerCase().includes('panic')
            ? `⚠️ ${l}` : l
        ).join('\n') || '(empty log)';
      } else {
        area.textContent = 'Failed to load logs: ' + (res?.message || 'Unknown error');
      }
    } catch {
      area.textContent = 'Failed to load logs. Caddy logs may not be available on this system.';
    }
  },
};

document.addEventListener('DOMContentLoaded', () => {
  CaddyPage.init();
});
