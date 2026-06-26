import si from 'systeminformation';
import { exec } from 'child_process';
import { promisify } from 'util';
import logger from '../../config/logger.js';

const execAsync = promisify(exec);

class DashboardService {
  /**
   * Get all realtime system metrics for dashboard.
   */
  async getMetrics() {
    try {
      const [cpu, mem, disk, osInfo, time, network, temp, load] = await Promise.allSettled([
        si.currentLoad(),
        si.mem(),
        si.fsSize(),
        si.osInfo(),
        si.time(),
        si.networkStats(),
        si.cpuTemperature(),
        si.currentLoad(),
      ]);

      const cpuData = cpu.value || {};
      const memData = mem.value || {};
      const diskData = disk.value || [];
      const osData = osInfo.value || {};
      const timeData = time.value || {};
      const netData = (network.value || [])[0] || {};
      const tempData = temp.value || {};
      const loadData = load.value || {};

      return {
        cpu: {
          usage: Math.round(cpuData.currentLoad || 0),
          cores: cpuData.cpus?.length || 1,
          speed: cpuData.cpus?.[0]?.speed || 0,
          loadAvg: [loadData.avgLoad1 || 0, loadData.avgLoad5 || 0, loadData.avgLoad15 || 0],
        },
        memory: {
          total: memData.total || 0,
          used: memData.used || 0,
          free: memData.free || 0,
          usedPercent: memData.total ? Math.round((memData.used / memData.total) * 100) : 0,
          swapTotal: memData.swaptotal || 0,
          swapUsed: memData.swapused || 0,
        },
        disk: diskData.map((d) => ({
          fs: d.fs,
          mount: d.mount,
          type: d.type,
          total: d.size,
          used: d.used,
          free: d.available,
          usedPercent: d.use || 0,
        })),
        system: {
          hostname: osData.hostname || 'unknown',
          platform: osData.platform || 'linux',
          distro: osData.distro || 'Linux',
          release: osData.release || '',
          kernel: osData.kernel || '',
          arch: osData.arch || '',
          uptime: timeData.uptime || 0,
        },
        temperature: {
          main: tempData.main || null,
          max: tempData.max || null,
          cores: tempData.cores || [],
        },
        network: {
          iface: netData.iface || '',
          rxSec: netData.rx_sec || 0,
          txSec: netData.tx_sec || 0,
          rxTotal: netData.rx_bytes || 0,
          txTotal: netData.tx_bytes || 0,
        },
        timestamp: Date.now(),
      };
    } catch (err) {
      logger.error('DashboardService.getMetrics error:', err);
      throw err;
    }
  }

  /**
   * Get additional info: Docker status, firewall, public IP, services.
   */
  async getServerInfo() {
    const results = await Promise.allSettled([
      this._getDockerStatus(),
      this._getFirewallStatus(),
      this._getPublicIp(),
      this._getRunningServices(),
      si.networkInterfaces(),
    ]);

    return {
      docker: results[0].value || { running: false, containers: 0 },
      firewall: results[1].value || { enabled: false, tool: 'none' },
      publicIp: results[2].value || 'unknown',
      services: results[3].value || [],
      interfaces: (results[4].value || []).filter((i) => !i.virtual),
      timestamp: Date.now(),
    };
  }

  async _getDockerStatus() {
    try {
      const { stdout } = await execAsync('docker ps --format "{{.ID}}" 2>/dev/null | wc -l');
      return { running: true, containers: parseInt(stdout.trim()) || 0 };
    } catch {
      return { running: false, containers: 0 };
    }
  }

  async _getFirewallStatus() {
    try {
      const { stdout } = await execAsync('ufw status 2>/dev/null | head -1');
      return { enabled: stdout.includes('active'), tool: 'ufw' };
    } catch {
      return { enabled: false, tool: 'none' };
    }
  }

  async _getPublicIp() {
    try {
      const { stdout } = await execAsync('curl -s --max-time 3 ifconfig.me 2>/dev/null');
      return stdout.trim() || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  async _getRunningServices() {
    try {
      const { stdout } = await execAsync(
        'systemctl list-units --type=service --state=running --no-pager --no-legend 2>/dev/null | head -20'
      );
      return stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const parts = line.trim().split(/\s+/);
          return { name: parts[0], status: parts[3] || 'running' };
        });
    } catch {
      return [];
    }
  }
}

const dashboardService = new DashboardService();
export default dashboardService;
