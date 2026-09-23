/**
 * AutoHeal Runtime & App Services Provider
 * Handles Node.js native binary integrity, port collision resolution, Mail queues, MQTT, and WhatsApp sessions.
 */

import { execCmd, execShell } from '../../../helpers/exec.js';
import logger from '../../../config/logger.js';
import fs from 'fs/promises';
import path from 'path';

class RuntimeProvider {
  constructor() {
    this.name = 'runtime';
    this.displayName = 'Runtimes, Ports & App Daemons';
  }

  /**
   * Run diagnostics on runtimes, port collisions, and services
   */
  async check() {
    const isWindows = process.platform === 'win32';
    const items = [];

    // 1. Native C++ Binaries Check (better-sqlite3, node-pty)
    try {
      const binariesOk = await this._verifyNativeBinaries();
      items.push({
        name: 'Node.js Native Modules',
        serviceName: 'runtime:node_binaries',
        type: 'runtime',
        status: binariesOk ? 'healthy' : 'warning',
        message: binariesOk ? 'better-sqlite3 and node-pty verified' : 'Native binary version mismatch detected',
        healable: true,
      });
    } catch (err) {
      items.push({
        name: 'Node.js Native Modules',
        serviceName: 'runtime:node_binaries',
        type: 'runtime',
        status: 'warning',
        message: `Native module check: ${err.message}`,
        healable: true,
      });
    }

    if (isWindows) {
      return items;
    }

    // 2. Mail Server (Postfix)
    try {
      if (await this._isInstalled('postfix')) {
        const postfixActive = await this._isServiceActive('postfix');
        items.push({
          name: 'Postfix Mail Transfer Agent',
          serviceName: 'postfix',
          type: 'runtime',
          status: postfixActive ? 'healthy' : 'warning',
          message: postfixActive ? 'MTA daemon active' : 'Postfix service is inactive',
          healable: true,
        });
      }
    } catch (_) {}

    // 3. IoT MQTT Broker (Mosquitto)
    try {
      if (await this._isInstalled('mosquitto')) {
        const mosqActive = await this._isServiceActive('mosquitto');
        items.push({
          name: 'Mosquitto MQTT Broker',
          serviceName: 'mosquitto',
          type: 'runtime',
          status: mosqActive ? 'healthy' : 'warning',
          message: mosqActive ? 'MQTT Broker listening on port 1883' : 'Broker service is inactive',
          healable: true,
        });
      }
    } catch (_) {}

    // 4. WhatsApp Baileys Auth Session Lock
    try {
      const waDir = path.resolve('storage', 'whatsapp_auth');
      let hasStaleLock = false;
      try {
        await fs.access(path.join(waDir, 'session.lock'));
        hasStaleLock = true;
      } catch (_) {}

      if (hasStaleLock) {
        items.push({
          name: 'WhatsApp Session Lock',
          serviceName: 'runtime:whatsapp_lock',
          type: 'runtime',
          status: 'warning',
          message: 'Stale WhatsApp session lock detected',
          healable: true,
        });
      }
    } catch (_) {}

    // 5. Node.js / NVM .npmrc Prefix Collision Check
    try {
      const homeDir = process.env.HOME || (process.platform === 'win32' ? process.env.USERPROFILE : '/root');
      const npmrcPaths = [path.join(homeDir, '.npmrc'), '/root/.npmrc'];
      let hasConflictingPrefix = false;
      let conflictFile = '';

      for (const p of npmrcPaths) {
        if (!p) continue;
        try {
          await fs.access(p);
          const raw = await fs.readFile(p, 'utf8');
          if (/^\s*(prefix|globalconfig)\s*=/m.test(raw)) {
            hasConflictingPrefix = true;
            conflictFile = p;
            break;
          }
        } catch (_) {}
      }

      if (hasConflictingPrefix) {
        items.push({
          name: 'NVM & NPM Configuration',
          serviceName: 'runtime:npmrc_prefix',
          type: 'runtime',
          status: 'warning',
          message: `Incompatible prefix/globalconfig found in ${conflictFile} (conflicts with NVM)`,
          healable: true,
        });
      }
    } catch (_) {}

    return items;
  }

  /**
   * Execute auto-healing for runtime services
   */
  async heal(target = 'all') {
    const isWindows = process.platform === 'win32';
    const actionsTaken = [];

    // 1. Rebuild native modules if needed
    if (target === 'all' || target === 'runtime:node_binaries') {
      try {
        const binariesOk = await this._verifyNativeBinaries();
        if (!binariesOk) {
          if (!isWindows) {
            await execCmd('npm', ['rebuild', 'better-sqlite3', 'node-pty'], { timeout: 60000 });
            actionsTaken.push('Rebuilt native binaries (better-sqlite3 & node-pty)');
          } else {
            actionsTaken.push('Native rebuild recommended via npm rebuild');
          }
        }
      } catch (err) {
        logger.warn(`[AutoHeal:Runtime] Binary rebuild error: ${err.message}`);
      }
    }

    // 2. WhatsApp stale lock cleanup
    if (target === 'all' || target === 'runtime:whatsapp_lock') {
      try {
        const lockPath = path.resolve('storage', 'whatsapp_auth', 'session.lock');
        await fs.unlink(lockPath).catch(() => {});
        actionsTaken.push('Cleared stale WhatsApp session lockfile');
      } catch (_) {}
    }

    // 3. .npmrc Prefix Conflict Remediation
    if (target === 'all' || target === 'runtime:npmrc_prefix') {
      try {
        const homeDir = process.env.HOME || (process.platform === 'win32' ? process.env.USERPROFILE : '/root');
        const npmrcPaths = [path.join(homeDir, '.npmrc'), '/root/.npmrc'];
        for (const p of npmrcPaths) {
          if (!p) continue;
          try {
            await fs.access(p);
            const raw = await fs.readFile(p, 'utf8');
            if (/^\s*(prefix|globalconfig)\s*=/m.test(raw)) {
              const cleaned = raw
                .split('\n')
                .filter(line => !/^\s*(prefix|globalconfig)\s*=/.test(line))
                .join('\n');
              await fs.writeFile(p, cleaned, 'utf8');
              actionsTaken.push(`Removed conflicting prefix setting from ${p}`);
            }
          } catch (_) {}
        }
      } catch (err) {
        logger.warn(`[AutoHeal:Runtime] .npmrc heal error: ${err.message}`);
      }
    }

    if (isWindows) {
      return { success: actionsTaken.length > 0, actionsTaken, message: actionsTaken.join(', ') };
    }

    // 3. Postfix Mail Server
    if (target === 'all' || target === 'postfix') {
      try {
        if (await this._isInstalled('postfix')) {
          if (!(await this._isServiceActive('postfix'))) {
            await execCmd('systemctl', ['restart', 'postfix'], { timeout: 15000 });
            actionsTaken.push('Restarted Postfix MTA');
          }
          // Flush queue
          await execCmd('postfix', ['flush'], { timeout: 10000 }).catch(() => {});
        }
      } catch (err) {
        logger.warn(`[AutoHeal:Runtime] Postfix heal error: ${err.message}`);
      }
    }

    // 4. Mosquitto MQTT
    if (target === 'all' || target === 'mosquitto') {
      try {
        if (await this._isInstalled('mosquitto') && !(await this._isServiceActive('mosquitto'))) {
          await execCmd('systemctl', ['restart', 'mosquitto'], { timeout: 15000 });
          actionsTaken.push('Restarted Mosquitto MQTT broker');
        }
      } catch (err) {
        logger.warn(`[AutoHeal:Runtime] Mosquitto heal error: ${err.message}`);
      }
    }

    // 5. Port Conflict resolution (kills zombie process holding port)
    if (target.startsWith('port:')) {
      const port = parseInt(target.replace('port:', '')) || 0;
      if (port > 0 && port !== 22) { // Never kill port 22
        try {
          const lsofOut = await execCmd('lsof', ['-ti', `:${port}`]).catch(() => '');
          const pid = lsofOut.trim().split('\n')[0];
          if (pid && /^\d+$/.test(pid) && parseInt(pid) !== process.pid) {
            await execCmd('kill', ['-9', pid]).catch(() => {});
            actionsTaken.push(`Killed conflicting process on port ${port} (PID: ${pid})`);
          }
        } catch (_) {}
      }
    }

    return {
      success: actionsTaken.length > 0,
      actionsTaken,
      message: actionsTaken.length > 0 ? actionsTaken.join(', ') : 'Runtime services are operational',
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  async _verifyNativeBinaries() {
    try {
      const bs = (await import('better-sqlite3')).default;
      const testDb = new bs(':memory:');
      testDb.prepare('SELECT 1').get();
      testDb.close();
    } catch {
      return false;
    }

    try {
      const ptyMod = (await import('node-pty')).default || (await import('node-pty'));
      if (!ptyMod || typeof ptyMod.spawn !== 'function') return false;
    } catch {
      return false;
    }

    return true;
  }

  async _isServiceActive(serviceName) {
    try {
      const stdout = await execCmd('systemctl', ['is-active', serviceName], { timeout: 5000 });
      return stdout.trim() === 'active';
    } catch {
      return false;
    }
  }

  async _isInstalled(bin) {
    try {
      const out = await execCmd('which', [bin], { timeout: 3000 });
      return !!out.trim();
    } catch {
      return false;
    }
  }
}

export default new RuntimeProvider();
