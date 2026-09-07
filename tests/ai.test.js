/**
 * OpenClaw AI Copilot & Terminal AI Diagnostics Tests
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { describe, test, expect } from '@jest/globals';
import aiService from '../src/modules/ai/ai.service.js';

describe('OpenClaw AI Copilot - Intent Matching', () => {
  test('matches RAM diagnosis intent correctly', () => {
    const queries = [
      'cek penggunaan ram tertinggi',
      'proses mana yang makan ram paling banyak?',
      'cek memory usage',
      'siapa pemakai memori terbesar',
    ];
    for (const q of queries) {
      const match = aiService.matchDiagnosticIntent(q);
      expect(match).not.toBeNull();
      expect(match.intent).toBe('check_ram_highest');
      expect(match.command).toBeDefined();
    }
  });

  test('matches CPU diagnosis intent correctly', () => {
    const queries = [
      'cek penggunaan cpu tertinggi',
      'proses apa yang bikin cpu tinggi?',
      'cek top cpu usage',
    ];
    for (const q of queries) {
      const match = aiService.matchDiagnosticIntent(q);
      expect(match).not.toBeNull();
      expect(match.intent).toBe('check_cpu_highest');
      expect(match.command).toBeDefined();
    }
  });

  test('matches Disk diagnosis intent correctly', () => {
    const queries = [
      'cek sisa storage disk',
      'berapa ruang harddisk tersisa?',
      'cek kapasitas partisi disk',
    ];
    for (const q of queries) {
      const match = aiService.matchDiagnosticIntent(q);
      expect(match).not.toBeNull();
      expect(match.intent).toBe('check_disk');
    }
  });

  test('matches Open Ports diagnosis intent', () => {
    const match = aiService.matchDiagnosticIntent('cek port terbuka di server');
    expect(match).not.toBeNull();
    expect(match.intent).toBe('check_ports');
  });

  test('matches Docker Containers diagnosis intent', () => {
    const match = aiService.matchDiagnosticIntent('cek status container docker');
    expect(match).not.toBeNull();
    expect(match.intent).toBe('check_docker');
  });

  test('matches Nginx diagnosis intent', () => {
    const match = aiService.matchDiagnosticIntent('cek konfigurasi status nginx');
    expect(match).not.toBeNull();
    expect(match.intent).toBe('check_nginx');
  });

  test('matches UFW Firewall diagnosis intent', () => {
    const match = aiService.matchDiagnosticIntent('cek status ufw firewall');
    expect(match).not.toBeNull();
    expect(match.intent).toBe('check_ufw');
  });

  test('returns null for generic conversational queries', () => {
    const queries = [
      'halo selamat pagi',
      'apa kabar?',
      'siapa kamu?',
      'buatkan saya puisi tentang linux',
    ];
    for (const q of queries) {
      expect(aiService.matchDiagnosticIntent(q)).toBeNull();
    }
  });
});

describe('OpenClaw AI Copilot - Security Guard', () => {
  test('detects and blocks catastrophic/destructive commands', () => {
    const dangerous = [
      'rm -rf /',
      'rm -rf /*',
      'rm -rf /etc',
      'mkfs.ext4 /dev/sda1',
      ':(){ :|:& };:',
      'dd if=/dev/zero of=/dev/sda',
      'shutdown -h now',
      'reboot',
      'init 0',
      '> /dev/sda',
    ];
    for (const cmd of dangerous) {
      expect(aiService.isDangerousCommand(cmd)).toBe(true);
    }
  });

  test('permits safe diagnostic and operational commands', () => {
    const safe = [
      'ps aux --sort=-%mem | head -n 15',
      'free -m',
      'df -h',
      'ss -tuln',
      'docker ps --format "table {{.Names}}\t{{.Status}}"',
      'systemctl status nginx',
      'uptime',
      'echo "hello world"',
    ];
    for (const cmd of safe) {
      expect(aiService.isDangerousCommand(cmd)).toBe(false);
    }
  });

  test('executeCommand throws Forbidden error on dangerous command', async () => {
    await expect(aiService.executeCommand('rm -rf /')).rejects.toThrow(/diblokir oleh Security Guard/i);
    await expect(aiService.executeCommand('mkfs /dev/sda')).rejects.toThrow(/diblokir oleh Security Guard/i);
  });

  test('detects system-modifying commands correctly', () => {
    expect(aiService.isSystemModifying('systemctl restart nginx')).toBe(true);
    expect(aiService.isSystemModifying('apt-get install -y fail2ban')).toBe(true);
    expect(aiService.isSystemModifying('kill -9 1234')).toBe(true);
    expect(aiService.isSystemModifying('chmod 755 /var/www')).toBe(true);
    expect(aiService.isSystemModifying('docker stop my-container')).toBe(true);

    // Read-only commands should not be flagged as system-modifying
    expect(aiService.isSystemModifying('ps aux')).toBe(false);
    expect(aiService.isSystemModifying('free -h')).toBe(false);
    expect(aiService.isSystemModifying('df -h')).toBe(false);
    expect(aiService.isSystemModifying('ls -la')).toBe(false);
  });
});

describe('Terminal AI Diagnostics - Heuristic Fallback', () => {
  test('diagnoses port in use error and proposes fuser kill solution', () => {
    const errorText = 'listen tcp 0.0.0.0:80: bind: address already in use';
    const diagnosis = aiService.diagnoseTerminalError(errorText);

    expect(diagnosis).not.toBeNull();
    expect(diagnosis.issue).toContain('Port 80');
    expect(diagnosis.fixCommand).toContain('fuser');
    expect(diagnosis.fixCommand).toContain('80/tcp');
  });

  test('diagnoses permission denied error and proposes sudo/chown solution', () => {
    const errorText = 'bash: /var/log/nginx/access.log: Permission denied';
    const diagnosis = aiService.diagnoseTerminalError(errorText);

    expect(diagnosis).not.toBeNull();
    expect(diagnosis.issue).toContain('Hak akses');
    expect(diagnosis.fixCommand).toContain('sudo');
  });

  test('diagnoses command not found error and proposes package manager solution', () => {
    const errorText = 'bash: htop: command not found';
    const diagnosis = aiService.diagnoseTerminalError(errorText);

    expect(diagnosis).not.toBeNull();
    expect(diagnosis.issue).toContain('htop');
    expect(diagnosis.fixCommand).toContain('apt update && apt install -y htop');
  });
});
