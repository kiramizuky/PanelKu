/**
 * AutoHeal Storage & System Provider
 * Handles disk space exhaustion, inode pressure, RAM pressure, and temporary files cleanup.
 */

import { execCmd, execShell } from '../../../helpers/exec.js';
import { getPrimaryDisk } from '../../../helpers/system.js';
import logger from '../../../config/logger.js';
import fs from 'fs/promises';
import path from 'path';

class StorageProvider {
  constructor() {
    this.name = 'storage';
    this.displayName = 'Storage & System Resources';
  }

  /**
   * Run diagnostics on Disk, RAM, Inodes, and Temp storage
   */
  async check() {
    const isWindows = process.platform === 'win32';
    const items = [];

    try {
      const si = await import('systeminformation');
      const [diskList, mem] = await Promise.all([
        si.fsSize(),
        si.mem(),
      ]);

      const primary = getPrimaryDisk(diskList || []);
      const diskPct = primary.use || (primary.size ? Math.round((primary.used / primary.size) * 100) : 0);
      const ramPct = mem.total ? Math.round((mem.used / mem.total) * 100) : 0;

      // 1. Primary Disk Space
      items.push({
        name: `Disk Storage (${primary.mount || '/'})`,
        serviceName: 'storage:disk',
        type: 'storage',
        status: diskPct > 90 ? 'critical' : (diskPct > 85 ? 'warning' : 'healthy'),
        message: `${diskPct}% used (${Math.round((primary.used || 0) / 1024 / 1024 / 1024)}GB / ${Math.round((primary.size || 0) / 1024 / 1024 / 1024)}GB)`,
        healable: true,
      });

      // 2. RAM Memory
      items.push({
        name: 'System Memory (RAM)',
        serviceName: 'storage:ram',
        type: 'storage',
        status: ramPct > 90 ? 'warning' : 'healthy',
        message: `${ramPct}% used (${Math.round((mem.used || 0) / 1024 / 1024)}MB / ${Math.round((mem.total || 0) / 1024 / 1024)}MB)`,
        healable: true,
      });

      if (!isWindows) {
        // 3. Inodes check
        try {
          const inodeOut = await execCmd('df', ['-i', '/'], { timeout: 5000 });
          const lines = inodeOut.trim().split('\n');
          if (lines.length > 1) {
            const parts = lines[1].trim().split(/\s+/);
            const inodePct = parseInt(parts[4]) || 0;
            items.push({
              name: 'Inode Capacity',
              serviceName: 'storage:inodes',
              type: 'storage',
              status: inodePct > 95 ? 'critical' : (inodePct > 85 ? 'warning' : 'healthy'),
              message: `${inodePct}% inodes used`,
              healable: true,
            });
          }
        } catch (_) {}
      }

      // 4. Stale Backup Temp Files
      try {
        const backupDir = path.resolve('storage', 'backups');
        let staleTmpCount = 0;
        try {
          const files = await fs.readdir(backupDir);
          staleTmpCount = files.filter(f => f.endsWith('.tmp') || f.includes('.part')).length;
        } catch (_) {}

        if (staleTmpCount > 0) {
          items.push({
            name: 'Backup Staging Files',
            serviceName: 'storage:backup_temp',
            type: 'storage',
            status: 'warning',
            message: `${staleTmpCount} stale backup fragments found in storage/backups`,
            healable: true,
          });
        }
      } catch (_) {}

    } catch (err) {
      logger.error(`[AutoHeal:Storage] Check error: ${err.message}`);
    }

    return items;
  }

  /**
   * Execute auto-healing for storage and resources
   */
  async heal(target = 'all') {
    const isWindows = process.platform === 'win32';
    const actionsTaken = [];

    // Clean stale backup .tmp files (works on all OS)
    if (target === 'all' || target === 'storage:disk' || target === 'storage:backup_temp') {
      try {
        const backupDir = path.resolve('storage', 'backups');
        const files = await fs.readdir(backupDir).catch(() => []);
        let purged = 0;
        for (const file of files) {
          if (file.endsWith('.tmp') || file.includes('.part')) {
            await fs.unlink(path.join(backupDir, file)).catch(() => {});
            purged++;
          }
        }
        if (purged > 0) actionsTaken.push(`Purged ${purged} orphaned backup temp archives`);
      } catch (_) {}
    }

    if (isWindows) {
      actionsTaken.push('Simulated disk and memory cache optimization');
      return { success: true, actionsTaken, message: actionsTaken.join(', ') };
    }

    // 1. Memory drop_caches
    if (target === 'all' || target === 'storage:ram') {
      try {
        await execShell('sync && echo 3 > /proc/sys/vm/drop_caches 2>/dev/null');
        actionsTaken.push('Dropped OS buffer caches to free physical memory');
      } catch (_) {}
    }

    // 2. Multi-stage Disk Cleanup
    if (target === 'all' || target === 'storage:disk' || target === 'storage:inodes') {
      // Stage A: Journalctl vacuum
      try {
        await execCmd('journalctl', ['--vacuum-time=2d'], { timeout: 15000 });
        actionsTaken.push('Vacuumed systemd journal logs to last 2 days');
      } catch (_) {}

      // Stage B: Docker system prune
      try {
        await execCmd('docker', ['system', 'prune', '-f'], { timeout: 30000 });
        actionsTaken.push('Pruned unreferenced Docker layers and caches');
      } catch (_) {}

      // Stage C: Package manager cache
      try {
        if (await this._hasCmd('apt-get')) {
          await execCmd('apt-get', ['clean'], { timeout: 15000 });
          actionsTaken.push('Cleaned APT package cache');
        } else if (await this._hasCmd('dnf')) {
          await execCmd('dnf', ['clean', 'all'], { timeout: 15000 });
          actionsTaken.push('Cleaned DNF repository cache');
        } else if (await this._hasCmd('pacman')) {
          await execCmd('pacman', ['-Sc', '--noconfirm'], { timeout: 15000 });
          actionsTaken.push('Cleaned Pacman package cache');
        }
      } catch (_) {}

      // Stage D: Purge old /tmp files
      try {
        await execCmd('find', ['/tmp', '-type', 'f', '-atime', '+3', '-delete'], { timeout: 10000 });
        actionsTaken.push('Purged /tmp files older than 3 days');
      } catch (_) {}
    }

    return {
      success: actionsTaken.length > 0,
      actionsTaken,
      message: actionsTaken.length > 0 ? actionsTaken.join(', ') : 'Storage resources optimal, no cleanup required',
    };
  }

  async _hasCmd(cmd) {
    try {
      const out = await execCmd('which', [cmd], { timeout: 3000 });
      return !!out.trim();
    } catch {
      return false;
    }
  }
}

export default new StorageProvider();
