import dockerService from '../../src/modules/docker/docker.service.js';
import firewallService from '../../src/modules/firewall/firewall.service.js';
import { successResponse, errorResponse } from '../../src/helpers/response.js';

export default {
  register(app, io) {
    // 1. Dashboard View
    app.get('/plugins/media-cloud-manager', async (req, res) => {
      try {
        const containers = await dockerService.listContainers(true);

        const getStatus = (name, defaultPort, internalPort = 80) => {
          const container = containers.find(c => c.names.includes(name));
          if (!container) return { state: 'not_installed', status: 'Not Installed', port: defaultPort };
          const portObj = container.ports?.find(p => p.PrivatePort === internalPort);
          return {
            state: container.state,
            status: container.status,
            port: (portObj && portObj.PublicPort) ? portObj.PublicPort : defaultPort
          };
        };

        const jellyfin = getStatus('jellyfin', 8096, 8096);
        const qbt = getStatus('qbittorrent', 8088, 8080);

        res.render('layout', {
          title: 'Media & Cloud Services',
          body: `
            <div class="lp-page-header" style="margin-bottom:25px; display:flex; justify-content:space-between; align-items:flex-end;">
              <div>
                <h1 class="lp-page-title" style="font-size:24px;font-weight:600;margin:0;"><i class="bi bi-tv text-danger me-2"></i> Media & Cloud Services</h1>
                <p class="lp-page-subtitle" style="color:var(--text-muted);margin:0;">Deploy home entertainment centers and downloading tools</p>
              </div>
            </div>

            <div class="row g-4">
              <!-- Jellyfin Card -->
              <div class="col-12 col-md-6">
                <div class="lp-glass-card p-4 text-center d-flex flex-column h-100 justify-content-between">
                  <div>
                    <div style="width:64px; height:64px; border-radius:12px; background:rgba(239,68,68,0.1); color:#ef4444; display:flex; align-items:center; justify-content:center; margin:0 auto 15px; font-size:28px;">
                      <i class="bi bi-tv-fill"></i>
                    </div>
                    <h5 style="font-weight:700; margin-bottom:5px;">Jellyfin</h5>
                    <p class="text-muted" style="font-size:12px; margin-bottom:15px;">The Free Software Media System that puts you in control of your media</p>
                    <div class="mb-3">
                      ${jellyfin.state === 'running' 
                        ? `<span class="lp-badge lp-badge-success"><span class="lp-badge-dot"></span>Running</span>`
                        : jellyfin.state === 'exited'
                          ? `<span class="lp-badge lp-badge-danger"><span class="lp-badge-dot"></span>Stopped</span>`
                          : `<span class="lp-badge lp-badge-ghost"><span class="lp-badge-dot"></span>Not Installed</span>`
                      }
                    </div>
                  </div>
                  <div>
                    <div style="display:flex; flex-direction:column; gap:10px;">
                      ${jellyfin.state === 'running'
                        ? `
                          <a href="http://${req.hostname}:${jellyfin.port}" target="_blank" class="btn-lp btn-lp-primary w-100"><i class="bi bi-box-arrow-up-right me-1"></i> Open Jellyfin</a>
                          <button class="btn-lp btn-lp-ghost text-danger w-100 btn-lp-sm" onclick="MediaCloud.stop('jellyfin')">Stop</button>
                        `
                        : jellyfin.state === 'exited'
                          ? `
                            <button class="btn-lp btn-lp-primary w-100" onclick="MediaCloud.start('jellyfin')">Start</button>
                            <button class="btn-lp btn-lp-ghost text-danger w-100 btn-lp-sm" onclick="MediaCloud.uninstall('jellyfin')">Uninstall</button>
                          `
                          : `
                            <button class="btn-lp btn-lp-primary w-100" onclick="MediaCloud.showDeployModal('jellyfin', 8096)">Deploy Jellyfin</button>
                          `
                      }
                    </div>
                  </div>
                </div>
              </div>

              <!-- qBittorrent Card -->
              <div class="col-12 col-md-6">
                <div class="lp-glass-card p-4 text-center d-flex flex-column h-100 justify-content-between">
                  <div>
                    <div style="width:64px; height:64px; border-radius:12px; background:rgba(59,130,246,0.1); color:#3b82f6; display:flex; align-items:center; justify-content:center; margin:0 auto 15px; font-size:28px;">
                      <i class="bi bi-download"></i>
                    </div>
                    <h5 style="font-weight:700; margin-bottom:5px;">qBittorrent</h5>
                    <p class="text-muted" style="font-size:12px; margin-bottom:15px;">Open-source bittorrent client with an integrated Web UI manager</p>
                    <div class="mb-3">
                      ${qbt.state === 'running' 
                        ? `<span class="lp-badge lp-badge-success"><span class="lp-badge-dot"></span>Running</span>`
                        : qbt.state === 'exited'
                          ? `<span class="lp-badge lp-badge-danger"><span class="lp-badge-dot"></span>Stopped</span>`
                          : `<span class="lp-badge lp-badge-ghost"><span class="lp-badge-dot"></span>Not Installed</span>`
                      }
                    </div>
                  </div>
                  <div>
                    <div style="display:flex; flex-direction:column; gap:10px;">
                      ${qbt.state === 'running'
                        ? `
                          <a href="http://${req.hostname}:${qbt.port}" target="_blank" class="btn-lp btn-lp-primary w-100"><i class="bi bi-box-arrow-up-right me-1"></i> Open Web UI</a>
                          <button class="btn-lp btn-lp-ghost text-danger w-100 btn-lp-sm" onclick="MediaCloud.stop('qbittorrent')">Stop</button>
                        `
                        : qbt.state === 'exited'
                          ? `
                            <button class="btn-lp btn-lp-primary w-100" onclick="MediaCloud.start('qbittorrent')">Start</button>
                            <button class="btn-lp btn-lp-ghost text-danger w-100 btn-lp-sm" onclick="MediaCloud.uninstall('qbittorrent')">Uninstall</button>
                          `
                          : `
                            <button class="btn-lp btn-lp-primary w-100" onclick="MediaCloud.showDeployModal('qbittorrent', 8088)">Deploy qBittorrent</button>
                          `
                      }
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Deploy Modal -->
            <div class="modal fade" id="deployMediaCloudModal" tabindex="-1">
              <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content" style="background:var(--bg-primary); border:1px solid var(--glass-border);">
                  <div class="modal-header">
                    <h5 class="modal-title font-mono" id="modalTitle" style="font-size:14px">Deploy Media Component</h5>
                    <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                  </div>
                  <form id="deployMediaCloudForm" onsubmit="MediaCloud.deploy(event)">
                    <input type="hidden" id="deployPkg">
                    <div class="modal-body">
                      <div class="lp-form-group mb-3">
                        <label class="lp-label">Access Port</label>
                        <input type="number" id="deployPort" class="lp-input" required min="80" max="65535">
                      </div>
                      
                      <div class="lp-form-group mb-3">
                        <label class="lp-label">Shared Media Directory (Host path)</label>
                        <input type="text" id="mediaPath" class="lp-input" value="/opt/panelku/storage/media">
                        <small class="text-muted mt-1 d-block" style="font-size:11px;">Host folder for storing video/audio files accessed by both qBittorrent and Jellyfin.</small>
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
              const MediaCloud = (() => {
                let modal = null;

                function showDeployModal(pkg, defaultPort) {
                  document.getElementById('deployPkg').value = pkg;
                  document.getElementById('deployPort').value = defaultPort;
                  document.getElementById('modalTitle').textContent = 'Deploy ' + pkg;
                  
                  modal = new bootstrap.Modal(document.getElementById('deployMediaCloudModal'));
                  modal.show();
                }

                async function deploy(e) {
                  e.preventDefault();
                  const pkg = document.getElementById('deployPkg').value;
                  const port = document.getElementById('deployPort').value;
                  const mediaPath = document.getElementById('mediaPath').value;
                  
                  if (modal) modal.hide();

                  const spinner = document.createElement('div');
                  spinner.id = 'mediaCloudSpinner';
                  spinner.innerHTML = \`
                    <div style="position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.8); z-index:9999; display:flex; flex-direction:column; align-items:center; justify-content:center;">
                      <div class="spinner-border text-primary" style="width: 3rem; height: 3rem;" role="status"></div>
                      <h4 style="color:#fff; margin-top:20px;">Deploying \${pkg}... Please wait.</h4>
                    </div>
                  \`;
                  document.body.appendChild(spinner);

                  try {
                    const res = await LP.post('/plugins/media-cloud-manager/deploy', {
                      package: pkg, port, mediaPath
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
                    document.getElementById('mediaCloudSpinner')?.remove();
                  }
                }

                async function start(pkg) {
                  LP.toast('Starting container...', 'info');
                  const res = await LP.post('/plugins/media-cloud-manager/start', { package: pkg });
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
                  const res = await LP.post('/plugins/media-cloud-manager/stop', { package: pkg });
                  if (res?.success) {
                    LP.toast(pkg + ' stopped', 'success');
                    window.location.reload();
                  } else {
                    LP.toast(res?.message || 'Stop failed', 'error');
                  }
                }

                async function uninstall(pkg) {
                  if (!await LP.confirm('Are you sure you want to completely remove ' + pkg + '?', 'Uninstall Service')) return;
                  LP.toast('Removing container...', 'info');
                  const res = await LP.post('/plugins/media-cloud-manager/uninstall', { package: pkg });
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
    app.post('/plugins/media-cloud-manager/deploy', async (req, res) => {
      try {
        const { package: pkg, port, mediaPath } = req.body;
        
        let composeYaml = '';
        if (pkg === 'jellyfin') {
          composeYaml = `
version: '3'
services:
  jellyfin:
    image: jellyfin/jellyfin:latest
    container_name: jellyfin
    ports:
      - "${port}:8096"
    volumes:
      - jellyfin_config:/config
      - jellyfin_cache:/cache
      - "${mediaPath}:/media"
    restart: unless-stopped

volumes:
  jellyfin_config:
  jellyfin_cache:
`;
        } else if (pkg === 'qbittorrent') {
          composeYaml = `
version: '3'
services:
  qbittorrent:
    image: linuxserver/qbittorrent:latest
    container_name: qbittorrent
    ports:
      - "${port}:8080"
      - "6881:6881"
      - "6881:6881/udp"
    environment:
      - PUID=1000
      - PGID=1000
      - TZ=Etc/UTC
      - WEBUI_PORT=8080
    volumes:
      - qbittorrent_config:/config
      - "${mediaPath}:/downloads"
    restart: unless-stopped

volumes:
  qbittorrent_config:
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
    app.post('/plugins/media-cloud-manager/start', async (req, res) => {
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
    app.post('/plugins/media-cloud-manager/stop', async (req, res) => {
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
    app.post('/plugins/media-cloud-manager/uninstall', async (req, res) => {
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
