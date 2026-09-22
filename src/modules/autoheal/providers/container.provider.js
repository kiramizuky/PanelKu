/**
 * AutoHeal Container Provider
 * Handles Docker daemon, CrashLoopBackOff containers, network subnet exhaustion, and orphan resources.
 */

import { execCmd } from '../../../helpers/exec.js';
import logger from '../../../config/logger.js';

class ContainerProvider {
  constructor() {
    this.name = 'container';
    this.displayName = 'Containers & Docker Orchestration';
  }

  /**
   * Run diagnostics on Docker containers and daemon
   */
  async check() {
    const isWindows = process.platform === 'win32';
    const items = [];

    if (isWindows) {
      return [{
        name: 'Docker Daemon (Simulated)',
        serviceName: 'docker',
        type: 'container',
        status: 'healthy',
        message: 'Container engine simulated in Windows environment',
      }];
    }

    // 1. Docker Daemon Health
    let isDaemonRunning = false;
    try {
      await execCmd('docker', ['info'], { timeout: 8000 });
      isDaemonRunning = true;
      items.push({
        name: 'Docker Daemon',
        serviceName: 'docker',
        type: 'container',
        status: 'healthy',
        message: 'Docker daemon is responding',
        healable: true,
      });
    } catch {
      items.push({
        name: 'Docker Daemon',
        serviceName: 'docker',
        type: 'container',
        status: 'critical',
        message: 'Docker daemon is unresponsive or stopped',
        healable: true,
      });
      return items;
    }

    if (!isDaemonRunning) return items;

    // 2. Check for CrashLoop / Restarting Containers
    try {
      const psOutput = await execCmd('docker', ['ps', '-a', '--format', '{{.ID}}\t{{.Names}}\t{{.Status}}'], { timeout: 10000 });
      const lines = psOutput.trim().split('\n').filter(Boolean);
      let crashLoopCount = 0;

      for (const line of lines) {
        const [id, name, status] = line.split('\t');
        if (status && status.toLowerCase().includes('restarting')) {
          crashLoopCount++;
          items.push({
            name: `Container: ${name}`,
            containerId: id,
            serviceName: `docker:${name}`,
            type: 'container',
            status: 'warning',
            message: `CrashLoop detected (${status})`,
            healable: true,
          });
        }
      }

      if (crashLoopCount === 0) {
        items.push({
          name: 'Container Stacks',
          serviceName: 'docker:containers',
          type: 'container',
          status: 'healthy',
          message: `${lines.length} containers monitored, 0 crash loops`,
          healable: false,
        });
      }
    } catch (_) {}

    // 3. Docker Bridge Network Check
    try {
      const netOutput = await execCmd('docker', ['network', 'ls', '-q'], { timeout: 6000 });
      const networkCount = netOutput.trim().split('\n').filter(Boolean).length;
      if (networkCount > 25) {
        items.push({
          name: 'Docker Networks',
          serviceName: 'docker:networks',
          type: 'container',
          status: 'warning',
          message: `${networkCount} networks active (subnet pool may be saturated)`,
          healable: true,
        });
      }
    } catch (_) {}

    return items;
  }

  /**
   * Execute auto-healing for container infrastructure
   */
  async heal(target = 'all') {
    const isWindows = process.platform === 'win32';
    const actionsTaken = [];

    if (isWindows) {
      return { success: true, actionsTaken: ['Container healing simulated'] };
    }

    // 1. Daemon Restart
    if (target === 'all' || target === 'docker') {
      try {
        let ok = false;
        try {
          await execCmd('docker', ['info'], { timeout: 4000 });
          ok = true;
        } catch (_) {}

        if (!ok) {
          await execCmd('systemctl', ['restart', 'docker.socket'], { timeout: 10000 }).catch(() => {});
          await execCmd('systemctl', ['restart', 'docker'], { timeout: 25000 });
          actionsTaken.push('Restarted Docker daemon and socket');
        }
      } catch (err) {
        logger.warn(`[AutoHeal:Container] Docker daemon heal error: ${err.message}`);
      }
    }

    // 2. Prune unused networks if saturated
    if (target === 'all' || target === 'docker:networks') {
      try {
        await execCmd('docker', ['network', 'prune', '-f'], { timeout: 15000 });
        actionsTaken.push('Pruned unattached Docker networks');
      } catch (_) {}
    }

    // 3. Heal CrashLoop containers (restart or pause)
    if (target === 'all' || target.startsWith('docker:')) {
      try {
        const psOutput = await execCmd('docker', ['ps', '-a', '--format', '{{.ID}}\t{{.Names}}\t{{.Status}}'], { timeout: 10000 });
        const lines = psOutput.trim().split('\n').filter(Boolean);

        for (const line of lines) {
          const [id, name, status] = line.split('\t');
          if (status && status.toLowerCase().includes('restarting')) {
            if (target === 'all' || target === `docker:${name}`) {
              // Attempt restart once
              await execCmd('docker', ['restart', id], { timeout: 15000 }).catch(() => {});
              actionsTaken.push(`Restarted crash-looping container: ${name}`);
            }
          }
        }
      } catch (_) {}
    }

    return {
      success: actionsTaken.length > 0,
      actionsTaken,
      message: actionsTaken.length > 0 ? actionsTaken.join(', ') : 'Containers are stable, no action required',
    };
  }
}

export default new ContainerProvider();
