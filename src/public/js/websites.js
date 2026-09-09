/**
 * Linux Panel - websites.js
 * Website management frontend — with Edit Drawer
 */

const WebsitesPage = (() => {
  let createModal = null;
  let editDrawer = null;
  let currentEditId = null;
  let currentEditWebsite = null;

  // ─── Load Websites Table ───────────────────────────────────────────────────
  async function loadWebsites() {
    try {
      const statusRes = await LP.get('/system/check-install');
      const isInstalled = statusRes?.success ? statusRes.data.nginx : true;
      const tbody = document.getElementById('websitesTableBody');

      if (isInstalled === false) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;">
          <h4 style="margin-bottom:15px;">Nginx is not installed</h4>
          <button class="btn-lp btn-lp-primary" onclick="WebsitesPage.installPackage('nginx')"><i class="bi bi-download"></i> Install Nginx</button>
        </td></tr>`;
        return;
      }

      const res = await LP.get('/websites');
      if (!res?.success) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger">${LP.escHtml(res?.message || 'Error loading websites')}</td></tr>`;
        return;
      }

      const { websites } = res.data;
      LP.paginate(websites, 10, 'websitesTableBody', 'websitesPagination', w => {
        const isProxy = w.type === 'proxy';
        const isSsl = Boolean(w.ssl && w.ssl.enabled);
        const protocol = isSsl ? 'https' : 'http';
        const sslBadge = isSsl
          ? `<span class="lp-badge lp-badge-success" style="font-size:10px;"><span class="lp-badge-dot"></span>HTTPS</span>`
          : `<span class="lp-badge lp-badge-ghost" style="font-size:10px;"><span class="lp-badge-dot"></span>HTTP</span>`;

        return `
          <tr>
            <td>
              <div style="font-weight:600;color:var(--text-primary)">
                <a href="${protocol}://${w.domain}" target="_blank" style="color:inherit;text-decoration:none">
                  ${LP.escHtml(w.domain)} <i class="bi bi-box-arrow-up-right" style="font-size:10px;color:var(--text-muted)"></i>
                </a>
              </div>
              ${w.aliases && w.aliases.length ? `<div style="font-size:11px;color:var(--text-muted)">${LP.escHtml(w.aliases.join(', '))}</div>` : ''}
            </td>
            <td><span class="lp-badge ${w.status === 'active' ? 'lp-badge-success' : 'lp-badge-warning'}"><span class="lp-badge-dot"></span>${w.status}</span></td>
            <td><span class="lp-badge" style="background:var(--bg-secondary);border:1px solid var(--border-color);text-transform:uppercase">${w.type}</span></td>
            <td class="font-mono" style="font-size:12px;color:var(--text-muted)">
              ${isProxy ? `${LP.escHtml(w.targetHost || '127.0.0.1')}:${w.port || 8080}` : LP.escHtml(w.rootDirectory || '')}
            </td>
            <td style="font-size:13px;">${sslBadge}</td>
            <td style="text-align:right;white-space:nowrap;">
              <button class="btn-lp btn-lp-ghost btn-lp-sm ${w.status === 'active' ? 'text-warning' : 'text-success'}" onclick="LP.call('WebsitesPage.toggleStatusRow', '${LP.encJsArg(w._id)}', '${w.status === 'active' ? 'inactive' : 'active'}')" title="${w.status === 'active' ? 'Stop / Disable Website' : 'Start / Enable Website'}">
                <i class="bi ${w.status === 'active' ? 'bi-pause-circle' : 'bi-play-circle'}"></i>
              </button>
              <button class="btn-lp btn-lp-ghost btn-lp-sm text-info" onclick="LP.call('WebsitesPage.openFolder', '${LP.encJsArg(w.rootDirectory || '')}')" title="File Manager">
                <i class="bi bi-folder"></i>
              </button>
              <button class="btn-lp btn-lp-ghost btn-lp-sm text-secondary" onclick="LP.call('WebsitesPage.openWebsiteLogs', '${LP.encJsArg(w._id)}')" title="View Logs">
                <i class="bi bi-journal-text"></i>
              </button>
              <button class="btn-lp btn-lp-primary btn-lp-sm" onclick="LP.call('WebsitesPage.openEditDrawer', '${LP.encJsArg(w._id)}')" title="Edit Website">
                <i class="bi bi-pencil-square me-1"></i> Edit
              </button>
              <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="LP.call('WebsitesPage.deleteWebsiteRow', '${LP.encJsArg(w._id)}', '${LP.encJsArg(w.domain)}')" title="Delete Website">
                <i class="bi bi-trash"></i>
              </button>
            </td>
          </tr>
        `;
      }, 'No websites configured', 6);
    } catch (err) {
      console.error('loadWebsites error:', err);
      const tbody = document.getElementById('websitesTableBody');
      if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger">Error: ${LP.escHtml(err.message)}</td></tr>`;
    }
  }

  // ─── Tab Switching ─────────────────────────────────────────────────────────
  function switchEditTab(btn) {
    document.querySelectorAll('.ew-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.ew-tab-pane').forEach(p => p.style.display = 'none');
    btn.classList.add('active');
    const target = document.getElementById(btn.dataset.target);
    if (target) target.style.display = 'block';

    // Lazy-load data when switching tabs
    if (btn.dataset.target === 'etab-nginx' && currentEditId) {
      loadNginxForDrawer();
    }
    if (btn.dataset.target === 'etab-ssl' && currentEditId && currentEditWebsite) {
      renderSslStatus(currentEditWebsite);
    }
    if (btn.dataset.target === 'etab-logs' && currentEditId) {
      loadLogsForDrawer();
    } else {
      stopAutoRefreshLogs();
    }
  }

  function switchSslSubTab(tab) {
    ['Le', 'Self', 'Custom'].forEach(t => {
      const lower = t.toLowerCase();
      const key = lower === 'le' ? 'letsencrypt' : lower === 'self' ? 'selfsigned' : 'custom';
      const btn = document.getElementById('editSslTab' + t);
      const pane = document.getElementById('editSslPane' + t);
      if (btn && pane) {
        btn.className = `btn-lp btn-lp-sm ssl-sub-btn ${key === tab ? 'btn-lp-primary' : 'btn-lp-ghost'}`;
        pane.style.display = key === tab ? 'block' : 'none';
      }
    });
  }

  // ─── Open Drawer ───────────────────────────────────────────────────────────
  async function openEditDrawer(id) {
    currentEditId = id;
    currentEditWebsite = null;

    // Reset to General tab
    document.querySelectorAll('.ew-tab-btn').forEach((b, i) => {
      b.classList.toggle('active', i === 0);
    });
    document.querySelectorAll('.ew-tab-pane').forEach((p, i) => {
      p.style.display = i === 0 ? 'block' : 'none';
    });

    if (!editDrawer) {
      editDrawer = new bootstrap.Modal(document.getElementById('editWebsiteModal'));
    }
    editDrawer.show();

    // Show loading state
    document.getElementById('editDrawerDomain').textContent = 'Loading...';

    try {
      const res = await LP.get(`/websites/${id}`);
      if (!res?.success) {
        LP.toast(res?.message || 'Failed to load website', 'error');
        editDrawer.hide();
        return;
      }

      const w = res.data?.website || res.data;
      currentEditWebsite = w;
      populateDrawer(w);
    } catch (err) {
      LP.toast('Failed to load website: ' + err.message, 'error');
      editDrawer.hide();
    }
  }

  function populateDrawer(w) {
    document.getElementById('editDrawerDomain').textContent = w.domain;
    document.getElementById('editDomain').value = w.domain || '';
    document.getElementById('editAliases').value = (w.aliases || []).join(', ');
    document.getElementById('editRoot').value = w.rootDirectory || '';
    const editHostEl = document.getElementById('editTargetHost');
    if (editHostEl) editHostEl.value = w.targetHost || '127.0.0.1';
    document.getElementById('editPort').value = w.port || '';
    document.getElementById('editGitRepo').value = w.gitRepo || '';
    document.getElementById('editGitBranch').value = w.gitBranch || '';
    document.getElementById('editAutoDeploy').checked = Boolean(w.autoDeploy);

    // Type
    const typeSelect = document.getElementById('editType');
    typeSelect.value = w.type || 'static';
    toggleEditTypeFields();

    if (w.type === 'php' && w.phpVersion) {
      document.getElementById('editPhpVersion').value = w.phpVersion;
    }

    // Status badge
    const isActive = w.status === 'active';
    document.getElementById('editStatusBadge').innerHTML = `
      <span class="lp-badge ${isActive ? 'lp-badge-success' : 'lp-badge-warning'}">
        <span class="lp-badge-dot"></span> ${isActive ? 'Active' : 'Inactive'}
      </span>`;
    const toggleBtn = document.getElementById('editToggleStatusBtn');
    toggleBtn.innerHTML = isActive
      ? '<i class="bi bi-pause-circle me-1"></i> Disable'
      : '<i class="bi bi-play-circle me-1"></i> Enable';
    toggleBtn.className = `btn-lp btn-lp-ghost btn-lp-sm ${isActive ? 'text-warning' : 'text-success'}`;

    // Webhook
    const webhookSection = document.getElementById('editWebhookSection');
    const deployBtn = document.getElementById('editDeployNowBtn');
    if (w.gitRepo) {
      deployBtn.style.display = 'inline-flex';
      if (w.autoDeploy && w.webhookToken) {
        webhookSection.style.display = 'block';
        document.getElementById('editWebhookUrl').value = `${window.location.origin}/api/websites/${w._id}/deploy/${w.webhookToken}`;
      } else {
        webhookSection.style.display = 'none';
      }
    } else {
      deployBtn.style.display = 'none';
      webhookSection.style.display = 'none';
    }

    // Listen for auto-deploy checkbox change
    document.getElementById('editAutoDeploy').onchange = () => {
      webhookSection.style.display = (document.getElementById('editAutoDeploy').checked && w.webhookToken) ? 'block' : 'none';
    };
  }

  function toggleEditTypeFields() {
    const type = document.getElementById('editType').value;
    document.getElementById('editPortGroup').style.display = (type === 'proxy' || type === 'node') ? 'block' : 'none';
    document.getElementById('editPhpGroup').style.display = type === 'php' ? 'block' : 'none';
  }

  // ─── Nginx Tab ─────────────────────────────────────────────────────────────
  async function loadNginxForDrawer() {
    if (!currentEditId) return;
    const editor = document.getElementById('editNginxEditor');
    const saveBtn = document.getElementById('editSaveNginxBtn');
    editor.value = '# Loading...';
    editor.disabled = true;
    saveBtn.disabled = true;

    try {
      const res = await LP.get(`/websites/${currentEditId}/nginx-config`);
      if (res?.success) {
        editor.value = res.data.content || '';
        if (res.data.confPath) {
          document.getElementById('editNginxFilePath').textContent = res.data.confPath;
        }
        const badgeEl = document.getElementById('editNginxBadge');
        if (badgeEl) {
          badgeEl.innerHTML = res.data.isCustom
            ? '<span class="badge bg-warning text-dark" style="font-size:10px;"><i class="bi bi-lock-fill me-1"></i>Custom (Protected)</span>'
            : '<span class="badge bg-secondary" style="font-size:10px;">Default Template</span>';
        }
        editor.disabled = false;
        saveBtn.disabled = false;
      } else {
        editor.value = `# Error: ${res?.message || 'Failed to load'}`;
        LP.toast(res?.message || 'Failed to load Nginx config', 'error');
      }
    } catch (err) {
      editor.value = `# Error: ${err.message}`;
      LP.toast('Error loading Nginx config', 'error');
    }
  }

  async function saveDrawerNginxConfig() {
    if (!currentEditId) return;
    const editor = document.getElementById('editNginxEditor');
    const saveBtn = document.getElementById('editSaveNginxBtn');
    const content = editor.value;
    const orig = saveBtn.innerHTML;
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Validating & Saving...';

    try {
      const res = await LP.put(`/websites/${currentEditId}/nginx-config`, { content });
      if (res?.success) {
        const badgeEl = document.getElementById('editNginxBadge');
        if (badgeEl) {
          badgeEl.innerHTML = '<span class="badge bg-warning text-dark" style="font-size:10px;"><i class="bi bi-lock-fill me-1"></i>Custom (Protected)</span>';
        }
        const msg = res?.data?.message || res?.message || 'Nginx configuration saved & reloaded!';
        LP.toast(msg, 'success');
      } else {
        LP.toast(`Failed: ${res?.message || 'Unknown error'}`, 'error');
      }
    } catch (err) {
      LP.toast(`Error: ${err.message}`, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = orig;
    }
  }

  async function resetDrawerNginxConfig() {
    if (!currentEditId) return;
    const confirmed = await LP.confirm(
      'Reset Nginx configuration to default generated template?<br><small class="text-danger">Any custom edits in this configuration will be lost.</small>',
      'Reset Nginx Config'
    );
    if (!confirmed) return;
    const editor = document.getElementById('editNginxEditor');
    const resetBtn = document.getElementById('editResetNginxBtn');
    const orig = resetBtn.innerHTML;
    resetBtn.disabled = true;
    resetBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
    try {
      const res = await LP.post(`/websites/${currentEditId}/nginx-config/reset`);
      if (res?.success) {
        editor.value = res.data.content || '';
        const badgeEl = document.getElementById('editNginxBadge');
        if (badgeEl) {
          badgeEl.innerHTML = '<span class="badge bg-secondary" style="font-size:10px;">Default Template</span>';
        }
        LP.toast('Nginx configuration reset to default template', 'success');
      } else {
        LP.toast(`Failed: ${res?.message || 'Error'}`, 'error');
      }
    } catch (err) {
      LP.toast('Error resetting config: ' + err.message, 'error');
    } finally {
      resetBtn.disabled = false;
      resetBtn.innerHTML = orig;
    }
  }

  // ─── SSL Tab ───────────────────────────────────────────────────────────────
  function renderSslStatus(w) {
    const isSsl = Boolean(w.ssl && w.ssl.enabled);
    if (isSsl) {
      const provider = w.ssl.provider || 'Active';
      const expiresAt = w.ssl.expiresAt ? new Date(w.ssl.expiresAt) : null;
      const daysLeft = expiresAt ? Math.ceil((expiresAt - Date.now()) / 86400000) : null;
      document.getElementById('editSslStatusText').innerHTML = `<span class="text-success"><i class="bi bi-shield-check"></i> Active (${LP.escHtml(provider)})</span>`;
      document.getElementById('editSslStatusBadge').innerHTML = `<span class="lp-badge lp-badge-success">SSL On</span>`;
      document.getElementById('editSslExpiryInfo').textContent = expiresAt
        ? `Expires: ${expiresAt.toLocaleDateString()} (${daysLeft} days remaining)`
        : 'SSL certificate is active';
      document.getElementById('editSslDisable').style.display = 'block';
    } else {
      document.getElementById('editSslStatusText').innerHTML = `<span class="text-muted"><i class="bi bi-shield-slash"></i> Inactive (HTTP Only)</span>`;
      document.getElementById('editSslStatusBadge').innerHTML = `<span class="lp-badge lp-badge-warning">No SSL</span>`;
      document.getElementById('editSslExpiryInfo').textContent = 'This website is currently served over insecure HTTP.';
      document.getElementById('editSslDisable').style.display = 'none';
    }
  }

  async function issueEditSSL(provider) {
    if (!currentEditId) return;
    const btnMap = { letsencrypt: 'editBtnLe', selfsigned: 'editBtnSelf', custom: 'editBtnCustom' };
    const btn = document.getElementById(btnMap[provider]);
    const orig = btn.innerHTML;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Processing...';
    btn.disabled = true;

    const payload = { websiteId: currentEditId, provider };
    if (provider === 'custom') {
      payload.certificate = document.getElementById('editSslCert').value.trim();
      payload.privateKey = document.getElementById('editSslKey').value.trim();
      if (!payload.certificate || !payload.privateKey) {
        LP.toast('Both Certificate and Private Key are required', 'warning');
        btn.innerHTML = orig; btn.disabled = false;
        return;
      }
    }

    try {
      const res = await LP.post('/ssl/issue', payload);
      if (res?.success) {
        LP.toast('SSL configured and Nginx reloaded!', 'success');
        // Refresh website data in drawer
        const fresh = await LP.get(`/websites/${currentEditId}`);
        if (fresh?.success) {
          currentEditWebsite = fresh.data?.website || fresh.data;
          renderSslStatus(currentEditWebsite);
        }
        loadWebsites();
      } else {
        LP.toast(res?.message || 'SSL configuration failed', 'error');
      }
    } catch (err) {
      LP.toast(err.message || 'Connection error', 'error');
    } finally {
      btn.innerHTML = orig; btn.disabled = false;
    }
  }

  async function disableEditSSL() {
    if (!currentEditId) return;
    if (!(await LP.confirm('Disable SSL? The website will revert to HTTP port 80 only.', 'Disable SSL'))) return;
    try {
      const res = await LP.post(`/ssl/disable/${currentEditId}`);
      if (res?.success) {
        LP.toast('SSL disabled', 'success');
        const fresh = await LP.get(`/websites/${currentEditId}`);
        if (fresh?.success) {
          currentEditWebsite = fresh.data?.website || fresh.data;
          renderSslStatus(currentEditWebsite);
        }
        loadWebsites();
      } else {
        LP.toast(res?.message || 'Failed', 'error');
      }
    } catch (err) {
      LP.toast('Error disabling SSL', 'error');
    }
  }

  // ─── General Save ──────────────────────────────────────────────────────────
  async function saveGeneralSettings() {
    if (!currentEditId) return;
    const domain = document.getElementById('editDomain').value.trim();
    const aliasesRaw = document.getElementById('editAliases').value;
    const aliases = aliasesRaw ? aliasesRaw.split(',').map(a => a.trim()).filter(Boolean) : [];
    const type = document.getElementById('editType').value;
    const rootDirectory = document.getElementById('editRoot').value.trim();
    const editHostEl = document.getElementById('editTargetHost');
    const targetHost = editHostEl ? (editHostEl.value.trim() || '127.0.0.1') : '127.0.0.1';
    const port = document.getElementById('editPort').value;
    const phpVersion = document.getElementById('editPhpVersion').value;
    const gitRepo = document.getElementById('editGitRepo').value.trim();
    const gitBranch = document.getElementById('editGitBranch').value.trim();
    const autoDeploy = document.getElementById('editAutoDeploy').checked;

    if (!domain) return LP.toast('Domain name is required', 'warning');

    try {
      const res = await LP.put(`/websites/${currentEditId}`, {
        domain, aliases, type, rootDirectory, targetHost, port: port ? Number(port) : undefined,
        phpVersion, gitRepo, gitBranch, autoDeploy
      });
      if (res?.success) {
        LP.toast('Website settings saved!', 'success');
        // Update drawer header
        document.getElementById('editDrawerDomain').textContent = domain;
        loadWebsites();
      } else {
        LP.toast(res?.message || 'Failed to save', 'error');
      }
    } catch (err) {
      LP.toast('Error saving: ' + err.message, 'error');
    }
  }

  async function toggleWebsiteStatus() {
    if (!currentEditId || !currentEditWebsite) return;
    const newStatus = currentEditWebsite.status === 'active' ? 'inactive' : 'active';
    try {
      const res = await LP.put(`/websites/${currentEditId}`, { status: newStatus });
      if (res?.success) {
        LP.toast(`Website ${newStatus === 'active' ? 'enabled' : 'disabled'}`, 'success');
        currentEditWebsite.status = newStatus;
        populateDrawer(currentEditWebsite);
        loadWebsites();
      } else {
        LP.toast(res?.message || 'Failed', 'error');
      }
    } catch (err) {
      LP.toast('Error toggling status', 'error');
    }
  }

  async function toggleStatusRow(id, targetStatus) {
    try {
      const res = await LP.put(`/websites/${id}`, { status: targetStatus });
      if (res?.success) {
        LP.toast(`Website ${targetStatus === 'active' ? 'started' : 'stopped'}!`, 'success');
        loadWebsites();
      } else {
        LP.toast(res?.message || 'Failed to update status', 'error');
      }
    } catch (err) {
      LP.toast('Error: ' + err.message, 'error');
    }
  }

  async function deleteWebsiteRow(id, domain) {
    const confirmed = await LP.confirm(
      `Delete website <strong>${LP.escHtml(domain)}</strong>?<br><small class="text-danger">Nginx configuration will be removed. Files in document root will be preserved.</small>`,
      'Delete Website'
    );
    if (!confirmed) return;
    try {
      const res = await LP.del(`/websites/${id}`);
      if (res?.success) {
        LP.toast(`Website ${domain} deleted`, 'success');
        loadWebsites();
      } else {
        LP.toast(res?.message || 'Failed to delete website', 'error');
      }
    } catch (err) {
      LP.toast('Error deleting website: ' + err.message, 'error');
    }
  }

  async function deleteCurrentWebsite() {
    if (!currentEditId || !currentEditWebsite) return;
    const confirmed = await LP.confirm(
      `Delete website <strong>${LP.escHtml(currentEditWebsite.domain)}</strong>?<br><small class="text-danger">Nginx config will be removed. Files in document root will be kept.</small>`,
      'Delete Website'
    );
    if (!confirmed) return;
    try {
      const res = await LP.del(`/websites/${currentEditId}`);
      if (res?.success) {
        LP.toast('Website deleted', 'success');
        editDrawer.hide();
        loadWebsites();
      } else {
        LP.toast(res?.message || 'Failed', 'error');
      }
    } catch (err) {
      LP.toast('Error deleting website', 'error');
    }
  }

  async function deployFromDrawer() {
    if (!currentEditId) return;
    const btn = document.getElementById('editDeployNowBtn');
    const orig = btn.innerHTML;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
    btn.disabled = true;
    try {
      const res = await LP.post(`/websites/${currentEditId}/deploy`);
      LP.toast(res?.success ? 'Git deployment successful!' : (res?.message || 'Deployment failed'), res?.success ? 'success' : 'error');
    } catch (err) {
      LP.toast('Deployment error', 'error');
    } finally {
      btn.innerHTML = orig; btn.disabled = false;
    }
  }

  function copyWebhookUrl() {
    const url = document.getElementById('editWebhookUrl').value;
    navigator.clipboard.writeText(url).then(() => LP.toast('Webhook URL copied!', 'success'));
  }

  function editOpenFolder() {
    const path = document.getElementById('editRoot').value;
    if (path) window.location.href = `/filemanager?path=${encodeURIComponent(path)}`;
    else LP.toast('No document root set', 'warning');
  }

  // ─── Website Logs Tab ──────────────────────────────────────────────────────
  let logRefreshInterval = null;

  async function loadLogsForDrawer() {
    if (!currentEditId) return;
    const typeSelect = document.getElementById('wlLogType');
    const linesSelect = document.getElementById('wlLogLines');
    const contentEl = document.getElementById('wlLogContent');
    const pathEl = document.getElementById('wlFilePath');
    const timeEl = document.getElementById('wlLogTimestamp');

    const type = typeSelect ? typeSelect.value : 'access';
    const lines = linesSelect ? linesSelect.value : '100';

    try {
      const res = await LP.get(`/websites/${currentEditId}/logs?type=${encodeURIComponent(type)}&lines=${encodeURIComponent(lines)}`);
      if (res?.success && res.data) {
        if (pathEl) pathEl.textContent = res.data.logFile || '--';
        if (timeEl) {
          timeEl.textContent = res.data.timestamp
            ? `Last updated: ${new Date(res.data.timestamp).toLocaleString()}`
            : `Retrieved: ${new Date().toLocaleTimeString()}`;
        }
        if (contentEl) {
          const rawLines = res.data.lines || [];
          if (rawLines.length === 0 || res.data.empty) {
            contentEl.textContent = rawLines[0] || '(Log file is currently empty)';
            contentEl.style.color = '#94a3b8';
          } else {
            contentEl.textContent = rawLines.join('\n');
            contentEl.style.color = type === 'error' ? '#fca5a5' : '#e2e8f0';
            contentEl.scrollTop = contentEl.scrollHeight;
          }
        }
      } else {
        if (contentEl) contentEl.textContent = `Error: ${res?.message || 'Failed to fetch logs'}`;
      }
    } catch (err) {
      if (contentEl) contentEl.textContent = `Error loading logs: ${err.message}`;
    }
  }

  async function clearLogs() {
    if (!currentEditId) return;
    const typeSelect = document.getElementById('wlLogType');
    const type = typeSelect ? typeSelect.value : 'access';
    const label = type === 'deploy' ? 'Git Deployment History' : `Nginx ${type.toUpperCase()} Log`;

    if (!(await LP.confirm(`Are you sure you want to clear ${label}?`, 'Clear Log File'))) return;

    try {
      const res = await LP.post(`/websites/${currentEditId}/logs/clear`, { type });
      if (res?.success) {
        LP.toast(res.data?.message || res.message || 'Log cleared successfully', 'success');
        await loadLogsForDrawer();
      } else {
        LP.toast(`Failed to clear log: ${res?.message || 'Unknown error'}`, 'error');
      }
    } catch (err) {
      LP.toast(`Error clearing log: ${err.message}`, 'error');
    }
  }

  function toggleAutoRefreshLogs(checkbox) {
    if (checkbox && checkbox.checked) {
      startAutoRefreshLogs();
    } else {
      stopAutoRefreshLogs();
    }
  }

  function startAutoRefreshLogs() {
    stopAutoRefreshLogs();
    const chk = document.getElementById('wlAutoRefresh');
    if (chk) chk.checked = true;
    logRefreshInterval = setInterval(() => {
      const logsPane = document.getElementById('etab-logs');
      if (logsPane && logsPane.style.display !== 'none' && currentEditId) {
        loadLogsForDrawer();
      } else {
        stopAutoRefreshLogs();
      }
    }, 5000);
  }

  function stopAutoRefreshLogs() {
    if (logRefreshInterval) {
      clearInterval(logRefreshInterval);
      logRefreshInterval = null;
    }
    const chk = document.getElementById('wlAutoRefresh');
    if (chk) chk.checked = false;
  }

  function askAILog() {
    const contentEl = document.getElementById('wlLogContent');
    const typeSelect = document.getElementById('wlLogType');
    const type = typeSelect ? typeSelect.value : 'website log';
    const logs = contentEl ? contentEl.textContent : '';

    if (!logs || logs.includes('does not exist') || logs.includes('currently empty')) {
      LP.toast('No meaningful logs available to analyze.', 'info');
      return;
    }

    if (window.askAI) {
      window.askAI(`Tolong analisis log website (${type}) berikut, jelaskan masalah yang terjadi dan rekomendasi solusinya:\n\n${logs.substring(0, 4000)}`, {
        logType: `website-${type}`,
        websiteId: currentEditId,
        domain: currentEditWebsite?.domain,
      });
    } else {
      LP.toast('AI Assistant is not available.', 'warning');
    }
  }

  async function openWebsiteLogs(id) {
    await openEditDrawer(id);
    const logsBtn = document.querySelector('.ew-tab-btn[data-target="etab-logs"]');
    if (logsBtn) {
      switchEditTab(logsBtn);
    }
  }

  // ─── Public API ────────────────────────────────────────────────────────────
  return {
    async init() {
      await LP.init();
      if (!LP.state.accessToken) return;
      createModal = new bootstrap.Modal(document.getElementById('createWebsiteModal'));
      const editModalEl = document.getElementById('editWebsiteModal');
      if (editModalEl) {
        editModalEl.addEventListener('hidden.bs.modal', () => {
          stopAutoRefreshLogs();
        });
      }
      loadWebsites();
    },


    showCreateModal() {
      document.getElementById('createWebsiteForm').reset();
      const hostEl = document.getElementById('cwTargetHost');
      if (hostEl) hostEl.value = '127.0.0.1';
      this.toggleTypeFields();
      createModal.show();
    },

    async toggleTypeFields() {
      const type = document.getElementById('cwType').value;
      const portGroup = document.getElementById('cwPortGroup');
      const phpGroup = document.getElementById('cwPhpGroup');
      const dockerGroup = document.getElementById('cwDockerGroup');

      if (type === 'proxy' || type === 'node') {
        portGroup.style.display = 'block';
        dockerGroup.style.display = 'block';
        document.getElementById('cwPort').required = true;

        const dockerSelect = document.getElementById('cwDockerContainer');
        dockerSelect.innerHTML = '<option value="">-- Don\'t map (Manual port config) --</option>';
        try {
          const res = await LP.get('/docker/containers');
          if (res?.success && res.data?.containers) {
            res.data.containers.forEach(c => {
              const name = c.names[0] || c.id;
              const portInfo = c.ports?.find(p => p.PublicPort);
              const publicPort = portInfo ? portInfo.PublicPort : '';
              if (publicPort) {
                const opt = document.createElement('option');
                opt.value = publicPort;
                opt.textContent = `${name} (port ${publicPort})`;
                dockerSelect.appendChild(opt);
              }
            });
          }
        } catch (e) { console.warn('Could not load Docker containers', e); }
      } else {
        portGroup.style.display = 'none';
        dockerGroup.style.display = 'none';
        document.getElementById('cwPort').required = false;
      }
      if (type === 'php') phpGroup.style.display = 'block';
      else phpGroup.style.display = 'none';
    },

    onDockerSelected() {
      const select = document.getElementById('cwDockerContainer');
      if (select.value) {
        document.getElementById('cwPort').value = select.value;
        const hostEl = document.getElementById('cwTargetHost');
        if (hostEl) hostEl.value = '127.0.0.1';
      }
    },

    async createWebsite(e) {
      e.preventDefault();
      const domain = document.getElementById('cwDomain').value;
      const type = document.getElementById('cwType').value;
      const rootDirectory = document.getElementById('cwRoot').value || undefined;
      const hostEl = document.getElementById('cwTargetHost');
      const targetHost = hostEl ? (hostEl.value.trim() || '127.0.0.1') : '127.0.0.1';
      const port = document.getElementById('cwPort').value || undefined;
      const gitRepo = document.getElementById('cwGitRepo').value || undefined;
      const autoDeploy = document.getElementById('cwAutoDeploy').checked;
      const phpVersion = document.getElementById('cwPhpVersion').value;

      const res = await LP.post('/websites', { domain, type, rootDirectory, targetHost, port, gitRepo, autoDeploy, phpVersion });
      if (res?.success) {
        LP.toast('Website created and Nginx reloaded', 'success');
        createModal.hide();
        loadWebsites();
      } else {
        LP.toast(res?.message || 'Failed to create website', 'error');
      }
    },

    openFolder(path) {
      window.location.href = `/filemanager?path=${encodeURIComponent(path)}`;
    },

    async installPackage(pkgName) {
      if (!(await LP.confirm(`Install ${pkgName}? This may take a few minutes.`, 'Install Nginx'))) return;
      const spinner = document.createElement('div');
      spinner.id = 'installSpinner';
      spinner.innerHTML = `<div style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.8);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;">
        <div class="spinner-border text-primary" style="width:3rem;height:3rem;"></div>
        <h4 style="color:#fff;margin-top:20px;">Installing ${pkgName}...</h4></div>`;
      document.body.appendChild(spinner);
      try {
        const res = await LP.post('/system/install', { package: pkgName });
        if (res?.success) { LP.toast(`${pkgName} installed!`, 'success'); loadWebsites(); }
        else LP.toast(`Failed: ${res?.message}`, 'error');
      } catch (e) { LP.toast('Error installing', 'error'); }
      finally { document.getElementById('installSpinner')?.remove(); }
    },

    // Table actions
    toggleStatusRow,
    deleteWebsiteRow,

    // Edit Drawer methods exposed
    openEditDrawer,
    switchEditTab,
    switchSslSubTab,
    toggleEditTypeFields,
    saveGeneralSettings,
    toggleWebsiteStatus,
    deleteCurrentWebsite,
    saveDrawerNginxConfig,
    resetDrawerNginxConfig,
    issueEditSSL,
    disableEditSSL,
    deployFromDrawer,
    copyWebhookUrl,
    editOpenFolder,

    // Website Logs Viewer
    openWebsiteLogs,
    loadLogsForDrawer,
    clearLogs,
    toggleAutoRefreshLogs,
    askAILog,

    // Legacy compat — safely open drawer then switch to target tab

    async configSSL(id) {
      await openEditDrawer(id);
      // Wait for drawer animation then switch tab
      setTimeout(() => {
        const btn = document.querySelector('.ew-tab-btn[data-target="etab-ssl"]');
        if (btn) switchEditTab(btn);
      }, 350);
    },
    async configNginx(id, _domain) {
      await openEditDrawer(id);
      setTimeout(() => {
        const btn = document.querySelector('.ew-tab-btn[data-target="etab-nginx"]');
        if (btn) switchEditTab(btn);
      }, 350);
    },
    async deleteWebsite(id, domain) {
      currentEditId = id;
      currentEditWebsite = { domain };
      await deleteCurrentWebsite();
    },
    async deployGit(id) {
      currentEditId = id;
      await deployFromDrawer();
    },
    async showWebhook(id, token) {
      const url = `${window.location.origin}/api/websites/${id}/deploy/${token}`;
      LP.toast('Webhook: ' + url, 'info');
    }
  };
})();

document.addEventListener('DOMContentLoaded', () => WebsitesPage.init());
window.WebsitesPage = WebsitesPage;
window.Websites = WebsitesPage;
window.WebsitesManager = WebsitesPage;
