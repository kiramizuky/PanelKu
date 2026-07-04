import dockerService from '../../src/modules/docker/docker.service.js';
import { successResponse, errorResponse } from '../../src/helpers/response.js';

export default {
  register(app, io) {
    // 1. Nextcloud Manager Dashboard View
    app.get('/plugins/nextcloud-manager', async (req, res) => {
      try {
        const containers = await dockerService.listContainers(true);
        const ncContainer = containers.find(c => c.names.includes('nextcloud-app'));
        
        let containerStatus = 'Not Installed';
        let containerState = '';
        let portMapped = '8080';
        
        if (ncContainer) {
          containerStatus = ncContainer.status; // e.g. "Up 2 hours"
          containerState = ncContainer.state; // e.g. "running"
          const portObj = ncContainer.ports?.find(p => p.PrivatePort === 80);
          if (portObj && portObj.PublicPort) {
            portMapped = portObj.PublicPort;
          }
        }

        res.render('layout', {
          title: 'Nextcloud Manager',
          body: `
            <div class="lp-page-header" style="margin-bottom:25px; display:flex; justify-content:space-between; align-items:flex-end;">
              <div>
                <h1 class="lp-page-title" style="font-size:24px;font-weight:600;margin:0;"><i class="bi bi-cloud-fill text-info me-2"></i> Nextcloud Manager</h1>
                <p class="lp-page-subtitle" style="color:var(--text-muted);margin:0;">Deploy and manage your personal Cloud Storage service</p>
              </div>
            </div>

            <div class="row g-4">
              <!-- Left side: Status & Actions -->
              <div class="col-12 col-md-4">
                <div class="lp-glass-card p-4 text-center">
                  <div style="width:72px; height:72px; border-radius:50%; background:rgba(14,165,233,0.1); color:var(--accent-info); display:flex; align-items:center; justify-content:center; margin:0 auto 15px; font-size:32px;">
                    <i class="bi bi-cloud-check-fill"></i>
                  </div>
                  <h5 style="font-weight:700; margin-bottom:5px;">Service Status</h5>
                  <div class="mb-3">
                    ${containerState === 'running' 
                      ? `<span class="lp-badge lp-badge-success"><span class="lp-badge-dot"></span>Running</span>`
                      : containerState === 'exited'
                        ? `<span class="lp-badge lp-badge-danger"><span class="lp-badge-dot"></span>Stopped</span>`
                        : `<span class="lp-badge lp-badge-ghost"><span class="lp-badge-dot"></span>Not Installed</span>`
                    }
                  </div>
                  <p class="text-muted" style="font-size:12px; margin-bottom:20px;">
                    ${ncContainer ? `Container status: ${containerStatus}` : 'Nextcloud container is not yet deployed on your server.'}
                  </p>

                  <div style="display:flex; flex-direction:column; gap:10px;">
                    ${containerState === 'running'
                      ? `
                        <a href="http://\${req.hostname}:\${portMapped}" target="_blank" class="btn-lp btn-lp-primary w-100"><i class="bi bi-box-arrow-up-right me-1"></i> Open Nextcloud</a>
                        <button class="btn-lp btn-lp-ghost text-danger w-100" onclick="NextcloudPage.stop()"><i class="bi bi-stop-circle me-1"></i> Stop Service</button>
                      `
                      : containerState === 'exited'
                        ? `
                          <button class="btn-lp btn-lp-primary w-100" onclick="NextcloudPage.start()"><i class="bi bi-play-circle me-1"></i> Start Service</button>
                          <button class="btn-lp btn-lp-ghost text-danger w-100" onclick="NextcloudPage.destroy()"><i class="bi bi-trash me-1"></i> Uninstall</button>
                        `
                        : `
                          <button class="btn-lp btn-lp-primary w-100" onclick="NextcloudPage.showDeployModal()"><i class="bi bi-rocket-takeoff me-1"></i> Deploy Nextcloud</button>
                        `
                    }
                  </div>
                </div>
              </div>

              <!-- Right side: Information/Configuration -->
              <div class="col-12 col-md-8">
                <div class="lp-glass-card p-4">
                  <h5 style="font-weight:700; margin-bottom:15px;"><i class="bi bi-info-circle text-primary me-2"></i> About Nextcloud</h5>
                  <p class="text-slate-300" style="font-size:13px; line-height:1.6; margin-bottom:15px;">
                    Nextcloud is a suite of client-server software for creating and using file hosting services. It provides functional security and control equivalent to Dropbox or Google Drive, but runs completely self-hosted on your own server.
                  </p>
                  <ul class="text-slate-400" style="font-size:12px; line-height:1.8; list-style-type: disc; padding-left: 20px;">
                    <li>Access files from Web, Desktop Client, or Mobile apps (Android & iOS).</li>
                    <li>Synchronize contacts, calendars, and tasks.</li>
                    <li>Built-in collaborative document editing features.</li>
                    <li>Uses SQLite for database storage inside the container.</li>
                  </ul>
                </div>
              </div>
            </div>

            <!-- Deploy Modal -->
            <div class="modal fade" id="deployNcModal" tabindex="-1">
              <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content" style="background:var(--bg-primary); border:1px solid var(--glass-border);">
                  <div class="modal-header">
                    <h5 class="modal-title font-mono" style="font-size:14px">Deploy Nextcloud Container</h5>
                    <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                  </div>
                  <form id="deployNcForm" onsubmit="NextcloudPage.deploy(event)">
                    <div class="modal-body">
                      <div class="lp-form-group">
                        <label class="lp-label">HTTP Host Port</label>
                        <input type="number" id="ncPort" class="lp-input" value="8080" required min="80" max="65535">
                        <small class="text-muted mt-1 d-block" style="font-size:11px;">Select a port to bind Nextcloud web panel (e.g. 8080).</small>
                      </div>
                    </div>
                    <div class="modal-footer">
                      <button type="button" class="btn-lp btn-lp-ghost" data-bs-dismiss="modal">Cancel</button>
                      <button type="submit" class="btn-lp btn-lp-primary">Start Deploying</button>
                    </div>
                  </form>
                </div>
              </div>
            </div>

            <script>
              const NextcloudPage = (() => {
                let modal = null;

                function showDeployModal() {
                  modal = new bootstrap.Modal(document.getElementById('deployNcModal'));
                  modal.show();
                }

                async function deploy(e) {
                  e.preventDefault();
                  const port = document.getElementById('ncPort').value;
                  
                  if (modal) modal.hide();
                  
                  // Show global spinner
                  const spinner = document.createElement('div');
                  spinner.id = 'ncDeploySpinner';
                  spinner.innerHTML = \`
                    <div style="position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.8); z-index:9999; display:flex; flex-direction:column; align-items:center; justify-content:center;">
                      <div class="spinner-border text-info" style="width: 3rem; height: 3rem;" role="status"></div>
                      <h4 style="color:#fff; margin-top:20px;">Deploying Nextcloud... This might take a minute.</h4>
                    </div>
                  \`;
                  document.body.appendChild(spinner);

                  try {
                    const res = await LP.post('/plugins/nextcloud-manager/deploy', { port });
                    if (res?.success) {
                      LP.toast('Nextcloud deployed successfully!', 'success');
                      window.location.reload();
                    } else {
                      LP.toast(res?.message || 'Deployment failed', 'error');
                    }
                  } catch (err) {
                    LP.toast('Deployment error', 'error');
                  } finally {
                    document.getElementById('ncDeploySpinner')?.remove();
                  }
                }

                async function start() {
                  LP.toast('Starting container...', 'info');
                  const res = await LP.post('/plugins/nextcloud-manager/start');
                  if (res?.success) {
                    LP.toast('Nextcloud started', 'success');
                    window.location.reload();
                  } else {
                    LP.toast(res?.message || 'Start failed', 'error');
                  }
                }

                async function stop() {
                  if (!await LP.confirm('Are you sure you want to stop Nextcloud?', 'Stop Nextcloud')) return;
                  LP.toast('Stopping container...', 'info');
                  const res = await LP.post('/plugins/nextcloud-manager/stop');
                  if (res?.success) {
                    LP.toast('Nextcloud stopped', 'success');
                    window.location.reload();
                  } else {
                    LP.toast(res?.message || 'Stop failed', 'error');
                  }
                }

                async function destroy() {
                  if (!await LP.confirm('Are you sure you want to completely uninstall Nextcloud? All app files will be removed.', 'Uninstall Nextcloud')) return;
                  LP.toast('Removing Nextcloud...', 'info');
                  const res = await LP.post('/plugins/nextcloud-manager/uninstall');
                  if (res?.success) {
                    LP.toast('Nextcloud uninstalled', 'success');
                    window.location.reload();
                  } else {
                    LP.toast(res?.message || 'Uninstall failed', 'error');
                  }
                }

                return { showDeployModal, deploy, start, stop, destroy };
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
    app.post('/plugins/nextcloud-manager/deploy', async (req, res) => {
      try {
        const { port = 8080 } = req.body;
        
        // Define docker-compose yml
        const composeYaml = `
version: '3'
services:
  nextcloud:
    image: nextcloud:latest
    container_name: nextcloud-app
    ports:
      - "${port}:80"
    volumes:
      - nextcloud_data:/var/www/html
    restart: unless-stopped

volumes:
  nextcloud_data:
`;
        await dockerService.deployCompose('nextcloud', composeYaml);
        return successResponse(res, null, 'Nextcloud deployed successfully');
      } catch (error) {
        return errorResponse(res, error.message, 500);
      }
    });

    // 3. Start API
    app.post('/plugins/nextcloud-manager/start', async (req, res) => {
      try {
        const containers = await dockerService.docker.listContainers({ all: true });
        const ncContainer = containers.find(c => c.Names.includes('/nextcloud-app'));
        if (!ncContainer) return errorResponse(res, 'Container not found', 404);
        
        const container = dockerService.docker.getContainer(ncContainer.Id);
        await container.start();
        return successResponse(res, null, 'Nextcloud started');
      } catch (error) {
        return errorResponse(res, error.message, 500);
      }
    });

    // 4. Stop API
    app.post('/plugins/nextcloud-manager/stop', async (req, res) => {
      try {
        const containers = await dockerService.docker.listContainers({ all: true });
        const ncContainer = containers.find(c => c.Names.includes('/nextcloud-app'));
        if (!ncContainer) return errorResponse(res, 'Container not found', 404);
        
        const container = dockerService.docker.getContainer(ncContainer.Id);
        await container.stop();
        return successResponse(res, null, 'Nextcloud stopped');
      } catch (error) {
        return errorResponse(res, error.message, 500);
      }
    });

    // 5. Uninstall API
    app.post('/plugins/nextcloud-manager/uninstall', async (req, res) => {
      try {
        const containers = await dockerService.docker.listContainers({ all: true });
        const ncContainer = containers.find(c => c.Names.includes('/nextcloud-app'));
        if (!ncContainer) return errorResponse(res, 'Container not found', 404);
        
        const container = dockerService.docker.getContainer(ncContainer.Id);
        try { await container.stop(); } catch (e) {}
        try { await container.remove({ force: true }); } catch (e) {}
        
        // Remove volumes if needed
        try {
          const vol = dockerService.docker.getVolume('nextcloud_nextcloud_data');
          await vol.remove();
        } catch (e) {}

        return successResponse(res, null, 'Nextcloud uninstalled');
      } catch (error) {
        return errorResponse(res, error.message, 500);
      }
    });
  }
};
