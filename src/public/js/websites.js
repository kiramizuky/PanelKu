/**
 * Linux Panel — websites.js
 * Website management frontend
 */

const WebsitesPage = (() => {
  let createModal = null;

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
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger">${res?.message || 'Error loading websites'}</td></tr>`;
        return;
      }

      const { websites } = res.data;
      if (!websites.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No websites configured</td></tr>';
        return;
      }

      tbody.innerHTML = websites.map(w => {
        const isProxy = w.type === 'proxy';
        const sslStatus = w.ssl?.enabled ? '<i class="bi bi-shield-lock-fill text-success" title="SSL Enabled"></i>' : '<i class="bi bi-shield-lock text-muted" title="No SSL"></i>';

        return `
          <tr>
            <td>
              <div style="font-weight:600;color:var(--text-primary)"><a href="http://${w.domain}" target="_blank" style="color:inherit;text-decoration:none">${w.domain} <i class="bi bi-box-arrow-up-right" style="font-size:10px;color:var(--text-muted)"></i></a></div>
              ${w.aliases.length ? `<div style="font-size:11px;color:var(--text-muted)">${w.aliases.join(', ')}</div>` : ''}
            </td>
            <td><span class="lp-badge ${w.status === 'active' ? 'lp-badge-success' : 'lp-badge-warning'}"><span class="lp-badge-dot"></span>${w.status}</span></td>
            <td><span class="lp-badge" style="background:var(--bg-secondary);border:1px solid var(--border-color);text-transform:uppercase">${w.type}</span></td>
            <td class="font-mono" style="font-size:12px;color:var(--text-muted)">
              ${isProxy ? `127.0.0.1:${w.port}` : w.rootDirectory}
            </td>
            <td style="font-size:14px">${sslStatus}</td>
            <td style="text-align:right">
              ${w.gitRepo ? `
                ${w.autoDeploy ? `<button class="btn-lp btn-lp-ghost btn-lp-sm text-info" onclick="WebsitesPage.showWebhook('${w._id}', '${w.webhookToken}')" title="Show Webhook URL"><i class="bi bi-link-45deg"></i></button>` : ''}
                <button class="btn-lp btn-lp-ghost btn-lp-sm text-primary" onclick="WebsitesPage.deployGit('${w._id}')" title="Deploy from Git"><i class="bi bi-cloud-arrow-down"></i></button>
              ` : ''}
              <button class="btn-lp btn-lp-ghost btn-lp-sm" onclick="WebsitesPage.configSSL('${w._id}')" title="SSL Settings"><i class="bi bi-shield"></i></button>
              <button class="btn-lp btn-lp-ghost btn-lp-sm" onclick="WebsitesPage.openFolder('${w.rootDirectory}')" title="File Manager"><i class="bi bi-folder"></i></button>
              <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="WebsitesPage.deleteWebsite('${w._id}', '${w.domain}')" title="Delete"><i class="bi bi-trash"></i></button>
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      console.error('loadWebsites error:', err);
      const tbody = document.getElementById('websitesTableBody');
      if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger">Error: ${err.message}</td></tr>`;
    }
  }

  return {
    async init() {
      await LP.init();
      if (!LP.state.accessToken) return;
      
      createModal = new bootstrap.Modal(document.getElementById('createWebsiteModal'));
      loadWebsites();
    },

    showCreateModal() {
      document.getElementById('createWebsiteForm').reset();
      this.toggleTypeFields();
      createModal.show();
    },

    toggleTypeFields() {
      const type = document.getElementById('cwType').value;
      const portGroup = document.getElementById('cwPortGroup');
      const phpGroup = document.getElementById('cwPhpGroup');
      
      if (type === 'proxy' || type === 'node') {
        portGroup.style.display = 'block';
        document.getElementById('cwPort').required = true;
      } else {
        portGroup.style.display = 'none';
        document.getElementById('cwPort').required = false;
      }
      
      if (type === 'php') {
        phpGroup.style.display = 'block';
      } else {
        phpGroup.style.display = 'none';
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

    configSSL(id) {
      LP.toast('SSL Configuration module coming soon', 'info');
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
      await LP.alert(`
        <div class="text-start">
          <p>Configure this URL in your Git repository's Webhook settings (e.g. GitHub, GitLab). Set the content type to <code>application/json</code>.</p>
          <div class="input-group mt-2">
            <input type="text" class="form-control font-mono" style="font-size:12px; background:rgba(0,0,0,0.2); color:#fff; border-color:var(--glass-border);" value="${url}" readonly id="webhookUrlCopy">
            <button class="btn btn-outline-secondary" onclick="navigator.clipboard.writeText(document.getElementById('webhookUrlCopy').value); LP.toast('Copied to clipboard', 'success');">Copy</button>
          </div>
        </div>
      `, 'Webhook URL');
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
    }
  };
})();

document.addEventListener('DOMContentLoaded', () => WebsitesPage.init());
