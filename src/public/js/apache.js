/**
 * Panelku — apache.js
 * Apache Manager frontend
 */

const ApachePage = {
  createVhostBsModal: null,

  async init() {
    await LP.init();
    if (!LP.state.accessToken) return;

    this.createVhostBsModal = new bootstrap.Modal(document.getElementById('createVhostModal'));
    this.refresh();
  },

  async refresh() {
    // First check install status
    try {
      const res = await LP.get('/apache/status');
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
        this.loadVhosts(),
        this.loadModules(),
        this.loadConfig(),
        this.loadLogs(),
      ]);
    } catch {
      this._showNotInstalled();
    }
  },

  _showNotInstalled() {
    document.getElementById('apacheNotInstalled').style.display = 'block';
    document.getElementById('apacheContent').style.display = 'none';
  },

  _showInstalled(status) {
    document.getElementById('apacheNotInstalled').style.display = 'none';
    document.getElementById('apacheContent').style.display = 'block';

    // Status cards
    const statusEl = document.getElementById('apacheStatusValue');
    if (status.running) {
      statusEl.innerHTML = '<span style="color:#10b981;"><span class="spinner-grow spinner-grow-sm me-1" style="width:8px;height:8px;"></span> Running</span>';
    } else {
      statusEl.innerHTML = '<span style="color:#ef4444;"><span class="spinner-grow spinner-grow-sm me-1" style="width:8px;height:8px;"></span> Stopped</span>';
    }

    document.getElementById('apacheVersionValue').textContent = status.version || 'N/A';
    document.getElementById('apacheModulesValue').textContent = `${status.loadedModulesCount || 0} loaded`;
    document.getElementById('apachePortsValue').textContent = (status.listeningPorts || []).join(', ') || 'N/A';

    // Info table
    document.getElementById('aiBinary').textContent = status.binary || 'N/A';
    document.getElementById('aiService').textContent = status.service || 'N/A';
    document.getElementById('aiPid').textContent = status.pid || 'N/A';
    document.getElementById('aiPorts').textContent = (status.listeningPorts || []).join(', ') || 'N/A';
  },

  // ── Tab Switching ────────────────────────────────────

  switchTab(tabId) {
    document.querySelectorAll('.apache-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.apache-tab-content').forEach(t => t.classList.remove('active'));

    const tabBtn = document.querySelector(`.apache-tab[data-tab="${tabId}"]`);
    if (tabBtn) tabBtn.classList.add('active');

    const tabContent = document.getElementById(`tab-${tabId}`);
    if (tabContent) tabContent.classList.add('active');
  },

  // ── Install ──────────────────────────────────────────

  async installApache() {
    if (!(await LP.confirm('Install Apache web server? This may take a few minutes.', 'Install Apache'))) return;

    const btn = document.querySelector('#apacheNotInstalled .btn-lp-primary');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Installing...';
    }

    try {
      const res = await LP.post('/apache/install');
      if (res?.success) {
        LP.toast('Apache installed successfully!', 'success');
        this.refresh();
      } else {
        LP.toast(res?.message || 'Installation failed', 'error');
      }
    } catch (err) {
      LP.toast('Error installing Apache: ' + err.message, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-download me-2"></i> Install Apache';
      }
    }
  },

  // ── Service Control ──────────────────────────────────

  async serviceAction(action) {
    try {
      const res = await LP.post('/apache/service', { action });
      if (res?.success) {
        LP.toast(`Apache ${action}ed successfully`, 'success');
        this.refresh();
      } else {
        LP.toast(res?.message || `Failed to ${action} Apache`, 'error');
      }
    } catch {
      LP.toast(`Error ${action} Apache`, 'error');
    }
  },

  async testConfig() {
    try {
      const res = await LP.get('/apache/configtest');
      if (res?.success) {
        const isValid = res.data?.valid;
        LP.toast(res.message || (isValid ? 'Config syntax OK!' : 'Config has errors'), isValid ? 'success' : 'error');
        if (!isValid && res.data?.output) {
          // Configtest output available in res.data.output
        }
      }
    } catch {
      LP.toast('Config test error', 'error');
    }
  },

  // ── Virtual Hosts ────────────────────────────────────

  async loadVhosts() {
    try {
      const res = await LP.get('/apache/vhosts');
      if (!res?.success) throw new Error(res?.message);

      const vhosts = res.data?.vhosts || [];
      const tbody = document.getElementById('vhostsTableBody');

      if (vhosts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--text-muted);font-size:13px;">No virtual hosts configured. Click "Add Vhost" to create one.</td></tr>';
        return;
      }

      tbody.innerHTML = vhosts.map(v => {
        const typeLabel = v.ssl ? 'SSL' : (v.php ? 'PHP' : (v.proxyTarget ? 'Proxy' : 'Static'));
        const typeIcon = v.ssl ? 'bi-shield-lock' : (v.php ? 'bi-filetype-php' : (v.proxyTarget ? 'bi-arrow-left-right' : 'bi-file-earmark'));
        return `
          <tr>
            <td>
              <div style="font-weight:600;color:var(--text-primary);">
                <a href="http://${LP.escHtml(v.serverName)}" target="_blank" style="color:inherit;text-decoration:none">
                  ${LP.escHtml(v.serverName)} <i class="bi bi-box-arrow-up-right" style="font-size:10px;color:var(--text-muted)"></i>
                </a>
              </div>
              ${v.aliases && v.aliases.length ? `<div style="font-size:11px;color:var(--text-muted)">${LP.escHtml(v.aliases.join(', '))}</div>` : ''}
            </td>
            <td>
              <span class="lp-badge" style="background:rgba(0,0,0,0.2);border:1px solid var(--border-color);font-size:11px;">
                <i class="${typeIcon} me-1"></i> ${typeLabel} :${v.port || 80}
              </span>
            </td>
            <td class="font-mono" style="font-size:12px;color:var(--text-muted);max-width:250px;overflow:hidden;text-overflow:ellipsis;">
              ${LP.escHtml(v.documentRoot || '—')}
            </td>
            <td>
              <span class="lp-badge ${v.enabled ? 'lp-badge-success' : 'lp-badge-warning'}" style="cursor:pointer;" onclick="ApachePage.toggleVhost('${LP.encJsArg(v.serverName)}', ${!v.enabled})">
                <span class="lp-badge-dot"></span> ${v.enabled ? 'Enabled' : 'Disabled'}
              </span>
            </td>
            <td style="text-align:right">
              <button class="btn-lp btn-lp-ghost btn-lp-sm text-info" onclick="ApachePage.viewVhostConfig('${LP.encJsArg(v.serverName)}')" title="View Config">
                <i class="bi bi-file-earmark-text"></i>
              </button>
              <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="ApachePage.deleteVhost('${LP.encJsArg(v.serverName)}')" title="Delete Vhost">
                <i class="bi bi-trash"></i>
              </button>
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      document.getElementById('vhostsTableBody').innerHTML =
        `<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--accent-danger);">Error: ${LP.escHtml(err.message)}</td></tr>`;
    }
  },

  showCreateVhostModal() {
    document.getElementById('cvServerName').value = '';
    document.getElementById('cvAliases').value = '';
    document.getElementById('cvRoot').value = '';
    document.getElementById('cvPort').value = '';
    document.getElementById('cvType').value = 'static';
    this.toggleCreateVhostFields();
    this.createVhostBsModal.show();
  },

  toggleCreateVhostFields() {
    const type = document.getElementById('cvType').value;
    document.getElementById('cvPortGroup').style.display = type === 'proxy' ? 'block' : 'none';
    document.getElementById('cvPhpGroup').style.display = type === 'php' ? 'block' : 'none';
    document.getElementById('cvSslGroup').style.display = type === 'ssl' ? 'block' : 'none';
  },

  async createVhost() {
    const serverName = document.getElementById('cvServerName').value.trim();
    if (!serverName) {
      LP.toast('Server name is required', 'error');
      return;
    }

    const aliasesStr = document.getElementById('cvAliases').value.trim();
    const aliases = aliasesStr ? aliasesStr.split(/\s+/).filter(Boolean) : [];
    const type = document.getElementById('cvType').value;
    const rootDirectory = document.getElementById('cvRoot').value.trim() || undefined;
    const port = document.getElementById('cvPort').value || undefined;
    const phpVersion = document.getElementById('cvPhpVersion').value;
    const sslCert = document.getElementById('cvSslCert').value.trim() || undefined;
    const sslKey = document.getElementById('cvSslKey').value.trim() || undefined;

    try {
      const res = await LP.post('/apache/vhosts', {
        serverName, aliases, type, rootDirectory, port, phpVersion, sslCert, sslKey,
      });
      if (res?.success) {
        LP.toast('Virtual host created and Apache reloaded', 'success');
        this.createVhostBsModal.hide();
        this.loadVhosts();
      } else {
        LP.toast(res?.message || 'Failed to create virtual host', 'error');
      }
    } catch (err) {
      LP.toast('Error creating virtual host: ' + err.message, 'error');
    }
  },

  async toggleVhost(name, enable) {
    try {
      const res = await LP.post('/apache/vhosts/toggle', { name, enable });
      if (res?.success) {
        LP.toast(res.message, 'success');
        this.loadVhosts();
      } else {
        LP.toast(res?.message || 'Failed to toggle vhost', 'error');
      }
    } catch {
      LP.toast('Error toggling vhost', 'error');
    }
  },

  async viewVhostConfig(name) {
    try {
      const res = await LP.get(`/apache/vhosts/${encodeURIComponent(name)}`);
      if (!res?.success) throw new Error(res?.message);

      const content = res.data?.vhost?.content || 'Config not found';
      LP.modal({
        title: `Vhost Config: ${LP.escHtml(name)}`,
        body: `<pre class="font-mono" style="background:#0a0a0f;color:#00ff88;padding:15px;border-radius:8px;font-size:11px;max-height:500px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;margin:0;">${LP.escHtml(content)}</pre>`,
        size: 'lg',
      });
    } catch (err) {
      LP.toast('Failed to load vhost config: ' + err.message, 'error');
    }
  },

  async deleteVhost(name) {
    if (!(await LP.confirm(`Delete vhost <strong>${LP.escHtml(name)}</strong>?<br><small class="text-muted">This will remove the Apache configuration and reload the server.</small>`, 'Delete Vhost'))) return;

    try {
      const res = await LP.del(`/apache/vhosts/${encodeURIComponent(name)}`);
      if (res?.success) {
        LP.toast('Vhost deleted', 'success');
        this.loadVhosts();
      } else {
        LP.toast(res?.message || 'Failed to delete vhost', 'error');
      }
    } catch {
      LP.toast('Error deleting vhost', 'error');
    }
  },

  // ── Logs ─────────────────────────────────────────────

  async loadLogs() {
    const vhost = document.getElementById('logVhostSelect').value;
    const type = document.getElementById('logTypeSelect').value;

    try {
      const qs = new URLSearchParams({ vhost: vhost || '', type, lines: 100 }).toString();
      const res = await LP.get(`/apache/logs?${qs}`);
      if (!res?.success) throw new Error(res?.message);

      const { logFile, lines } = res.data;
      document.getElementById('logFilePath').textContent = logFile || '';

      const output = document.getElementById('logOutputArea');
      if (!lines || lines.length === 0) {
        output.textContent = '[No log entries found]';
      } else {
        output.textContent = lines.join('\n');
      }
    } catch (err) {
      document.getElementById('logOutputArea').textContent = `[Error loading logs: ${err.message}]`;
    }
  },

  // ── Modules ──────────────────────────────────────────

  async loadModules() {
    try {
      const res = await LP.get('/apache/modules');
      if (!res?.success) throw new Error(res?.message);

      const { enabled, available } = res.data?.modules || { enabled: [], available: [] };
      const container = document.getElementById('moduleListContainer');

      const allModules = [...new Set([...available, ...enabled])];

      if (allModules.length === 0) {
        container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);">No module information available.</div>';
        return;
      }

      container.innerHTML = `<div class="row g-2" id="moduleGrid">
        ${allModules.map(mod => {
          const isEnabled = enabled.includes(mod);
          return `
            <div class="col-6 col-md-4 col-lg-3 module-item" data-name="${LP.escHtml(mod.toLowerCase())}">
              <div class="p-2 rounded d-flex justify-content-between align-items-center" style="background:rgba(0,0,0,0.08);border:1px solid ${isEnabled ? 'rgba(16,185,129,0.3)' : 'var(--glass-border)'};">
                <div style="display:flex;align-items:center;gap:8px;min-width:0;">
                  <span style="width:8px;height:8px;border-radius:50%;background:${isEnabled ? '#10b981' : '#6b7280'};flex-shrink:0;"></span>
                  <span style="font-size:12px;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${LP.escHtml(mod)}</span>
                </div>
                ${isEnabled
                  ? `<button class="btn-lp btn-lp-ghost btn-lp-sm" style="padding:2px 6px;font-size:10px;" onclick="ApachePage.disableModule('${LP.encJsArg(mod)}')">Disable</button>`
                  : `<button class="btn-lp btn-lp-ghost btn-lp-sm text-success" style="padding:2px 6px;font-size:10px;" onclick="ApachePage.enableModule('${LP.encJsArg(mod)}')">Enable</button>`
                }
              </div>
            </div>
          `;
        }).join('')}
      </div>`;

      // Store module data for filtering
      this._moduleData = { enabled, available };
    } catch (err) {
      document.getElementById('moduleListContainer').innerHTML =
        `<div style="padding:20px;text-align:center;color:var(--accent-danger);font-size:13px;">Error: ${LP.escHtml(err.message)}</div>`;
    }
  },

  filterModules() {
    const query = document.getElementById('moduleFilterInput').value.toLowerCase();
    document.querySelectorAll('.module-item').forEach(el => {
      const name = el.dataset.name || '';
      el.style.display = name.includes(query) ? '' : 'none';
    });
  },

  async enableModule(name) {
    try {
      const res = await LP.post('/apache/modules/enable', { name });
      if (res?.success) {
        LP.toast(`Module "${name}" enabled`, 'success');
        this.loadModules();
      } else {
        LP.toast(res?.message || 'Failed to enable module', 'error');
      }
    } catch {
      LP.toast('Error enabling module', 'error');
    }
  },

  async disableModule(name) {
    try {
      const res = await LP.post('/apache/modules/disable', { name });
      if (res?.success) {
        LP.toast(`Module "${name}" disabled`, 'success');
        this.loadModules();
      } else {
        LP.toast(res?.message || 'Failed to disable module', 'error');
      }
    } catch {
      LP.toast('Error disabling module', 'error');
    }
  },

  // ── Config Editor ────────────────────────────────────

  async loadConfig() {
    try {
      const res = await LP.get('/apache/config');
      if (!res?.success) throw new Error(res?.message);

      const config = res.data?.config;
      if (!config) throw new Error('No config data');

      document.getElementById('configFilePath').textContent = `📄 ${config.path}`;
      document.getElementById('apacheConfigEditor').value = config.content;
      document.getElementById('configTestResult').style.display = 'none';
    } catch (err) {
      document.getElementById('apacheConfigEditor').value = `// Error loading config: ${err.message}`;
    }
  },

  async saveConfig() {
    const content = document.getElementById('apacheConfigEditor').value;
    if (!content.trim()) {
      LP.toast('Config content is empty', 'error');
      return;
    }

    if (!(await LP.confirm('Save configuration and reload Apache? A backup will be created automatically.', 'Save Config'))) return;

    try {
      const res = await LP.put('/apache/config', { content });
      if (res?.success) {
        LP.toast('Configuration saved and Apache reloaded', 'success');
        const resultEl = document.getElementById('configTestResult');
        resultEl.style.display = 'block';
        resultEl.style.background = 'rgba(16,185,129,0.1)';
        resultEl.style.color = '#10b981';
        resultEl.style.border = '1px solid rgba(16,185,129,0.2)';
        resultEl.textContent = '✓ Config valid — Apache reloaded successfully';
      } else {
        LP.toast(res?.message || 'Failed to save config', 'error');
      }
    } catch (err) {
      LP.toast('Error saving config: ' + err.message, 'error');
    }
  },
};

document.addEventListener('DOMContentLoaded', () => ApachePage.init());
