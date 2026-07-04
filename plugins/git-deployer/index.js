import { exec } from 'child_process';
import { promisify } from 'util';
import { requireAuth } from '../../middleware/auth.js';

const execAsync = promisify(exec);

export default {
  register(app, io) {
    // We will dynamically load Setting model to query/save configurations
    async function getWebhooks() {
      try {
        const Setting = (await import('../../models/Setting.js')).default;
        const webhooksStr = await Setting.get('git_deploy_webhooks') || '[]';
        return JSON.parse(typeof webhooksStr === 'string' ? webhooksStr : JSON.stringify(webhooksStr));
      } catch {
        return [];
      }
    }

    async function saveWebhooks(webhooks) {
      const Setting = (await import('../../models/Setting.js')).default;
      await Setting.set('git_deploy_webhooks', JSON.stringify(webhooks), 'json');
    }

    // --- Page Route (Protected) ---
    app.get('/plugins/git-deployer', requireAuth, async (req, res) => {
      const webhooks = await getWebhooks();
      res.render('layout', {
        title: 'Git Auto-Deploy',
        body: `
          <div class="lp-page-header" style="margin-bottom:20px;">
            <h1 class="lp-page-title" style="font-size:24px;font-weight:600;margin:0;"><i class="bi bi-git text-danger"></i> Git Auto-Deploy</h1>
            <p class="lp-page-subtitle" style="color:var(--text-muted);margin:0;">Deploy code automatically via Git Webhooks</p>
          </div>

          <div class="row">
            <!-- Left Panel: Create Webhook -->
            <div class="col-md-5">
              <div class="lp-glass-card p-4 mb-4">
                <h5 style="font-size: 16px; font-weight: 600; color: var(--text-primary); margin-bottom: 20px;">Create Deployment Hook</h5>
                <div class="mb-3">
                  <label class="lp-label" style="display:block; margin-bottom:6px;">Hook Name</label>
                  <input type="text" id="hookName" class="form-control lp-input w-100" placeholder="e.g. My Website App">
                </div>
                <div class="mb-3">
                  <label class="lp-label" style="display:block; margin-bottom:6px;">Repository Local Path</label>
                  <input type="text" id="hookPath" class="form-control lp-input w-100" placeholder="e.g. /var/www/myapp">
                </div>
                <div class="mb-3">
                  <label class="lp-label" style="display:block; margin-bottom:6px;">Branch to Watch</label>
                  <input type="text" id="hookBranch" class="form-control lp-input w-100" placeholder="e.g. main" value="main">
                </div>
                <div class="mb-3">
                  <label class="lp-label" style="display:block; margin-bottom:6px;">Build / Deployment Script</label>
                  <textarea id="hookScript" class="form-control lp-input w-100" rows="4" placeholder="e.g. git pull && npm install && npm run build" style="background: rgba(255,255,255,0.05); color: var(--text-primary); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; font-family: monospace; font-size:12px; padding: 10px;"></textarea>
                </div>
                <button class="btn-lp btn-lp-primary w-100" onclick="GitDeployPage.createHook()">Create Webhook</button>
              </div>
            </div>

            <!-- Right Panel: List & Logs -->
            <div class="col-md-7">
              <div class="lp-glass-card p-4">
                <h5 style="font-size: 16px; font-weight: 600; color: var(--text-primary); margin-bottom: 20px;">Active Deployment Webhooks</h5>
                <div id="webhookListContainer">
                  ${webhooks.length === 0 ? `
                    <p class="text-center text-muted" style="padding: 20px;">No webhooks created yet.</p>
                  ` : webhooks.map(hook => `
                    <div style="background: rgba(0,0,0,0.15); padding: 15px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.05); margin-bottom: 15px;">
                      <div class="d-flex justify-content-between align-items-center mb-2">
                        <strong style="color:var(--text-primary); font-size:15px;"><i class="bi bi-link-45deg text-danger"></i> ${hook.name}</strong>
                        <button class="btn-lp btn-lp-ghost btn-sm text-danger" onclick="GitDeployPage.deleteHook('${hook.id}')"><i class="bi bi-trash"></i></button>
                      </div>
                      <div style="font-size:12px; color:var(--text-muted); margin-bottom:10px;">
                        <div><strong>Path:</strong> <code>${hook.path}</code></div>
                        <div><strong>Branch:</strong> <span class="lp-badge lp-badge-info" style="font-size:10px;">${hook.branch}</span></div>
                        <div class="mt-2"><strong>Webhook URL:</strong></div>
                        <div class="d-flex gap-2 align-items-center mt-1">
                          <input type="text" class="form-control lp-input" readonly value="${req.protocol}://${req.get('host')}/api/git-deploy/webhook/${hook.id}" style="background: rgba(0,0,0,0.3); font-size:11px; height:28px; padding: 0 8px; border:none; border-radius:4px; flex-grow:1;">
                          <button class="btn-lp btn-lp-primary" style="height:28px; font-size:11px; padding: 0 10px; line-height:28px;" onclick="navigator.clipboard.writeText('${req.protocol}://${req.get('host')}/api/git-deploy/webhook/${hook.id}').then(() => LP.toast('Copied URL', 'success'))">Copy</button>
                        </div>
                      </div>

                      <!-- Deployment History -->
                      <div style="border-top:1px solid rgba(255,255,255,0.05); padding-top:10px; margin-top:10px;">
                        <span style="font-size:11px; font-weight:600; color:var(--text-primary); display:block; margin-bottom:6px;">Recent Deployments</span>
                        ${(!hook.logs || hook.logs.length === 0) ? `
                          <span style="font-size:11px; color:var(--text-muted);">No deployments yet. Send a push webhook to trigger.</span>
                        ` : hook.logs.map(log => `
                          <div style="font-size:11px; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.2); padding: 6px 10px; border-radius:6px;">
                            <span><span class="lp-badge ${log.status === 'success' ? 'lp-badge-success' : 'lp-badge-danger'}" style="font-size:9px; margin-right:6px;">${log.status.toUpperCase()}</span> ${new Date(log.timestamp).toLocaleString()}</span>
                            <button class="btn-lp btn-lp-ghost btn-sm text-info p-0" style="height:20px; line-height:20px;" onclick="GitDeployPage.showLog('${hook.id}', '${log.timestamp}')">View Output</button>
                          </div>
                        `).join('')}
                      </div>
                    </div>
                  `).join('')}
                </div>
              </div>
            </div>
          </div>

          <!-- Log Modal -->
          <div class="modal fade" id="logModal" tabindex="-1">
            <div class="modal-dialog modal-lg modal-dialog-centered">
              <div class="modal-content lp-glass-card" style="border:1px solid rgba(255,255,255,0.1); background:rgba(20,20,25,0.95);">
                <div class="modal-header" style="border-bottom: 1px solid rgba(255,255,255,0.1);">
                  <h5 class="modal-title font-mono" style="color: var(--text-primary); font-size: 14px;">Build Log Output</h5>
                  <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body">
                  <pre id="logOutputArea" style="background:#000; color:#00ff00; padding:15px; border-radius:8px; font-size:12px; font-family:monospace; max-height:400px; overflow-y:auto; margin:0; white-space: pre-wrap; word-break: break-all;"></pre>
                </div>
              </div>
            </div>
          </div>

          <script>
            const GitDeployPage = (() => {
              let logModal = null;
              const webhooksData = ${JSON.stringify(webhooks)};

              async function createHook() {
                const name = document.getElementById('hookName').value;
                const path = document.getElementById('hookPath').value;
                const branch = document.getElementById('hookBranch').value;
                const script = document.getElementById('hookScript').value;

                if (!name || !path || !script) {
                  LP.toast('Please fill in all fields', 'error');
                  return;
                }

                try {
                  const res = await LP.post('/api/plugins/git-deploy/webhook-configs', { name, path, branch, script });
                  if (res?.success) {
                    LP.toast('Webhook hook created successfully', 'success');
                    setTimeout(() => location.reload(), 1000);
                  } else {
                    LP.toast(res?.message || 'Failed to create webhook', 'error');
                  }
                } catch {
                  LP.toast('Error creating webhook', 'error');
                }
              }

              async function deleteHook(id) {
                if (!confirm('Are you sure you want to delete this webhook?')) return;
                try {
                  const res = await LP.post('/api/plugins/git-deploy/webhook-configs/delete', { id });
                  if (res?.success) {
                    LP.toast('Webhook deleted successfully', 'success');
                    setTimeout(() => location.reload(), 1000);
                  } else {
                    LP.toast(res?.message || 'Failed to delete webhook', 'error');
                  }
                } catch {
                  LP.toast('Error deleting webhook', 'error');
                }
              }

              function showLog(hookId, timestamp) {
                const hook = webhooksData.find(h => h.id === hookId);
                if (hook && hook.logs) {
                  const log = hook.logs.find(l => l.timestamp === timestamp);
                  if (log) {
                    document.getElementById('logOutputArea').textContent = log.output || 'No output.';
                    if (!logModal) logModal = new bootstrap.Modal(document.getElementById('logModal'));
                    logModal.show();
                    return;
                  }
                }
                LP.toast('Log not found', 'error');
              }

              return { createHook, deleteHook, showLog };
            })();
          </script>
        `,
        layout: false
      });
    });

    // --- Private API: Create configuration ---
    app.post('/api/plugins/git-deploy/webhook-configs', requireAuth, async (req, res) => {
      const { name, path, branch, script } = req.body;
      const webhooks = await getWebhooks();
      const newHook = {
        id: Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15),
        name,
        path,
        branch: branch || 'main',
        script,
        logs: []
      };
      webhooks.push(newHook);
      await saveWebhooks(webhooks);
      res.json({ success: true, message: 'Webhook created successfully' });
    });

    // --- Private API: Delete configuration ---
    app.post('/api/plugins/git-deploy/webhook-configs/delete', requireAuth, async (req, res) => {
      const { id } = req.body;
      const webhooks = await getWebhooks();
      const updated = webhooks.filter(w => w.id !== id);
      await saveWebhooks(updated);
      res.json({ success: true, message: 'Webhook deleted successfully' });
    });

    // --- Public API Endpoint: Webhook Trigger ---
    app.post('/api/git-deploy/webhook/:secret', async (req, res) => {
      const { secret } = req.params;
      const webhooks = await getWebhooks();
      const hook = webhooks.find(w => w.id === secret);

      if (!hook) {
        return res.status(404).json({ success: false, message: 'Invalid webhook token' });
      }

      // Return response immediately so Git platform doesn't timeout
      res.json({ success: true, message: 'Deployment triggered in the background' });

      // Run deploy script in the background asynchronously
      const timestamp = new Date().toISOString();
      let status = 'success';
      let output = '';

      try {
        const { stdout, stderr } = await execAsync(hook.script, { cwd: hook.path });
        output = stdout + '\n' + stderr;
      } catch (err) {
        status = 'error';
        output = err.message + '\n' + (err.stdout || '') + '\n' + (err.stderr || '');
      }

      // Append log (keep last 5 logs)
      const freshWebhooks = await getWebhooks();
      const hookToUpdate = freshWebhooks.find(w => w.id === secret);
      if (hookToUpdate) {
        if (!hookToUpdate.logs) hookToUpdate.logs = [];
        hookToUpdate.logs.unshift({ timestamp, status, output });
        hookToUpdate.logs = hookToUpdate.logs.slice(0, 5);
        await saveWebhooks(freshWebhooks);

        // Notify front-end dashboard in real-time
        io.emit('git-deploy:triggered', { hookId: secret, status, timestamp });
      }
    });
  }
};
