/**
 * Linux Panel — websites.js
 * Website management frontend
 */

const WebsitesPage = (() => {
  let createModal = null;
  let sslModal = null;
  let nginxModal = null;
  let currentSslWebsiteId = null;
  let currentNginxWebsiteId = null;

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
        const sslStatus = isSsl
          ? `<span style="cursor:pointer" onclick="LP.call('WebsitesPage.configSSL', '${LP.encJsArg(w._id)}')" title="SSL Enabled (${w.ssl.provider || 'Active'}). Click to manage."><i class="bi bi-shield-lock-fill text-success"></i> <span style="font-size:11px;font-weight:600;color:var(--accent-success)">HTTPS</span></span>`
          : `<span style="cursor:pointer" onclick="LP.call('WebsitesPage.configSSL', '${LP.encJsArg(w._id)}')" title="No SSL configured. Click to setup HTTPS."><i class="bi bi-shield text-muted"></i> <span style="font-size:11px;color:var(--text-muted)">HTTP</span></span>`;

        return `
          <tr>
            <td>
              <div style="font-weight:600;color:var(--text-primary)"><a href="${protocol}://${w.domain}" target="_blank" style="color:inherit;text-decoration:none">${w.domain} <i class="bi bi-box-arrow-up-right" style="font-size:10px;color:var(--text-muted)"></i></a></div>
              ${w.aliases.length ? `<div style="font-size:11px;color:var(--text-muted)">${w.aliases.join(', ')}</div>` : ''}
            </td>
            <td><span class="lp-badge ${w.status === 'active' ? 'lp-badge-success' : 'lp-badge-warning'}"><span class="lp-badge-dot"></span>${w.status}</span></td>
            <td><span class="lp-badge" style="background:var(--bg-secondary);border:1px solid var(--border-color);text-transform:uppercase">${w.type}</span></td>
            <td class="font-mono" style="font-size:12px;color:var(--text-muted)">
              ${isProxy ? `127.0.0.1:${w.port}` : w.rootDirectory}
            </td>
            <td style="font-size:13px">${sslStatus}</td>
            <td style="text-align:right">
              ${w.gitRepo ? `
                ${w.autoDeploy ? `<button class="btn-lp btn-lp-ghost btn-lp-sm text-info" onclick="LP.call('WebsitesPage.showWebhook', '${LP.encJsArg(w._id)}', '${LP.encJsArg(w.webhookToken)}')" title="Show Webhook URL"><i class="bi bi-link-45deg"></i></button>` : ''}
                <button class="btn-lp btn-lp-ghost btn-lp-sm text-primary" onclick="LP.call('WebsitesPage.deployGit', '${LP.encJsArg(w._id)}')" title="Deploy from Git"><i class="bi bi-cloud-arrow-down"></i></button>
              ` : ''}
              <button class="btn-lp btn-lp-ghost btn-lp-sm" onclick="LP.call('WebsitesPage.configNginx', '${LP.encJsArg(w._id)}', '${LP.encJsArg(w.domain)}')" title="Nginx Configuration"><i class="bi bi-file-earmark-code"></i></button>
              <button class="btn-lp btn-lp-ghost btn-lp-sm" onclick="LP.call('WebsitesPage.configSSL', '${LP.encJsArg(w._id)}')" title="SSL Settings"><i class="bi bi-shield"></i></button>
              <button class="btn-lp btn-lp-ghost btn-lp-sm" onclick="LP.call('WebsitesPage.openFolder', '${LP.encJsArg(w.rootDirectory)}')" title="File Manager"><i class="bi bi-folder"></i></button>
              <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="LP.call('WebsitesPage.deleteWebsite', '${LP.encJsArg(w._id)}', '${LP.encJsArg(w.domain)}')" title="Delete"><i class="bi bi-trash"></i></button>
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

  return {
    async init() {
      await LP.init();
      if (!LP.state.accessToken) return;
      
      createModal = new bootstrap.Modal(document.getElementById('createWebsiteModal'));
      const sslModalEl = document.getElementById('configSslModal');
      if (sslModalEl) {
        sslModal = new bootstrap.Modal(sslModalEl);
      }
      const nginxModalEl = document.getElementById('nginxConfigModal');
      if (nginxModalEl) {
        nginxModal = new bootstrap.Modal(nginxModalEl);
      }
      loadWebsites();
    },

    showCreateModal() {
      document.getElementById('createWebsiteForm').reset();
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
        } catch (e) {
          console.warn('Could not load Docker containers for mapping', e);
        }
      } else {
        portGroup.style.display = 'none';
        dockerGroup.style.display = 'none';
        document.getElementById('cwPort').required = false;
      }
      
      if (type === 'php') {
        phpGroup.style.display = 'block';
      } else {
        phpGroup.style.display = 'none';
      }
    },

    onDockerSelected() {
      const select = document.getElementById('cwDockerContainer');
      const portInput = document.getElementById('cwPort');
      if (select.value) {
        portInput.value = select.value;
      }
    },

    async createWebsite(e) {
      e.preventDefault();
      
      const domain = document.getElementById('cwDomain').value;
      const type = document.getElementById('cwType').value;
      const rootDirectory = document.getElementById('cwRoot').value || undefined;
      const port = document.getElementById('cwPort').value || undefined;
      const gitRepo = document.getElementById('cwGitRepo').value || undefined;
      const autoDeploy = document.getElementById('cwAutoDeploy').checked;
      const phpVersion = document.getElementById('cwPhpVersion').value;

      const res = await LP.post('/websites', { domain, type, rootDirectory, port, gitRepo, autoDeploy, phpVersion });
      if (res?.success) {
        LP.toast('Website created and nginx reloaded', 'success');
        createModal.hide();
        loadWebsites();
      } else {
        LP.toast(res?.message || 'Failed to create website', 'error');
      }
    },

    async deleteWebsite(id, domain) {
      const confirmed = await LP.confirm(`Delete website <strong>${domain}</strong>?<br><small class="text-danger">This will remove the nginx configuration, but files in document root will be kept.</small>`, 'Delete Website');
      if (!confirmed) return;

      const res = await LP.del(`/websites/${id}`);
      if (res?.success) {
        LP.toast('Website deleted', 'success');
        loadWebsites();
      } else {
        LP.toast(res?.message || 'Failed to delete website', 'error');
      }
    },

    openFolder(path) {
      window.location.href = `/filemanager?path=${encodeURIComponent(path)}`;
    },

    async configSSL(id) {
      currentSslWebsiteId = id;
      document.getElementById('sslModalDomain').textContent = '...';
      document.getElementById('sslStatusText').textContent = 'Checking certificate status...';
      document.getElementById('sslStatusBadge').innerHTML = '';
      document.getElementById('sslExpiryInfo').textContent = '';
      document.getElementById('sslDisableSection').style.display = 'none';
      document.getElementById('sslCustomCert').value = '';
      document.getElementById('sslCustomKey').value = '';

      if (sslModal) sslModal.show();

      try {
        const res = await LP.get(`/websites/${id}`);
        if (!res?.success) {
          LP.toast(res?.message || 'Failed to fetch website details', 'error');
          return;
        }

        const website = res.data?.website || res.data;
        document.getElementById('sslModalDomain').textContent = website.domain;

        const isSsl = Boolean(website.ssl && website.ssl.enabled);
        if (isSsl) {
          const provider = website.ssl.provider || 'Active';
          const expiresAt = website.ssl.expiresAt ? new Date(website.ssl.expiresAt) : null;
          const daysLeft = expiresAt ? Math.ceil((expiresAt - Date.now()) / 86400000) : null;

          document.getElementById('sslStatusText').innerHTML = `<span class="text-success"><i class="bi bi-shield-check"></i> Active (${LP.escHtml(provider)})</span>`;
          document.getElementById('sslStatusBadge').innerHTML = `<span class="lp-badge lp-badge-success">SSL Enabled</span>`;
          document.getElementById('sslExpiryInfo').textContent = expiresAt
            ? `Expires: ${expiresAt.toLocaleDateString()} (${daysLeft} days remaining)`
            : 'SSL certificate is active';
          document.getElementById('sslDisableSection').style.display = 'block';
        } else {
          document.getElementById('sslStatusText').innerHTML = `<span class="text-muted"><i class="bi bi-shield-slash"></i> Inactive (HTTP Only)</span>`;
          document.getElementById('sslStatusBadge').innerHTML = `<span class="lp-badge lp-badge-warning">No SSL</span>`;
          document.getElementById('sslExpiryInfo').textContent = 'This website is currently served over insecure HTTP.';
          document.getElementById('sslDisableSection').style.display = 'none';
        }
      } catch (err) {
        LP.toast('Failed to load website SSL configuration', 'error');
      }
    },

    async applySSL(provider) {
      if (!currentSslWebsiteId) return;

      const btnId = provider === 'selfsigned' ? 'btnIssueSelfSigned' : 'btnIssueLetsEncrypt';
      const btn = document.getElementById(btnId);
      const oldHtml = btn.innerHTML;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Processing... (please wait)';
      btn.disabled = true;

      try {
        const res = await LP.post('/ssl/issue', {
          websiteId: currentSslWebsiteId,
          provider
        });

        if (res?.success) {
          LP.toast('SSL certificate configured and Nginx reloaded!', 'success');
          await this.configSSL(currentSslWebsiteId);
          loadWebsites();
        } else {
          LP.toast(res?.message || 'SSL configuration failed', 'error');
        }
      } catch (err) {
        LP.toast(err.message || 'Connection error while configuring SSL', 'error');
      } finally {
        btn.innerHTML = oldHtml;
        btn.disabled = false;
      }
    },

    async applyCustomSSL() {
      if (!currentSslWebsiteId) return;

      const certificate = document.getElementById('sslCustomCert').value.trim();
      const privateKey = document.getElementById('sslCustomKey').value.trim();

      if (!certificate || !privateKey) {
        return LP.toast('Both Certificate and Private Key PEM are required', 'warning');
      }

      const btn = document.getElementById('btnApplyCustomSSL');
      const oldHtml = btn.innerHTML;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Saving & Reloading Nginx...';
      btn.disabled = true;

      try {
        const res = await LP.post('/ssl/issue', {
          websiteId: currentSslWebsiteId,
          provider: 'custom',
          certificate,
          privateKey
        });

        if (res?.success) {
          LP.toast('Custom SSL installed and Nginx reloaded!', 'success');
          await this.configSSL(currentSslWebsiteId);
          loadWebsites();
        } else {
          LP.toast(res?.message || 'Failed to install custom SSL', 'error');
        }
      } catch (err) {
        LP.toast(err.message || 'Connection error while installing custom SSL', 'error');
      } finally {
        btn.innerHTML = oldHtml;
        btn.disabled = false;
      }
    },

    async disableSSL() {
      if (!currentSslWebsiteId) return;
      if (!(await LP.confirm('Are you sure you want to disable SSL? Website traffic will revert to HTTP port 80 only.', 'Disable SSL'))) {
        return;
      }

      try {
        const res = await LP.post(`/ssl/disable/${currentSslWebsiteId}`);
        if (res?.success) {
          LP.toast('SSL disabled and Nginx reverted to HTTP', 'success');
          await this.configSSL(currentSslWebsiteId);
          loadWebsites();
        } else {
          LP.toast(res?.message || 'Failed to disable SSL', 'error');
        }
      } catch (err) {
        LP.toast('Error disabling SSL', 'error');
      }
    },

    async deployGit(id) {
      const btn = event.currentTarget;
      const icon = btn.innerHTML;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
      btn.disabled = true;

      try {
        const res = await LP.post(`/websites/${id}/deploy`);
        if (res?.success) {
          LP.toast('Git deployment successful', 'success');
        } else {
          LP.toast(res?.message || 'Deployment failed', 'error');
        }
      } catch (err) {
        LP.toast('Deployment error', 'error');
      } finally {
        btn.innerHTML = icon;
        btn.disabled = false;
      }
    },

    async showWebhook(id, token) {
      const url = `${window.location.origin}/api/websites/${id}/deploy/${token}`;

      // Build modal with DOM methods to avoid innerHTML injection
      const modalEl = document.createElement('div');
      modalEl.innerHTML = `
        <div class="modal fade" tabindex="-1">
          <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content" style="background: var(--bg-secondary); border: 1px solid var(--border-color); color: var(--text-primary);">
              <div class="modal-header border-0">
                <h5 class="modal-title">Webhook URL</h5>
                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
              </div>
              <div class="modal-body">
                <p style="font-size:13px;">Configure this URL in your Git repository's Webhook settings (e.g. GitHub, GitLab). Set the content type to <code>application/json</code>.</p>
                <div class="input-group mt-2">
                  <input type="text" class="form-control font-mono" style="font-size:12px; background:rgba(0,0,0,0.2); color:#fff; border-color:var(--glass-border);" readonly>
                  <button class="btn btn-outline-secondary" style="font-size:12px;">Copy</button>
                </div>
              </div>
              <div class="modal-footer border-0">
                <button class="btn-lp btn-lp-primary" data-bs-dismiss="modal">OK</button>
              </div>
            </div>
          </div>
        </div>`;

      // Set URL with textContent (safe, no innerHTML)
      const input = modalEl.querySelector('input');
      input.value = url;
      document.body.appendChild(modalEl);

      // Copy button
      const copyBtn = modalEl.querySelector('.btn-outline-secondary');
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(url).then(() => {
          LP.toast('Copied to clipboard', 'success');
        });
      });

      const bsModal = new bootstrap.Modal(modalEl.querySelector('.modal'));
      bsModal.show();
      modalEl.addEventListener('hidden.bs.modal', () => modalEl.remove());
    },

    async installPackage(pkgName) {
      if (!(await LP.confirm(`Do you want to install ${pkgName}? This may take a few minutes.`, 'Install Nginx'))) return;
      
      const spinner = document.createElement('div');
      spinner.id = 'installSpinner';
      spinner.innerHTML = `
        <div style="position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.8); z-index:9999; display:flex; flex-direction:column; align-items:center; justify-content:center;">
          <div class="spinner-border text-primary" style="width: 3rem; height: 3rem;" role="status"></div>
          <h4 style="color:#fff; margin-top:20px;">Installing ${pkgName}... Please wait.</h4>
        </div>
      `;
      document.body.appendChild(spinner);

      try {
        const res = await LP.post('/system/install', { package: pkgName });
        if (res?.success) {
          LP.toast(`${pkgName} installed successfully!`, 'success');
          loadWebsites();
        } else {
          LP.toast(`Failed to install ${pkgName}: ${res?.message}`, 'error');
        }
      } catch (e) {
        LP.toast(`Error installing ${pkgName}`, 'error');
      } finally {
        document.getElementById('installSpinner')?.remove();
      }
    },

    async configNginx(websiteId, domain) {
      currentNginxWebsiteId = websiteId;
      document.getElementById('nginxModalDomain').textContent = domain;
      document.getElementById('nginxModalFilePath').textContent = `/etc/nginx/conf.d/${domain}.conf`;
      const editor = document.getElementById('nginxConfigEditor');
      editor.value = '# Loading configuration...';
      editor.disabled = true;
      document.getElementById('btnSaveNginxConfig').disabled = true;

      if (nginxModal) nginxModal.show();

      try {
        const res = await LP.get(`/websites/${websiteId}/nginx-config`);
        if (res?.success) {
          editor.value = res.data.content || '';
          editor.disabled = false;
          document.getElementById('btnSaveNginxConfig').disabled = false;
          if (res.data.confPath) {
            document.getElementById('nginxModalFilePath').textContent = res.data.confPath;
          }
        } else {
          editor.value = `# Error: ${res?.message || 'Failed to load configuration'}`;
          LP.toast(res?.message || 'Failed to load configuration', 'error');
        }
      } catch (err) {
        editor.value = `# Error: ${err.message}`;
        LP.toast('Error loading Nginx configuration', 'error');
      }
    },

    async saveNginxConfig() {
      if (!currentNginxWebsiteId) return;
      const editor = document.getElementById('nginxConfigEditor');
      const saveBtn = document.getElementById('btnSaveNginxConfig');
      const content = editor.value;

      const originalHtml = saveBtn.innerHTML;
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status"></span> Validating & Saving...';

      try {
        const res = await LP.put(`/websites/${currentNginxWebsiteId}/nginx-config`, { content });
        if (res?.success) {
          LP.toast('Nginx configuration saved & reloaded successfully!', 'success');
          if (nginxModal) nginxModal.hide();
        } else {
          LP.toast(`Failed to save: ${res?.message || 'Unknown error'}`, 'error');
        }
      } catch (err) {
        LP.toast(`Error saving configuration: ${err.message}`, 'error');
      } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalHtml;
      }
    }
  };
})();

document.addEventListener('DOMContentLoaded', () => WebsitesPage.init());
window.WebsitesPage = WebsitesPage;
window.Websites = WebsitesPage;
window.WebsitesManager = WebsitesPage;
