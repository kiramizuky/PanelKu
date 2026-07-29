import lvmManagerService from '../src/modules/lvm-manager/lvm-manager.service.js';

describe('LVM & RAID Storage Manager Module Tests', () => {

  describe('Service Layer (Windows Mock & Command Simulation)', () => {

    test('getDisks returns list of physical storage devices', async () => {
      const disks = await lvmManagerService.getDisks();
      expect(Array.isArray(disks)).toBe(true);
      expect(disks.length).toBeGreaterThan(0);
      expect(disks[0]).toHaveProperty('name');
      expect(disks[0]).toHaveProperty('path');
    });

    test('getSmartStatus returns SMART health status object', async () => {
      const status = await lvmManagerService.getSmartStatus('/dev/sda');
      expect(status).toHaveProperty('device', '/dev/sda');
      expect(status).toHaveProperty('passed', true);
      expect(status).toHaveProperty('healthStatus');
    });

    test('getRaidArrays returns active software RAID arrays', async () => {
      const raids = await lvmManagerService.getRaidArrays();
      expect(Array.isArray(raids)).toBe(true);
      expect(raids.length).toBeGreaterThan(0);
      expect(raids[0]).toHaveProperty('level', 'raid1');
    });

    test('createRaid creates a new software RAID array', async () => {
      const res = await lvmManagerService.createRaid({
        name: 'md1',
        level: 'raid0',
        devices: ['/dev/sdd'],
      });
      expect(res.success).toBe(true);
      expect(res.raid.name).toBe('md1');
    });

    test('manageRaidDisk adds and removes drives from RAID array', async () => {
      const resAdd = await lvmManagerService.manageRaidDisk({
        mdDevice: '/dev/md0',
        action: 'add',
        diskDevice: '/dev/sdd',
      });
      expect(resAdd.success).toBe(true);

      const resFail = await lvmManagerService.manageRaidDisk({
        mdDevice: '/dev/md0',
        action: 'fail',
        diskDevice: '/dev/sdd',
      });
      expect(resFail.success).toBe(true);
    });

    test('getPVs returns Physical Volumes', async () => {
      const pvs = await lvmManagerService.getPVs();
      expect(Array.isArray(pvs)).toBe(true);
      expect(pvs.length).toBeGreaterThan(0);
    });

    test('createPV and removePV initialize and delete physical volumes', async () => {
      const createRes = await lvmManagerService.createPV('/dev/sde');
      expect(createRes.success).toBe(true);

      const pvs = await lvmManagerService.getPVs();
      expect(pvs.some(p => p.pvName === '/dev/sde')).toBe(true);

      const removeRes = await lvmManagerService.removePV('/dev/sde');
      expect(removeRes.success).toBe(true);
    });

    test('getVGs returns Volume Groups', async () => {
      const vgs = await lvmManagerService.getVGs();
      expect(Array.isArray(vgs)).toBe(true);
      expect(vgs.length).toBeGreaterThan(0);
    });

    test('createVG, extendVG, and removeVG manage volume groups', async () => {
      const createRes = await lvmManagerService.createVG({
        vgName: 'vg_test',
        devices: ['/dev/sdf'],
      });
      expect(createRes.success).toBe(true);

      const extendRes = await lvmManagerService.extendVG({
        vgName: 'vg_test',
        devices: ['/dev/sdg'],
      });
      expect(extendRes.success).toBe(true);

      const removeRes = await lvmManagerService.removeVG('vg_test');
      expect(removeRes.success).toBe(true);
    });

    test('getLVs returns Logical Volumes', async () => {
      const lvs = await lvmManagerService.getLVs();
      expect(Array.isArray(lvs)).toBe(true);
      expect(lvs.length).toBeGreaterThan(0);
    });

    test('createLV, extendLV, and removeLV manage logical volumes', async () => {
      const createRes = await lvmManagerService.createLV({
        vgName: 'vg_data',
        lvName: 'lv_test',
        size: '10G',
      });
      expect(createRes.success).toBe(true);
      expect(createRes.lv.lvName).toBe('lv_test');

      const extendRes = await lvmManagerService.extendLV({
        vgName: 'vg_data',
        lvName: 'lv_test',
        size: '5G',
      });
      expect(extendRes.success).toBe(true);

      const removeRes = await lvmManagerService.removeLV({
        vgName: 'vg_data',
        lvName: 'lv_test',
      });
      expect(removeRes.success).toBe(true);
    });

    test('formatVolume, mountVolume, and unmountVolume format and mount volumes', async () => {
      const formatRes = await lvmManagerService.formatVolume({
        devicePath: '/dev/vg_data/lv_storage',
        fsType: 'ext4',
        label: 'DATA_VOL',
      });
      expect(formatRes.success).toBe(true);

      const mountRes = await lvmManagerService.mountVolume({
        devicePath: '/dev/vg_data/lv_storage',
        mountPoint: '/mnt/storage',
        fstabPersist: true,
      });
      expect(mountRes.success).toBe(true);

      const unmountRes = await lvmManagerService.unmountVolume('/dev/vg_data/lv_storage');
      expect(unmountRes.success).toBe(true);
    });

  });
});
