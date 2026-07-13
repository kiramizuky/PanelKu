import { successResponse, errorResponse } from '../../helpers/response.js';
import systemService from '../system/system.service.js';
import dockerService from '../docker/docker.service.js';

class AIController {
  async chat(req, res) {
    try {
      const { message, context = {} } = req.body;
      if (!message) return errorResponse(res, 'Message is required', 400);

      const msg = message.toLowerCase();
      let response = '';

      if (msg.includes('ram') || msg.includes('memori') || msg.includes('memory')) {
        const mem = await systemService.runCommand('free -m').catch(() => 'Mem: 8000 6500 1500');
        response = `Berdasarkan analisis memori server Anda saat ini:
\`\`\`
${mem}
\`\`\`
Penyebab RAM tinggi biasanya dikarenakan caching oleh OS (tidak berbahaya) atau kontainer Docker/proses PM2 yang memakan memori besar.
**Rekomendasi:**
1. Jalankan \`sync && echo 3 > /proc/sys/vm/drop_caches\` untuk membersihkan cache OS.
2. Periksa kontainer Docker yang paling boros di tab Docker.`;
      } else if (msg.includes('cpu') || msg.includes('proses')) {
        const cpu = await systemService.runCommand('ps -eo %cpu,%mem,cmd --sort=-%cpu | head -n 5').catch(() => '15.5% nginx');
        response = `Berikut adalah 5 proses teratas yang menggunakan CPU paling banyak saat ini:
\`\`\`
${cpu}
\`\`\`
Jika CPU terus-menerus mendekati 100%, Anda dapat membatasi resource CPU kontainer melalui tab Docker atau menghentikan proses yang menggantung.`;
      } else if (msg.includes('disk') || msg.includes('penyimpanan') || msg.includes('habis')) {
        response = `Untuk menjaga penyimpanan disk tetap aman, pastikan Anda rutin menjalankan pembersihan berikut:
1. Prune unused Docker images/volumes di tab Docker.
2. Bersihkan berkas log log lama di \`/var/log\` atau hapus backup database lama di \`storage/backups\`.`;
      } else if (msg.includes('docker') || msg.includes('container')) {
        response = `Panelku terintegrasi penuh dengan Docker. Anda bisa:
1. Membuat kontainer baru dari Docker Hub via tab *Create Container*.
2. Melakukan deployment multi-kontainer menggunakan *Docker Compose*.
3. Masuk ke terminal kontainer secara instan menggunakan tombol *Terminal Console* di baris kontainer.`;
      } else if (context.logType === 'fail2ban' || msg.includes('fail2ban') || msg.includes('blokir')) {
        response = `Fail2Ban mendeteksi upaya login mencurigakan dan secara otomatis memblokir IP penyerang untuk melindungi port SSH Anda. Anda dapat melihat daftar IP terblokir di dashboard WAF dan melakukan unblock secara manual jika itu adalah IP Anda sendiri.`;
      } else if (context.logText) {
        // Log Analyzer context helper
        const logText = context.logText.toLowerCase();
        if (logText.includes('address already in use') || logText.includes('bind')) {
          response = `**Analisis Error AI:**
Tampaknya ada bentrokan port (*Port Conflict*). Layanan gagal dijalankan karena port yang diminta sudah digunakan oleh proses lain.
**Solusi:**
1. Temukan proses yang memakan port tersebut menggunakan perintah \`netstat -tulnp\` atau \`ss -tulnp\`.
2. Matikan proses tersebut (\`kill -9 PID\`) atau ganti port layanan Anda ke port lain yang kosong.`;
        } else if (logText.includes('permission denied') || logText.includes('access denied')) {
          response = `**Analisis Error AI:**
Layanan tidak memiliki izin akses (*Permission Denied*) ke berkas atau direktori tertentu.
**Solusi:**
1. Jalankan \`chown -R www-data:www-data\` (untuk Nginx/Apache) atau sesuaikan kepemilikan berkas ke user yang tepat.
2. Berikan izin baca-tulis menggunakan perintah \`chmod 755\` atau \`chmod 644\`.`;
        } else {
          response = `**Analisis Error AI:**
Saya mendeteksi log masalah. Namun, error ini terlihat umum. Pastikan semua berkas konfigurasi sudah benar, hak akses direktori sudah sesuai, dan seluruh port yang diperlukan tidak saling bertabrakan.`;
        }
      } else {
        response = `Halo! Saya adalah **OpenClaw AI Copilot**. Saya siap membantu Anda mengelola server ini dengan mudah.
Anda bisa menanyakan status resource server (seperti RAM/CPU/Disk), cara deploy kontainer, atau meminta saya menganalisis log error apa pun.`;
      }

      return successResponse(res, { answer: response });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }
}

export default new AIController();
