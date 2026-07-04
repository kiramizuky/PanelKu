import { exec } from 'child_process';
import { promisify } from 'util';
import { successResponse, errorResponse } from '../../src/helpers/response.js';
import packageManager from '../../src/modules/system/package-manager.js';

const execPromise = promisify(exec);

export default {
  register(app, io) {
    // 1. Rclone View
    app.get('/plugins/rclone-manager', async (req, res) => {
      try {
        let isInstalled = false;
        let rcloneVersionStr = '';
        let remotes = [];

        try {
          const { stdout } = await execPromise('rclone --version');
          isInstalled = true;
          rcloneVersionStr = stdout.split('\n')[0] || 'rclone detected';
          
          // Fetch remotes
          const { stdout: remotesOut } = await execPromise('rclone listremotes');
          remotes = remotesOut.split('\n').map(r => r.trim()).filter(Boolean);
        } catch (e) {
          isInstalled = false;
        }

        res.render('layout', {
          title: 'Rclone Manager',
          body: `
            <div class="lp-page-header" style="margin-bottom:25px; display:flex; justify-content:space-between; align-items:flex-end;">
              <div>
                <h1 class="lp-page-title" style="font-size:24px;font-weight:600;margin:0;"><i class="bi bi-cloud-upload-fill text-warning me-2"></i> Rclone Manager</h1>
                <p class="lp-page-subtitle" style="color:var(--text-muted);margin:0;">Sync and backup folders to remote cloud storage providers</p>
              </div>
            </div>

            <div class="row g-4">
              <!-- Left: CLI status -->
              <div class="col-12 col-md-4">
                <div class="lp-glass-card p-4 text-center">
                  <div style="width:72px; height:72px; border-radius:50%; background:rgba(245,158,11,0.1); color:var(--accent-warning); display:flex; align-items:center; justify-content:center; margin:0 auto 15px; font-size:32px;">
                    <i class="bi bi-cloud-upload-fill"></i>
                  </div>
                  <h5 style="font-weight:700; margin-bottom:5px;">Rclone CLI</h5>
                  <div class="mb-3">
                    ${isInstalled 
                      ? `<span class="lp-badge lp-badge-success"><span class="lp-badge-dot"></span>Installed</span>`
                      : `<span class="lp-badge lp-badge-danger"><span class="lp-badge-dot"></span>Not Found</span>`
                    }
                  </div>
                  <p class="text-muted" style="font-size:12px; margin-bottom:20px;">
                    ${isInstalled ? rcloneVersionStr : 'Rclone CLI utility is not installed on the host system.'}
                  </p>

                  <div>
                    ${!isInstalled 
                      ? `<button class="btn-lp btn-lp-primary w-100" onclick="RclonePage.install()"><i class="bi bi-download me-1"></i> Install Rclone CLI</button>`
                      : `<button class="btn-lp btn-lp-ghost text-muted w-100" disabled><i class="bi bi-check-circle me-1"></i> CLI Available</button>`
                    }
                  </div>
                </div>
              </div>

              <!-- Right: Configured Remotes -->
              <div class="col-12 col-md-8">
                <div class="lp-glass-card p-4">
                  <h5 style="font-weight:700; margin-bottom:15px;"><i class="bi bi-list-task text-primary me-2"></i> Configured Cloud Remotes</h5>
                  
                  ${isInstalled 
                    ? remotes.length === 0
                      ? `
                        <div class="text-center py-4">
                          <p class="text-muted" style="font-size:13px; margin-bottom:15px;">No cloud remotes configured yet.</p>
                          <p class="text-slate-400" style="font-size:12px;">Configure remotes via SSH terminal using:</p>
                          <pre class="bg-dark text-success p-2 rounded font-mono mt-1" style="font-size:11px; display:inline-block; border:1px solid rgba(255,255,255,0.05);">rclone config</pre>
                        </div>
                      `
                      : `
                        <div class="table-responsive">
                          <table class="lp-table">
                            <thead>
                              <tr>
                                <th>Remote Name</th>
                                <th>Type</th>
                                <th style="text-align:right">Action</th>
                              </tr>
                            </thead>
                            <tbody>
                              ${remotes.map(rem => {
                                const [name, type] = rem.split(':');
                                return `
                                  <tr>
                                    <td><strong style="color:var(--text-primary)">${name}</strong></td>
                                    <td><span class="lp-badge lp-badge-info">${type || 'cloud'}</span></td>
                                    <td style="text-align:right">
                                      <button class="btn-lp btn-lp-ghost btn-lp-sm text-info" onclick="RclonePage.testRemote('${name}')"><i class="bi bi-lightning-fill"></i> Test Connection</button>
                                    </td>
                                  </tr>
                                `;
                              }).join('')}
                            </tbody>
                          </table>
                        </div>
                      `
                    : `
                      <p class="text-muted" style="font-size:13px;">Please install the Rclone CLI utility first to view and manage cloud remotes.</p>
                    `
                  }
                </div>
              </div>
            </div>

            <script>
              const RclonePage = (() => {
                async function install() {
                  LP.toast('Installing Rclone CLI... This may take a minute.', 'info');
                  try {
                    const res = await LP.post('/plugins/rclone-manager/install-cli');
                    if (res?.success) {
                      LP.toast('Rclone installed successfully!', 'success');
                      window.location.reload();
                    } else {
                      LP.toast(res?.message || 'Installation failed', 'error');
                    }
                  } catch (e) {
                    LP.toast('Installation failed', 'error');
                  }
                }

                async function testRemote(name) {
                  LP.toast('Testing remote connection...', 'info');
                  try {
                    const res = await LP.post('/plugins/rclone-manager/test-remote', { name });
                    if (res?.success) {
                      LP.toast('Connection success: ' + res.message, 'success');
                    } else {
                      LP.toast(res?.message || 'Connection failed', 'error');
                    }
                  } catch (e) {
                    LP.toast('Test failed', 'error');
                  }
                }

                return { install, testRemote };
              })();
            </script>
          `,
          layout: false
        });
      } catch (err) {
        res.status(500).send('Internal Server Error: ' + err.message);
      }
    });

    // 2. Install CLI Route
    app.post('/plugins/rclone-manager/install-cli', async (req, res) => {
      try {
        await packageManager.init();
        let installCmd = 'sudo apt-get install -y rclone';
        
        if (packageManager.pmType === 'pacman') {
          installCmd = 'sudo pacman -S --noconfirm rclone';
        } else if (packageManager.pmType === 'dnf') {
          installCmd = 'sudo dnf install -y rclone';
        } else if (packageManager.pmType === 'emerge') {
          installCmd = 'sudo emerge net-misc/rclone';
        }

        await execPromise(installCmd);
        return successResponse(res, null, 'Rclone installed successfully');
      } catch (error) {
        return errorResponse(res, error.message, 500);
      }
    });

    // 3. Test Connection Route
    app.post('/plugins/rclone-manager/test-remote', async (req, res) => {
      try {
        const { name } = req.body;
        if (!name) return errorResponse(res, 'Remote name is required', 400);

        // Run rclone lsd remote:
        const { stdout } = await execPromise(`rclone lsd "${name}:"`);
        return successResponse(res, null, 'Connected to remote cloud successfully');
      } catch (error) {
        return errorResponse(res, error.message, 500);
      }
    });
  }
};
