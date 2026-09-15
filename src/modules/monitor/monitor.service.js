import si from 'systeminformation';
import MonitorHistory from '../../models/MonitorHistory.js';
import logger from '../../config/logger.js';
import { getPrimaryDisk } from '../../helpers/system.js';

class MonitorService {
  /**
   * Get current realtime metrics (for polling fallback).
   */
  async getCurrent() {
    const [cpu, mem, disk, net, temp, diskIO] = await Promise.allSettled([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.networkStats('*'),
      si.cpuTemperature(),
      si.disksIO(),
    ]);

    return this._buildMetrics(
      cpu.value, mem.value, disk.value,
      net.value, temp.value, diskIO.value
    );
  }

  /**
   * Build a normalized metrics object.
   */
  _buildMetrics(cpu, mem, disk, net, temp, diskIO) {
    const primaryDisk = getPrimaryDisk(disk || []);
    const netList = Array.isArray(net) ? net : (net ? [net] : []);
    const totalRx = netList.reduce((sum, n) => sum + (n.rx_sec || 0), 0);
    const totalTx = netList.reduce((sum, n) => sum + (n.tx_sec || 0), 0);
    const primaryNet = netList[0] || {};
    const loadData = cpu || {};

    return {
      cpu: Math.round(loadData.currentLoad || 0),
      cpuTemp: temp?.main || null,
      ramUsed: mem?.used || 0,
      ramTotal: mem?.total || 0,
      ramPercent: mem?.total ? Math.round((mem.used / mem.total) * 100) : 0,
      swapUsed: mem?.swapused || 0,
      swapTotal: mem?.swaptotal || 0,
      diskUsed: primaryDisk.used || 0,
      diskTotal: primaryDisk.size || 0,
      diskPercent: primaryDisk.use || 0,
      networkRx: totalRx || primaryNet.rx_sec || 0,
      networkTx: totalTx || primaryNet.tx_sec || 0,
      diskRead: diskIO?.rIO_sec || 0,
      diskWrite: diskIO?.wIO_sec || 0,
      loadAvg: [loadData.avgLoad1 || 0, loadData.avgLoad5 || 0, loadData.avgLoad15 || 0],
      timestamp: Date.now(),
    };
  }

  /**
   * Save current metrics to history (called by monitor job).
   */
  async saveHistory(metrics) {
    try {
      await MonitorHistory.create({ metrics });
    } catch (err) {
      logger.warn('MonitorService: failed to save history:', err.message);
    }
  }

  /**
   * Get metric history for a time range.
   */
  async getHistory(minutes = 60) {
    const since = new Date(Date.now() - minutes * 60 * 1000);
    const all = await MonitorHistory.find({ since });
    return all.filter(h => new Date(h.timestamp) >= since);
  }

  /**
   * Get SMART disk health data.
   */
  async getDiskHealth() {
    try {
      const [disks, smart] = await Promise.allSettled([
        si.diskLayout(),
        si.disksIO(),
      ]);
      return {
        disks: disks.value || [],
        io: smart.value || {},
      };
    } catch (err) {
      logger.error('MonitorService.getDiskHealth error:', err);
      return { disks: [], io: {} };
    }
  }

  /**
   * Get network interface stats.
   */
  async getNetworkStats() {
    const [ifaces, stats, connections] = await Promise.allSettled([
      si.networkInterfaces(),
      si.networkStats('*'),
      si.networkConnections(),
    ]);
    return {
      interfaces: (ifaces.value || []).filter((i) => (!i.virtual || (i.ip4 && i.ip4 !== '127.0.0.1')) && i.iface !== 'lo'),
      stats: stats.value || [],
      connections: (connections.value || []).length,
    };
  }

  /**
   * Check configured alert thresholds.
   */
  checkAlerts(metrics, thresholds = { cpu: 90, ram: 90, disk: 90 }) {
    const alerts = [];
    if (metrics.cpu >= thresholds.cpu) alerts.push({ type: 'cpu', value: metrics.cpu, threshold: thresholds.cpu });
    if (metrics.ramPercent >= thresholds.ram) alerts.push({ type: 'ram', value: metrics.ramPercent, threshold: thresholds.ram });
    if (metrics.diskPercent >= thresholds.disk) alerts.push({ type: 'disk', value: metrics.diskPercent, threshold: thresholds.disk });
    return alerts;
  }

  /**
   * Get running system processes with detailed memory footprint.
   */
  async getProcesses() {
    try {
      const data = await si.processes();
      return (data.list || []).map(p => ({
        pid: p.pid,
        name: p.name,
        cpu: p.cpu,
        mem: p.mem,
        memRss: p.memRss ? Math.round(p.memRss / 1024 / 1024) : 0, // MB
        user: p.user,
        state: p.state,
        priority: p.priority ?? 0,
        command: p.command || p.name
      }));
    } catch (err) {
      logger.error('MonitorService.getProcesses error:', err);
      return [];
    }
  }

  /**
   * Terminate/kill a running process with safety guards.
   */
  async killProcess(pid, signal = 'SIGTERM') {
    const targetPid = parseInt(pid, 10);
    if (!targetPid || isNaN(targetPid) || targetPid <= 1) {
      throw Object.assign(new Error('Invalid PID. Cannot terminate system init (PID 1) or non-positive PID.'), { statusCode: 400 });
    }
    if (targetPid === process.pid) {
      throw Object.assign(new Error('Cannot terminate the Linux-Panel server process itself.'), { statusCode: 400 });
    }
    const allowedSignals = ['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGHUP'];
    const safeSignal = allowedSignals.includes(signal) ? signal : 'SIGTERM';

    try {
      process.kill(targetPid, safeSignal);
      return { success: true, pid: targetPid, signal: safeSignal, message: `Signal ${safeSignal} sent to PID ${targetPid}` };
    } catch (err) {
      throw Object.assign(new Error(`Failed to terminate process ${targetPid}: ${err.message}`), { statusCode: 500 });
    }
  }
}

const monitorService = new MonitorService();
export default monitorService;
