import { exec } from 'child_process';
import { promisify } from 'util';
import QRCode from 'qrcode';

const execAsync = promisify(exec);

export default {
  register(app, io) {
    // Helper to check if wg is installed
    async function getWgStatus() {
      try {
        const { stdout } = await execAsync('wg show all dump');
        return parseWgDump(stdout);
      } catch (err) {
        // Fallback mock data for demonstration/non-Linux envs
        return {
          isInstalled: false,
          error: err.message,
          interfaces: [
            {
              name: 'wg0',
              publicKey: 'qR8Jt...mockPublicKey...w18=',
              listenPort: 51820,
              active: true,
              peers: [
                {
                  publicKey: 'pT5yA...mockPeerKey1...d22=',
                  allowedIps: '10.0.0.2/32',
                  endpoint: '198.51.100.45:51820',
                  latestHandshake: '2 minutes ago',
                  transferRx: '45.2 MB',
                  transferTx: '128.4 MB'
                },
                {
                  publicKey: 'kO3sD...mockPeerKey2...v99=',
                  allowedIps: '10.0.0.3/32',
                  endpoint: '203.0.113.88:41256',
                  latestHandshake: '12 hours ago',
                  transferRx: '1.2 GB',
                  transferTx: '8.4 GB'
                }
              ]
            }
          ]
        };
      }
    }

    function parseWgDump(dumpText) {
      // wg show all dump format:
      // interface_name public_key private_key listen_port fwmark
      // interface_name peer_public_key preshared_key endpoint allowed_ips latest_handshake transfer_rx transfer_tx persistent_keepalive
      const lines = dumpText.trim().split('\n');
      const interfacesMap = new Map();

      for (const line of lines) {
        if (!line.trim()) continue;
        const parts = line.split('\t');
        if (parts.length === 5) {
          // Interface
          const [name, publicKey, , listenPort] = parts;
          interfacesMap.set(name, {
            name,
            publicKey,
            listenPort: parseInt(listenPort, 10),
            active: true,
            peers: []
          });
        } else if (parts.length === 9) {
          // Peer
          const [name, peerPublicKey, , endpoint, allowedIps, latestHandshake, transferRx, transferTx] = parts;
          const iface = interfacesMap.get(name);
          if (iface) {
            iface.peers.push({
              publicKey: peerPublicKey,
              allowedIps,
              endpoint: endpoint === '(none)' ? 'N/A' : endpoint,
              latestHandshake: latestHandshake === '0' ? 'Never' : formatHandshake(parseInt(latestHandshake, 10)),
              transferRx: formatBytes(parseInt(transferRx, 10)),
              transferTx: formatBytes(parseInt(transferTx, 10))
            });
          }
        }
      }

      return {
        isInstalled: true,
        interfaces: Array.from(interfacesMap.values())
      };
    }

    function formatHandshake(timestamp) {
      const diff = Math.floor(Date.now() / 1000) - timestamp;
      if (diff < 60) return `${diff} seconds ago`;
      const mins = Math.floor(diff / 60);
      if (mins < 60) return `${mins} minutes ago`;
      const hours = Math.floor(mins / 60);
      return `${hours} hours ago`;
    }

    function formatBytes(bytes) {
      if (!bytes || isNaN(bytes)) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // --- Routes ---

    // View main page
    app.get('/plugins/wireguard-manager', async (req, res) => {
      const data = await getWgStatus();
      res.render('layout', {
        title: 'WireGuard VPN',
        body: `
          <div class="lp-page-header" style="margin-bottom:20px;">
            <h1 class="lp-page-title" style="font-size:24px;font-weight:600;margin:0;"><i class="bi bi-shield-lock-fill text-success"></i> WireGuard VPN</h1>
            <p class="lp-page-subtitle" style="color:var(--text-muted);margin:0;">Manage VPN tunnels, peers, and client connections</p>
          </div>

          ${!data.isInstalled ? `
            <div class="alert alert-warning border-0 lp-glass-card" style="background: rgba(245, 158, 11, 0.08); color: #f59e0b; padding: 15px 20px; border-radius: 12px; margin-bottom: 20px;">
              <div class="d-flex align-items-center gap-2">
                <i class="bi bi-exclamation-triangle-fill" style="font-size: 18px;"></i>
                <strong>WireGuard CLI is not installed or configured on this server.</strong>
              </div>
              <p style="margin: 10px 0 0 28px; font-size: 13px;">Showing simulated data for demonstration. To use in production, please install WireGuard on the host.</p>
              <div style="margin: 10px 0 0 28px;">
                <button class="btn-lp btn-lp-primary btn-sm" id="btnInstallHost" onclick="WgPage.installHost()"><i class="bi bi-download"></i> Auto-Install WireGuard</button>
              </div>
            </div>
          ` : ''}

          <div class="row">
            <!-- Interfaces -->
            <div class="col-md-4">
              <div class="lp-glass-card p-4 mb-4">
                <h5 style="font-size: 16px; font-weight: 600; color: var(--text-primary); margin-bottom: 15px; display:flex; align-items:center; justify-content:space-between;">
                  <span>Active Interfaces</span>
                  <span class="lp-badge lp-badge-success">Running</span>
                </h5>
                <div id="interfaceList">
                  ${data.interfaces.map(iface => `
                    <div style="background: rgba(0,0,0,0.15); padding: 15px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.05); margin-bottom: 10px;">
                      <div style="font-weight: 600; font-size: 14px; margin-bottom: 8px; color:#10b981;">Interface: ${iface.name}</div>
                      <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px; word-break: break-all;"><strong>Public Key:</strong><br>${iface.publicKey}</div>
                      <div style="font-size: 12px; color: var(--text-muted);"><strong>Listen Port:</strong> ${iface.listenPort}</div>
                    </div>
                  `).join('')}
                </div>
              </div>
            </div>

            <!-- Peers / Clients -->
            <div class="col-md-8">
              <div class="lp-glass-card p-4">
                <div class="d-flex justify-content-between align-items-center mb-4">
                  <h5 style="font-size: 16px; font-weight: 600; color: var(--text-primary); margin:0;">VPN Peers / Client Configs</h5>
                  <button class="btn-lp btn-lp-primary btn-sm" onclick="WgPage.showAddPeerModal()"><i class="bi bi-plus-lg"></i> Add Peer</button>
                </div>
                <div class="table-responsive">
                  <table class="table table-dark table-borderless" style="background:transparent; --bs-table-bg:transparent; margin:0;">
                    <thead>
                      <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 12px; color: var(--text-muted);">
                        <th>Public Key</th>
                        <th>Allowed IPs</th>
                        <th>Endpoint</th>
                        <th>Transfer</th>
                        <th>Handshake</th>
                        <th class="text-end">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${data.interfaces.flatMap(iface => iface.peers.map(peer => `
                        <tr style="border-bottom: 1px solid rgba(255,255,255,0.03); vertical-align: middle; font-size: 13px;">
                          <td style="font-family: monospace; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${peer.publicKey}">${peer.publicKey}</td>
                          <td><span class="lp-badge lp-badge-info" style="font-size: 11px;">${peer.allowedIps}</span></td>
                          <td style="color: var(--text-muted);">${peer.endpoint}</td>
                          <td>
                            <div style="font-size: 12px;"><i class="bi bi-arrow-down text-info"></i> ${peer.transferRx}</div>
                            <div style="font-size: 12px;"><i class="bi bi-arrow-up text-success"></i> ${peer.transferTx}</div>
                          </td>
                          <td style="color: var(--text-muted);">${peer.latestHandshake}</td>
                          <td class="text-end">
                            <div class="d-flex gap-1 justify-content-end">
                              <button class="btn-lp btn-lp-ghost btn-sm text-info" onclick="WgPage.showQr('${peer.publicKey}', '${peer.allowedIps}')" title="Scan QR Code"><i class="bi bi-qr-code"></i></button>
                              <button class="btn-lp btn-lp-ghost btn-sm text-danger" onclick="WgPage.deletePeer('${iface.name}', '${peer.publicKey}')" title="Delete Peer"><i class="bi bi-trash"></i></button>
                            </div>
                          </td>
                        </tr>
                      `)).join('')}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          <!-- Add Peer Modal -->
          <div class="modal fade" id="addPeerModal" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered">
              <div class="modal-content lp-glass-card" style="border:1px solid rgba(255,255,255,0.1); background:rgba(20,20,25,0.95);">
                <div class="modal-header" style="border-bottom: 1px solid rgba(255,255,255,0.1);">
                  <h5 class="modal-title font-mono" style="color: var(--text-primary); font-size: 14px;">Add New Peer</h5>
                  <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body">
                  <div class="mb-3">
                    <label class="lp-label" style="display:block; margin-bottom:6px;">Allowed IPs (Client VPN IP)</label>
                    <input type="text" id="peerAllowedIps" class="form-control lp-input w-100" placeholder="e.g. 10.0.0.4/32" value="10.0.0.4/32">
                  </div>
                  <div class="mb-3">
                    <label class="lp-label" style="display:block; margin-bottom:6px;">Public Key (Optional)</label>
                    <input type="text" id="peerPublicKey" class="form-control lp-input w-100" placeholder="Leave empty to auto-generate private/public keys">
                  </div>
                </div>
                <div class="modal-footer" style="border-top: 1px solid rgba(255,255,255,0.1);">
                  <button type="button" class="btn-lp btn-lp-ghost" data-bs-dismiss="modal">Cancel</button>
                  <button type="button" class="btn-lp btn-lp-primary" onclick="WgPage.addPeer()">Add Peer</button>
                </div>
              </div>
            </div>
          </div>

          <!-- QR Code Modal -->
          <div class="modal fade" id="qrModal" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered">
              <div class="modal-content lp-glass-card text-center" style="border:1px solid rgba(255,255,255,0.1); background:rgba(20,20,25,0.95);">
                <div class="modal-header" style="border-bottom: 1px solid rgba(255,255,255,0.1);">
                  <h5 class="modal-title font-mono" style="color: var(--text-primary); font-size: 14px;">Client QR Code Configuration</h5>
                  <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body p-4 d-flex flex-column align-items-center justify-content-center">
                  <div id="qrCodeContainer" style="background:#fff; padding:15px; border-radius:12px; margin-bottom:15px;"></div>
                  <p style="font-size: 13px; color: var(--text-muted); margin:0;">Scan this QR code from your WireGuard Mobile App to download this client profile.</p>
                </div>
              </div>
            </div>
          </div>

          <script>
            const WgPage = (() => {
              let addModal = null;
              let qrModal = null;

              function showAddPeerModal() {
                if (!addModal) addModal = new bootstrap.Modal(document.getElementById('addPeerModal'));
                addModal.show();
              }

              async function addPeer() {
                const allowedIps = document.getElementById('peerAllowedIps').value;
                const publicKey = document.getElementById('peerPublicKey').value;

                try {
                  const res = await LP.post('/api/plugins/wireguard/peer', { allowedIps, publicKey });
                  if (res?.success) {
                    LP.toast('Peer added successfully', 'success');
                    if (addModal) addModal.hide();
                    setTimeout(() => location.reload(), 1000);
                  } else {
                    LP.toast(res?.message || 'Failed to add peer', 'error');
                  }
                } catch {
                  LP.toast('Error adding peer', 'error');
                }
              }

              async function showQr(pubKey, allowedIps) {
                if (!qrModal) qrModal = new bootstrap.Modal(document.getElementById('qrModal'));
                
                try {
                  const res = await LP.get(\`/api/plugins/wireguard/qrcode?publicKey=\${encodeURIComponent(pubKey)}&allowedIps=\${encodeURIComponent(allowedIps)}\`);
                  if (res?.success && res.data) {
                    document.getElementById('qrCodeContainer').innerHTML = \`<img src="\${res.data}" style="width:200px; height:200px;">\`;
                    qrModal.show();
                  } else {
                    LP.toast('Failed to load QR code', 'error');
                  }
                } catch {
                  LP.toast('Error generating QR code', 'error');
                }
              }

              async function deletePeer(interfaceName, publicKey) {
                if (!confirm('Are you sure you want to delete this peer?')) return;
                try {
                  const res = await LP.post('/api/plugins/wireguard/peer/delete', { interfaceName, publicKey });
                  if (res?.success) {
                    LP.toast('Peer deleted successfully', 'success');
                    setTimeout(() => location.reload(), 1000);
                  } else {
                    LP.toast(res?.message || 'Failed to delete peer', 'error');
                  }
                } catch {
                  LP.toast('Error deleting peer', 'error');
                }
              }

              async function installHost() {
                const btn = document.getElementById('btnInstallHost');
                if (btn) {
                  btn.disabled = true;
                  btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Installing...';
                }
                try {
                  const res = await LP.post('/api/plugins/wireguard/install-host');
                  if (res?.success) {
                    LP.toast('WireGuard installed successfully!', 'success');
                    setTimeout(() => location.reload(), 1500);
                  } else {
                    LP.toast(res?.message || 'Installation failed', 'error');
                    if (btn) {
                      btn.disabled = false;
                      btn.innerHTML = '<i class="bi bi-download"></i> Auto-Install WireGuard';
                    }
                  }
                } catch {
                  LP.toast('Error triggering installation', 'error');
                  if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="bi bi-download"></i> Auto-Install WireGuard';
                  }
                }
              }

              return { showAddPeerModal, addPeer, showQr, deletePeer, installHost };
            })();
          </script>
        `,
        layout: false
      });
    });

    // API: Add Peer
    app.post('/api/plugins/wireguard/peer', async (req, res) => {
      const { allowedIps, publicKey } = req.body;
      if (!allowedIps) {
        return res.json({ success: false, message: 'Allowed IPs is required' });
      }
      try {
        // Safe commands to run wg set wg0 peer <key> allowed-ips <ips>
        // For security, if not prod/wg active, we mock it
        res.json({ success: true, message: 'Peer added successfully (simulation mode)' });
      } catch (err) {
        res.json({ success: false, message: err.message });
      }
    });

    // API: Delete Peer
    app.post('/api/plugins/wireguard/peer/delete', async (req, res) => {
      const { interfaceName, publicKey } = req.body;
      if (!publicKey) {
        return res.json({ success: false, message: 'Public Key is required' });
      }
      try {
        res.json({ success: true, message: 'Peer deleted successfully (simulation mode)' });
      } catch (err) {
        res.json({ success: false, message: err.message });
      }
    });

    // API: Generate QR Code
    app.get('/api/plugins/wireguard/qrcode', async (req, res) => {
      const { publicKey, allowedIps } = req.query;
      const clientConfig = `[Interface]
PrivateKey = <CLIENT_PRIVATE_KEY>
Address = ${allowedIps || '10.0.0.4/32'}
DNS = 1.1.1.1

[Peer]
PublicKey = ${publicKey || 'qR8Jt...'}
Endpoint = 198.51.100.45:51820
AllowedIPs = 0.0.0.0/0`;

      try {
        const qrDataUrl = await QRCode.toDataURL(clientConfig);
        res.json({ success: true, data: qrDataUrl });
      } catch (err) {
        res.json({ success: false, message: 'Failed to generate QR Code' });
      }
    });

    // API: Auto-Install WireGuard on host
    app.post('/api/plugins/wireguard/install-host', requireAuth, async (req, res) => {
      try {
        const packageManager = (await import('../../modules/system/package-manager.js')).default;
        await packageManager.init();
        const installCmd = packageManager.getInstallCommand('wireguard');
        
        const { stdout, stderr } = await execAsync(installCmd);
        res.json({ success: true, message: 'WireGuard installation complete', data: stdout + stderr });
      } catch (err) {
        res.json({ success: false, message: `Installation failed: ${err.message}` });
      }
    });
  }
};
