import si from 'systeminformation';
import MonitorHistory from '../../models/MonitorHistory.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import logger from '../../config/logger.js';

const execAsync = promisify(exec);

/** Read last N lines of a file safely */
async function tailFile(filepath, lines = 100) {
  try {
    await fs.access(filepath);
    const { stdout } = await execAsync(`tail -n ${Math.min(Math.max(lines, 10), 500)} "${filepath}" 2>/dev/null`);
    return stdout.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

class AnalyticsService {
  // ═══════════════════════════════════════════════════════════════
  //  SECTION 1 — Metrics Analytics (historical aggregation)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get aggregated metrics history with downsampling for charts.
   * Uses monitor_history SQLite table.
   */
  async getMetricsHistory(hours = 24) {
    const since = new Date(Date.now() - hours * 3600 * 1000);
    const all = await MonitorHistory.find({});

    const filtered = all.filter(h => new Date(h.timestamp) >= since);

    // Downsample: determine interval
    const count = filtered.length;
    let step = 1;
    if (count > 500) step = Math.ceil(count / 500);

    const sampled = filtered.filter((_, i) => i % step === 0);

    const series = sampled.map(h => {
      const m = h.metrics || {};
      return {
        t: new Date(h.timestamp).getTime(),
        cpu: m.cpu ?? 0,
        ramUsed: m.ramUsed ?? 0,
        ramTotal: m.ramTotal ?? 0,
        ramPercent: m.ramPercent ?? (m.ramTotal ? Math.round((m.ramUsed / m.ramTotal) * 100) : 0),
        diskUsed: m.diskUsed ?? 0,
        diskTotal: m.diskTotal ?? 0,
        diskPercent: m.diskPercent ?? 0,
        networkRx: m.networkRx ?? 0,
        networkTx: m.networkTx ?? 0,
        diskRead: m.diskRead ?? 0,
        diskWrite: m.diskWrite ?? 0,
        loadAvg: m.loadAvg ?? [0, 0, 0],
      };
    });

    // Compute stats
    const cpuValues = series.map(s => s.cpu).filter(v => !isNaN(v));
    const ramValues = series.map(s => s.ramPercent).filter(v => !isNaN(v));
    const diskValues = series.map(s => s.diskPercent).filter(v => !isNaN(v));

    const stats = {
      cpu: {
        avg: average(cpuValues),
        max: Math.max(...cpuValues, 0),
        min: Math.min(...cpuValues, 0),
        current: cpuValues[cpuValues.length - 1] || 0,
      },
      ram: {
        avg: average(ramValues),
        max: Math.max(...ramValues, 0),
        min: Math.min(...ramValues, 0),
        current: ramValues[ramValues.length - 1] || 0,
      },
      disk: {
        avg: average(diskValues),
        max: Math.max(...diskValues, 0),
        min: Math.min(...diskValues, 0),
        current: diskValues[diskValues.length - 1] || 0,
      },
    };

    return { series, stats, count: filtered.length, hours };
  }

  /**
   * Get real-time metrics (live snapshot).
   */
  async getRealtimeMetrics() {
    const [cpu, mem, disk, net, temp, load, diskIO] = await Promise.allSettled([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.networkStats(),
      si.cpuTemperature(),
      si.currentLoad(),
      si.disksIO(),
    ]);

    const cpuData = cpu.value || {};
    const memData = mem.value || {};
    const diskData = disk.value || [];
    const netData = (net.value || [])[0] || {};
    const tempData = temp.value || {};
    const loadData = load.value || {};
    const ioData = diskIO.value || {};

    
    return {
      cpu: {
        usage: Math.round(cpuData.currentLoad || 0),
        cores: cpuData.cpus?.length || 1,
        speed: cpuData.cpus?.[0]?.speed || 0,
        loadAvg: [loadData.avgLoad1 || 0, loadData.avgLoad5 || 0, loadData.avgLoad15 || 0],
        temp: tempData.main || null,
      },
      memory: {
        total: memData.total || 0,
        used: memData.used || 0,
        free: memData.free || 0,
        usedPercent: memData.total ? Math.round((memData.used / memData.total) * 100) : 0,
        swapTotal: memData.swaptotal || 0,
        swapUsed: memData.swapused || 0,
      },
      disk: diskData.map(d => ({
        fs: d.fs,
        mount: d.mount,
        type: d.type,
        total: d.size,
        used: d.used,
        free: d.available,
        usedPercent: d.use || 0,
      })),
      diskIO: {
        read: ioData.rIO_sec || 0,
        write: ioData.wIO_sec || 0,
        readTotal: ioData.rIO || 0,
        writeTotal: ioData.wIO || 0,
      },
      network: netData,
      timestamp: Date.now(),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  SECTION 2 — Log Analytics
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get system log entries from common log files.
   */
  async getSystemLogs(type = 'syslog', lines = 100) {
    // [SECURITY] Only allow known log types
    const validTypes = ['syslog', 'auth', 'kern', 'dmesg', 'bootstrap'];
    if (!validTypes.includes(type)) {
      throw new Error(`Invalid log type: ${type}`);
    }

    // Try alternative paths for different distros
    const altPaths = {
      syslog: ['/var/log/syslog', '/var/log/messages'],
      auth: ['/var/log/auth.log', '/var/log/secure'],
      kern: ['/var/log/kern.log'],
      dmesg: ['/var/log/dmesg'],
      bootstrap: ['/var/log/bootstrap.log'],
    };

    const candidates = altPaths[type];

    for (const fp of candidates) {
      try {
        const lines_content = await tailFile(fp, lines);
        if (lines_content.length > 0) {
          return {
            logFile: fp,
            type,
            lines: this._parseLogLines(lines_content, type),
          };
        }
      } catch { /* try next path */ }
    }

    // Fallback: try journalctl
    try {
      const _priority = type === 'auth' ? 'auth' : 'sys';
      const { stdout } = await execAsync(
        `journalctl -n ${Math.min(lines, 200)} --no-pager -p info 2>/dev/null | tail -${Math.min(lines, 200)} || echo ""`,
        { timeout: 10000 }
      );
      const journalLines = stdout.split('\n').filter(Boolean);
      if (journalLines.length > 0) {
        return {
          logFile: 'journalctl',
          type,
          lines: journalLines.map(l => ({
            raw: l,
            timestamp: l.substring(0, 15),
            level: l.includes('error') ? 'error' : l.includes('warn') ? 'warn' : 'info',
            message: l,
          })),
        };
      }
    } catch { /* ignore */ }

    return { logFile: null, type, lines: [] };
  }

  /**
   * Get web server access/error logs.
   */
  async getWebLogs(service = 'nginx', logType = 'access', lines = 100) {
    const logDirs = {
      nginx: '/var/log/nginx',
      apache2: '/var/log/apache2',
      httpd: '/var/log/httpd',
    };

    // [SECURITY] Validate service and logType against allowed values
    const dir = logDirs[service];
    if (!dir) throw new Error(`Unknown web server: ${service}`);

    const validLogTypes = ['access', 'error'];
    if (!validLogTypes.includes(logType)) throw new Error('Invalid log type');

    const filepath = path.join(dir, `${logType}.log`);

    try {
      const lines_content = await tailFile(filepath, lines);
      return {
        logFile: filepath,
        service,
        type: logType,
        lines: lines_content.map(l => {
          // Parse common log format
          const match = l.match(/^(\S+)\s+.*?\[([^\]]+)\]\s+"([^"]+)"\s+(\d+)\s+(\d+)/);
          return {
            raw: l,
            ip: match?.[1] || null,
            timestamp: match?.[2] || null,
            request: match?.[3] || null,
            status: match?.[4] ? parseInt(match[4]) : null,
            bytes: match?.[5] ? parseInt(match[5]) : null,
            level: match && match[4] && parseInt(match[4]) >= 400 ? 'error' : 'info',
          };
        }),
      };
    } catch (err) {
      throw new Error(`Failed to read ${service} ${logType} log: ${err.message}`);
    }
  }

  /**
   * Parse log lines into structured format.
   */
  _parseLogLines(rawLines, _type) {
    return rawLines.map(line => {
      const timestamp = line.match(/^\w{3}\s+\d+\s+\d+:\d+:\d+/)?.[0] || '';
      const level = line.toLowerCase().includes('error') ? 'error'
        : line.toLowerCase().includes('warn') ? 'warn'
        : line.toLowerCase().includes('fail') ? 'error'
        : line.toLowerCase().includes('critical') ? 'error'
        : 'info';

      let service = 'system';
      const serviceMatch = line.match(/\b(\w+(?:\[\d+\])?):\s/);
      if (serviceMatch) service = serviceMatch[1];

      return { raw: line, timestamp, level, service, message: line };
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  SECTION 3 — Service Health
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get all system services status.
   */
  async getServiceHealth() {
    try {
      const { stdout } = await execAsync(
        'systemctl list-units --type=service --all --no-pager --no-legend 2>/dev/null | head -60 || echo ""',
        { timeout: 10000 }
      );

      const services = stdout.split('\n')
        .filter(Boolean)
        .map(line => {
          const parts = line.trim().split(/\s+/);
          return {
            name: parts[0] || '',
            load: parts[1] || '',
            active: parts[2] || '',
            sub: parts[3] || '',
            description: parts.slice(4).join(' ') || '',
          };
        })
        .filter(s => s.name);

      // Get resource usage for important services
      const important = services.filter(s =>
        s.name.includes('nginx') || s.name.includes('apache') ||
        s.name.includes('mysql') || s.name.includes('postgres') ||
        s.name.includes('redis') || s.name.includes('docker') ||
        s.name.includes('ssh') || s.name.includes('ufw') ||
        s.name.includes('panelku') || s.name.includes('php')
      );

      // Enrich with resource usage via ps
      const enriched = await Promise.all(
        important.slice(0, 20).map(async svc => {
          try {
            const _pidMatch = svc.name.match(/\.service$/);
            const svcName = svc.name.replace('.service', '');
            const { stdout: psOut } = await execAsync(
              `ps aux | grep -E "${svcName}" | grep -v grep | head -3 2>/dev/null || echo ""`,
              { timeout: 5000 }
            );
            const psLines = psOut.split('\n').filter(Boolean);
            const cpu = psLines.reduce((sum, l) => {
              const parts = l.trim().split(/\s+/);
              return sum + (parseFloat(parts[2]) || 0);
            }, 0);
            const mem = psLines.reduce((sum, l) => {
              const parts = l.trim().split(/\s+/);
              return sum + (parseFloat(parts[3]) || 0);
            }, 0);

            return { ...svc, cpu: Math.round(cpu * 10) / 10, mem: Math.round(mem * 10) / 10 };
          } catch {
            return { ...svc, cpu: 0, mem: 0 };
          }
        })
      );

      const stats = {
        total: services.length,
        running: services.filter(s => s.active === 'active').length,
        failed: services.filter(s => s.active === 'failed').length,
        inactive: services.filter(s => s.active === 'inactive').length,
      };

      return { services: enriched, all: services, stats };
    } catch (err) {
      logger.error('Failed to get service health:', err.message);
      return { services: [], all: [], stats: { total: 0, running: 0, failed: 0, inactive: 0 } };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  SECTION 4 — Top Processes
  // ═══════════════════════════════════════════════════════════════

  async getTopProcesses(sortBy = 'cpu', limit = 20) {
    try {
      const data = await si.processes();
      const list = (data.list || []).map(p => ({
        pid: p.pid,
        name: p.name,
        cpu: Math.round(p.cpu * 10) / 10,
        mem: Math.round(p.mem * 10) / 10,
        memBytes: p.mem_rss || 0,
        user: p.user,
        state: p.state,
        command: p.command || p.name,
      }));

      if (sortBy === 'mem') {
        list.sort((a, b) => b.mem - a.mem);
      } else {
        list.sort((a, b) => b.cpu - a.cpu);
      }

      return list.slice(0, limit);
    } catch {
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  SECTION 5 — Network Analytics
  // ═══════════════════════════════════════════════════════════════

  async getNetworkAnalytics() {
    const [ifaces, stats, connections] = await Promise.allSettled([
      si.networkInterfaces(),
      si.networkStats(),
      si.networkConnections(),
    ]);

    const interfaces = (ifaces.value || []).filter(i => !i.virtual);
    const netStats = stats.value || [];
    const conns = connections.value || [];

    // Connection summary
    const connSummary = {};
    conns.forEach(c => {
      const state = c.state || 'unknown';
      connSummary[state] = (connSummary[state] || 0) + 1;
    });

    // Listening ports summary
    const listeningPorts = conns
      .filter(c => c.state === 'listen')
      .map(c => ({ port: c.localPort, process: c.process?.name || 'unknown' }));

    return {
      interfaces: interfaces.map(i => ({
        name: i.iface,
        ip4: i.ip4,
        ip6: i.ip6,
        mac: i.mac,
        type: i.type,
        speed: i.speed,
      })),
      traffic: netStats.map(s => ({
        iface: s.iface,
        rxSec: s.rx_sec || 0,
        txSec: s.tx_sec || 0,
        rxTotal: s.rx_bytes || 0,
        txTotal: s.tx_bytes || 0,
      })),
      connections: {
        total: conns.length,
        byState: connSummary,
        listeningPorts: [...new Map(listeningPorts.map(p => [p.port, p])).values()],
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  SECTION 6 — Docker Analytics
  // ═══════════════════════════════════════════════════════════════

  async getDockerAnalytics() {
    try {
      const { stdout: ps } = await execAsync(
        'docker ps --format "{{.ID}}\t{{.Image}}\t{{.Status}}\t{{.Names}}\t{{.Ports}}" 2>/dev/null || echo ""',
        { timeout: 10000 }
      );

      const containers = ps.split('\n')
        .filter(Boolean)
        .map(line => {
          const parts = line.split('\t');
          return {
            id: parts[0]?.substring(0, 12) || '',
            image: parts[1] || '',
            status: parts[2] || '',
            name: parts[3] || '',
            ports: parts[4] || '',
          };
        });

      const { stdout: stats } = await execAsync(
        'docker stats --no-stream --format "{{.Name}}\t{{.CPUPerc}}\t{{.MemPerc}}\t{{.MemUsage}}" 2>/dev/null || echo ""',
        { timeout: 10000 }
      );

      const containerStats = stats.split('\n')
        .filter(Boolean)
        .map(line => {
          const parts = line.split('\t');
          return {
            name: parts[0] || '',
            cpu: parts[1] || '0%',
            memPerc: parts[2] || '0%',
            memUsage: parts[3] || '',
          };
        });

      const { stdout: info } = await execAsync('docker info --format "{{.Containers}}\t{{.Images}}\t{{.ServerVersion}}" 2>/dev/null || echo "0\t0\t0"', { timeout: 5000 });
      const infoParts = info.split('\t');

      return {
        installed: true,
        containers,
        containerStats,
        summary: {
          total: parseInt(infoParts[0]) || containers.length,
          images: parseInt(infoParts[1]) || 0,
          version: infoParts[2] || 'N/A',
          running: containers.filter(c => c.status.toLowerCase().includes('up')).length,
        },
      };
    } catch {
      return {
        installed: false,
        containers: [],
        containerStats: [],
        summary: { total: 0, images: 0, version: 'N/A', running: 0 },
      };
    }
  }
}

function average(arr) {
  if (!arr || arr.length === 0) return 0;
  return Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10;
}

export default new AnalyticsService();
