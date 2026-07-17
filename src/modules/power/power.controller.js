import powerService from './power.service.js';
import { success, error } from '../../helpers/response.js';

class PowerController {
  async getCpuInfo(req, res) {
    try {
      const info = await powerService.getCpuInfo();
      return success(res, info);
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async setGovernor(req, res) {
    try {
      const { governor } = req.body;
      if (!governor) return error(res, 'Governor name is required', 400);
      const result = await powerService.setGovernor(governor);
      return success(res, result, `Governor set to ${governor}`);
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async setFrequency(req, res) {
    try {
      const { khz } = req.body;
      if (!khz) return error(res, 'Frequency in kHz is required', 400);
      const result = await powerService.setFrequency(khz);
      return success(res, result, `Frequency set to ${(parseInt(khz)/1000000).toFixed(2)} GHz`);
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async getPowerProfiles(req, res) {
    try {
      const profiles = await powerService.getPowerProfiles();
      return success(res, profiles);
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async setPowerProfile(req, res) {
    try {
      const { profile } = req.body;
      if (!profile) return error(res, 'Profile is required', 400);
      const result = await powerService.setPowerProfile(profile);
      return success(res, result, `Profile set to ${profile}`);
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async suspend(req, res) {
    try {
      const result = await powerService.suspend();
      return success(res, result, 'System suspending...');
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async hibernate(req, res) {
    try {
      const result = await powerService.hibernate();
      return success(res, result, 'System hibernating...');
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async hybridSleep(req, res) {
    try {
      const result = await powerService.hybridSleep();
      return success(res, result, 'System entering hybrid sleep...');
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async getThermalInfo(req, res) {
    try {
      const info = await powerService.getThermalInfo();
      return success(res, info);
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async getFanInfo(req, res) {
    try {
      const fans = await powerService.getFanInfo();
      return success(res, { fans });
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async setFanSpeed(req, res) {
    try {
      const { device, fan, pwm } = req.body;
      if (!device || fan === undefined || pwm === undefined) return error(res, 'Device, fan index, and PWM value are required', 400);
      const result = await powerService.setFanSpeed(device, parseInt(fan), parseInt(pwm));
      return success(res, result, 'Fan speed updated');
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async getPowerStats(req, res) {
    try {
      const stats = await powerService.getPowerStats();
      return success(res, stats);
    } catch (err) {
      return error(res, err.message, 500);
    }
  }
}

export default new PowerController();
