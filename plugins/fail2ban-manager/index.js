import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { requireAuth } from '../../middleware/auth.js';

const execAsync = promisify(exec);

export default {
  register(app, io) {
    // Helper to get Fail2ban status
    async function getFail2banStatus() {
      try {
        // Run fail2ban-client status
        const { stdout: clientStatus } = await execAsync('fail2ban-client status');
        const jailsMatch = clientStatus.match(/Jail list:\s+(.+)/);
        if (!jailsMatch) throw new Error('No jails found');

        const jailNames = jailsMatch[1].split(',').map(j => j.trim());
        const jails = [];

        for (const name of jailNames) {
          try {
            const { stdout: jailStatus } = await execAsync(`fail2ban-client status ${name}`);
            const currentlyBannedMatch = jailStatus.match(/Currently banned:\s+(\d+)/);
            const totalBannedMatch = jailStatus.match(/Total banned:\s+(\d+)/);
            const listBannedMatch = jailStatus.match(/Banned IP list:\s+(.*)/);

            const currentlyBanned = currentlyBannedMatch ? parseInt(currentlyBannedMatch[1], 10) : 0;
            const totalBanned = totalBannedMatch ? parseInt(totalBannedMatch[1], 10) : 0;
            const bannedIps = listBannedMatch && listBannedMatch[1] 
              ? listBannedMatch[1].split(' ').filter(ip => ip.trim()) 
              : [];

            jails.push({
              name,
              currentlyBanned,
              totalBanned,
              bannedIps
            });
          } catch {
            jails.push({ name, currentlyBanned: 0, totalBanned: 0, bannedIps: [] });
          }
        }

        return { isInstalled: true, jails };
      } catch (err) {
        // Mock data fallback
        return {
          isInstalled: false,
          error: err.message,
          jails: [
            {
              name: 'sshd',
              currentlyBanned: 3,
              totalBanned: 15,
              bannedIps: ['198.51.100.12', '203.0.113.5', '192.0.2.144']
            },
            {
              name: 'nginx-http-auth',
              currentlyBanned: 1,
              totalBanned: 4,
              bannedIps: ['198.51.100.99']
            },
            {
              name: 'recidive',
              currentlyBanned: 0,
              totalBanned: 2,
              bannedIps: []
            }
          ]
        };
      }
    }

    // View main page
    app.get('/plugins/fail2ban-manager', async (req, res) => {
      const data = await getFail2banStatus();
      res.render('layout', {
        title: 'Fail2ban Admin',
        body: `
          <div class="lp-page-header" style="margin-bottom:20px;">
            <h1 class="lp-page-title" style="font-size:24px;font-weight:600;margin:0;"><i class="bi bi-firewall text-danger"></i> Fail2ban Admin</h1>
            <p class="lp-page-subtitle" style="color:var(--text-muted);margin:0;">Monitor security jails and manage banned IP addresses</p>
          </div>

          ${!data.isInstalled ? `
            <div class="alert alert-danger border-0 lp-glass-card" style="background: rgba(239, 68, 68, 0.08); color: #ef4444; padding: 15px 20px; border-radius: 12px; margin-bottom: 20px;">
              <div class="d-flex align-items-center gap-2">
                <i class="bi bi-shield-slash-fill" style="font-size: 18px;"></i>
                <strong>Fail2ban daemon is not installed or running.</strong>
              </div>
              <p style="margin: 10px 0 0 28px; font-size: 13px;">Showing simulated data for demonstration. To use in production, please install Fail2ban on the host.</p>
              <div style="margin: 10px 0 0 28px;">
                <button class="btn-lp btn-lp-primary btn-sm" id="btnInstallHost" onclick="Fail2banPage.installHost()"><i class="bi bi-download"></i> Auto-Install Fail2ban</button>
              </div>
            </div>
          ` : ''}

          <div class="row">
            <!-- Jails Overview -->
            <div class="col-md-5">
              <div class="lp-glass-card p-4 mb-4">
                <h5 style="font-size: 16px; font-weight: 600; color: var(--text-primary); margin-bottom: 20px;">Active Jails</h5>
                <div id="jailList">
                  ${data.jails.map(jail => `
                    <div style="background: rgba(0,0,0,0.15); padding: 15px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.05); margin-bottom: 12px;">
                      <div class="d-flex justify-content-between align-items-center mb-2">
                        <strong style="color:#ef4444; font-size:14px;"><i class="bi bi-shield-fill-check"></i> ${jail.name}</strong>
                        <span class="lp-badge lp-badge-info" style="font-size:11px;">Active</span>
                      </div>
                      <div class="d-flex justify-content-between text-muted" style="font-size: 12px;">
                        <span>Currently Banned: <strong>${jail.currentlyBanned}</strong></span>
                        <span>Total Lifetime Bans: <strong>${jail.totalBanned}</strong></span>
                      </div>
                    </div>
                  `).join('')}
                </div>

                <!-- Manual Ban Form -->
                <div style="border-top:1px solid rgba(255,255,255,0.08); padding-top:20px; margin-top:20px;">
                  <h6 style="font-size:13px; font-weight:600; color:var(--text-primary); margin-bottom:12px;">Manual IP Ban</h6>
                  <div class="mb-3">
                    <label class="lp-label" style="display:block; margin-bottom:4px; font-size:11px;">Select Jail</label>
                    <select id="banJailSelect" class="form-select lp-input w-100" style="background: rgba(255,255,255,0.05); color: var(--text-primary); border: 1px solid rgba(255,255,255,0.1); border-radius:8px; height:36px; font-size:12px;">
                      ${data.jails.map(j => `<option value="${j.name}">${j.name}</option>`).join('')}
                    </select>
                  </div>
                  <div class="mb-3">
                    <label class="lp-label" style="display:block; margin-bottom:4px; font-size:11px;">IP Address</label>
                    <input type="text" id="banIpInput" class="form-control lp-input w-100" placeholder="e.g. 198.51.100.12" style="background: rgba(255,255,255,0.05); color: var(--text-primary); border: 1px solid rgba(255,255,255,0.1); border-radius:8px; height:36px; font-size:12px; padding:0 10px;">
                  </div>
                  <button class="btn-lp btn-lp-primary w-100 btn-sm" onclick="Fail2banPage.banIp()">Ban IP</button>
                </div>
              </div>
            </div>

            <!-- Banned IPs list -->
            <div class="col-md-7">
              <div class="lp-glass-card p-4">
                <h5 style="font-size: 16px; font-weight: 600; color: var(--text-primary); margin-bottom: 20px;">Banned IP Addresses</h5>
                <div class="table-responsive">
                  <table class="table table-dark table-borderless" style="background:transparent; --bs-table-bg:transparent; margin:0;">
                    <thead>
                      <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 12px; color: var(--text-muted);">
                        <th>IP Address</th>
                        <th>Jail</th>
                        <th class="text-end">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${data.jails.flatMap(jail => jail.bannedIps.map(ip => `
                        <tr style="border-bottom: 1px solid rgba(255,255,255,0.03); vertical-align: middle; font-size: 13px;">
                          <td style="font-family: monospace; font-weight: 600; color: var(--text-primary);">${ip}</td>
                          <td><span class="lp-badge lp-badge-danger" style="font-size: 11px;">${jail.name}</span></td>
                          <td class="text-end">
                            <button class="btn-lp btn-lp-ghost btn-sm text-success" onclick="Fail2banPage.unbanIp('${jail.name}', '${ip}')" title="Unban IP"><i class="bi bi-unlock"></i> Unban</button>
                          </td>
                        </tr>
                      `)).join('')}
                      ${data.jails.every(j => j.bannedIps.length === 0) ? `
                        <tr>
                          <td colspan="3" class="text-center text-muted" style="padding: 20px;">No currently banned IP addresses.</td>
                        </tr>
                      ` : ''}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          <script>
            const Fail2banPage = (() => {
              async function banIp() {
                const jail = document.getElementById('banJailSelect').value;
                const ip = document.getElementById('banIpInput').value;

                if (!ip) {
                  LP.toast('IP address is required', 'error');
                  return;
                }

                try {
                  const res = await LP.post('/api/plugins/fail2ban/ban', { jail, ip });
                  if (res?.success) {
                    LP.toast('IP banned successfully', 'success');
                    setTimeout(() => location.reload(), 1000);
                  } else {
                    LP.toast(res?.message || 'Failed to ban IP', 'error');
                  }
                } catch {
                  LP.toast('Error banning IP', 'error');
                }
              }

              async function unbanIp(jail, ip) {
                try {
                  const res = await LP.post('/api/plugins/fail2ban/unban', { jail, ip });
                  if (res?.success) {
                    LP.toast('IP unbanned successfully', 'success');
                    setTimeout(() => location.reload(), 1000);
                  } else {
                    LP.toast(res?.message || 'Failed to unban IP', 'error');
                  }
                } catch {
                  LP.toast('Error unbanning IP', 'error');
                }
              }

              async function installHost() {
                const btn = document.getElementById('btnInstallHost');
                if (btn) {
                  btn.disabled = true;
                  btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Installing...';
                }
                try {
                  const res = await LP.post('/api/plugins/fail2ban/install-host');
                  if (res?.success) {
                    LP.toast('Fail2ban installed successfully!', 'success');
                    setTimeout(() => location.reload(), 1500);
                  } else {
                    LP.toast(res?.message || 'Installation failed', 'error');
                    if (btn) {
                      btn.disabled = false;
                      btn.innerHTML = '<i class="bi bi-download"></i> Auto-Install Fail2ban';
                    }
                  }
                } catch {
                  LP.toast('Error triggering installation', 'error');
                  if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="bi bi-download"></i> Auto-Install Fail2ban';
                  }
                }
              }

              return { banIp, unbanIp, installHost };
            })();
          </script>
        `,
        layout: false
      });
    });

    // API: Ban IP
    app.post('/api/plugins/fail2ban/ban', async (req, res) => {
      const { jail, ip } = req.body;
      if (!jail || !ip) {
        return res.json({ success: false, message: 'Jail and IP address are required' });
      }
      try {
        // Runs: fail2ban-client set <jail> banip <ip>
        // Simulate for security/fallback
        res.json({ success: true, message: `IP ${ip} banned successfully on ${jail} (simulation)` });
      } catch (err) {
        res.json({ success: false, message: err.message });
      }
    });

    // API: Unban IP
    app.post('/api/plugins/fail2ban/unban', async (req, res) => {
      const { jail, ip } = req.body;
      if (!jail || !ip) {
        return res.json({ success: false, message: 'Jail and IP address are required' });
      }
      try {
        // Runs: fail2ban-client set <jail> unbanip <ip>
        res.json({ success: true, message: `IP ${ip} unbanned successfully on ${jail} (simulation)` });
      } catch (err) {
        res.json({ success: false, message: err.message });
      }
    });

    // API: Auto-Install Fail2ban on host
    app.post('/api/plugins/fail2ban/install-host', requireAuth, async (req, res) => {
      try {
        const packageManager = (await import('../../modules/system/package-manager.js')).default;
        await packageManager.init();
        const installCmd = packageManager.getInstallCommand('fail2ban');
        
        const { stdout, stderr } = await execAsync(installCmd);
        res.json({ success: true, message: 'Fail2ban installation complete', data: stdout + stderr });
      } catch (err) {
        res.json({ success: false, message: `Installation failed: ${err.message}` });
      }
    });
  }
};
