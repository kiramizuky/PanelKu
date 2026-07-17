import nodejsService from './nodejs.service.js';
import { successResponse, errorResponse } from '../../helpers/response.js';

class NodeJSController {
  /**
   * GET /api/nodejs/status
   * Get Node.js environment status (versions, NVM, PM2).
   */
  async getStatus(req, res) {
    try {
      const status = await nodejsService.getStatus();
      const nodeInfo = await nodejsService.getNodeInfo();
      return successResponse(res, { status, nodeInfo });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * POST /api/nodejs/nvm/install
   * Install NVM on the host system.
   */
  async installNvm(req, res) {
    try {
      const result = await nodejsService.installNvm();
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * GET /api/nodejs/versions/local
   * List locally installed Node.js versions (via NVM).
   */
  async getLocalVersions(req, res) {
    try {
      const status = await nodejsService.getStatus();
      return successResponse(res, {
        current: status.currentVersion,
        default: status.defaultVersion,
        installed: status.installedVersions,
      });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * GET /api/nodejs/versions/remote
   * List available remote Node.js versions (LTS by default).
   */
  async getRemoteVersions(req, res) {
    try {
      const filter = req.query.filter || 'lts';
      const versions = await nodejsService.listRemote(filter);
      return successResponse(res, { filter, versions });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * POST /api/nodejs/versions/install
   * Install a specific Node.js version.
   */
  async installVersion(req, res) {
    try {
      const { version } = req.body;
      if (!version) return errorResponse(res, 'Version is required', 400);

      const result = await nodejsService.installVersion(version);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * POST /api/nodejs/versions/uninstall
   * Uninstall a specific Node.js version.
   */
  async uninstallVersion(req, res) {
    try {
      const { version } = req.body;
      if (!version) return errorResponse(res, 'Version is required', 400);

      const result = await nodejsService.uninstallVersion(version);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * POST /api/nodejs/versions/default
   * Set default Node.js version.
   */
  async setDefaultVersion(req, res) {
    try {
      const { version } = req.body;
      if (!version) return errorResponse(res, 'Version is required', 400);

      const result = await nodejsService.setDefault(version);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * POST /api/nodejs/versions/use
   * Switch active Node.js version.
   */
  async useVersion(req, res) {
    try {
      const { version } = req.body;
      if (!version) return errorResponse(res, 'Version is required', 400);

      const result = await nodejsService.useVersion(version);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * GET /api/nodejs/packages
   * List globally installed npm packages.
   */
  async listGlobalPackages(req, res) {
    try {
      const packages = await nodejsService.listGlobalPackages();
      return successResponse(res, { packages });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * POST /api/nodejs/packages/install
   * Install a global npm package.
   */
  async installGlobalPackage(req, res) {
    try {
      const { name } = req.body;
      if (!name) return errorResponse(res, 'Package name is required', 400);

      const result = await nodejsService.installGlobalPackage(name);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * POST /api/nodejs/packages/uninstall
   * Uninstall a global npm package.
   */
  async uninstallGlobalPackage(req, res) {
    try {
      const { name } = req.body;
      if (!name) return errorResponse(res, 'Package name is required', 400);

      const result = await nodejsService.uninstallGlobalPackage(name);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * GET /api/nodejs/pm2
   * List PM2 processes.
   */
  async getPm2List(req, res) {
    try {
      const data = await nodejsService.getPm2List();
      return successResponse(res, data);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * POST /api/nodejs/pm2/action
   * Perform action on PM2 process (start, stop, restart, delete).
   */
  async pm2Action(req, res) {
    try {
      const { name, action } = req.body;
      if (!name) return errorResponse(res, 'Process name is required', 400);
      if (!action) return errorResponse(res, 'Action is required', 400);

      const result = await nodejsService.pm2Action(name, action);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * GET /api/nodejs/pm2/logs
   * Get PM2 logs for a process.
   */
  async getPm2Logs(req, res) {
    try {
      const { name, lines } = req.query;
      if (!name) return errorResponse(res, 'Process name is required', 400);

      const logs = await nodejsService.getPm2Logs(name, lines);
      return successResponse(res, { logs });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * POST /api/nodejs/pm2/start
   * Start a new PM2 process.
   */
  async pm2Start(req, res) {
    try {
      const { script, name, args, cwd } = req.body;
      if (!script) return errorResponse(res, 'Script path is required', 400);

      const result = await nodejsService.pm2Start(script, name, args, cwd);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * GET /api/nodejs/info
   * Get detailed Node.js environment info.
   */
  async getNodeInfo(req, res) {
    try {
      const info = await nodejsService.getNodeInfo();
      return successResponse(res, { info });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }
}

export default new NodeJSController();
