import gpuService from './gpu.service.js';
import { success, error } from '../../helpers/response.js';

class GpuController {
  async getStatus(req, res) {
    try {
      const info = await gpuService.getGpuInfo();
      return success(res, info);
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async getProcesses(req, res) {
    try {
      const gpuIndex = req.query.gpu || null;
      const processes = await gpuService.getGpuProcesses(gpuIndex);
      return success(res, { processes });
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async killProcess(req, res) {
    try {
      const { pid } = req.body;
      if (!pid) return error(res, 'PID is required', 400);
      const result = await gpuService.killProcess(pid);
      return success(res, result, 'Process terminated');
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async resetGpu(req, res) {
    try {
      const { gpuIndex } = req.body;
      if (gpuIndex === undefined) return error(res, 'GPU index is required', 400);
      const result = await gpuService.resetGpu(gpuIndex);
      return success(res, result, 'GPU reset initiated');
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async setPowerLimit(req, res) {
    try {
      const { gpuIndex, watts } = req.body;
      if (gpuIndex === undefined || !watts) return error(res, 'GPU index and power limit are required', 400);
      const result = await gpuService.setPowerLimit(gpuIndex, watts);
      return success(res, result, 'Power limit updated');
    } catch (err) {
      return error(res, err.message, 500);
    }
  }
}

export default new GpuController();
