import systemService from './system.service.js';
import sshService from './ssh.service.js';
import phpService from './php.service.js';
import { success, errorResponse } from '../../helpers/response.js';

class SystemController {
  async getServicesStatus(req, res) {
    try {
      const servicesToWatch = ['nginx', 'apache2', 'docker', 'mysql', 'ssh', 'cron'];
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
      const apps = ['mysql', 'postgres', 'docker', 'nginx', 'syncthing'];
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
      const { package: pkgName, password } = req.body;
      if (!pkgName) return errorResponse(res, new Error('Package name is required'), 400);
      
      // Fire and forget or wait. apt-get takes time.
      // We will wait for it so the frontend spinner stays active.
      await systemService.installPackage(pkgName, password);
      return success(res, null, `${pkgName} installed successfully`);
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async getPackageManagerInfo(req, res) {
    try {
      const info = await systemService.getPackageManagerInfo();
      return success(res, info);
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async runUpdate(req, res) {
    try {
      const log = await systemService.runUpdate();
      return success(res, { log }, 'System update completed');
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async runUpgrade(req, res) {
    try {
      const log = await systemService.runUpgrade();
      return success(res, { log }, 'System upgrade completed');
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async runAptUpdate(req, res) {
    try {
      const info = await systemService.getPackageManagerInfo();
      const log = await systemService.runAptUpdate();
      return success(res, { log }, `${info.name} update completed`);
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async runAptUpgrade(req, res) {
    try {
      const info = await systemService.getPackageManagerInfo();
      const log = await systemService.runAptUpgrade();
      return success(res, { log }, `${info.name} upgrade completed`);
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

  // ── Panel Update ───────────────────────────────────

  async getPanelVersion(req, res) {
    try {
      const data = await systemService.getPanelVersion();
      return success(res, data);
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async checkPanelUpdate(req, res) {
    try {
      const data = await systemService.checkPanelUpdate();
      return success(res, data);
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async runPanelUpdate(req, res) {
    try {
      const { method = 'git', branch = 'main' } = req.body;
      const log = await systemService.runPanelUpdate(method, branch);
      return success(res, { log }, 'Panel update started');
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async restartPanel(req, res) {
    try {
      await systemService.restartPanel();
      return success(res, null, 'Panel is restarting');
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async getPanelAutoUpdate(req, res) {
    try {
      const data = await systemService.getPanelAutoUpdate();
      return success(res, data);
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async setPanelAutoUpdate(req, res) {
    try {
      const { enabled, frequency } = req.body;
      await systemService.setPanelAutoUpdate({ enabled: !!enabled, frequency: frequency || 'daily' });
      return success(res, null, `Panel auto-update ${enabled ? 'enabled' : 'disabled'}`);
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async getSSHKeys(req, res) {
    try {
      const keys = await sshService.getKeys();
      return success(res, keys);
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async addSSHKey(req, res) {
    try {
      const { key } = req.body;
      await sshService.addKey(key);
      return success(res, null, 'SSH key added successfully');
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async deleteSSHKey(req, res) {
    try {
      const { id } = req.body;
      await sshService.deleteKey(id);
      return success(res, null, 'SSH key deleted successfully');
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async getSSHConfig(req, res) {
    try {
      const config = await sshService.getSSHConfig();
      return success(res, config);
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async updateSSHConfig(req, res) {
    try {
      const { port, passwordAuth } = req.body;
      await sshService.updateSSHConfig({ port, passwordAuth });
      return success(res, null, 'SSH configuration updated successfully');
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async getPHPConfig(req, res) {
    try {
      const config = await phpService.getConfig();
      return success(res, config);
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async updatePHPConfig(req, res) {
    try {
      await phpService.updateConfig(req.body);
      return success(res, null, 'PHP-FPM configuration updated successfully');
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }
}

export default new SystemController();
