import dockerService from '../../src/modules/docker/docker.service.js';
import firewallService from '../../src/modules/firewall/firewall.service.js';
import { successResponse, errorResponse } from '../../src/helpers/response.js';

export default {
  register(app, io) {
    // 1. Dashboard View
    app.get('/plugins/home-assistant-manager', async (req, res) => {
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

        const hass = getStatus('homeassistant', 8123, 8123);
        const mqtt = getStatus('mosquitto', 1883, 1883);
        const z2m = getStatus('zigbee2mqtt', 8099, 8080);

        res.render('layout', {
          title: 'Smart Home Manager',
          body: `
            <div class="lp-page-header" style="margin-bottom:25px; display:flex; justify-content:space-between; align-items:flex-end;">
              <div>
                <h1 class="lp-page-title" style="font-size:24px;font-weight:600;margin:0;"><i class="bi bi-house-gear text-warning me-2"></i> Smart Home Manager</h1>
                <p class="lp-page-subtitle" style="color:var(--text-muted);margin:0;">Deploy local IoT controllers, messaging brokers, and Zigbee networks</p>
              </div>
            </div>

            <div class="row g-4">
              <!-- Home Assistant Card -->
              <div class="col-12 col-md-4">
                <div class="lp-glass-card p-4 text-center d-flex flex-column h-100 justify-content-between">
                  <div>
                    <div style="width:64px; height:64px; border-radius:12px; background:rgba(249,115,22,0.1); color:#f97316; display:flex; align-items:center; justify-content:center; margin:0 auto 15px; font-size:28px;">
                      <i class="bi bi-house"></i>
                    </div>
                    <h5 style="font-weight:700; margin-bottom:5px;">Home Assistant</h5>
                    <p class="text-muted" style="font-size:12px; margin-bottom:15px;">Smart home automation hub for locally controlling devices</p>
                    <div class="mb-3">
                      ${hass.state === 'running' 
                        ? `<span class="lp-badge lp-badge-success"><span class="lp-badge-dot"></span>Running</span>`
                        : hass.state === 'exited'
                          ? `<span class="lp-badge lp-badge-danger"><span class="lp-badge-dot"></span>Stopped</span>`
                          : `<span class="lp-badge lp-badge-ghost"><span class="lp-badge-dot"></span>Not Installed</span>`
                      }
                    </div>
                  </div>
                  <div>
                    <div style="display:flex; flex-direction:column; gap:10px;">
                      ${hass.state === 'running'
                        ? `
                          <a href="http://${req.hostname}:${hass.port}" target="_blank" class="btn-lp btn-lp-primary w-100"><i class="bi bi-box-arrow-up-right me-1"></i> Open Assistant</a>
                          <button class="btn-lp btn-lp-ghost text-danger w-100 btn-lp-sm" onclick="SmartHome.stop('homeassistant')">Stop</button>
                        `
                        : hass.state === 'exited'
                          ? `
                            <button class="btn-lp btn-lp-primary w-100" onclick="SmartHome.start('homeassistant')">Start</button>
                            <button class="btn-lp btn-lp-ghost text-danger w-100 btn-lp-sm" onclick="SmartHome.uninstall('homeassistant')">Uninstall</button>
                          `
                          : `
                            <button class="btn-lp btn-lp-primary w-100" onclick="SmartHome.showDeployModal('homeassistant', 8123)">Deploy Home Assistant</button>
                          `
                      }
                    </div>
                  </div>
                </div>
              </div>

              <!-- Mosquitto MQTT Card -->
              <div class="col-12 col-md-4">
                <div class="lp-glass-card p-4 text-center d-flex flex-column h-100 justify-content-between">
                  <div>
                    <div style="width:64px; height:64px; border-radius:12px; background:rgba(14,165,233,0.1); color:#0ea5e9; display:flex; align-items:center; justify-content:center; margin:0 auto 15px; font-size:28px;">
                      <i class="bi bi-shuffle"></i>
                    </div>
                    <h5 style="font-weight:700; margin-bottom:5px;">Mosquitto Broker</h5>
                    <p class="text-muted" style="font-size:12px; margin-bottom:15px;">Lightweight MQTT messaging broker for machine-to-machine telemetry</p>
                    <div class="mb-3">
                      ${mqtt.state === 'running' 
                        ? `<span class="lp-badge lp-badge-success"><span class="lp-badge-dot"></span>Running</span>`
                        : mqtt.state === 'exited'
                          ? `<span class="lp-badge lp-badge-danger"><span class="lp-badge-dot"></span>Stopped</span>`
                          : `<span class="lp-badge lp-badge-ghost"><span class="lp-badge-dot"></span>Not Installed</span>`
                      }
                    </div>
                  </div>
                  <div>
                    <div style="display:flex; flex-direction:column; gap:10px;">
                      ${mqtt.state === 'running'
                        ? `
                          <button class="btn-lp btn-lp-primary w-100" disabled><i class="bi bi-check-circle me-1"></i> Running on Port ${mqtt.port}</button>
                          <button class="btn-lp btn-lp-ghost text-danger w-100 btn-lp-sm" onclick="SmartHome.stop('mosquitto')">Stop</button>
                        `
                        : mqtt.state === 'exited'
                          ? `
                            <button class="btn-lp btn-lp-primary w-100" onclick="SmartHome.start('mosquitto')">Start</button>
                            <button class="btn-lp btn-lp-ghost text-danger w-100 btn-lp-sm" onclick="SmartHome.uninstall('mosquitto')">Uninstall</button>
                          `
                          : `
                            <button class="btn-lp btn-lp-primary w-100" onclick="SmartHome.showDeployModal('mosquitto', 1883)">Deploy Broker</button>
                          `
                      }
                    </div>
                  </div>
                </div>
              </div>

              <!-- Zigbee2MQTT Card -->
              <div class="col-12 col-md-4">
                <div class="lp-glass-card p-4 text-center d-flex flex-column h-100 justify-content-between">
                  <div>
                    <div style="width:64px; height:64px; border-radius:12px; background:rgba(34,197,94,0.1); color:#22c55e; display:flex; align-items:center; justify-content:center; margin:0 auto 15px; font-size:28px;">
                      <i class="bi bi-router"></i>
                    </div>
                    <h5 style="font-weight:700; margin-bottom:5px;">Zigbee2MQTT</h5>
                    <p class="text-muted" style="font-size:12px; margin-bottom:15px;">Bridge Zigbee networks directly to MQTT brokers without proprietary hubs</p>
                    <div class="mb-3">
                      ${z2m.state === 'running' 
                        ? `<span class="lp-badge lp-badge-success"><span class="lp-badge-dot"></span>Running</span>`
                        : z2m.state === 'exited'
                          ? `<span class="lp-badge lp-badge-danger"><span class="lp-badge-dot"></span>Stopped</span>`
                          : `<span class="lp-badge lp-badge-ghost"><span class="lp-badge-dot"></span>Not Installed</span>`
                      }
                    </div>
                  </div>
                  <div>
                    <div style="display:flex; flex-direction:column; gap:10px;">
                      ${z2m.state === 'running'
                        ? `
                          <a href="http://${req.hostname}:${z2m.port}" target="_blank" class="btn-lp btn-lp-primary w-100"><i class="bi bi-box-arrow-up-right me-1"></i> Open Dashboard</a>
                          <button class="btn-lp btn-lp-ghost text-danger w-100 btn-lp-sm" onclick="SmartHome.stop('zigbee2mqtt')">Stop</button>
                        `
                        : z2m.state === 'exited'
                          ? `
                            <button class="btn-lp btn-lp-primary w-100" onclick="SmartHome.start('zigbee2mqtt')">Start</button>
                            <button class="btn-lp btn-lp-ghost text-danger w-100 btn-lp-sm" onclick="SmartHome.uninstall('zigbee2mqtt')">Uninstall</button>
                          `
                          : `
                            <button class="btn-lp btn-lp-primary w-100" onclick="SmartHome.showDeployModal('zigbee2mqtt', 8099)">Deploy Bridge</button>
                          `
                      }
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Deploy Modal -->
            <div class="modal fade" id="deploySmartHomeModal" tabindex="-1">
              <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content" style="background:var(--bg-primary); border:1px solid var(--glass-border);">
                  <div class="modal-header">
                    <h5 class="modal-title font-mono" id="modalTitle" style="font-size:14px">Deploy Smart Home Component</h5>
                    <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                  </div>
                  <form id="deploySmartHomeForm" onsubmit="SmartHome.deploy(event)">
                    <input type="hidden" id="deployPkg">
                    <div class="modal-body">
                      <div class="lp-form-group mb-3">
                        <label class="lp-label">Access Port</label>
                        <input type="number" id="deployPort" class="lp-input" required min="80" max="65535">
                      </div>
                      
                      <!-- Specific fields for Zigbee2MQTT -->
                      <div id="z2mFields" style="display:none;">
                        <div class="lp-form-group mb-3">
                          <label class="lp-label">USB Coordinator Device Port</label>
                          <input type="text" id="z2mUsb" class="lp-input" value="/dev/ttyACM0">
                          <small class="text-muted mt-1 d-block" style="font-size:11px;">Path to the Zigbee USB dongle on host (e.g. /dev/ttyACM0 or /dev/ttyUSB0).</small>
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
              const SmartHome = (() => {
                let modal = null;

                function showDeployModal(pkg, defaultPort) {
                  document.getElementById('deployPkg').value = pkg;
                  document.getElementById('deployPort').value = defaultPort;
                  document.getElementById('modalTitle').textContent = 'Deploy ' + pkg;
                  
                  document.getElementById('z2mFields').style.display = pkg === 'zigbee2mqtt' ? 'block' : 'none';
                  
                  modal = new bootstrap.Modal(document.getElementById('deploySmartHomeModal'));
                  modal.show();
                }

                async function deploy(e) {
                  e.preventDefault();
                  const pkg = document.getElementById('deployPkg').value;
                  const port = document.getElementById('deployPort').value;
                  const usb = document.getElementById('z2mUsb').value;
                  
                  if (modal) modal.hide();

                  const spinner = document.createElement('div');
                  spinner.id = 'smartHomeSpinner';
                  spinner.innerHTML = \`
                    <div style="position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.8); z-index:9999; display:flex; flex-direction:column; align-items:center; justify-content:center;">
                      <div class="spinner-border text-primary" style="width: 3rem; height: 3rem;" role="status"></div>
                      <h4 style="color:#fff; margin-top:20px;">Deploying \${pkg}... Please wait.</h4>
                    </div>
                  \`;
                  document.body.appendChild(spinner);

                  try {
                    const res = await LP.post('/plugins/home-assistant-manager/deploy', {
                      package: pkg, port, usb
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
                    document.getElementById('smartHomeSpinner')?.remove();
                  }
                }

                async function start(pkg) {
                  LP.toast('Starting container...', 'info');
                  const res = await LP.post('/plugins/home-assistant-manager/start', { package: pkg });
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
                  const res = await LP.post('/plugins/home-assistant-manager/stop', { package: pkg });
                  if (res?.success) {
                    LP.toast(pkg + ' stopped', 'success');
                    window.location.reload();
                  } else {
                    LP.toast(res?.message || 'Stop failed', 'error');
                  }
                }

                async function uninstall(pkg) {
                  if (!await LP.confirm('Are you sure you want to completely remove ' + pkg + '?', 'Uninstall Component')) return;
                  LP.toast('Removing container...', 'info');
                  const res = await LP.post('/plugins/home-assistant-manager/uninstall', { package: pkg });
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
    app.post('/plugins/home-assistant-manager/deploy', async (req, res) => {
      try {
        const { package: pkg, port, usb } = req.body;
        
        let composeYaml = '';
        if (pkg === 'homeassistant') {
          composeYaml = `
version: '3'
services:
  homeassistant:
    image: ghcr.io/home-assistant/home-assistant:stable
    container_name: homeassistant
    ports:
      - "${port}:8123"
    volumes:
      - homeassistant_config:/config
      - /etc/localtime:/etc/localtime:ro
    restart: unless-stopped

volumes:
  homeassistant_config:
`;
        } else if (pkg === 'mosquitto') {
          composeYaml = `
version: '3'
services:
  mosquitto:
    image: eclipse-mosquitto:latest
    container_name: mosquitto
    ports:
      - "${port}:1883"
    volumes:
      - mosquitto_data:/mosquitto/data
      - mosquitto_log:/mosquitto/log
    restart: unless-stopped

volumes:
  mosquitto_data:
  mosquitto_log:
`;
        } else if (pkg === 'zigbee2mqtt') {
          composeYaml = `
version: '3'
services:
  zigbee2mqtt:
    image: koenkk/zigbee2mqtt:latest
    container_name: zigbee2mqtt
    ports:
      - "${port}:8080"
    volumes:
      - zigbee2mqtt_data:/app/data
      - /run/udev:/run/udev:ro
    devices:
      - "${usb}:${usb}"
    environment:
      - TZ=UTC
    restart: unless-stopped

volumes:
  zigbee2mqtt_data:
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
    app.post('/plugins/home-assistant-manager/start', async (req, res) => {
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
    app.post('/plugins/home-assistant-manager/stop', async (req, res) => {
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
    app.post('/plugins/home-assistant-manager/uninstall', async (req, res) => {
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
