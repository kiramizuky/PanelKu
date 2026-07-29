import lvmManagerService from './lvm-manager.service.js';
import { success, error } from '../../helpers/response.js';
import logger from '../../config/logger.js';

class LvmManagerController {
  async getDisks(req, res) {
    try {
      const disks = await lvmManagerService.getDisks();
      return success(res, disks, 'Disks retrieved successfully');
    } catch (err) {
      logger.error('Error fetching disks:', err);
      return error(res, err.message);
    }
  }

  async getSmartStatus(req, res) {
    try {
      const { device } = req.query;
      if (!device) return error(res, 'Device path parameter is required', 400);
      const status = await lvmManagerService.getSmartStatus(device);
      return success(res, status, 'SMART status retrieved');
    } catch (err) {
      logger.error('Error getting SMART status:', err);
      return error(res, err.message);
    }
  }

  async getRaidArrays(req, res) {
    try {
      const arrays = await lvmManagerService.getRaidArrays();
      return success(res, arrays, 'RAID arrays retrieved successfully');
    } catch (err) {
      logger.error('Error fetching RAID arrays:', err);
      return error(res, err.message);
    }
  }

  async createRaid(req, res) {
    try {
      const { name, level, devices, spareDevices } = req.body;
      const result = await lvmManagerService.createRaid({ name, level, devices, spareDevices });
      return success(res, result.raid || {}, result.message || 'RAID array created');
    } catch (err) {
      logger.error('Error creating RAID array:', err);
      return error(res, err.message, 400);
    }
  }

  async manageRaidDisk(req, res) {
    try {
      const { mdDevice, action, diskDevice } = req.body;
      const result = await lvmManagerService.manageRaidDisk({ mdDevice, action, diskDevice });
      return success(res, {}, result.message);
    } catch (err) {
      logger.error('Error managing RAID disk:', err);
      return error(res, err.message, 400);
    }
  }

  async stopRaid(req, res) {
    try {
      const { mdDevice } = req.body;
      const result = await lvmManagerService.stopRaid(mdDevice);
      return success(res, {}, result.message);
    } catch (err) {
      logger.error('Error stopping RAID array:', err);
      return error(res, err.message, 400);
    }
  }

  async getPVs(req, res) {
    try {
      const pvs = await lvmManagerService.getPVs();
      return success(res, pvs, 'Physical Volumes retrieved');
    } catch (err) {
      logger.error('Error getting PVs:', err);
      return error(res, err.message);
    }
  }

  async createPV(req, res) {
    try {
      const { devicePath } = req.body;
      const result = await lvmManagerService.createPV(devicePath);
      return success(res, {}, result.message);
    } catch (err) {
      logger.error('Error creating PV:', err);
      return error(res, err.message, 400);
    }
  }

  async removePV(req, res) {
    try {
      const { devicePath } = req.body;
      const result = await lvmManagerService.removePV(devicePath);
      return success(res, {}, result.message);
    } catch (err) {
      logger.error('Error removing PV:', err);
      return error(res, err.message, 400);
    }
  }

  async getVGs(req, res) {
    try {
      const vgs = await lvmManagerService.getVGs();
      return success(res, vgs, 'Volume Groups retrieved');
    } catch (err) {
      logger.error('Error getting VGs:', err);
      return error(res, err.message);
    }
  }

  async createVG(req, res) {
    try {
      const { vgName, devices } = req.body;
      const result = await lvmManagerService.createVG({ vgName, devices });
      return success(res, {}, result.message);
    } catch (err) {
      logger.error('Error creating VG:', err);
      return error(res, err.message, 400);
    }
  }

  async extendVG(req, res) {
    try {
      const { vgName, devices } = req.body;
      const result = await lvmManagerService.extendVG({ vgName, devices });
      return success(res, {}, result.message);
    } catch (err) {
      logger.error('Error extending VG:', err);
      return error(res, err.message, 400);
    }
  }

  async removeVG(req, res) {
    try {
      const { vgName } = req.body;
      const result = await lvmManagerService.removeVG(vgName);
      return success(res, {}, result.message);
    } catch (err) {
      logger.error('Error removing VG:', err);
      return error(res, err.message, 400);
    }
  }

  async getLVs(req, res) {
    try {
      const lvs = await lvmManagerService.getLVs();
      return success(res, lvs, 'Logical Volumes retrieved');
    } catch (err) {
      logger.error('Error getting LVs:', err);
      return error(res, err.message);
    }
  }

  async createLV(req, res) {
    try {
      const { vgName, lvName, size } = req.body;
      const result = await lvmManagerService.createLV({ vgName, lvName, size });
      return success(res, result.lv || {}, result.message || 'LV created');
    } catch (err) {
      logger.error('Error creating LV:', err);
      return error(res, err.message, 400);
    }
  }

  async extendLV(req, res) {
    try {
      const { vgName, lvName, size, resizeFs } = req.body;
      const result = await lvmManagerService.extendLV({ vgName, lvName, size, resizeFs });
      return success(res, {}, result.message);
    } catch (err) {
      logger.error('Error extending LV:', err);
      return error(res, err.message, 400);
    }
  }

  async removeLV(req, res) {
    try {
      const { vgName, lvName } = req.body;
      const result = await lvmManagerService.removeLV({ vgName, lvName });
      return success(res, {}, result.message);
    } catch (err) {
      logger.error('Error removing LV:', err);
      return error(res, err.message, 400);
    }
  }

  async formatVolume(req, res) {
    try {
      const { devicePath, fsType, label } = req.body;
      const result = await lvmManagerService.formatVolume({ devicePath, fsType, label });
      return success(res, {}, result.message);
    } catch (err) {
      logger.error('Error formatting volume:', err);
      return error(res, err.message, 400);
    }
  }

  async mountVolume(req, res) {
    try {
      const { devicePath, mountPoint, fstabPersist } = req.body;
      const result = await lvmManagerService.mountVolume({ devicePath, mountPoint, fstabPersist });
      return success(res, {}, result.message);
    } catch (err) {
      logger.error('Error mounting volume:', err);
      return error(res, err.message, 400);
    }
  }

  async unmountVolume(req, res) {
    try {
      const { devicePath } = req.body;
      const result = await lvmManagerService.unmountVolume(devicePath);
      return success(res, {}, result.message);
    } catch (err) {
      logger.error('Error unmounting volume:', err);
      return error(res, err.message, 400);
    }
  }
}

export default new LvmManagerController();
