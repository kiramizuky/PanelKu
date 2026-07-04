import dockerService from '../../src/modules/docker/docker.service.js';
import { successResponse, errorResponse } from '../../src/helpers/response.js';

export default {
  register(app, io) {
    // 1. MinIO View
    app.get('/plugins/minio-manager', async (req, res) => {
      try {
        const containers = await dockerService.listContainers(true);
        const minioContainer = containers.find(c => c.names.includes('minio-app'));

        let containerStatus = 'Not Installed';
        let containerState = '';
        let apiPort = '9000';
        let consolePort = '9001';

        if (minioContainer) {
          containerStatus = minioContainer.status;
          containerState = minioContainer.state;
          const apiPortObj = minioContainer.ports?.find(p => p.PrivatePort === 9000);
          const consolePortObj = minioContainer.ports?.find(p => p.PrivatePort === 9001);
          if (apiPortObj && apiPortObj.PublicPort) apiPort = apiPortObj.PublicPort;
          if (consolePortObj && consolePortObj.PublicPort) consolePort = consolePortObj.PublicPort;
        }

        res.render('layout', {
          title: 'MinIO Server',
          body: `
            <div class="lp-page-header" style="margin-bottom:25px; display:flex; justify-content:space-between; align-items:flex-end;">
              <div>
                <h1 class="lp-page-title" style="font-size:24px;font-weight:600;margin:0;"><i class="bi bi-box-fill text-danger me-2"></i> MinIO Server</h1>
                <p class="lp-page-subtitle" style="color:var(--text-muted);margin:0;">High-performance, S3-compatible self-hosted object storage</p>
              </div>
            </div>

            <div class="row g-4">
              <!-- Left: CLI status -->
              <div class="col-12 col-md-4">
                <div class="lp-glass-card p-4 text-center">
                  <div style="width:72px; height:72px; border-radius:50%; background:rgba(236,72,153,0.1); color:var(--accent-danger); display:flex; align-items:center; justify-content:center; margin:0 auto 15px; font-size:32px;">
                    <i class="bi bi-box-fill"></i>
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
                    ${minioContainer ? `Container status: ${containerStatus}` : 'MinIO container is not yet deployed on your server.'}
                  </p>

                  <div style="display:flex; flex-direction:column; gap:10px;">
                    ${containerState === 'running'
                      ? `
                        <a href="http://\${req.hostname}:\${consolePort}" target="_blank" class="btn-lp btn-lp-primary w-100"><i class="bi bi-box-arrow-up-right me-1"></i> Open Console Panel</a>
                        <button class="btn-lp btn-lp-ghost text-danger w-100" onclick="MinioPage.stop()"><i class="bi bi-stop-circle me-1"></i> Stop Service</button>
                      `
                      : containerState === 'exited'
                        ? `
                          <button class="btn-lp btn-lp-primary w-100" onclick="MinioPage.start()"><i class="bi bi-play-circle me-1"></i> Start Service</button>
                          <button class="btn-lp btn-lp-ghost text-danger w-100" onclick="MinioPage.destroy()"><i class="bi bi-trash me-1"></i> Uninstall</button>
                        `
                        : `
                          <button class="btn-lp btn-lp-primary w-100" onclick="MinioPage.showDeployModal()"><i class="bi bi-rocket-takeoff me-1"></i> Deploy MinIO</button>
                        `
                    }
                  </div>
                </div>
              </div>

              <!-- Right: Info -->
              <div class="col-12 col-md-8">
                <div class="lp-glass-card p-4">
                  <h5 style="font-weight:700; margin-bottom:15px;"><i class="bi bi-info-circle text-primary me-2"></i> Object Storage (S3 Compatible)</h5>
                  <p class="text-slate-300" style="font-size:13px; line-height:1.6; margin-bottom:15px;">
                    MinIO is a high-performance object storage server compatible with Amazon S3. It is ideal for storing unstructured data such as photos, videos, log files, backups, and container images.
                  </p>
                  
                  ${containerState === 'running'
                    ? `
                      <div class="mt-4 p-3 rounded" style="background:rgba(0,0,0,0.2); border:1px solid var(--glass-border);">
                        <h6 class="font-mono text-warning" style="font-size:13px; font-weight:600; margin-bottom:10px;">Connection Details</h6>
                        <ul class="text-slate-400 font-mono" style="font-size:11px; line-height:1.8; list-style-type:none; padding-left:0;">
                          <li>S3 API Endpoint: <strong>http://\${req.hostname}:\${apiPort}</strong></li>
                          <li>Console Web Panel: <strong>http://\${req.hostname}:\${consolePort}</strong></li>
                        </ul>
                      </div>
                    `
                    : `
                      <p class="text-slate-400" style="font-size:12px;">Configure username, password, and ports on deployment to set up your S3 instance instantly.</p>
                    `
                  }
                </div>
              </div>
            </div>

            <!-- Deploy Modal -->
            <div class="modal fade" id="deployMinioModal" tabindex="-1">
              <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content" style="background:var(--bg-primary); border:1px solid var(--glass-border);">
                  <div class="modal-header">
                    <h5 class="modal-title font-mono" style="font-size:14px">Deploy MinIO Server</h5>
                    <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                  </div>
                  <form id="deployMinioForm" onsubmit="MinioPage.deploy(event)">
                    <div class="modal-body">
                      <div class="lp-form-group">
                        <label class="lp-label">S3 API Port</label>
                        <input type="number" id="minioApiPort" class="lp-input" value="9000" required>
                      </div>
                      <div class="lp-form-group mt-3">
                        <label class="lp-label">Web Console Port</label>
                        <input type="number" id="minioConsolePort" class="lp-input" value="9001" required>
                      </div>
                      <div class="lp-form-group mt-3">
                        <label class="lp-label">Root Username</label>
                        <input type="text" id="minioUser" class="lp-input" value="minioadmin" required>
                      </div>
                      <div class="lp-form-group mt-3">
                        <label class="lp-label">Root Password (Min. 8 characters)</label>
                        <input type="password" id="minioPassword" class="lp-input" value="minioadmin" required minlength="8">
                      </div>
                    </div>
                    <div class="modal-footer">
                      <button type="button" class="btn-lp btn-lp-ghost" data-bs-dismiss="modal">Cancel</button>
                      <button type="submit" class="btn-lp btn-lp-primary">Deploy Server</button>
                    </div>
                  </form>
                </div>
              </div>
            </div>

            <script>
              const MinioPage = (() => {
                let modal = null;

                function showDeployModal() {
                  modal = new bootstrap.Modal(document.getElementById('deployMinioModal'));
                  modal.show();
                }

                async function deploy(e) {
                  e.preventDefault();
                  const port = document.getElementById('minioApiPort').value;
                  const consolePort = document.getElementById('minioConsolePort').value;
                  const user = document.getElementById('minioUser').value;
                  const password = document.getElementById('minioPassword').value;

                  if (modal) modal.hide();

                  const spinner = document.createElement('div');
                  spinner.id = 'minioDeploySpinner';
                  spinner.innerHTML = \`
                    <div style="position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.8); z-index:9999; display:flex; flex-direction:column; align-items:center; justify-content:center;">
                      <div class="spinner-border text-danger" style="width: 3rem; height: 3rem;" role="status"></div>
                      <h4 style="color:#fff; margin-top:20px;">Deploying MinIO Server... This might take a minute.</h4>
                    </div>
                  \`;
                  document.body.appendChild(spinner);

                  try {
                    const res = await LP.post('/plugins/minio-manager/deploy', { port, consolePort, user, password });
                    if (res?.success) {
                      LP.toast('MinIO Server deployed successfully!', 'success');
                      window.location.reload();
                    } else {
                      LP.toast(res?.message || 'Deployment failed', 'error');
                    }
                  } catch (err) {
                    LP.toast('Deployment error', 'error');
                  } finally {
                    document.getElementById('minioDeploySpinner')?.remove();
                  }
                }

                async function start() {
                  LP.toast('Starting container...', 'info');
                  const res = await LP.post('/plugins/minio-manager/start');
                  if (res?.success) {
                    LP.toast('MinIO started', 'success');
                    window.location.reload();
                  } else {
                    LP.toast(res?.message || 'Start failed', 'error');
                  }
                }

                async function stop() {
                  if (!await LP.confirm('Are you sure you want to stop MinIO?', 'Stop MinIO')) return;
                  LP.toast('Stopping container...', 'info');
                  const res = await LP.post('/plugins/minio-manager/stop');
                  if (res?.success) {
                    LP.toast('MinIO stopped', 'success');
                    window.location.reload();
                  } else {
                    LP.toast(res?.message || 'Stop failed', 'error');
                  }
                }

                async function destroy() {
                  if (!await LP.confirm('Are you sure you want to completely uninstall MinIO? All storage volumes will be deleted.', 'Uninstall MinIO')) return;
                  LP.toast('Removing MinIO...', 'info');
                  const res = await LP.post('/plugins/minio-manager/uninstall');
                  if (res?.success) {
                    LP.toast('MinIO uninstalled', 'success');
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
    app.post('/plugins/minio-manager/deploy', async (req, res) => {
      try {
        const { port = 9000, consolePort = 9001, user, password } = req.body;
        if (!user || !password) return errorResponse(res, 'Credentials are required', 400);

        const composeYaml = `
version: '3'
services:
  minio:
    image: quay.io/minio/minio:latest
    container_name: minio-app
    ports:
      - "${port}:9000"
      - "${consolePort}:9001"
    volumes:
      - minio_data:/data
    environment:
      MINIO_ROOT_USER: "${user}"
      MINIO_ROOT_PASSWORD: "${password}"
    command: server /data --console-address ":9001"
    restart: unless-stopped

volumes:
  minio_data:
`;
        await dockerService.deployCompose('minio', composeYaml);
        return successResponse(res, null, 'MinIO deployed successfully');
      } catch (error) {
        return errorResponse(res, error.message, 500);
      }
    });

    // 3. Start API
    app.post('/plugins/minio-manager/start', async (req, res) => {
      try {
        const containers = await dockerService.docker.listContainers({ all: true });
        const minioContainer = containers.find(c => c.Names.includes('/minio-app'));
        if (!minioContainer) return errorResponse(res, 'Container not found', 404);
        
        const container = dockerService.docker.getContainer(minioContainer.Id);
        await container.start();
        return successResponse(res, null, 'MinIO started');
      } catch (error) {
        return errorResponse(res, error.message, 500);
      }
    });

    // 4. Stop API
    app.post('/plugins/minio-manager/stop', async (req, res) => {
      try {
        const containers = await dockerService.docker.listContainers({ all: true });
        const minioContainer = containers.find(c => c.Names.includes('/minio-app'));
        if (!minioContainer) return errorResponse(res, 'Container not found', 404);
        
        const container = dockerService.docker.getContainer(minioContainer.Id);
        await container.stop();
        return successResponse(res, null, 'MinIO stopped');
      } catch (error) {
        return errorResponse(res, error.message, 500);
      }
    });

    // 5. Uninstall API
    app.post('/plugins/minio-manager/uninstall', async (req, res) => {
      try {
        const containers = await dockerService.docker.listContainers({ all: true });
        const minioContainer = containers.find(c => c.Names.includes('/minio-app'));
        if (!minioContainer) return errorResponse(res, 'Container not found', 404);
        
        const container = dockerService.docker.getContainer(minioContainer.Id);
        try { await container.stop(); } catch (e) {}
        try { await container.remove({ force: true }); } catch (e) {}
        
        // Remove volumes
        try {
          const vol = dockerService.docker.getVolume('minio_minio_data');
          await vol.remove();
        } catch (e) {}

        return successResponse(res, null, 'MinIO uninstalled');
      } catch (error) {
        return errorResponse(res, error.message, 500);
      }
    });
  }
};
