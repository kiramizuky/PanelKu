import dockerService from '../../src/modules/docker/docker.service.js';
import { successResponse, errorResponse } from '../../src/helpers/response.js';

export default {
  register(app, io) {
    // 1. Uptime Kuma View
    app.get('/plugins/uptime-kuma-manager', async (req, res) => {
      try {
        const containers = await dockerService.listContainers(true);
        const ukContainer = containers.find(c => c.names.includes('uptime-kuma'));

        let containerStatus = 'Not Installed';
        let containerState = '';
        let portMapped = '3001';

        if (ukContainer) {
          containerStatus = ukContainer.status;
          containerState = ukContainer.state;
          const portObj = ukContainer.ports?.find(p => p.PrivatePort === 3001);
          if (portObj && portObj.PublicPort) portMapped = portObj.PublicPort;
        }

        res.render('layout', {
          title: 'Uptime Kuma',
          body: `
            <div class="lp-page-header" style="margin-bottom:25px; display:flex; justify-content:space-between; align-items:flex-end;">
              <div>
                <h1 class="lp-page-title" style="font-size:24px;font-weight:600;margin:0;"><i class="bi bi-heart-pulse-fill text-success me-2"></i> Uptime Kuma</h1>
                <p class="lp-page-subtitle" style="color:var(--text-muted);margin:0;">Self-hosted monitoring tool for website, port, ping, and DNS status</p>
              </div>
            </div>

            <div class="row g-4">
              <!-- Left: CLI status -->
              <div class="col-12 col-md-4">
                <div class="lp-glass-card p-4 text-center">
                  <div style="width:72px; height:72px; border-radius:50%; background:rgba(34,197,94,0.1); color:var(--accent-success); display:flex; align-items:center; justify-content:center; margin:0 auto 15px; font-size:32px;">
                    <i class="bi bi-heart-pulse-fill"></i>
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
                    ${ukContainer ? `Container status: ${containerStatus}` : 'Uptime Kuma container is not yet deployed.'}
                  </p>

                  <div style="display:flex; flex-direction:column; gap:10px;">
                    ${containerState === 'running'
                      ? `
                        <a href="http://\${req.hostname}:\${portMapped}" target="_blank" class="btn-lp btn-lp-primary w-100"><i class="bi bi-box-arrow-up-right me-1"></i> Open Dashboard</a>
                        <button class="btn-lp btn-lp-ghost text-danger w-100" onclick="KumaPage.stop()"><i class="bi bi-stop-circle me-1"></i> Stop Service</button>
                      `
                      : containerState === 'exited'
                        ? `
                          <button class="btn-lp btn-lp-primary w-100" onclick="KumaPage.start()"><i class="bi bi-play-circle me-1"></i> Start Service</button>
                          <button class="btn-lp btn-lp-ghost text-danger w-100" onclick="KumaPage.destroy()"><i class="bi bi-trash me-1"></i> Uninstall</button>
                        `
                        : `
                          <button class="btn-lp btn-lp-primary w-100" onclick="KumaPage.showDeployModal()"><i class="bi bi-rocket-takeoff me-1"></i> Deploy Kuma</button>
                        `
                    }
                  </div>
                </div>
              </div>

              <!-- Right: Info -->
              <div class="col-12 col-md-8">
                <div class="lp-glass-card p-4">
                  <h5 style="font-weight:700; margin-bottom:15px;"><i class="bi bi-info-circle text-primary me-2"></i> About Uptime Kuma</h5>
                  <p class="text-slate-300" style="font-size:13px; line-height:1.6; margin-bottom:15px;">
                    Uptime Kuma is a fancy self-hosted monitoring tool. It allows you to monitor HTTP(s) websites, TCP Ports, Ping responses, DNS records, Steam game servers, and more. It features customizable notification integrations for Telegram, Discord, Slack, email, and 90+ other notification services.
                  </p>
                  <ul class="text-slate-400" style="font-size:12px; line-height:1.8; list-style-type: disc; padding-left: 20px;">
                    <li>Monitor uptime for websites, API endpoints, and server ports.</li>
                    <li>Generates beautiful status pages for public visitors.</li>
                    <li>Integrate alert notifications with your Telegram/Discord channel.</li>
                    <li>Very low RAM/CPU footprint.</li>
                  </ul>
                </div>
              </div>
            </div>

            <!-- Deploy Modal -->
            <div class="modal fade" id="deployKumaModal" tabindex="-1">
              <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content" style="background:var(--bg-primary); border:1px solid var(--glass-border);">
                  <div class="modal-header">
                    <h5 class="modal-title font-mono" style="font-size:14px">Deploy Uptime Kuma</h5>
                    <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                  </div>
                  <form id="deployKumaForm" onsubmit="KumaPage.deploy(event)">
                    <div class="modal-body">
                      <div class="lp-form-group">
                        <label class="lp-label">Web Console Port</label>
                        <input type="number" id="kumaPort" class="lp-input" value="3001" required min="80" max="65535">
                        <small class="text-muted mt-1 d-block" style="font-size:11px;">Specify the port to access Uptime Kuma dashboard (default 3001).</small>
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
              const KumaPage = (() => {
                let modal = null;

                function showDeployModal() {
                  modal = new bootstrap.Modal(document.getElementById('deployKumaModal'));
                  modal.show();
                }

                async function deploy(e) {
                  e.preventDefault();
                  const port = document.getElementById('kumaPort').value;
                  if (modal) modal.hide();

                  const spinner = document.createElement('div');
                  spinner.id = 'kumaDeploySpinner';
                  spinner.innerHTML = \`
                    <div style="position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.8); z-index:9999; display:flex; flex-direction:column; align-items:center; justify-content:center;">
                      <div class="spinner-border text-success" style="width: 3rem; height: 3rem;" role="status"></div>
                      <h4 style="color:#fff; margin-top:20px;">Deploying Uptime Kuma... This might take a minute.</h4>
                    </div>
                  \`;
                  document.body.appendChild(spinner);

                  try {
                    const res = await LP.post('/plugins/uptime-kuma-manager/deploy', { port });
                    if (res?.success) {
                      LP.toast('Uptime Kuma deployed successfully!', 'success');
                      window.location.reload();
                    } else {
                      LP.toast(res?.message || 'Deployment failed', 'error');
                    }
                  } catch (err) {
                    LP.toast('Deployment error', 'error');
                  } finally {
                    document.getElementById('kumaDeploySpinner')?.remove();
                  }
                }

                async function start() {
                  LP.toast('Starting container...', 'info');
                  const res = await LP.post('/plugins/uptime-kuma-manager/start');
                  if (res?.success) {
                    LP.toast('Uptime Kuma started', 'success');
                    window.location.reload();
                  } else {
                    LP.toast(res?.message || 'Start failed', 'error');
                  }
                }

                async function stop() {
                  if (!await LP.confirm('Are you sure you want to stop Uptime Kuma?', 'Stop Uptime Kuma')) return;
                  LP.toast('Stopping container...', 'info');
                  const res = await LP.post('/plugins/uptime-kuma-manager/stop');
                  if (res?.success) {
                    LP.toast('Uptime Kuma stopped', 'success');
                    window.location.reload();
                  } else {
                    LP.toast(res?.message || 'Stop failed', 'error');
                  }
                }

                async function destroy() {
                  if (!await LP.confirm('Are you sure you want to completely uninstall Uptime Kuma? All monitoring data will be deleted.', 'Uninstall Uptime Kuma')) return;
                  LP.toast('Removing container...', 'info');
                  const res = await LP.post('/plugins/uptime-kuma-manager/uninstall');
                  if (res?.success) {
                    LP.toast('Uptime Kuma uninstalled', 'success');
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
    app.post('/plugins/uptime-kuma-manager/deploy', async (req, res) => {
      try {
        const { port = 3001 } = req.body;
        const composeYaml = `
version: '3'
services:
  uptime-kuma:
    image: louislam/uptime-kuma:1
    container_name: uptime-kuma
    ports:
      - "${port}:3001"
    volumes:
      - uptime-kuma_data:/app/data
    restart: unless-stopped

volumes:
  uptime-kuma_data:
`;
        await dockerService.deployCompose('uptime-kuma', composeYaml);
        return successResponse(res, null, 'Uptime Kuma deployed successfully');
      } catch (error) {
        return errorResponse(res, error.message, 500);
      }
    });

    // 3. Start API
    app.post('/plugins/uptime-kuma-manager/start', async (req, res) => {
      try {
        const containers = await dockerService.docker.listContainers({ all: true });
        const ukContainer = containers.find(c => c.Names.includes('/uptime-kuma'));
        if (!ukContainer) return errorResponse(res, 'Container not found', 404);
        
        const container = dockerService.docker.getContainer(ukContainer.Id);
        await container.start();
        return successResponse(res, null, 'Uptime Kuma started');
      } catch (error) {
        return errorResponse(res, error.message, 500);
      }
    });

    // 4. Stop API
    app.post('/plugins/uptime-kuma-manager/stop', async (req, res) => {
      try {
        const containers = await dockerService.docker.listContainers({ all: true });
        const ukContainer = containers.find(c => c.Names.includes('/uptime-kuma'));
        if (!ukContainer) return errorResponse(res, 'Container not found', 404);
        
        const container = dockerService.docker.getContainer(ukContainer.Id);
        await container.stop();
        return successResponse(res, null, 'Uptime Kuma stopped');
      } catch (error) {
        return errorResponse(res, error.message, 500);
      }
    });

    // 5. Uninstall API
    app.post('/plugins/uptime-kuma-manager/uninstall', async (req, res) => {
      try {
        const containers = await dockerService.docker.listContainers({ all: true });
        const ukContainer = containers.find(c => c.Names.includes('/uptime-kuma'));
        if (!ukContainer) return errorResponse(res, 'Container not found', 404);
        
        const container = dockerService.docker.getContainer(ukContainer.Id);
        try { await container.stop(); } catch (e) {}
        try { await container.remove({ force: true }); } catch (e) {}
        
        // Remove volume
        try {
          const vol = dockerService.docker.getVolume('uptime-kuma_uptime-kuma_data');
          await vol.remove();
        } catch (e) {}

        return successResponse(res, null, 'Uptime Kuma uninstalled');
      } catch (error) {
        return errorResponse(res, error.message, 500);
      }
    });
  }
};
