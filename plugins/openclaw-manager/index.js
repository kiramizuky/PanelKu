import dockerService from '../../src/modules/docker/docker.service.js';
import firewallService from '../../src/modules/firewall/firewall.service.js';
import { successResponse, errorResponse } from '../../src/helpers/response.js';

export default {
  register(app, io) {
    // 1. OpenClaw View
    app.get('/plugins/openclaw-manager', async (req, res) => {
      try {
        const containers = await dockerService.listContainers(true);
        const ocContainer = containers.find(c => c.names.includes('openclaw'));

        let containerStatus = 'Not Installed';
        let containerState = '';
        let portMapped = '18789';

        if (ocContainer) {
          containerStatus = ocContainer.status;
          containerState = ocContainer.state;
          const portObj = ocContainer.ports?.find(p => p.PrivatePort === 18789);
          if (portObj && portObj.PublicPort) portMapped = portObj.PublicPort;
        }

        res.render('layout', {
          title: 'OpenClaw AI',
          body: `
            <div class="lp-page-header" style="margin-bottom:25px; display:flex; justify-content:space-between; align-items:flex-end;">
              <div>
                <h1 class="lp-page-title" style="font-size:24px;font-weight:600;margin:0;"><i class="bi bi-robot text-primary me-2"></i> OpenClaw AI</h1>
                <p class="lp-page-subtitle" style="color:var(--text-muted);margin:0;">Autonomous AI agent platform and gateway orchestration service</p>
              </div>
            </div>

            <div class="row g-4">
              <!-- Left: CLI status -->
              <div class="col-12 col-md-4">
                <div class="lp-glass-card p-4 text-center">
                  <div style="width:72px; height:72px; border-radius:50%; background:rgba(59,130,246,0.1); color:var(--accent-primary); display:flex; align-items:center; justify-content:center; margin:0 auto 15px; font-size:32px;">
                    <i class="bi bi-robot"></i>
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
                    ${ocContainer ? `Container status: ${containerStatus}` : 'OpenClaw container is not yet deployed.'}
                  </p>

                  <div style="display:flex; flex-direction:column; gap:10px;">
                    ${containerState === 'running'
                      ? `
                        <a href="http://${req.hostname}:${portMapped}" target="_blank" class="btn-lp btn-lp-primary w-100"><i class="bi bi-box-arrow-up-right me-1"></i> Open Gateway Dashboard</a>
                        <button class="btn-lp btn-lp-ghost text-danger w-100" onclick="OpenClawPage.stop()"><i class="bi bi-stop-circle me-1"></i> Stop Service</button>
                      `
                      : containerState === 'exited'
                        ? `
                          <button class="btn-lp btn-lp-primary w-100" onclick="OpenClawPage.start()"><i class="bi bi-play-circle me-1"></i> Start Service</button>
                          <button class="btn-lp btn-lp-ghost text-danger w-100" onclick="OpenClawPage.destroy()"><i class="bi bi-trash me-1"></i> Uninstall</button>
                        `
                        : `
                          <button class="btn-lp btn-lp-primary w-100" onclick="OpenClawPage.showDeployModal()"><i class="bi bi-rocket-takeoff me-1"></i> Deploy OpenClaw</button>
                        `
                    }
                  </div>
                </div>
              </div>

              <!-- Right: Info -->
              <div class="col-12 col-md-8">
                <div class="lp-glass-card p-4">
                  <h5 style="font-weight:700; margin-bottom:15px;"><i class="bi bi-info-circle text-primary me-2"></i> About OpenClaw</h5>
                  <p class="text-slate-300" style="font-size:13px; line-height:1.6; margin-bottom:15px;">
                    OpenClaw is an open-source, autonomous AI agent gateway that integrates message hubs (WhatsApp, Telegram, Discord, Slack) with state-of-the-art Large Language Models. By executing tasks in isolated environments, it securely runs scripts, reads files, and automates processes on self-hosted VPS servers or local homelabs.
                  </p>
                  <ul class="text-slate-400" style="font-size:12px; line-height:1.8; list-style-type: disc; padding-left: 20px;">
                    <li>Orchestrate AI agents and trigger tasks using conversational text interfaces.</li>
                    <li>Supports Docker sandboxing to execute files and CLI scripts safely.</li>
                    <li>Pre-configured with standard persistence mounts for configuration and workspace memory.</li>
                    <li>Easily connects WhatsApp and other messengers as agent terminals.</li>
                  </ul>
                </div>
              </div>
            </div>

            <!-- Deploy Modal -->
            <div class="modal fade" id="deployClawModal" tabindex="-1">
              <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content" style="background:var(--bg-primary); border:1px solid var(--glass-border);">
                  <div class="modal-header">
                    <h5 class="modal-title font-mono" style="font-size:14px">Deploy OpenClaw</h5>
                    <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                  </div>
                  <form id="deployClawForm" onsubmit="OpenClawPage.deploy(event)">
                    <div class="modal-body">
                      <div class="lp-form-group">
                        <label class="lp-label">Gateway Access Port</label>
                        <input type="number" id="clawPort" class="lp-input" value="18789" required min="80" max="65535">
                        <small class="text-muted mt-1 d-block" style="font-size:11px;">Specify the network port to access the OpenClaw gateway (default 18789).</small>
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
              const OpenClawPage = (() => {
                let modal = null;

                function showDeployModal() {
                  modal = new bootstrap.Modal(document.getElementById('deployClawModal'));
                  modal.show();
                }

                async function deploy(e) {
                  e.preventDefault();
                  const port = document.getElementById('clawPort').value;
                  if (modal) modal.hide();

                  const spinner = document.createElement('div');
                  spinner.id = 'clawDeploySpinner';
                  spinner.innerHTML = \`
                    <div style="position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.8); z-index:9999; display:flex; flex-direction:column; align-items:center; justify-content:center;">
                      <div class="spinner-border text-primary" style="width: 3rem; height: 3rem;" role="status"></div>
                      <h4 style="color:#fff; margin-top:20px;">Deploying OpenClaw... This might take a minute.</h4>
                    </div>
                  \`;
                  document.body.appendChild(spinner);

                  try {
                    const res = await LP.post('/plugins/openclaw-manager/deploy', { port });
                    if (res?.success) {
                      LP.toast('OpenClaw deployed successfully!', 'success');
                      window.location.reload();
                    } else {
                      LP.toast(res?.message || 'Deployment failed', 'error');
                    }
                  } catch (err) {
                    LP.toast('Deployment error', 'error');
                  } finally {
                    document.getElementById('clawDeploySpinner')?.remove();
                  }
                }

                async function start() {
                  LP.toast('Starting container...', 'info');
                  const res = await LP.post('/plugins/openclaw-manager/start');
                  if (res?.success) {
                    LP.toast('OpenClaw started', 'success');
                    window.location.reload();
                  } else {
                    LP.toast(res?.message || 'Start failed', 'error');
                  }
                }

                async function stop() {
                  if (!await LP.confirm('Are you sure you want to stop OpenClaw?', 'Stop OpenClaw')) return;
                  LP.toast('Stopping container...', 'info');
                  const res = await LP.post('/plugins/openclaw-manager/stop');
                  if (res?.success) {
                    LP.toast('OpenClaw stopped', 'success');
                    window.location.reload();
                  } else {
                    LP.toast(res?.message || 'Stop failed', 'error');
                  }
                }

                async function destroy() {
                  if (!await LP.confirm('Are you sure you want to completely uninstall OpenClaw? All workspace records will be deleted.', 'Uninstall OpenClaw')) return;
                  LP.toast('Removing container...', 'info');
                  const res = await LP.post('/plugins/openclaw-manager/uninstall');
                  if (res?.success) {
                    LP.toast('OpenClaw uninstalled', 'success');
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
    app.post('/plugins/openclaw-manager/deploy', async (req, res) => {
      try {
        const { port = 18789 } = req.body;
        const composeYaml = `
version: '3'
services:
  openclaw:
    image: ghcr.io/openclaw/openclaw:latest
    container_name: openclaw
    ports:
      - "${port}:18789"
    volumes:
      - openclaw_config:/root/.openclaw
      - openclaw_workspace:/root/openclaw/workspace
      - /var/run/docker.sock:/var/run/docker.sock
    restart: unless-stopped

volumes:
  openclaw_config:
  openclaw_workspace:
`;
        await dockerService.deployCompose('openclaw', composeYaml);
        try {
          await firewallService.addRule(port, 'tcp');
        } catch (fwErr) {
          console.warn('Firewall: failed to allow port', port, fwErr.message);
        }
        return successResponse(res, null, 'OpenClaw deployed successfully');
      } catch (error) {
        return errorResponse(res, error.message, 500);
      }
    });

    // 3. Start API
    app.post('/plugins/openclaw-manager/start', async (req, res) => {
      try {
        const containers = await dockerService.docker.listContainers({ all: true });
        const ocContainer = containers.find(c => c.Names.includes('/openclaw'));
        if (!ocContainer) return errorResponse(res, 'Container not found', 404);
        
        const container = dockerService.docker.getContainer(ocContainer.Id);
        await container.start();
        return successResponse(res, null, 'OpenClaw started');
      } catch (error) {
        return errorResponse(res, error.message, 500);
      }
    });

    // 4. Stop API
    app.post('/plugins/openclaw-manager/stop', async (req, res) => {
      try {
        const containers = await dockerService.docker.listContainers({ all: true });
        const ocContainer = containers.find(c => c.Names.includes('/openclaw'));
        if (!ocContainer) return errorResponse(res, 'Container not found', 404);
        
        const container = dockerService.docker.getContainer(ocContainer.Id);
        await container.stop();
        return successResponse(res, null, 'OpenClaw stopped');
      } catch (error) {
        return errorResponse(res, error.message, 500);
      }
    });

    // 5. Uninstall API
    app.post('/plugins/openclaw-manager/uninstall', async (req, res) => {
      try {
        const containers = await dockerService.docker.listContainers({ all: true });
        const ocContainer = containers.find(c => c.Names.includes('/openclaw'));
        if (!ocContainer) return errorResponse(res, 'Container not found', 404);
        
        const container = dockerService.docker.getContainer(ocContainer.Id);
        try { await container.stop(); } catch (e) {}
        try { await container.remove({ force: true }); } catch (e) {}
        
        // Remove volume
        try {
          const vol1 = dockerService.docker.getVolume('openclaw_openclaw_config');
          await vol1.remove();
        } catch (e) {}
        try {
          const vol2 = dockerService.docker.getVolume('openclaw_openclaw_workspace');
          await vol2.remove();
        } catch (e) {}

        return successResponse(res, null, 'OpenClaw uninstalled');
      } catch (error) {
        return errorResponse(res, error.message, 500);
      }
    });
  }
};
