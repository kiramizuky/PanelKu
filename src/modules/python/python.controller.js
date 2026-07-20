import pythonService from './python.service.js';
import { successResponse, errorResponse } from '../../helpers/response.js';

class PythonController {
  /**
   * GET /api/python/status
   */
  async getStatus(req, res) {
    try {
      const status = await pythonService.getStatus();
      const info = await pythonService.getPythonInfo();
      return successResponse(res, { status, info });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * POST /api/python/pyenv/install
   */
  async installPyenv(req, res) {
    // Pyenv download + compile can take several minutes — extend HTTP timeout
    req.setTimeout(660000);
    res.setTimeout(660000);
    try {
      const result = await pythonService.installPyenv();
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * GET /api/python/versions/local
   */
  async getLocalVersions(req, res) {
    try {
      const status = await pythonService.getStatus();
      return successResponse(res, {
        current: status.currentVersion,
        installed: status.installedVersions,
        pyenvInstalled: status.pyenvInstalled,
      });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * GET /api/python/versions/remote
   */
  async getRemoteVersions(req, res) {
    try {
      const filter = req.query.filter || 'stable';
      const versions = await pythonService.listRemote(filter);
      return successResponse(res, { filter, versions });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * POST /api/python/versions/install
   */
  async installVersion(req, res) {
    try {
      const { version } = req.body;
      if (!version) return errorResponse(res, 'Version is required', 400);

      const result = await pythonService.installVersion(version);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * POST /api/python/versions/uninstall
   */
  async uninstallVersion(req, res) {
    try {
      const { version } = req.body;
      if (!version) return errorResponse(res, 'Version is required', 400);

      const result = await pythonService.uninstallVersion(version);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * POST /api/python/versions/global
   */
  async setGlobalVersion(req, res) {
    try {
      const { version } = req.body;
      if (!version) return errorResponse(res, 'Version is required', 400);

      const result = await pythonService.setGlobal(version);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * GET /api/python/venvs
   */
  async listVirtualEnvs(req, res) {
    try {
      const venvs = await pythonService.listVirtualEnvs();
      return successResponse(res, { venvs });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * POST /api/python/venvs
   */
  async createVirtualEnv(req, res) {
    try {
      const { name, pythonVersion } = req.body;
      if (!name) return errorResponse(res, 'Name is required', 400);

      const result = await pythonService.createVirtualEnv(name, pythonVersion);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * DELETE /api/python/venvs/:name
   */
  async deleteVirtualEnv(req, res) {
    try {
      const { name } = req.params;
      if (!name) return errorResponse(res, 'Name is required', 400);

      const result = await pythonService.deleteVirtualEnv(name);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * GET /api/python/packages
   */
  async listPipPackages(req, res) {
    try {
      const venvPath = req.query.venv || '';
      const packages = await pythonService.listPipPackages(venvPath);
      return successResponse(res, { packages });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * POST /api/python/packages/install
   */
  async installPipPackage(req, res) {
    try {
      const { name, venv } = req.body;
      if (!name) return errorResponse(res, 'Package name is required', 400);

      const result = await pythonService.installPipPackage(name, venv);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * POST /api/python/packages/uninstall
   */
  async uninstallPipPackage(req, res) {
    try {
      const { name, venv } = req.body;
      if (!name) return errorResponse(res, 'Package name is required', 400);

      const result = await pythonService.uninstallPipPackage(name, venv);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * GET /api/python/wsgi
   */
  async getWsgiServers(req, res) {
    try {
      const servers = await pythonService.getWsgiServers();
      return successResponse(res, { servers });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * POST /api/python/wsgi/start
   */
  async startWsgi(req, res) {
    try {
      const { type, appModule, venvPath, port, workers, host } = req.body;
      if (!appModule) return errorResponse(res, 'App module is required', 400);

      const result = await pythonService.startWsgi({ type, appModule, venvPath, port, workers, host });
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * POST /api/python/wsgi/stop
   */
  async stopWsgi(req, res) {
    try {
      const { pid } = req.body;
      if (!pid) return errorResponse(res, 'PID is required', 400);

      const result = await pythonService.stopWsgi(String(pid));
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * GET /api/python/supervisor
   */
  async getSupervisorStatus(req, res) {
    try {
      const data = await pythonService.getSupervisorStatus();
      return successResponse(res, data);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * POST /api/python/supervisor/config
   */
  async createSupervisorConfig(req, res) {
    try {
      const { name, command, user, directory, environment, numprocs } = req.body;
      if (!name) return errorResponse(res, 'Program name is required', 400);
      if (!command) return errorResponse(res, 'Command is required', 400);

      const result = await pythonService.createSupervisorConfig({ name, command, user, directory, environment, numprocs });
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * POST /api/python/supervisor/action
   */
  async supervisorAction(req, res) {
    try {
      const { name, action } = req.body;
      if (!name) return errorResponse(res, 'Program name is required', 400);
      if (!action) return errorResponse(res, 'Action is required', 400);

      const result = await pythonService.supervisorAction(name, action);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * GET /api/python/info
   */
  async getPythonInfo(req, res) {
    try {
      const info = await pythonService.getPythonInfo();
      return successResponse(res, { info });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }
}

export default new PythonController();
