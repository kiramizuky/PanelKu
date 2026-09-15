import si from 'systeminformation';
import { exec } from 'child_process';
import { promisify } from 'util';
import logger from '../../config/logger.js';
import { normalizeDisks } from '../../helpers/system.js';
import cache from '../../helpers/cache.js';

const execAsync = promisify(exec);

class DashboardService {
  /**
   * Get all realtime system metrics for dashboard.
   */
  async getMetrics() {
    return cache.remember('dashboard:metrics', 2, async () => {
      try {
        const [cpu, mem, disk, osInfo, time, network, temp, load, ifaces] = await Promise.allSettled([
          si.currentLoad(),
          si.mem(),
          si.fsSize(),
          si.osInfo(),
          si.time(),
          si.networkStats('*'),
          si.cpuTemperature(),
          si.currentLoad(),
          si.networkInterfaces(),
        ]);

        const cpuData = cpu.value || {};
        const memData = mem.value || {};
        const rawDiskData = disk.value || [];
        const diskData = normalizeDisks(rawDiskData);
        const osData = osInfo.value || {};
        const timeData = time.value || {};
        const netStats = network.value || [];
        const netInterfaces = ifaces.value || [];
        const tempData = temp.value || {};
        const loadData = load.value || {};

        const ifacesList = Array.isArray(netInterfaces) ? netInterfaces : [];
        const statsList = Array.isArray(netStats) ? netStats : [];
        const nonLoopIfaces = ifacesList.filter(i => i.iface !== 'lo' && i.ip4 !== '127.0.0.1');
        const activeIfaces = nonLoopIfaces.length > 0 ? nonLoopIfaces : ifacesList;

        const networksMapped = activeIfaces.map(info => {
          const stat = statsList.find(s => s.iface === info.iface) || {};
          return {
            iface: info.iface,
            ip4: info.ip4 || 'No IP',
            mac: info.mac || '',
            operstate: info.operstate || stat.operstate || 'unknown',
            rxSec: stat.rx_sec || 0,
            txSec: stat.tx_sec || 0,
            rxTotal: stat.rx_bytes || 0,
            txTotal: stat.tx_bytes || 0,
          };
        });

        statsList.forEach(stat => {
          if (stat.iface && stat.iface !== 'lo' && !networksMapped.some(n => n.iface === stat.iface)) {
            networksMapped.push({
              iface: stat.iface,
              ip4: 'No IP',
              mac: '',
              operstate: stat.operstate || 'unknown',
              rxSec: stat.rx_sec || 0,
              txSec: stat.tx_sec || 0,
              rxTotal: stat.rx_bytes || 0,
              txTotal: stat.tx_bytes || 0,
            });
          }
        });

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
            percent: memData.total ? Math.round((memData.used / memData.total) * 100) : 0,
          },
          disk: diskData,
          os: {
            distro: osData.distro || '',
            release: osData.release || '',
            hostname: osData.hostname || '',
            arch: osData.arch || '',
            uptime: timeData.uptime || 0,
          },
          temperature: {
            main: tempData.main || null,
            max: tempData.max || null,
            cores: tempData.cores || [],
          },
          network: networksMapped,
          timestamp: Date.now(),
        };
      } catch (err) {
        logger.error('DashboardService.getMetrics error:', err);
        throw err;
      }
    });
  }

  /**
   * Get additional info: Docker status, firewall, public IP, services.
   */
  async getServerInfo() {
    return cache.remember('dashboard:server_info', 5, async () => {
      const results = await Promise.allSettled([
        this._getDockerStatus(),
        this._getFirewallStatus(),
        this._getPublicIp(),
        this._getRunningServices(),
        si.networkInterfaces(),
      ]);

      return {
        docker: results[0].value || { running: false, containers: 0 },
        firewall: results[1].value || { active: false },
        publicIp: results[2].value || 'N/A',
        services: results[3].value || {},
        interfaces: results[4].value || [],
      };
    });
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
