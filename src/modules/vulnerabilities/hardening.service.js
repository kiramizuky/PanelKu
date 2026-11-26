import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import logger from '../../config/logger.js';
import { getStorageDir } from '../../config/paths.js';

const execFileAsync = promisify(execFile);

const PROFILES = {
  web: {
    id: 'web',
    name: 'Web Production Baseline',
    description: 'Balanced hardening for Nginx/Apache/Caddy + Node.js/PHP production hosts.',
    files: [
      {
        key: 'sysctl',
        path: '/etc/sysctl.d/99-panelku-hardening.conf',
        content: [
          '# PanelKu Hardening Profile: web',
          'kernel.randomize_va_space = 2',
          'fs.suid_dumpable = 0',
          'net.ipv4.tcp_syncookies = 1',
          'net.ipv4.conf.all.rp_filter = 1',
          'net.ipv4.conf.default.rp_filter = 1',
        ].join('\n') + '\n',
      },
      {
        key: 'sshd',
        path: '/etc/ssh/sshd_config.d/99-panelku-hardening.conf',
        content: [
          '# PanelKu Hardening Profile: web',
          'PermitRootLogin prohibit-password',
          'PermitEmptyPasswords no',
          'MaxAuthTries 4',
          'LoginGraceTime 0',
          'X11Forwarding no',
        ].join('\n') + '\n',
      },
      {
        key: 'fail2ban',
        path: '/etc/fail2ban/jail.d/panelku-hardening.local',
        content: [
          '# PanelKu Hardening Profile: web',
          '[sshd]',
          'enabled = true',
          'maxretry = 5',
          'bantime = 3600',
        ].join('\n') + '\n',
      },
      {
        key: 'systemd',
        path: '/etc/systemd/system/panelku.service.d/limits.conf',
        content: [
          '[Service]',
          'MemoryMax=1536M',
          'LimitNOFILE=65536',
        ].join('\n') + '\n',
      },
    ],
  },
  database: {
    id: 'database',
    name: 'Database Tier Baseline',
    description: 'Tuned for PostgreSQL, MySQL/MariaDB, Redis, and MongoDB hosts with high file descriptor limits.',
    files: [
      {
        key: 'sysctl',
        path: '/etc/sysctl.d/99-panelku-hardening.conf',
        content: [
          '# PanelKu Hardening Profile: database',
          'kernel.randomize_va_space = 2',
          'fs.suid_dumpable = 0',
          'net.ipv4.tcp_syncookies = 1',
          'net.ipv4.conf.all.rp_filter = 1',
          'vm.swappiness = 10',
        ].join('\n') + '\n',
      },
      {
        key: 'sshd',
        path: '/etc/ssh/sshd_config.d/99-panelku-hardening.conf',
        content: [
          '# PanelKu Hardening Profile: database',
          'PermitRootLogin prohibit-password',
          'PermitEmptyPasswords no',
          'MaxAuthTries 4',
          'LoginGraceTime 0',
          'X11Forwarding no',
          'AllowTcpForwarding no',
        ].join('\n') + '\n',
      },
      {
        key: 'fail2ban',
        path: '/etc/fail2ban/jail.d/panelku-hardening.local',
        content: [
          '# PanelKu Hardening Profile: database',
          '[sshd]',
          'enabled = true',
          'maxretry = 4',
          'bantime = 7200',
        ].join('\n') + '\n',
      },
      {
        key: 'systemd',
        path: '/etc/systemd/system/panelku.service.d/limits.conf',
        content: [
          '[Service]',
          'MemoryMax=4096M',
          'LimitNOFILE=131072',
        ].join('\n') + '\n',
      },
    ],
  },
  bastion: {
    id: 'bastion',
    name: 'Bastion / Maximum Lockdown',
    description: 'Strictest SSH key-only enforcement, aggressive Fail2Ban bans, and tight kernel/systemd limits.',
    files: [
      {
        key: 'sysctl',
        path: '/etc/sysctl.d/99-panelku-hardening.conf',
        content: [
          '# PanelKu Hardening Profile: bastion',
          'kernel.randomize_va_space = 2',
          'fs.suid_dumpable = 0',
          'net.ipv4.tcp_syncookies = 1',
          'net.ipv4.conf.all.rp_filter = 1',
          'net.ipv4.conf.all.accept_redirects = 0',
          'net.ipv4.icmp_echo_ignore_broadcasts = 1',
        ].join('\n') + '\n',
      },
      {
        key: 'sshd',
        path: '/etc/ssh/sshd_config.d/99-panelku-hardening.conf',
        content: [
          '# PanelKu Hardening Profile: bastion',
          'PermitRootLogin no',
          'PasswordAuthentication no',
          'PermitEmptyPasswords no',
          'MaxAuthTries 3',
          'LoginGraceTime 0',
          'X11Forwarding no',
          'AllowTcpForwarding no',
        ].join('\n') + '\n',
      },
      {
        key: 'fail2ban',
        path: '/etc/fail2ban/jail.d/panelku-hardening.local',
        content: [
          '# PanelKu Hardening Profile: bastion',
          '[sshd]',
          'enabled = true',
          'maxretry = 3',
          'bantime = 86400',
        ].join('\n') + '\n',
      },
      {
        key: 'systemd',
        path: '/etc/systemd/system/panelku.service.d/limits.conf',
        content: [
          '[Service]',
          'MemoryMax=1024M',
          'LimitNOFILE=65536',
        ].join('\n') + '\n',
      },
    ],
  },
};

function computeUnifiedDiff(currentText, proposedText) {
  const curLines = (currentText || '').split('\n').filter((l, idx, arr) => idx < arr.length - 1 || l !== '');
  const propLines = (proposedText || '').split('\n').filter((l, idx, arr) => idx < arr.length - 1 || l !== '');
  const diff = [];
  for (const line of curLines) {
    if (!propLines.includes(line)) diff.push(`- ${line}`);
  }
  for (const line of propLines) {
    if (!curLines.includes(line)) diff.push(`+ ${line}`);
    else diff.push(`  ${line}`);
  }
  return diff.join('\n');
}

class HardeningService {
  constructor() {
    this._lastSnapshot = null;
  }

  listProfiles() {
    return Object.values(PROFILES).map(({ id, name, description, files }) => ({
      id,
      name,
      description,
      targets: files.map((f) => ({ key: f.key, path: f.path })),
    }));
  }

  /**
   * Generate a non-destructive Preview Diff comparing current host files against the target profile.
   */
  previewProfile(profileId, fsImpl = fs) {
    const profile = PROFILES[profileId];
    if (!profile) {
      throw new Error(`Unknown hardening profile: ${profileId}`);
    }

    const diffs = profile.files.map((target) => {
      let current = '';
      let exists = false;
      try {
        if (fsImpl.existsSync(target.path)) {
          exists = true;
          current = fsImpl.readFileSync(target.path, 'utf8');
        }
      } catch {
        current = '';
      }

      return {
        key: target.key,
        path: target.path,
        exists,
        changed: current !== target.content,
        current,
        proposed: target.content,
        diff: computeUnifiedDiff(current, target.content),
      };
    });

    return {
      profile: { id: profile.id, name: profile.name, description: profile.description },
      diffs,
    };
  }

  async _runHealthcheck(runner) {
    if (typeof runner === 'function') {
      return runner();
    }
    if (process.platform === 'win32' || process.env.NODE_ENV === 'test') {
      return { ok: true, detail: 'Simulated healthcheck OK' };
    }
    try {
      await execFileAsync('sshd', ['-t'], { timeout: 5000 });
      const { stdout } = await execFileAsync('systemctl', ['is-active', 'ssh'], { timeout: 4000 })
        .catch(() => execFileAsync('systemctl', ['is-active', 'sshd'], { timeout: 4000 }));
      if (!String(stdout).trim().includes('active')) {
        return { ok: false, detail: 'SSH daemon is not active after reload' };
      }
      return { ok: true, detail: 'sshd syntax and service health verified' };
    } catch (err) {
      return { ok: false, detail: `SSH healthcheck failed: ${err.message}` };
    }
  }

  /**
   * Apply a baseline hardening profile with snapshot creation and automatic rollback on healthcheck failure.
   */
  async applyProfile(profileId, options = {}) {
    if (!options.confirmed) {
      throw new Error('Manual confirmation is required before applying a hardening profile.');
    }
    const profile = PROFILES[profileId];
    if (!profile) {
      throw new Error(`Unknown hardening profile: ${profileId}`);
    }

    const fsImpl = options.fsImpl || fs;
    const isDryPlatform = process.platform === 'win32' || process.env.NODE_ENV === 'test';
    const writeTargetFs = !isDryPlatform || Boolean(options.fsImpl);
    const snapshot = {
      id: `hardening-${Date.now()}`,
      profileId,
      createdAt: new Date().toISOString(),
      entries: [],
    };

    // 1. Capture pre-apply snapshot
    for (const target of profile.files) {
      const existed = writeTargetFs && fsImpl.existsSync(target.path);
      const previousContent = existed ? fsImpl.readFileSync(target.path, 'utf8') : null;
      snapshot.entries.push({ path: target.path, existed, previousContent });
    }
    this._lastSnapshot = snapshot;

    // Persist snapshot for audit/recovery
    try {
      const backupDir = path.join(getStorageDir(), 'backups');
      fs.mkdirSync(backupDir, { recursive: true, mode: 0o750 });
      fs.writeFileSync(
        path.join(backupDir, `${snapshot.id}.json`),
        JSON.stringify(snapshot, null, 2),
        { mode: 0o600 }
      );
    } catch (err) {
      logger.warn(`Failed to persist hardening snapshot: ${err.message}`);
    }

    // 2. Write hardening configs (real write on Linux prod, or when custom fsImpl is injected in tests)
    if (!isDryPlatform || options.fsImpl) {
      for (const target of profile.files) {
        fsImpl.mkdirSync(path.dirname(target.path), { recursive: true });
        fsImpl.writeFileSync(target.path, target.content, 'utf8');
      }
    }

    if (!isDryPlatform && !options.healthcheckFn) {
      await execFileAsync('sysctl', ['--system'], { timeout: 8000 }).catch(() => {});
      await execFileAsync('systemctl', ['daemon-reload'], { timeout: 5000 }).catch(() => {});
      await execFileAsync('systemctl', ['reload', 'ssh'], { timeout: 5000 })
        .catch(() => execFileAsync('systemctl', ['reload', 'sshd'], { timeout: 5000 }))
        .catch(() => {});
      await execFileAsync('fail2ban-client', ['reload'], { timeout: 5000 }).catch(() => {});
    }

    // 3. Verify SSH/service healthcheck — auto-rollback if anything fails
    const health = await this._runHealthcheck(options.healthcheckFn);
    if (!health.ok) {
      logger.error(`[Hardening] Healthcheck failed for profile ${profileId}: ${health.detail}. Triggering auto-rollback...`);
      await this.rollbackSnapshot(snapshot, { fsImpl, skipSystemReload: isDryPlatform });
      return {
        success: false,
        rolledBack: true,
        profileId,
        reason: health.detail,
        snapshotId: snapshot.id,
      };
    }

    return {
      success: true,
      rolledBack: false,
      profileId,
      snapshotId: snapshot.id,
      appliedFiles: profile.files.map((f) => f.path),
      health,
    };
  }

  async rollbackSnapshot(snapshot = this._lastSnapshot, options = {}) {
    if (!snapshot || !Array.isArray(snapshot.entries)) {
      throw new Error('No hardening snapshot available for rollback');
    }
    const fsImpl = options.fsImpl || fs;
    const isDryPlatform = options.skipSystemReload ?? (process.platform === 'win32' || process.env.NODE_ENV === 'test');

    if (!isDryPlatform || options.fsImpl) {
      for (const entry of snapshot.entries) {
        if (entry.existed && entry.previousContent !== null) {
          fsImpl.writeFileSync(entry.path, entry.previousContent, 'utf8');
        } else if (!entry.existed && fsImpl.existsSync(entry.path)) {
          fsImpl.unlinkSync(entry.path);
        }
      }
    }

    if (!isDryPlatform) {
      await execFileAsync('sysctl', ['--system'], { timeout: 8000 }).catch(() => {});
      await execFileAsync('systemctl', ['daemon-reload'], { timeout: 5000 }).catch(() => {});
      await execFileAsync('systemctl', ['reload', 'ssh'], { timeout: 5000 })
        .catch(() => execFileAsync('systemctl', ['reload', 'sshd'], { timeout: 5000 }))
        .catch(() => {});
    }

    return { success: true, restoredSnapshotId: snapshot.id };
  }
}

export default new HardeningService();
