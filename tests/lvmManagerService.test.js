/**
 * Unit tests for LVM & Storage Manager Module:
 * - src/modules/lvm-manager/lvm-manager.service.js
 * - src/modules/lvm-manager/lvm-manager.controller.js
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

const { default: lvmService } = await import('../src/modules/lvm-manager/lvm-manager.service.js');
const { default: lvmController } = await import('../src/modules/lvm-manager/lvm-manager.controller.js');

function createMockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  // Reset mock state
  lvmService.mockDisks = [
    { name: 'sda', path: '/dev/sda', size: '512 GB', type: 'disk', fstype: 'ext4', mountpoint: '/', model: 'Samsung SSD 870', serial: 'S5Y3NJ0N123456' },
    { name: 'sdb', path: '/dev/sdb', size: '2 TB', type: 'disk', fstype: null, mountpoint: null, model: 'WDC WD2003FZEX', serial: 'WD-WCC6Y0123456' },
  ];
  lvmService.mockRaids = [
    { name: 'md0', path: '/dev/md0', level: 'raid1', size: '2 TB', state: 'clean', devices: ['/dev/sdb'], activeDevices: 1, totalDevices: 1 },
  ];
  lvmService.mockPVs = [
    { pvName: '/dev/md0', vgName: 'vg_data', pvSize: '2.00t', pvFree: '500.00g' },
  ];
  lvmService.mockVGs = [
    { vgName: 'vg_data', pvCount: 1, lvCount: 1, vgSize: '2.00t', vgFree: '500.00g' },
  ];
  lvmService.mockLVs = [
    { lvName: 'lv_storage', vgName: 'vg_data', path: '/dev/vg_data/lv_storage', size: '1.50t', fstype: 'ext4', mountpoint: '/mnt/storage' },
  ];
});

describe('LvmManagerService — Disks & SMART Status', () => {
  test('getDisks returns list of disks', async () => {
    const disks = await lvmService.getDisks();
    expect(Array.isArray(disks)).toBe(true);
    expect(disks.length).toBeGreaterThanOrEqual(1);
    expect(disks[0]).toHaveProperty('name');
    expect(disks[0]).toHaveProperty('size');
  });

  test('getSmartStatus returns drive health metrics', async () => {
    const smart = await lvmService.getSmartStatus('/dev/sda');
    expect(smart.device).toBe('/dev/sda');
    expect(smart.healthStatus).toBe('PASSED');
    expect(smart.passed).toBe(true);
  });
});

describe('LvmManagerService — Software RAID Operations', () => {
  test('getRaidArrays returns active arrays', async () => {
    const arrays = await lvmService.getRaidArrays();
    expect(arrays.length).toBe(1);
    expect(arrays[0].name).toBe('md0');
    expect(arrays[0].level).toBe('raid1');
  });

  test('createRaid validates inputs and creates array', async () => {
    await expect(lvmService.createRaid({})).rejects.toThrow('required');

    const res = await lvmService.createRaid({
      name: 'md1',
      level: 'raid0',
      devices: ['/dev/sdc', '/dev/sdd'],
    });
    expect(res.success).toBe(true);
    expect(res.raid.name).toBe('md1');
  });

  test('manageRaidDisk adds or removes disk', async () => {
    await expect(lvmService.manageRaidDisk({})).rejects.toThrow('required');
    await expect(lvmService.manageRaidDisk({ mdDevice: 'md0', action: 'bad', diskDevice: '/dev/sdc' })).rejects.toThrow('Invalid RAID disk action');

    const addRes = await lvmService.manageRaidDisk({ mdDevice: 'md0', action: 'add', diskDevice: '/dev/sdc' });
    expect(addRes.success).toBe(true);

    const removeRes = await lvmService.manageRaidDisk({ mdDevice: 'md0', action: 'remove', diskDevice: '/dev/sdc' });
    expect(removeRes.success).toBe(true);
  });

  test('stopRaid stops and removes array', async () => {
    const res = await lvmService.stopRaid('/dev/md0');
    expect(res.success).toBe(true);
    const arrays = await lvmService.getRaidArrays();
    expect(arrays.find(r => r.path === '/dev/md0')).toBeUndefined();
  });
});

describe('LvmManagerService — Physical Volumes (PV)', () => {
  test('getPVs returns physical volumes', async () => {
    const pvs = await lvmService.getPVs();
    expect(pvs.length).toBe(1);
    expect(pvs[0].pvName).toBe('/dev/md0');
  });

  test('createPV and removePV create and remove volume', async () => {
    await expect(lvmService.createPV('')).rejects.toThrow('required');

    const createRes = await lvmService.createPV('/dev/sdd');
    expect(createRes.success).toBe(true);

    const removeRes = await lvmService.removePV('/dev/sdd');
    expect(removeRes.success).toBe(true);
  });
});

describe('LvmManagerService — Volume Groups (VG)', () => {
  test('getVGs returns volume groups', async () => {
    const vgs = await lvmService.getVGs();
    expect(vgs.length).toBe(1);
    expect(vgs[0].vgName).toBe('vg_data');
  });

  test('createVG, extendVG, and removeVG', async () => {
    await expect(lvmService.createVG({})).rejects.toThrow('required');

    const createRes = await lvmService.createVG({ vgName: 'vg_fast', devices: ['/dev/nvme0n1'] });
    expect(createRes.success).toBe(true);

    const extendRes = await lvmService.extendVG({ vgName: 'vg_fast', devices: ['/dev/nvme0n2'] });
    expect(extendRes.success).toBe(true);

    const removeRes = await lvmService.removeVG('vg_fast');
    expect(removeRes.success).toBe(true);
  });
});

describe('LvmManagerService — Logical Volumes (LV)', () => {
  test('getLVs returns logical volumes', async () => {
    const lvs = await lvmService.getLVs();
    expect(lvs.length).toBe(1);
    expect(lvs[0].lvName).toBe('lv_storage');
  });

  test('createLV, extendLV, and removeLV', async () => {
    await expect(lvmService.createLV({})).rejects.toThrow('required');

    const createRes = await lvmService.createLV({ vgName: 'vg_data', lvName: 'lv_web', size: '20G' });
    expect(createRes.success).toBe(true);
    expect(createRes.lv.lvName).toBe('lv_web');

    const extendRes = await lvmService.extendLV({ vgName: 'vg_data', lvName: 'lv_web', size: '10' });
    expect(extendRes.success).toBe(true);

    const removeRes = await lvmService.removeLV({ vgName: 'vg_data', lvName: 'lv_web' });
    expect(removeRes.success).toBe(true);
  });
});

describe('LvmManagerService — Formatting & Mounting', () => {
  test('formatVolume validates filesystem type', async () => {
    await expect(lvmService.formatVolume({})).rejects.toThrow('devicePath is required');
    await expect(lvmService.formatVolume({ devicePath: '/dev/vg_data/lv_storage', fsType: 'ntfs' })).rejects.toThrow('Unsupported filesystem type');

    const res = await lvmService.formatVolume({ devicePath: '/dev/vg_data/lv_storage', fsType: 'xfs' });
    expect(res.success).toBe(true);
  });

  test('mountVolume and unmountVolume handle mount state', async () => {
    await expect(lvmService.mountVolume({})).rejects.toThrow('required');

    const mountRes = await lvmService.mountVolume({ devicePath: '/dev/vg_data/lv_storage', mountPoint: '/mnt/storage' });
    expect(mountRes.success).toBe(true);

    const unmountRes = await lvmService.unmountVolume('/dev/vg_data/lv_storage');
    expect(unmountRes.success).toBe(true);
  });
});

describe('LvmManagerController — Endpoints', () => {
  test('getDisks and getSmartStatus endpoints', async () => {
    const req = {};
    const resDisks = createMockRes();
    await lvmController.getDisks(req, resDisks);
    expect(resDisks.statusCode).toBe(200);

    const reqSmartNoDev = { query: {} };
    const resSmartNoDev = createMockRes();
    await lvmController.getSmartStatus(reqSmartNoDev, resSmartNoDev);
    expect(resSmartNoDev.statusCode).toBe(400);

    const reqSmart = { query: { device: '/dev/sda' } };
    const resSmart = createMockRes();
    await lvmController.getSmartStatus(reqSmart, resSmart);
    expect(resSmart.statusCode).toBe(200);
  });

  test('createRaid and manageRaidDisk endpoints validate body', async () => {
    const reqEmpty = { body: {} };
    const resEmpty = createMockRes();
    await lvmController.createRaid(reqEmpty, resEmpty);
    expect(resEmpty.statusCode).toBe(400);

    const resManage = createMockRes();
    await lvmController.manageRaidDisk(reqEmpty, resManage);
    expect(resManage.statusCode).toBe(400);
  });

  test('createPV and createVG endpoints', async () => {
    const reqPV = { body: { devicePath: '/dev/sdd' } };
    const resPV = createMockRes();
    await lvmController.createPV(reqPV, resPV);
    expect(resPV.statusCode).toBe(200);

    const reqVG = { body: { vgName: 'vg_new', devices: ['/dev/sdd'] } };
    const resVG = createMockRes();
    await lvmController.createVG(reqVG, resVG);
    expect(resVG.statusCode).toBe(200);
  });

  test('createLV and formatVolume endpoints', async () => {
    const reqLV = { body: { vgName: 'vg_data', lvName: 'lv_test', size: '5G' } };
    const resLV = createMockRes();
    await lvmController.createLV(reqLV, resLV);
    expect(resLV.statusCode).toBe(200);

    const reqFmt = { body: { devicePath: '/dev/vg_data/lv_test', fsType: 'ext4' } };
    const resFmt = createMockRes();
    await lvmController.formatVolume(reqFmt, resFmt);
    expect(resFmt.statusCode).toBe(200);
  });
});
