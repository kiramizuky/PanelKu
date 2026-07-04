import dockerService from '../../src/modules/docker/docker.service.js';
import firewallService from '../../src/modules/firewall/firewall.service.js';
import { successResponse, errorResponse } from '../../src/helpers/response.js';

export default {
  register(app, io) {
    // 1. AdGuard Home Manager Dashboard View
    app.get('/plugins/adguard-manager', async (req, res) => {
      try {
        const containers = await dockerService.listContainers(true);
        const agContainer = containers.find(c => c.names.includes('adguard-app'));
        
        let containerStatus = 'Not Installed';
        let containerState = '';
        let portMapped = '3000';
        
        if (agContainer) {
          containerStatus = agContainer.status;
          containerState = agContainer.state;
          const portObj = agContainer.ports?.find(p => p.PrivatePort === 3000);
          if (portObj && portObj.PublicPort) {
            portMapped = portObj.PublicPort;
          }
        }

        res.render('layout', {
          title: 'AdGuard Home',
          body: `
            <div class="lp-page-header" style="margin-bottom:25px; display:flex; justify-content:space-between; align-items:flex-end;">
              <div>
                <h1 class="lp-page-title" style="font-size:24px;font-weight:600;margin:0;"><i class="bi bi-shield-fill-check text-success me-2"></i> AdGuard Home</h1>
                <p class="lp-page-subtitle" style="color:var(--text-muted);margin:0;">Network-wide DNS server for blocking ads and tracking</p>
              </div>
            </div>

            <div class="row g-4">
              <!-- Left side: Status & Actions -->
              <div class="col-12 col-md-4">
                <div class="lp-glass-card p-4 text-center">
                  <div style="width:72px; height:72px; border-radius:50%; background:rgba(16,185,129,0.1); color:var(--accent-success); display:flex; align-items:center; justify-content:center; margin:0 auto 15px; font-size:32px;">
                    <i class="bi bi-shield-fill-check"></i>
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
                    ${agContainer ? `Container status: ${containerStatus}` : 'AdGuard Home container is not yet deployed on your server.'}
                  </p>

                  <div style="display:flex; flex-direction:column; gap:10px;">
                    ${containerState === 'running'
                      ? `
                        <a href="http://\${req.hostname}:\${portMapped}" target="_blank" class="btn-lp btn-lp-primary w-100"><i class="bi bi-box-arrow-up-right me-1"></i> Open Admin Panel</a>
                        <button class="btn-lp btn-lp-ghost text-danger w-100" onclick="AdGuardPage.stop()"><i class="bi bi-stop-circle me-1"></i> Stop Service</button>
                      `
                      : containerState === 'exited'
                        ? `
                          <button class="btn-lp btn-lp-primary w-100" onclick="AdGuardPage.start()"><i class="bi bi-play-circle me-1"></i> Start Service</button>
                          <button class="btn-lp btn-lp-ghost text-danger w-100" onclick="AdGuardPage.destroy()"><i class="bi bi-trash me-1"></i> Uninstall</button>
                        `
                        : `
                          <button class="btn-lp btn-lp-primary w-100" onclick="AdGuardPage.showDeployModal()"><i class="bi bi-rocket-takeoff me-1"></i> Deploy AdGuard</button>
                        `
                    }
                  </div>
                </div>
              </div>

              <!-- Right side: Information -->
              <div class="col-12 col-md-8">
                <div class="lp-glass-card p-4">
                  <h5 style="font-weight:700; margin-bottom:15px;"><i class="bi bi-info-circle text-primary me-2"></i> About AdGuard Home</h5>
                  <p class="text-slate-300" style="font-size:13px; line-height:1.6; margin-bottom:15px;">
                    AdGuard Home is a network-wide software for blocking ads and tracking. After you set it up, it will cover ALL your home devices without requiring any client-side software. It operates as a DNS server that re-routes tracking domains to a black hole.
                  </p>
                  <ul class="text-slate-400" style="font-size:12px; line-height:1.8; list-style-type: disc; padding-left: 20px;">
                    <li>Blocks advertisements, banners, pop-ups, and trackers network-wide.</li>
                    <li>Allows managing parental controls to block adult websites.</li>
                    <li>Configures custom DNS filters and access whitelists.</li>
                    <li>Requires Port 53 to be free on your server for DNS resolution.</li>
                  </ul>
                </div>
              </div>
            </div>

            <!-- Deploy Modal -->
            <div class="modal fade" id="deployAgModal" tabindex="-1">
              <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content" style="background:var(--bg-primary); border:1px solid var(--glass-border);">
                  <div class="modal-header">
                    <h5 class="modal-title font-mono" style="font-size:14px">Deploy AdGuard Home Container</h5>
                    <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                  </div>
                  <form id="deployAgForm" onsubmit="AdGuardPage.deploy(event)">
                    <div class="modal-body">
                      <div class="lp-form-group">
                        <label class="lp-label">Web Admin Port</label>
                        <input type="number" id="agPort" class="lp-input" value="3000" required min="80" max="65535">
                        <small class="text-muted mt-1 d-block" style="font-size:11px;">Specify the port to access AdGuard configuration interface (default 3000).</small>
                      </div>
                      <div class="lp-form-group mt-3">
                        <label class="lp-label">DNS Resolver Port</label>
                        <input type="number" id="agDnsPort" class="lp-input" value="53" required min="13" max="65535">
                        <small class="text-muted mt-1 d-block" style="font-size:11px;">Specify the DNS port (default 53). If port 53 is already in use by systemd-resolved, change this to another port (e.g. 5353).</small>
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
              const AdGuardPage = (() => {
                let modal = null;

                function showDeployModal() {
                  modal = new bootstrap.Modal(document.getElementById('deployAgModal'));
                  modal.show();
                }

                async function deploy(e) {
                  e.preventDefault();
                  const port = document.getElementById('agPort').value;
                  const dnsPort = document.getElementById('agDnsPort').value;
                  
                  if (modal) modal.hide();
                  
                  const spinner = document.createElement('div');
                  spinner.id = 'agDeploySpinner';
                  spinner.innerHTML = \`
                    <div style="position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.8); z-index:9999; display:flex; flex-direction:column; align-items:center; justify-content:center;">
                      <div class="spinner-border text-success" style="width: 3rem; height: 3rem;" role="status"></div>
                      <h4 style="color:#fff; margin-top:20px;">Deploying AdGuard Home... This might take a minute.</h4>
                    </div>
                  \`;
                  document.body.appendChild(spinner);

                  try {
                    const res = await LP.post('/plugins/adguard-manager/deploy', { port, dnsPort });
                    if (res?.success) {
                      LP.toast('AdGuard Home deployed successfully!', 'success');
                      window.location.reload();
                    } else {
                      LP.toast(res?.message || 'Deployment failed', 'error');
                    }
                  } catch (err) {
                    LP.toast('Deployment error', 'error');
                  } finally {
                    document.getElementById('agDeploySpinner')?.remove();
                  }
                }

                async function start() {
                  LP.toast('Starting container...', 'info');
                  const res = await LP.post('/plugins/adguard-manager/start');
                  if (res?.success) {
                    LP.toast('AdGuard Home started', 'success');
                    window.location.reload();
                  } else {
                    LP.toast(res?.message || 'Start failed', 'error');
                  }
                }

                async function stop() {
                  if (!await LP.confirm('Are you sure you want to stop AdGuard Home?', 'Stop AdGuard')) return;
                  LP.toast('Stopping container...', 'info');
                  const res = await LP.post('/plugins/adguard-manager/stop');
                  if (res?.success) {
                    LP.toast('AdGuard Home stopped', 'success');
                    window.location.reload();
                  } else {
                    LP.toast(res?.message || 'Stop failed', 'error');
                  }
                }

                async function destroy() {
                  if (!await LP.confirm('Are you sure you want to completely uninstall AdGuard Home? All data will be removed.', 'Uninstall AdGuard')) return;
                  LP.toast('Removing AdGuard...', 'info');
                  const res = await LP.post('/plugins/adguard-manager/uninstall');
                  if (res?.success) {
                    LP.toast('AdGuard Home uninstalled', 'success');
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
    app.post('/plugins/adguard-manager/deploy', async (req, res) => {
      try {
        const { port = 3000, dnsPort = 53 } = req.body;
        
        // Define docker-compose yml
        const composeYaml = `
version: '3'
services:
  adguardhome:
    image: adguard/adguardhome:latest
    container_name: adguard-app
    ports:
      - "${dnsPort}:53/tcp"
      - "${dnsPort}:53/udp"
      - "${port}:3000/tcp"
    volumes:
      - adguard_work:/opt/adguardhome/work
      - adguard_conf:/opt/adguardhome/conf
    restart: unless-stopped

volumes:
  adguard_work:
  adguard_conf:
`;
        await dockerService.deployCompose('adguard', composeYaml);
        try {
          await firewallService.addRule(port, 'tcp');
          await firewallService.addRule(dnsPort, 'tcp');
          await firewallService.addRule(dnsPort, 'udp');
        } catch (fwErr) {
          console.warn('Firewall: failed to allow ports', port, dnsPort, fwErr.message);
        }
        return successResponse(res, null, 'AdGuard Home deployed successfully');
      } catch (error) {
        return errorResponse(res, error.message, 500);
      }
    });

    // 3. Start API
    app.post('/plugins/adguard-manager/start', async (req, res) => {
      try {
        const containers = await dockerService.docker.listContainers({ all: true });
        const agContainer = containers.find(c => c.Names.includes('/adguard-app'));
        if (!agContainer) return errorResponse(res, 'Container not found', 404);
        
        const container = dockerService.docker.getContainer(agContainer.Id);
        await container.start();
        return successResponse(res, null, 'AdGuard Home started');
      } catch (error) {
        return errorResponse(res, error.message, 500);
      }
    });

    // 4. Stop API
    app.post('/plugins/adguard-manager/stop', async (req, res) => {
      try {
        const containers = await dockerService.docker.listContainers({ all: true });
        const agContainer = containers.find(c => c.Names.includes('/adguard-app'));
        if (!agContainer) return errorResponse(res, 'Container not found', 404);
        
        const container = dockerService.docker.getContainer(agContainer.Id);
        await container.stop();
        return successResponse(res, null, 'AdGuard Home stopped');
      } catch (error) {
        return errorResponse(res, error.message, 500);
      }
    });

    // 5. Uninstall API
    app.post('/plugins/adguard-manager/uninstall', async (req, res) => {
      try {
        const containers = await dockerService.docker.listContainers({ all: true });
        const agContainer = containers.find(c => c.Names.includes('/adguard-app'));
        if (!agContainer) return errorResponse(res, 'Container not found', 404);
        
        const container = dockerService.docker.getContainer(agContainer.Id);
        try { await container.stop(); } catch (e) {}
        try { await container.remove({ force: true }); } catch (e) {}
        
        // Remove volumes if needed
        try {
          const vol1 = dockerService.docker.getVolume('adguard_adguard_work');
          await vol1.remove();
        } catch (e) {}
        try {
          const vol2 = dockerService.docker.getVolume('adguard_adguard_conf');
          await vol2.remove();
        } catch (e) {}

        return successResponse(res, null, 'AdGuard Home uninstalled');
      } catch (error) {
        return errorResponse(res, error.message, 500);
      }
    });
  }
};
