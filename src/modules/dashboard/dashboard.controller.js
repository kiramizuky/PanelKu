import dashboardService from './dashboard.service.js';
import { success, error } from '../../helpers/response.js';

class DashboardController {
  async getMetrics(req, res) {
    try {
      const data = await dashboardService.getMetrics();
      return success(res, data);
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async getServerInfo(req, res) {
    try {
      const data = await dashboardService.getServerInfo();
      return success(res, data);
    } catch (err) {
      return error(res, err.message, 500);
    }
  }
}

const dashboardController = new DashboardController();
export default dashboardController;
