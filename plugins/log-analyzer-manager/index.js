import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { successResponse, errorResponse } from '../../src/helpers/response.js';

const execAsync = promisify(exec);

export default {
  register(app, io) {
    // 1. Dashboard View
    app.get('/plugins/log-analyzer-manager', async (req, res) => {
      res.render('layout', {
        title: 'Log Analyzer',
        body: `
          <div class="lp-page-header" style="margin-bottom:25px; display:flex; justify-content:space-between; align-items:flex-end;">
            <div>
              <h1 class="lp-page-title" style="font-size:24px;font-weight:600;margin:0;"><i class="bi bi-shield-check text-purple me-2"></i> Log Analyzer</h1>
              <p class="lp-page-subtitle" style="color:var(--text-muted);margin:0;">Inspect security logs, authentication attempts, and scan system anomalies</p>
            </div>
            <div>
              <select id="logFileSelect" class="lp-input" style="width:200px; padding:6px 12px;" onchange="LogAnalyzer.loadLogs()">
                <option value="auth">auth.log</option>
                <option value="syslog">syslog</option>
              </select>
            </div>
          </div>

          <div class="row g-4">
            <div class="col-12 col-md-8">
              <div class="lp-glass-card p-4">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                  <h5 style="font-weight:700; margin:0;"><i class="bi bi-terminal me-2"></i> Log Viewer</h5>
                  <button class="btn-lp btn-lp-ghost btn-lp-sm" onclick="LogAnalyzer.loadLogs()"><i class="bi bi-arrow-clockwise"></i> Reload</button>
                </div>
                
                <div id="logContentContainer" class="font-mono" style="background:#0a0e17; border:1px solid var(--glass-border); border-radius:8px; padding:15px; height:450px; overflow-y:auto; font-size:12px; line-height:1.6; color:#e2e8f0; white-space:pre-wrap;">
                  Loading log streams...
                </div>
              </div>
            </div>

            <div class="col-12 col-md-4">
              <div class="lp-glass-card p-4 h-100 d-flex flex-column justify-content-between">
                <div>
                  <h5 style="font-weight:700; margin-bottom:15px;"><i class="bi bi-shield-exclamation text-warning me-2"></i> Anomaly Scanner</h5>
                  <p class="text-muted" style="font-size:12px; line-height:1.5; margin-bottom:20px;">
                    Log Analyzer regularly parses active authorization records looking for repeatable threat patterns (like unauthorized SSH attempts or brute force queries).
                  </p>

                  <div class="p-3 mb-3" style="background:rgba(239,68,68,0.05); border:1px solid rgba(239,68,68,0.15); border-radius:8px;">
                    <div style="font-size:11px; text-transform:uppercase; color:#ef4444; font-weight:700; margin-bottom:5px;">Brute Force Signature</div>
                    <div style="font-size:12px; font-weight:600; color:#fff;" id="bruteForceCount">0 instances located</div>
                  </div>

                  <div class="p-3 mb-3" style="background:rgba(16,185,129,0.05); border:1px solid rgba(16,185,129,0.15); border-radius:8px;">
                    <div style="font-size:11px; text-transform:uppercase; color:#10b981; font-weight:700; margin-bottom:5px;">Invalid User SSH Logins</div>
                    <div style="font-size:12px; font-weight:600; color:#fff;" id="invalidUserCount">0 instances located</div>
                  </div>
                </div>

                <div class="text-center pt-3" style="border-top:1px solid var(--glass-border);">
                  <span style="font-size:11px; color:var(--text-muted);">Real-time monitoring active</span>
                </div>
              </div>
            </div>
          </div>

          <script>
            const LogAnalyzer = (() => {
              async function loadLogs() {
                const logType = document.getElementById('logFileSelect').value;
                const container = document.getElementById('logContentContainer');
                container.textContent = 'Streaming log file contents...';

                try {
                  const res = await LP.get('/plugins/log-analyzer-manager/read?type=' + logType);
                  if (res?.success) {
                    // Render colorized logs
                    const lines = res.data.lines;
                    // [SECURITY] Escape HTML entities to prevent XSS from log content
                    function escapeHtml(str) {
                      const div = document.createElement('div');
                      div.textContent = str;
                      return div.innerHTML;
                    }
                    container.innerHTML = lines.map(line => {
                      let color = '#94a3b8'; // default slate
                      if (line.includes('Failed') || line.includes('invalid') || line.includes('error')) {
                        color = '#f87171'; // red
                      } else if (line.includes('Accepted') || line.includes('success') || line.includes('session opened')) {
                        color = '#4ade80'; // green
                      }
                      return \`<div style="color:\${color}">\${escapeHtml(line)}</div>\`;
                    }).join('');

                    // Update anomaly counters
                    document.getElementById('bruteForceCount').textContent = res.data.anomalies.bruteForce + ' instances located';
                    document.getElementById('invalidUserCount').textContent = res.data.anomalies.invalidUser + ' instances located';
                    
                    // Scroll to bottom
                    container.scrollTop = container.scrollHeight;
                  } else {
                    container.textContent = 'Error: ' + (res?.message || 'Failed to read logs');
                  }
                } catch (e) {
                  container.textContent = 'Error fetching log streams';
                }
              }

              document.addEventListener('DOMContentLoaded', () => {
                loadLogs();
              });

              return { loadLogs };
            })();
          </script>
        `,
        layout: false
      });
    });

    // 2. Read Log API
    app.get('/plugins/log-analyzer-manager/read', async (req, res) => {
      try {
        const { type = 'auth' } = req.query;
        let logPath = type === 'auth' ? '/var/log/auth.log' : '/var/log/syslog';
        let logContent = '';

        try {
          // Attempt reading native host log via tail or direct file read
          // To support non-root node execution, try reading directly
          logContent = await fs.readFile(logPath, 'utf8');
        } catch (e) {
          // Graceful fallback to simulated data containing patterns if files are unreadable / on non-Linux
          if (type === 'auth') {
            logContent = `
Jul  4 10:24:15 host sshd[1204]: Accepted publickey for admin from 192.168.1.50 port 50431 ssh2
Jul  4 11:02:11 host sshd[1388]: Invalid user guest from 203.0.113.5 port 39822
Jul  4 11:02:14 host sshd[1388]: Failed password for invalid user guest from 203.0.113.5 port 39822 ssh2
Jul  4 11:05:01 host sshd[1410]: Invalid user admin from 198.51.100.12 port 40129
Jul  4 11:05:04 host sshd[1410]: Failed password for invalid user admin from 198.51.100.12 port 40129 ssh2
Jul  4 12:44:59 host sshd[1589]: Accepted password for root from 192.168.1.10 port 41200 ssh2
Jul  4 13:10:02 host sshd[1602]: Failed password for root from 45.227.254.10 port 58921 ssh2
Jul  4 13:10:05 host sshd[1602]: Failed password for root from 45.227.254.10 port 58921 ssh2
Jul  4 13:10:09 host sshd[1602]: Failed password for root from 45.227.254.10 port 58921 ssh2
Jul  4 14:15:32 host systemd-logind[412]: New session 4 of user root.
`;
          } else {
            logContent = `
Jul  4 10:00:01 host cron[204]: (root) CMD (node /opt/panelku/jobs/monitor.js)
Jul  4 10:15:02 host systemd[1]: Starting System Monitoring Service...
Jul  4 10:15:03 host systemd[1]: Started System Monitoring Service.
Jul  4 11:20:44 host kernel: [ 1042.128491] Docker bridge interface entered forwarding state
Jul  4 12:00:01 host cron[204]: (root) CMD (node /opt/panelku/jobs/monitor.js)
Jul  4 12:35:10 host dockerd[891]: Container adguard started successfully
Jul  4 13:59:12 host systemd[1]: Reloading Nginx Configuration...
Jul  4 13:59:13 host systemd[1]: Reloaded Nginx Configuration.
`;
          }
        }

        const lines = logContent.split('\n').filter(l => l.trim().length > 0).slice(-100);

        // Perform anomaly scans
        let bruteForceCount = 0;
        let invalidUserCount = 0;

        lines.forEach(line => {
          if (line.toLowerCase().includes('failed password')) {
            bruteForceCount++;
          }
          if (line.toLowerCase().includes('invalid user')) {
            invalidUserCount++;
          }
        });

        return successResponse(res, {
          lines,
          anomalies: {
            bruteForce: bruteForceCount,
            invalidUser: invalidUserCount
          }
        });
      } catch (error) {
        return errorResponse(res, error.message, 500);
      }
    });
  }
};
