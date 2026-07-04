import dockerService from '../../src/modules/docker/docker.service.js';
import firewallService from '../../src/modules/firewall/firewall.service.js';
import { successResponse, errorResponse } from '../../src/helpers/response.js';

export default {
  register(app, io) {
    // 1. Dashboard View
    app.get('/plugins/db-admin-manager', async (req, res) => {
      try {
        const containers = await dockerService.listContainers(true);

        const getStatus = (name, defaultPort) => {
          const container = containers.find(c => c.names.includes(name));
          if (!container) return { state: 'not_installed', status: 'Not Installed', port: defaultPort };
          const portObj = container.ports?.find(p => p.PrivatePort === (name === 'adminer' ? 8080 : 80));
          return {
            state: container.state,
            status: container.status,
            port: (portObj && portObj.PublicPort) ? portObj.PublicPort : defaultPort
          };
        };

        const pma = getStatus('phpmyadmin', 8081);
        const adminer = getStatus('adminer', 8082);
        const pgadmin = getStatus('pgadmin', 8083);

        res.render('layout', {
          title: 'DB Web Admin',
          body: `
            <div class="lp-page-header" style="margin-bottom:25px; display:flex; justify-content:space-between; align-items:flex-end;">
              <div>
                <h1 class="lp-page-title" style="font-size:24px;font-weight:600;margin:0;"><i class="bi bi-database-fill-gear text-emerald me-2"></i> Database Web Admin</h1>
                <p class="lp-page-subtitle" style="color:var(--text-muted);margin:0;">Deploy web-based administration interfaces for your database engines</p>
              </div>
            </div>

            <div class="row g-4">
              <!-- phpMyAdmin Card -->
              <div class="col-12 col-md-4">
                <div class="lp-glass-card p-4 text-center d-flex flex-column h-100 justify-content-between">
                  <div>
                    <div style="width:64px; height:64px; border-radius:12px; background:rgba(16,185,129,0.1); color:#10b981; display:flex; align-items:center; justify-content:center; margin:0 auto 15px; font-size:28px;">
                      <i class="bi bi-browser-safari"></i>
                    </div>
                    <h5 style="font-weight:700; margin-bottom:5px;">phpMyAdmin</h5>
                    <p class="text-muted" style="font-size:12px; margin-bottom:15px;">Web interface for MySQL/MariaDB database administration</p>
                    <div class="mb-3">
                      ${pma.state === 'running' 
                        ? `<span class="lp-badge lp-badge-success"><span class="lp-badge-dot"></span>Running</span>`
                        : pma.state === 'exited'
                          ? `<span class="lp-badge lp-badge-danger"><span class="lp-badge-dot"></span>Stopped</span>`
                          : `<span class="lp-badge lp-badge-ghost"><span class="lp-badge-dot"></span>Not Installed</span>`
                      }
                    </div>
                  </div>
                  <div>
                    <div style="display:flex; flex-direction:column; gap:10px;">
                      ${pma.state === 'running'
                        ? `
                          <a href="http://${req.hostname}:${pma.port}" target="_blank" class="btn-lp btn-lp-primary w-100"><i class="bi bi-box-arrow-up-right me-1"></i> Open phpMyAdmin</a>
                          <button class="btn-lp btn-lp-ghost text-danger w-100 btn-lp-sm" onclick="DBAdminPage.stop('phpmyadmin')">Stop</button>
                        `
                        : pma.state === 'exited'
                          ? `
                            <button class="btn-lp btn-lp-primary w-100" onclick="DBAdminPage.start('phpmyadmin')">Start</button>
                            <button class="btn-lp btn-lp-ghost text-danger w-100 btn-lp-sm" onclick="DBAdminPage.uninstall('phpmyadmin')">Uninstall</button>
                          `
                          : `
                            <button class="btn-lp btn-lp-primary w-100" onclick="DBAdminPage.showDeployModal('phpmyadmin', 8081)">Deploy phpMyAdmin</button>
                          `
                      }
                    </div>
                  </div>
                </div>
              </div>

              <!-- Adminer Card -->
              <div class="col-12 col-md-4">
                <div class="lp-glass-card p-4 text-center d-flex flex-column h-100 justify-content-between">
                  <div>
                    <div style="width:64px; height:64px; border-radius:12px; background:rgba(59,130,246,0.1); color:#3b82f6; display:flex; align-items:center; justify-content:center; margin:0 auto 15px; font-size:28px;">
                      <i class="bi bi-database"></i>
                    </div>
                    <h5 style="font-weight:700; margin-bottom:5px;">Adminer</h5>
                    <p class="text-muted" style="font-size:12px; margin-bottom:15px;">Lightweight manager supporting MySQL, PostgreSQL, SQLite, etc.</p>
                    <div class="mb-3">
                      ${adminer.state === 'running' 
                        ? `<span class="lp-badge lp-badge-success"><span class="lp-badge-dot"></span>Running</span>`
                        : adminer.state === 'exited'
                          ? `<span class="lp-badge lp-badge-danger"><span class="lp-badge-dot"></span>Stopped</span>`
                          : `<span class="lp-badge lp-badge-ghost"><span class="lp-badge-dot"></span>Not Installed</span>`
                      }
                    </div>
                  </div>
                  <div>
                    <div style="display:flex; flex-direction:column; gap:10px;">
                      ${adminer.state === 'running'
                        ? `
                          <a href="http://${req.hostname}:${adminer.port}" target="_blank" class="btn-lp btn-lp-primary w-100"><i class="bi bi-box-arrow-up-right me-1"></i> Open Adminer</a>
                          <button class="btn-lp btn-lp-ghost text-danger w-100 btn-lp-sm" onclick="DBAdminPage.stop('adminer')">Stop</button>
                        `
                        : adminer.state === 'exited'
                          ? `
                            <button class="btn-lp btn-lp-primary w-100" onclick="DBAdminPage.start('adminer')">Start</button>
                            <button class="btn-lp btn-lp-ghost text-danger w-100 btn-lp-sm" onclick="DBAdminPage.uninstall('adminer')">Uninstall</button>
                          `
                          : `
                            <button class="btn-lp btn-lp-primary w-100" onclick="DBAdminPage.showDeployModal('adminer', 8082)">Deploy Adminer</button>
                          `
                      }
                    </div>
                  </div>
                </div>
              </div>

              <!-- pgAdmin Card -->
              <div class="col-12 col-md-4">
                <div class="lp-glass-card p-4 text-center d-flex flex-column h-100 justify-content-between">
                  <div>
                    <div style="width:64px; height:64px; border-radius:12px; background:rgba(99,102,241,0.1); color:#6366f1; display:flex; align-items:center; justify-content:center; margin:0 auto 15px; font-size:28px;">
                      <i class="bi bi-file-earmark-code"></i>
                    </div>
                    <h5 style="font-weight:700; margin-bottom:5px;">pgAdmin</h5>
                    <p class="text-muted" style="font-size:12px; margin-bottom:15px;">Full-featured web administration interface for PostgreSQL databases</p>
                    <div class="mb-3">
                      ${pgadmin.state === 'running' 
                        ? `<span class="lp-badge lp-badge-success"><span class="lp-badge-dot"></span>Running</span>`
                        : pgadmin.state === 'exited'
                          ? `<span class="lp-badge lp-badge-danger"><span class="lp-badge-dot"></span>Stopped</span>`
                          : `<span class="lp-badge lp-badge-ghost"><span class="lp-badge-dot"></span>Not Installed</span>`
                      }
                    </div>
                  </div>
                  <div>
                    <div style="display:flex; flex-direction:column; gap:10px;">
                      ${pgadmin.state === 'running'
                        ? `
                          <a href="http://${req.hostname}:${pgadmin.port}" target="_blank" class="btn-lp btn-lp-primary w-100"><i class="bi bi-box-arrow-up-right me-1"></i> Open pgAdmin</a>
                          <button class="btn-lp btn-lp-ghost text-danger w-100 btn-lp-sm" onclick="DBAdminPage.stop('pgadmin')">Stop</button>
                        `
                        : pgadmin.state === 'exited'
                          ? `
                            <button class="btn-lp btn-lp-primary w-100" onclick="DBAdminPage.start('pgadmin')">Start</button>
                            <button class="btn-lp btn-lp-ghost text-danger w-100 btn-lp-sm" onclick="DBAdminPage.uninstall('pgadmin')">Uninstall</button>
                          `
                          : `
                            <button class="btn-lp btn-lp-primary w-100" onclick="DBAdminPage.showDeployModal('pgadmin', 8083)">Deploy pgAdmin</button>
                          `
                      }
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Deploy Modal -->
            <div class="modal fade" id="deployDBAdminModal" tabindex="-1">
              <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content" style="background:var(--bg-primary); border:1px solid var(--glass-border);">
                  <div class="modal-header">
                    <h5 class="modal-title font-mono" id="modalTitle" style="font-size:14px">Deploy Database Manager</h5>
                    <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                  </div>
                  <form id="deployDBAdminForm" onsubmit="DBAdminPage.deploy(event)">
                    <input type="hidden" id="deployPkg">
                    <div class="modal-body">
                      <div class="lp-form-group mb-3">
                        <label class="lp-label">Access Port</label>
                        <input type="number" id="deployPort" class="lp-input" required min="80" max="65535">
                      </div>
                      
                      <!-- Specific fields for phpMyAdmin -->
                      <div id="pmaFields" style="display:none;">
                        <div class="lp-form-group mb-3">
                          <label class="lp-label">MySQL Host IP (inside container / host)</label>
                          <input type="text" id="pmaHost" class="lp-input" value="172.17.0.1">
                          <small class="text-muted mt-1 d-block" style="font-size:11px;">Normally the Docker bridge gateway 172.17.0.1 routes to host databases.</small>
                        </div>
                      </div>

                      <!-- Specific fields for pgAdmin -->
                      <div id="pgadminFields" style="display:none;">
                        <div class="lp-form-group mb-3">
                          <label class="lp-label">Default Admin Email</label>
                          <input type="email" id="pgadminEmail" class="lp-input" value="admin@panelku.local">
                        </div>
                        <div class="lp-form-group mb-3">
                          <label class="lp-label">Default Admin Password</label>
                          <input type="password" id="pgadminPassword" class="lp-input" value="Admin@123456">
                        </div>
                      </div>
                    </div>
                    <div class="modal-footer">
                      <button type="button" class="btn-lp btn-lp-ghost" data-bs-dismiss="modal">Cancel</button>
                      <button type="submit" class="btn-lp btn-lp-primary">Deploy Container</button>
                    </div>
                  </form>
                </div>
              </div>
            </div>

            <script>
              const DBAdminPage = (() => {
                let modal = null;

                function showDeployModal(pkg, defaultPort) {
                  document.getElementById('deployPkg').value = pkg;
                  document.getElementById('deployPort').value = defaultPort;
                  document.getElementById('modalTitle').textContent = 'Deploy ' + pkg;
                  
                  // Toggle specific forms
                  document.getElementById('pmaFields').style.display = pkg === 'phpmyadmin' ? 'block' : 'none';
                  document.getElementById('pgadminFields').style.display = pkg === 'pgadmin' ? 'block' : 'none';
                  
                  modal = new bootstrap.Modal(document.getElementById('deployDBAdminModal'));
                  modal.show();
                }

                async function deploy(e) {
                  e.preventDefault();
                  const pkg = document.getElementById('deployPkg').value;
                  const port = document.getElementById('deployPort').value;
                  const pmaHost = document.getElementById('pmaHost').value;
                  const pgadminEmail = document.getElementById('pgadminEmail').value;
                  const pgadminPassword = document.getElementById('pgadminPassword').value;
                  
                  if (modal) modal.hide();

                  const spinner = document.createElement('div');
                  spinner.id = 'dbAdminDeploySpinner';
                  spinner.innerHTML = \`
                    <div style="position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.8); z-index:9999; display:flex; flex-direction:column; align-items:center; justify-content:center;">
                      <div class="spinner-border text-primary" style="width: 3rem; height: 3rem;" role="status"></div>
                      <h4 style="color:#fff; margin-top:20px;">Deploying \${pkg}... Please wait.</h4>
                    </div>
                  \`;
                  document.body.appendChild(spinner);

                  try {
                    const res = await LP.post('/plugins/db-admin-manager/deploy', {
                      package: pkg, port, pmaHost, pgadminEmail, pgadminPassword
                    });
                    if (res?.success) {
                      LP.toast(pkg + ' deployed successfully!', 'success');
                      window.location.reload();
                    } else {
                      LP.toast(res?.message || 'Deployment failed', 'error');
                    }
                  } catch (err) {
                    LP.toast('Deployment error', 'error');
                  } finally {
                    document.getElementById('dbAdminDeploySpinner')?.remove();
                  }
                }

                async function start(pkg) {
                  LP.toast('Starting container...', 'info');
                  const res = await LP.post('/plugins/db-admin-manager/start', { package: pkg });
                  if (res?.success) {
                    LP.toast(pkg + ' started', 'success');
                    window.location.reload();
                  } else {
                    LP.toast(res?.message || 'Start failed', 'error');
                  }
                }

                async function stop(pkg) {
                  if (!await LP.confirm('Are you sure you want to stop ' + pkg + '?', 'Stop Service')) return;
                  LP.toast('Stopping container...', 'info');
                  const res = await LP.post('/plugins/db-admin-manager/stop', { package: pkg });
                  if (res?.success) {
                    LP.toast(pkg + ' stopped', 'success');
                    window.location.reload();
                  } else {
                    LP.toast(res?.message || 'Stop failed', 'error');
                  }
                }

                async function uninstall(pkg) {
                  if (!await LP.confirm('Are you sure you want to completely remove ' + pkg + '?', 'Uninstall Manager')) return;
                  LP.toast('Removing container...', 'info');
                  const res = await LP.post('/plugins/db-admin-manager/uninstall', { package: pkg });
                  if (res?.success) {
                    LP.toast(pkg + ' uninstalled', 'success');
                    window.location.reload();
                  } else {
                    LP.toast(res?.message || 'Uninstall failed', 'error');
                  }
                }

                return { showDeployModal, deploy, start, stop, uninstall };
              })();
            </script>
          `,
          layout: false
        });
      } catch (err) {
        res.status(500).send('Internal Server Error: ' + err.message);
      }
    });

    // 2. Deploy API
    app.post('/plugins/db-admin-manager/deploy', async (req, res) => {
      try {
        const { package: pkg, port, pmaHost = '172.17.0.1', pgadminEmail, pgadminPassword } = req.body;
        
        let composeYaml = '';
        if (pkg === 'phpmyadmin') {
          composeYaml = `
version: '3.1'
services:
  phpmyadmin:
    image: phpmyadmin:latest
    container_name: phpmyadmin
    ports:
      - "${port}:80"
    environment:
      PMA_HOST: "${pmaHost}"
      PMA_ARBITRARY: 1
    restart: unless-stopped
`;
        } else if (pkg === 'adminer') {
          composeYaml = `
version: '3.1'
services:
  adminer:
    image: adminer:latest
    container_name: adminer
    ports:
      - "${port}:8080"
    restart: unless-stopped
`;
        } else if (pkg === 'pgadmin') {
          composeYaml = `
version: '3.1'
services:
  pgadmin:
    image: dpage/pgadmin4:latest
    container_name: pgadmin
    ports:
      - "${port}:80"
    environment:
      PGADMIN_DEFAULT_EMAIL: "${pgadminEmail}"
      PGADMIN_DEFAULT_PASSWORD: "${pgadminPassword}"
      PGADMIN_LISTEN_PORT: 80
    restart: unless-stopped
`;
        } else {
          return errorResponse(res, 'Invalid package name', 400);
        }

        await dockerService.deployCompose(pkg, composeYaml);
        try {
          await firewallService.addRule(port, 'tcp');
        } catch (fwErr) {
          console.warn('Firewall: failed to allow port', port, fwErr.message);
        }
        return successResponse(res, null, `${pkg} deployed successfully`);
      } catch (error) {
        return errorResponse(res, error.message, 500);
      }
    });

    // 3. Start API
    app.post('/plugins/db-admin-manager/start', async (req, res) => {
      try {
        const { package: pkg } = req.body;
        const containers = await dockerService.docker.listContainers({ all: true });
        const target = containers.find(c => c.Names.includes('/' + pkg));
        if (!target) return errorResponse(res, 'Container not found', 404);
        
        const container = dockerService.docker.getContainer(target.Id);
        await container.start();
        return successResponse(res, null, `${pkg} started`);
      } catch (error) {
        return errorResponse(res, error.message, 500);
      }
    });

    // 4. Stop API
    app.post('/plugins/db-admin-manager/stop', async (req, res) => {
      try {
        const { package: pkg } = req.body;
        const containers = await dockerService.docker.listContainers({ all: true });
        const target = containers.find(c => c.Names.includes('/' + pkg));
        if (!target) return errorResponse(res, 'Container not found', 404);
        
        const container = dockerService.docker.getContainer(target.Id);
        await container.stop();
        return successResponse(res, null, `${pkg} stopped`);
      } catch (error) {
        return errorResponse(res, error.message, 500);
      }
    });

    // 5. Uninstall API
    app.post('/plugins/db-admin-manager/uninstall', async (req, res) => {
      try {
        const { package: pkg } = req.body;
        const containers = await dockerService.docker.listContainers({ all: true });
        const target = containers.find(c => c.Names.includes('/' + pkg));
        if (!target) return errorResponse(res, 'Container not found', 404);
        
        const container = dockerService.docker.getContainer(target.Id);
        try { await container.stop(); } catch (e) {}
        try { await container.remove({ force: true }); } catch (e) {}
        
        return successResponse(res, null, `${pkg} uninstalled`);
      } catch (error) {
        return errorResponse(res, error.message, 500);
      }
    });
  }
};
