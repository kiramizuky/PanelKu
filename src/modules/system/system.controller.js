import systemService from './system.service.js';
import { success, errorResponse } from '../../helpers/response.js';

class SystemController {
  async getServicesStatus(req, res) {
    try {
      const servicesToWatch = ['nginx', 'docker', 'mongodb', 'mysql', 'ssh', 'cron'];
      const statuses = {};
      
      for (const svc of servicesToWatch) {
        statuses[svc] = await systemService.getServiceStatus(svc);
      }
      return success(res, statuses);
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async manageService(req, res) {
    try {
      const { service, action } = req.body;
      if (!service || !action) return errorResponse(res, new Error('Service and action are required'), 400);

      await systemService.manageService(service, action);
      return success(res, null, `Service ${service} ${action}ed successfully`);
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async getInstallStatus(req, res) {
    try {
      const apps = ['mysql', 'postgres', 'docker', 'nginx', 'mongodb'];
      const statuses = {};
      for (const app of apps) {
        statuses[app] = await systemService.isInstalled(app);
      }
      return success(res, statuses);
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async installPackage(req, res) {
    try {
      const { package: pkgName } = req.body;
      if (!pkgName) return errorResponse(res, new Error('Package name is required'), 400);
      
      // Fire and forget or wait. apt-get takes time.
      // We will wait for it so the frontend spinner stays active.
      await systemService.installPackage(pkgName);
      return success(res, null, `${pkgName} installed successfully`);
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async runAptUpdate(req, res) {
    try {
      const log = await systemService.runAptUpdate();
      return success(res, { log }, 'APT Update completed');
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async runAptUpgrade(req, res) {
    try {
      const log = await systemService.runAptUpgrade();
      return success(res, { log }, 'APT Upgrade completed');
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async reboot(req, res) {
    try {
      await systemService.reboot();
      return success(res, null, 'Reboot initiated');
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async getAutoUpdate(req, res) {
    try {
      const enabled = await systemService.getAutoUpdate();
      return success(res, { enabled });
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async setAutoUpdate(req, res) {
    try {
      const { enabled } = req.body;
      await systemService.setAutoUpdate(!!enabled);
      return success(res, null, `Auto-update ${enabled ? 'enabled' : 'disabled'}`);
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }
}

export default new SystemController();
