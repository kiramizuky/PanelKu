import monitorService from './monitor.service.js';
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

  async getSysInfo(req, res) {
    try {
      const si = (await import('systeminformation')).default;
      const [os, cpu] = await Promise.all([
        si.osInfo(),
        si.cpu()
      ]);
      return success(res, { os, cpu });
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
}

const monitorController = new MonitorController();
export default monitorController;
