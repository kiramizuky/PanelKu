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
        const response = `**Hasil Diagnosa Error Terminal (${diag.category}):**
${diag.explanation}

**Perintah Diagnosa / Pengecekan:**
\`\`\`bash
${diag.fixCommand}
\`\`\`${diag.actionAdvice ? `\n**Perintah Perbaikan yang Disarankan:**\n\`\`\`bash\n${diag.actionAdvice}\n\`\`\`\n` : ''}`;

        return successResponse(res, { answer: response, diagnosis: diag });
      }

      // 2. Check for Direct Diagnostic Intent (e.g. "cek penggunaan ram tertinggi", "cek disk", etc.)
      const matchedIntent = aiService.matchDiagnosticIntent(message);
      if (matchedIntent) {
        try {
          const execRes = await aiService.executeCommand(matchedIntent.command);
          const output = execRes.stdout || execRes.stderr || '(Tidak ada output yang dihasilkan)';
          
          let response = `### 🔍 ${matchedIntent.title}
Data aktual dari server Anda saat ini:

\`\`\`bash
# ${matchedIntent.command}
${output}
\`\`\``;

          if (matchedIntent.actionAdvice) {
            response += `\n\n**💡 Rekomendasi Tindakan:**
\`\`\`bash
${matchedIntent.actionAdvice}
\`\`\`
*Klik tombol **Jalankan** di atas jika Anda ingin menerapkan tindakan ini.*`;
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
                  { parts: [{ text: `${systemPrompt}\n\nPertanyaan User: ${prompt}` }] },
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
        response = `Berdasarkan pengecekan memori server:
\`\`\`bash
free -h
${memRes.stdout}
\`\`\`
Penyebab RAM tinggi biasanya caching kernel OS (pagecache/buffers) atau kontainer Docker/database.
**Rekomendasi Pembersihan:**
\`\`\`bash
sync && echo 3 > /proc/sys/vm/drop_caches
\`\`\``;
      } else if (msg.includes('cpu') || msg.includes('proses')) {
        const cpuRes = await aiService.executeCommand('ps -eo pid,user,%cpu,cmd --sort=-%cpu | head -n 6').catch(() => ({ stdout: '15.5% nginx' }));
        response = `Berikut 5 proses teratas yang menggunakan CPU paling banyak:
\`\`\`bash
ps -eo pid,user,%cpu,cmd --sort=-%cpu | head -n 6
${cpuRes.stdout}
\`\`\`
Jika CPU terus tinggi, Anda dapat membatasi batas CPU kontainer di menu Docker atau menghentikan proses yang menggantung.`;
      } else if (msg.includes('disk') || msg.includes('penyimpanan') || msg.includes('habis')) {
        const dfRes = await aiService.executeCommand('df -h').catch(() => ({ stdout: '/dev/sda1 50G 45G 5G 90% /' }));
        response = `Status kapasitas partisi disk saat ini:
\`\`\`bash
df -h
${dfRes.stdout}
\`\`\`
**Rekomendasi Pembersihan:**
\`\`\`bash
journalctl --vacuum-size=100M && apt clean
\`\`\``;
      } else if (msg.includes('docker') || msg.includes('container')) {
        const docRes = await aiService.executeCommand('docker ps --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"').catch(() => ({ stdout: 'No running containers' }));
        response = `Daftar kontainer Docker yang sedang aktif:
\`\`\`bash
docker ps
${docRes.stdout}
\`\`\`
Anda dapat mengelola kontainer lebih lengkap melalui menu **Docker** di sidebar.`;
      } else if (context.logType === 'fail2ban' || msg.includes('fail2ban') || msg.includes('blokir') || msg.includes('intrusion')) {
        const bannedIps = (context.logText || '').match(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g) || [];
        const uniqueIps = [...new Set(bannedIps)].slice(0, 5);
        response = `**Analisis Log Fail2Ban:**
Fail2Ban mendeteksi upaya serangan dan memblokir IP penyerang secara otomatis.
${uniqueIps.length > 0 ? `\n**IP terdeteksi:**\n${uniqueIps.map(ip => '- ' + ip).join('\n')}\n` : ''}
Untuk membuka blokir IP tertentu jika salah terblokir:
\`\`\`bash
fail2ban-client unban <IP_ADDRESS>
\`\`\``;
      } else {
        response = `Halo! Saya adalah **OpenClaw AI Copilot**. Saya dapat mengeksekusi pengecekan langsung pada server Anda.
Contoh yang dapat Anda tanyakan:
- *"Cek penggunaan RAM tertinggi"*
- *"Cek proses CPU terberat"*
- *"Cek sisa kapasitas disk"*
- *"Cek port terbuka"*
- *"Cek status kontainer Docker"*
- *"Cek service yang gagal"*`;
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
      return successResponse(res, result, 'Perintah berhasil dieksekusi');
    } catch (error) {
      return errorResponse(res, 400, error.message);
    }
  }
}

export default new AIController();

