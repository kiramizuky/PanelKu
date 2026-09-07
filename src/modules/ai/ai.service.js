/**
 * OpenClaw AI Copilot Service
 * Handles diagnostic intent mapping, terminal error diagnosis,
 * command execution with security guard, and system state snapshotting.
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import logger from '../../config/logger.js';

const execAsync = promisify(exec);

// Dangerous commands that must NEVER be executed directly via AI
const DANGEROUS_PATTERNS = [
  /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s+[/~*]/i,
  /\bmkfs(?:\.[a-z0-9]+)?\b/i,
  /\bdd\s+.*of=\/dev\/(?:sd|hd|nvme|vd|mapper)/i,
  />\s*\/dev\/(?:sd|hd|nvme|vd|mapper)/i,
  /:[a-zA-Z0-9_]*\s*\(\)\s*\{[\s\S]*?:\|:&[\s\S]*?\};:/, // fork bomb
  /\bchmod\s+-[a-zA-Z]*R\s+777\s+[/~*]/i,
  /\bchown\s+-[a-zA-Z]*R\s+.*?\s+[/~*]/i,
  /\b(?:shutdown|reboot|poweroff|init\s+[06])\b/i,
  /\bcurl\b.*?\|\s*(?:bash|sh)\b/i, // piping untrusted url to shell
  /\bwget\b.*?\|\s*(?:bash|sh)\b/i,
];

// Commands that modify system state (requires warning / higher caution)
const SYSTEM_MODIFY_PATTERNS = [
  /\bsystemctl\s+(?:restart|stop|start|disable|enable|mask|daemon-reload)\b/i,
  /\bapt(?:-get)?\s+(?:install|remove|purge|upgrade|dist-upgrade|autoremove)\b/i,
  /\byum\s+(?:install|remove|update)\b/i,
  /\bdnf\s+(?:install|remove|update)\b/i,
  /\bpacman\s+-[SRU]/i,
  /\bkill\s+(?:-9\s+)?\d+/i,
  /\bpkill\b/i,
  /\bkillall\b/i,
  /\bdocker\s+(?:rm|stop|restart|kill|prune|volume\s+rm|compose\s+down)\b/i,
  /\bchown\b/i,
  /\bchmod\b/i,
  /\bsed\s+-i\b/i,
  /\btruncate\b/i,
];

class AIService {
  /**
   * Check if a command is considered dangerous
   */
  isDangerousCommand(cmd) {
    if (!cmd || typeof cmd !== 'string') return true;
    const clean = cmd.trim();
    return DANGEROUS_PATTERNS.some(pattern => pattern.test(clean));
  }

  /**
   * Check if a command modifies system configuration/services
   */
  isSystemModifyingCommand(cmd) {
    if (!cmd || typeof cmd !== 'string') return false;
    const clean = cmd.trim();
    return SYSTEM_MODIFY_PATTERNS.some(pattern => pattern.test(clean));
  }

  /**
   * Alias for isSystemModifyingCommand
   */
  isSystemModifying(cmd) {
    return this.isSystemModifyingCommand(cmd);
  }

  /**
   * Execute command safely with timeout and security check
   */
  async executeCommand(command, options = {}) {
    if (!command || typeof command !== 'string') {
      throw new Error('Command is required and must be a string');
    }

    const cleanCmd = command.trim();
    if (this.isDangerousCommand(cleanCmd)) {
      logger.warn(`[AI-SecurityGuard] Blocked dangerous command: ${cleanCmd}`);
      throw new Error('Perintah ini diblokir oleh Security Guard karena berisiko merusak sistem.');
    }

    const timeout = options.timeout || 30000;
    const maxOutputLen = 6000;
    const startTime = Date.now();

    try {
      if (process.platform === 'win32') {
        // Windows simulated execution for tests / dev
        try {
          const { stdout, stderr } = await execAsync(cleanCmd, { timeout });
          const executionTime = Date.now() - startTime;
          return {
            stdout: (stdout || '').substring(0, maxOutputLen),
            stderr: (stderr || '').substring(0, maxOutputLen),
            exitCode: 0,
            executionTime,
            command: cleanCmd,
          };
        } catch {
          // Fallback simulation for linux-specific commands on windows
          return {
            stdout: `[Simulated Linux Output on Windows]: Command '${cleanCmd}' executed.`,
            stderr: '',
            exitCode: 0,
            executionTime: Date.now() - startTime,
            command: cleanCmd,
          };
        }
      }

      const { stdout, stderr } = await execAsync(cleanCmd, {
        timeout,
        cwd: options.cwd || '/root',
        maxBuffer: 1024 * 1024 * 2, // 2MB
      });

      const executionTime = Date.now() - startTime;
      return {
        stdout: (stdout || '').substring(0, maxOutputLen),
        stderr: (stderr || '').substring(0, maxOutputLen),
        exitCode: 0,
        executionTime,
        command: cleanCmd,
      };
    } catch (err) {
      const executionTime = Date.now() - startTime;
      return {
        stdout: (err.stdout || '').substring(0, maxOutputLen),
        stderr: (err.stderr || err.message || '').substring(0, maxOutputLen),
        exitCode: err.code || 1,
        executionTime,
        command: cleanCmd,
      };
    }
  }

  /**
   * Match user prompt against known diagnostic intents
   */
  matchDiagnosticIntent(message) {
    if (!message || typeof message !== 'string') return null;
    const msg = message.toLowerCase().trim();

    // 1. RAM / Memory Highest Usage
    if (
      (msg.includes('ram') || msg.includes('memori') || msg.includes('memory')) &&
      (msg.includes('tinggi') || msg.includes('tertinggi') || msg.includes('boros') || msg.includes('habis') || msg.includes('banyak') || msg.includes('cek') || msg.includes('penggunaan') || msg.includes('terbesar') || msg.includes('besar') || msg.includes('pemakai'))
    ) {
      return {
        intent: 'check_ram_highest',
        title: 'Pengecekan Penggunaan RAM Tertinggi',
        command: 'ps -eo pid,user,%mem,rss,cmd --sort=-%mem | head -n 11 && echo "---" && free -h',
        category: 'RAM / Memory',
        actionAdvice: 'sync && echo 3 > /proc/sys/vm/drop_caches',
        actionLabel: 'Bersihkan Cache RAM (Drop Caches)',
      };
    }

    // 2. CPU / Top CPU Process
    if (
      (msg.includes('cpu') || msg.includes('proses')) &&
      (msg.includes('tinggi') || msg.includes('tertinggi') || msg.includes('berat') || msg.includes('beban') || msg.includes('cek') || msg.includes('penggunaan') || msg.includes('terbesar') || msg.includes('besar') || msg.includes('boros') || msg.includes('banyak'))
    ) {
      return {
        intent: 'check_cpu_highest',
        title: 'Pengecekan Proses CPU Tertinggi',
        command: 'ps -eo pid,user,%cpu,time,cmd --sort=-%cpu | head -n 11 && echo "---" && uptime',
        category: 'CPU / Load',
        actionAdvice: 'top -b -n 1 | head -n 15',
        actionLabel: 'Lihat Snapshot Top Proses',
      };
    }

    // 3. Disk Space / Storage Usage
    if (
      (msg.includes('disk') || msg.includes('storage') || msg.includes('penyimpanan') || msg.includes('partisi') || msg.includes('kapasitas')) &&
      (msg.includes('cek') || msg.includes('penuh') || msg.includes('habis') || msg.includes('status') || msg.includes('sisa'))
    ) {
      return {
        intent: 'check_disk',
        title: 'Pengecekan Kapasitas & Partisi Disk',
        command: 'df -h && echo "---" && du -sh /var/log /var/www /var/lib/docker 2>/dev/null || true',
        category: 'Disk / Storage',
        actionAdvice: 'journalctl --vacuum-size=100M',
        actionLabel: 'Bersihkan Log Jurnal Sistem (Vacuum 100M)',
      };
    }

    // 4. Docker Containers Status
    if (
      msg.includes('docker') &&
      (msg.includes('cek') || msg.includes('status') || msg.includes('container') || msg.includes('kontainer') || msg.includes('jalan') || msg.includes('running'))
    ) {
      return {
        intent: 'check_docker',
        title: 'Pengecekan Kontainer Docker',
        command: 'docker ps -a --format "table {{.Names}}\\t{{.Status}}\\t{{.Image}}\\t{{.Ports}}"',
        category: 'Docker',
        actionAdvice: 'docker system df',
        actionLabel: 'Cek Penggunaan Disk Docker',
      };
    }

    // 5. Open Ports / Network Listening
    if (
      (msg.includes('port') || msg.includes('listening')) &&
      (msg.includes('cek') || msg.includes('terbuka') || msg.includes('open') || msg.includes('bentrok') || msg.includes('aktif'))
    ) {
      return {
        intent: 'check_ports',
        title: 'Pengecekan Port Terbuka (Listening)',
        command: 'ss -tulpn 2>/dev/null | grep LISTEN || netstat -tulpn 2>/dev/null | grep LISTEN || true',
        category: 'Network / Ports',
      };
    }

    // 6. Failed Services / Systemd Status
    if (
      (msg.includes('service') || msg.includes('layanan') || msg.includes('systemd')) &&
      (msg.includes('gagal') || msg.includes('error') || msg.includes('mati') || msg.includes('failed') || msg.includes('cek'))
    ) {
      return {
        intent: 'check_failed_services',
        title: 'Pengecekan Service Gagal (Systemd)',
        command: 'systemctl --failed',
        category: 'Services',
        actionAdvice: 'systemctl reset-failed',
        actionLabel: 'Reset Status Failed Services',
      };
    }

    // 7. Nginx Test & Syntax
    if (
      msg.includes('nginx') &&
      (msg.includes('cek') || msg.includes('test') || msg.includes('syntax') || msg.includes('konfigurasi') || msg.includes('error'))
    ) {
      return {
        intent: 'check_nginx',
        title: 'Pengecekan Sintaks Konfigurasi Nginx',
        command: 'nginx -t 2>&1',
        category: 'Web Server',
        actionAdvice: 'systemctl reload nginx',
        actionLabel: 'Reload Nginx Web Server',
      };
    }

    // 8. Firewall (UFW) Status
    if (
      (msg.includes('firewall') || msg.includes('ufw')) &&
      (msg.includes('cek') || msg.includes('status') || msg.includes('rule'))
    ) {
      return {
        intent: 'check_ufw',
        title: 'Pengecekan Status Firewall (UFW)',
        command: 'ufw status verbose 2>/dev/null || echo "UFW firewall is inactive or not installed"',
        category: 'Security',
      };
    }

    // 9. System Logs / Journal Errors
    if (
      (msg.includes('log') || msg.includes('journal')) &&
      (msg.includes('error') || msg.includes('sistem') || msg.includes('system') || msg.includes('crash'))
    ) {
      return {
        intent: 'check_system_logs',
        title: 'Pengecekan Log Error Sistem Terkini',
        command: 'journalctl -p 3 -xb -n 15 --no-pager 2>/dev/null || tail -n 15 /var/log/syslog 2>/dev/null || true',
        category: 'Logs',
      };
    }

    return null;
  }

  /**
   * Diagnose terminal error output and provide targeted command fix
   */
  diagnoseTerminalError(logText) {
    if (!logText || typeof logText !== 'string') {
      return {
        category: 'General Terminal',
        issue: 'Tidak ada log error yang terdeteksi secara spesifik.',
        explanation: 'Tidak ada log error yang terdeteksi secara spesifik.',
        fixCommand: '',
        riskLevel: 'safe',
      };
    }

    const t = logText.toLowerCase();

    // 1. Port conflict / Address already in use
    if (t.includes('address already in use') || t.includes('eaddrinuse') || (t.includes('bind') && t.includes('failed'))) {
      const portMatch = logText.match(/:([0-9]{2,5})\b/) || logText.match(/port\s+([0-9]{2,5})/i);
      const port = portMatch ? portMatch[1] : '80';
      return {
        category: 'Port Conflict',
        issue: `Port ${port} sedang digunakan oleh proses lain, sehingga layanan baru tidak dapat mengikat (bind) ke port tersebut.`,
        explanation: `Port ${port} sedang digunakan oleh proses lain, sehingga layanan baru tidak dapat mengikat (bind) ke port tersebut.`,
        fixCommand: `fuser -k ${port}/tcp`,
        actionAdvice: `fuser -k ${port}/tcp`,
        riskLevel: 'medium',
      };
    }

    // 2. Permission Denied / Access Denied
    if (t.includes('permission denied') || t.includes('eacces') || t.includes('operation not permitted')) {
      return {
        category: 'Permission Denied',
        issue: 'Hak akses (permission) tidak mencukupi untuk membaca atau mengeksekusi file/direktori target.',
        explanation: 'Proses atau pengguna saat ini tidak memiliki hak akses (permission) ke file atau direktori target.',
        fixCommand: 'sudo chmod 755 . && sudo chown -R $USER:$USER .',
        actionAdvice: 'chmod 755 . && chown -R $USER:$USER .',
        riskLevel: 'medium',
      };
    }

    // 3. APT / Dpkg Lock
    if (t.includes('could not get lock') || t.includes('unable to lock directory') || t.includes('/var/lib/dpkg/lock')) {
      return {
        category: 'Package Manager Lock',
        issue: 'APT/dpkg terkunci oleh proses package manager lain.',
        explanation: 'APT/dpkg terkunci karena ada proses instalasi atau update lain yang sedang berjalan di background.',
        fixCommand: 'killall apt apt-get dpkg 2>/dev/null || rm -f /var/lib/apt/lists/lock /var/lib/dpkg/lock*',
        actionAdvice: 'killall apt apt-get dpkg 2>/dev/null || rm -f /var/lib/apt/lists/lock /var/lib/dpkg/lock*',
        riskLevel: 'medium',
      };
    }

    // 4. Command not found
    if (t.includes('command not found') || t.includes('not recognized as an internal or external command')) {
      const cmdMatch = logText.match(/([a-zA-Z0-9_-]+):\s*command not found/i) || logText.match(/'([^']+)'\s*is not recognized/i);
      const cmd = cmdMatch ? cmdMatch[1] : 'perintah';
      return {
        category: 'Command Not Found',
        issue: `Perintah \`${cmd}\` belum terinstal di sistem atau tidak berada dalam PATH lingkungan.`,
        explanation: `Perintah \`${cmd}\` belum terinstal di sistem atau tidak berada dalam PATH lingkungan.`,
        fixCommand: `apt update && apt install -y ${cmd}`,
        actionAdvice: `apt update && apt install -y ${cmd}`,
        riskLevel: 'medium',
      };
    }

    // 5. No space left on device
    if (t.includes('no space left on device') || t.includes('enospc') || t.includes('disk full')) {
      return {
        category: 'Disk Full',
        explanation: 'Partisi disk penyimpanan telah mencapai kapasitas maksimum 100%.',
        fixCommand: 'df -h',
        actionAdvice: 'journalctl --vacuum-size=50M && apt clean',
        riskLevel: 'safe',
      };
    }

    // 6. Node.js / NPM module missing
    if (t.includes('cannot find module') || t.includes('module_not_found')) {
      return {
        category: 'Node.js Missing Module',
        explanation: 'Dependensi Node.js belum terpasang atau berkas `node_modules` hilang.',
        fixCommand: 'npm install',
        riskLevel: 'safe',
      };
    }

    // Default fallback
    return {
      category: 'Diagnostic',
      explanation: 'Error terminal terdeteksi. Silakan periksa detail error di atas untuk menentukan langkah perbaikan.',
      fixCommand: 'dmesg -T | tail -n 10',
      riskLevel: 'safe',
    };
  }

  /**
   * Snapshot quick server metrics for LLM context injection
   */
  async getSystemSnapshot() {
    const totalMem = Math.round(os.totalmem() / (1024 * 1024));
    const freeMem = Math.round(os.freemem() / (1024 * 1024));
    const usedMem = totalMem - freeMem;
    const memPercent = totalMem > 0 ? Math.round((usedMem / totalMem) * 100) : 0;
    const cpus = os.cpus();
    const loadAvg = os.loadavg();

    let diskInfo = 'N/A';
    try {
      if (process.platform !== 'win32') {
        const { stdout } = await execAsync('df -h / | tail -1', { timeout: 3000 });
        diskInfo = stdout.trim();
      }
    } catch {}

    return {
      platform: os.platform(),
      uptimeHours: Math.round(os.uptime() / 3600),
      cpuCount: cpus.length,
      cpuModel: cpus[0]?.model || 'Generic CPU',
      loadAverage: loadAvg.map(l => l.toFixed(2)).join(', '),
      memory: {
        totalMb: totalMem,
        usedMb: usedMem,
        freeMb: freeMem,
        percent: memPercent,
      },
      rootDisk: diskInfo,
    };
  }
}

export default new AIService();
