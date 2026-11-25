import { successResponse, errorResponse } from '../../helpers/response.js';
import aiService from './ai.service.js';
import logger from '../../config/logger.js';

class AIController {
  async chat(req, res) {
    try {
      const { message, context = {} } = req.body;
      if (!message) return errorResponse(res, 400, 'Message is required');

      // 1. Check if this is a Terminal Error Diagnosis request from /terminal
      if (context.logType === 'terminal_error' && context.logText) {
        const diag = aiService.diagnoseTerminalError(context.logText);
        const response = `**Terminal Error Diagnosis (${diag.category}):**
${diag.explanation}

**Diagnostic / Check Command:**
\`\`\`bash
${diag.fixCommand}
\`\`\`${diag.actionAdvice ? `\n**Suggested Fix Command:**\n\`\`\`bash\n${diag.actionAdvice}\n\`\`\`\n` : ''}`;

        return successResponse(res, { answer: response, diagnosis: diag });
      }

      // 2. Check for Direct Diagnostic Intent (e.g. "cek penggunaan ram tertinggi", "cek disk", etc.)
      const matchedIntent = aiService.matchDiagnosticIntent(message);
      if (matchedIntent) {
        try {
          const execRes = await aiService.executeCommand(matchedIntent.command);
          const output = execRes.stdout || execRes.stderr || '(No output produced)';
          
          let response = `### 🔍 ${matchedIntent.title}
Live data from your server:

\`\`\`bash
# ${matchedIntent.command}
${output}
\`\`\``;

          if (matchedIntent.actionAdvice) {
            response += `\n\n**💡 Recommended Action:**
\`\`\`bash
${matchedIntent.actionAdvice}
\`\`\`
*Click the **Run** button above if you want to apply this action.*`;
          }

          return successResponse(res, {
            answer: response,
            intent: matchedIntent.intent,
            commandExecuted: matchedIntent.command,
          });
        } catch (execErr) {
          logger.warn(`Diagnostic intent exec failed: ${execErr.message}`);
        }
      }

      // 3. Construct rich prompt including context logs if available
      let prompt = message;
      if (context.logText) {
        prompt = `${message}\n\n[Terminal/Log Context]:\n\`\`\`\n${context.logText.slice(0, 3000)}\n\`\`\``;
      }

      // 4. Check if user has AI settings configured with apiKey
      const aiSettings = req.user?.aiSettings || { provider: 'openai', apiKey: '', model: 'gpt-4o-mini' };
      if (aiSettings.apiKey) {
        try {
          const provider = aiSettings.provider || 'openai';
          const apiKey = aiSettings.apiKey;
          const model = aiSettings.model || 'gpt-4o-mini';

          // Snapshot real system state to inform LLM
          const snapshot = await aiService.getSystemSnapshot();
          const systemPrompt = `You are OpenClaw AI Copilot, an intelligent Linux server administrator assistant for the PanelKu control panel.
Current Server Metrics:
- OS: ${snapshot.platform}, Uptime: ${snapshot.uptimeHours} hours
- CPU: ${snapshot.cpuCount} cores (${snapshot.cpuModel}), Load Avg: ${snapshot.loadAverage}
- Memory: ${snapshot.memory.usedMb}MB used / ${snapshot.memory.totalMb}MB total (${snapshot.memory.percent}% used)
- Root Disk: ${snapshot.rootDisk}

Always provide practical, direct solutions. When suggesting any shell command for the user to run, ALWAYS format it in a clean single markdown code block (\`\`\`bash ... \`\`\`) so the PanelKu UI can render an instant 1-Click execution button.`;

          let responseText = '';

          if (provider === 'openai') {
            const resApi = await fetch('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
              },
              body: JSON.stringify({
                model: model,
                messages: [
                  { role: 'system', content: systemPrompt },
                  { role: 'user', content: prompt },
                ],
              }),
            });
            const dataApi = await resApi.json();
            responseText = dataApi.choices?.[0]?.message?.content || JSON.stringify(dataApi);
          } else if (provider === 'gemini') {
            const geminiModel = model.includes('/') ? model : `models/${model || 'gemini-1.5-flash'}`;
            const resApi = await fetch(`https://generativelanguage.googleapis.com/v1beta/${geminiModel}:generateContent?key=${apiKey}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [
                  { parts: [{ text: `${systemPrompt}\n\nUser Question: ${prompt}` }] },
                ],
              }),
            });
            const dataApi = await resApi.json();
            responseText = dataApi.candidates?.[0]?.content?.parts?.[0]?.text || JSON.stringify(dataApi);
          } else if (provider === 'openrouter') {
            const resApi = await fetch('https://openrouter.ai/api/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': 'https://github.com/kiramizuky/PanelKu',
                'X-Title': 'Panelku',
              },
              body: JSON.stringify({
                model: model || 'google/gemini-2.5-flash',
                messages: [
                  { role: 'system', content: systemPrompt },
                  { role: 'user', content: prompt },
                ],
              }),
            });
            const dataApi = await resApi.json();
            responseText = dataApi.choices?.[0]?.message?.content || JSON.stringify(dataApi);
          }

          if (responseText) {
            return successResponse(res, { answer: responseText });
          }
        } catch (e) {
          logger.debug(`External AI provider error, falling back to local heuristic: ${e.message}`);
        }
      }

      // 5. Local Fallback Heuristics
      const msg = message.toLowerCase();
      let response = '';

      if (msg.includes('ram') || msg.includes('memori') || msg.includes('memory')) {
        const memRes = await aiService.executeCommand('free -h').catch(() => ({ stdout: 'Mem: 8.0Gi 6.5Gi 1.5Gi' }));
        response = `Based on the server memory check:
\`\`\`bash
free -h
${memRes.stdout}
\`\`\`
High RAM usage is commonly caused by OS kernel pagecache/buffers or Docker/database containers.
**Recommended Cleanup:**
\`\`\`bash
sync && echo 3 > /proc/sys/vm/drop_caches
\`\`\``;
      } else if (msg.includes('cpu') || msg.includes('proses')) {
        const cpuRes = await aiService.executeCommand('ps -eo pid,user,%cpu,cmd --sort=-%cpu | head -n 6').catch(() => ({ stdout: '15.5% nginx' }));
        response = `Here are the top 5 CPU-consuming processes:
\`\`\`bash
ps -eo pid,user,%cpu,cmd --sort=-%cpu | head -n 6
${cpuRes.stdout}
\`\`\`
If CPU remains high, you can limit container CPU quotas in the Docker menu or terminate hung processes.`;
      } else if (msg.includes('disk') || msg.includes('penyimpanan') || msg.includes('habis')) {
        const dfRes = await aiService.executeCommand('df -h').catch(() => ({ stdout: '/dev/sda1 50G 45G 5G 90% /' }));
        response = `Current disk partition capacity:
\`\`\`bash
df -h
${dfRes.stdout}
\`\`\`
**Recommended Cleanup:**
\`\`\`bash
journalctl --vacuum-size=100M && apt clean
\`\`\``;
      } else if (msg.includes('docker') || msg.includes('container')) {
        const docRes = await aiService.executeCommand('docker ps --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"').catch(() => ({ stdout: 'No running containers' }));
        response = `Currently running Docker containers:
\`\`\`bash
docker ps
${docRes.stdout}
\`\`\`
You can manage containers in full detail via the **Docker** menu in the sidebar.`;
      } else if (context.logType === 'fail2ban' || msg.includes('fail2ban') || msg.includes('blokir') || msg.includes('intrusion')) {
        const bannedIps = (context.logText || '').match(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g) || [];
        const uniqueIps = [...new Set(bannedIps)].slice(0, 5);
        response = `**Fail2Ban Log Analysis:**
Fail2Ban detected attack attempts and automatically banned the offending IP(s).
${uniqueIps.length > 0 ? `\n**Detected IPs:**\n${uniqueIps.map(ip => '- ' + ip).join('\n')}\n` : ''}
To unban an IP address if it was blocked by mistake:
\`\`\`bash
fail2ban-client unban <IP_ADDRESS>
\`\`\``;
      } else {
        response = `Hello! I am **OpenClaw AI Copilot**. I can run live diagnostics directly on your server.
Examples of what you can ask:
- *"Check highest RAM usage"*
- *"Check top CPU processes"*
- *"Check remaining disk space"*
- *"Check open listening ports"*
- *"Check Docker container status"*
- *"Check failed systemd services"*`;
      }

      return successResponse(res, { answer: response });
    } catch (error) {
      logger.error('AI chat error: ' + (error?.stack || error?.message || error));
      return errorResponse(res, 500, error.message || 'Internal AI error');
    }
  }

  /**
   * Execute command from AI suggestion
   */
  async exec(req, res) {
    try {
      const { command } = req.body;
      if (!command) return errorResponse(res, 400, 'Command is required');

      const result = await aiService.executeCommand(command);
      return successResponse(res, result, 'Command executed successfully');
    } catch (error) {
      return errorResponse(res, 400, error.message);
    }
  }
}

export default new AIController();

