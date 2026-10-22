import monitorService from './monitor.service.js';
import dashboardService from '../dashboard/dashboard.service.js';
import cache from '../../helpers/cache.js';
import { siCall } from '../../helpers/withTimeout.js';
import { success, error } from '../../helpers/response.js';

class MonitorController {
  async getCurrent(req, res) {
    try {
      const data = await monitorService.getCurrent();
      return success(res, data);
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async getMetrics(req, res) {
    try {
      const data = await dashboardService.getMetrics();
      return success(res, data);
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async getSysInfo(req, res) {
    try {
      // osInfo and cpu data are static hardware metadata — cache for 5 minutes
      const data = await cache.remember('monitor:sys_info', 300, async () => {
        const si = (await import('systeminformation')).default;
        const [os, cpu] = await Promise.all([
          siCall(() => si.osInfo(), 'si.osInfo'),
          siCall(() => si.cpu(), 'si.cpu'),
        ]);
        return { os, cpu };
      });
      return success(res, data);
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async getHistory(req, res) {
    try {
      const minutes = parseInt(req.query.minutes) || 60;
      const data = await monitorService.getHistory(minutes);
      return success(res, { history: data, minutes });
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async getDiskHealth(req, res) {
    try {
      const data = await monitorService.getDiskHealth();
      return success(res, data);
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async getNetworkStats(req, res) {
    try {
      const data = await monitorService.getNetworkStats();
      return success(res, data);
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async getProcesses(req, res) {
    try {
      const data = await monitorService.getProcesses();
      return success(res, data);
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async killProcess(req, res) {
    try {
      const { pid } = req.params;
      const { signal = 'SIGTERM' } = req.body || {};
      const result = await monitorService.killProcess(pid, signal);
      return success(res, result, result.message);
    } catch (err) {
      return error(res, err.message, err.statusCode || 500);
    }
  }
}

const monitorController = new MonitorController();
export default monitorController;
