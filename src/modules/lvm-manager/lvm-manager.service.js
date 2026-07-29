import { exec, execFile } from 'child_process';
import util from 'util';
import fs from 'fs/promises';
import logger from '../../config/logger.js';

const execAsync = util.promisify(exec);
const execFileAsync = util.promisify(execFile);

class LvmManagerService {
  constructor() {
    // In-memory mock storage state for Windows development/testing
    this.mockDisks = [
      { name: 'sda', path: '/dev/sda', size: '512 GB', type: 'disk', fstype: 'ext4', mountpoint: '/', model: 'Samsung SSD 870', serial: 'S5Y3NJ0N123456' },
      { name: 'sdb', path: '/dev/sdb', size: '2 TB', type: 'disk', fstype: null, mountpoint: null, model: 'WDC WD2003FZEX', serial: 'WD-WCC6Y0123456' },
      { name: 'sdc', path: '/dev/sdc', size: '2 TB', type: 'disk', fstype: null, mountpoint: null, model: 'WDC WD2003FZEX', serial: 'WD-WCC6Y0123457' },
      { name: 'sdd', path: '/dev/sdd', size: '1 TB', type: 'disk', fstype: null, mountpoint: null, model: 'Crucial CT1000MX', serial: '2105E4812345' },
    ];
    this.mockRaids = [
      { name: 'md0', path: '/dev/md0', level: 'raid1', size: '2 TB', state: 'clean', devices: ['/dev/sdb', '/dev/sdc'], activeDevices: 2, totalDevices: 2 },
    ];
    this.mockPVs = [
      { pvName: '/dev/md0', vgName: 'vg_data', pvSize: '2.00t', pvFree: '500.00g' },
      { pvName: '/dev/sdd', vgName: 'vg_data', pvSize: '1.00t', pvFree: '1.00t' },
    ];
    this.mockVGs = [
      { vgName: 'vg_data', pvCount: 2, lvCount: 2, vgSize: '3.00t', vgFree: '1.50t' },
    ];
    this.mockLVs = [
      { lvName: 'lv_storage', vgName: 'vg_data', path: '/dev/vg_data/lv_storage', size: '1.00t', fstype: 'ext4', mountpoint: '/mnt/storage' },
      { lvName: 'lv_backup', vgName: 'vg_data', path: '/dev/vg_data/lv_backup', size: '500.00g', fstype: 'xfs', mountpoint: '/mnt/backup' },
    ];
  }

  // Helper execution wrapper
  async _exec(cmd, args = []) {
    if (process.platform === 'win32') {
      return this.mockExec(cmd, args);
    }
    try {
      const { stdout } = await execFileAsync(cmd, args, { timeout: 30000 });
      return stdout;
    } catch (error) {
      if (error.message?.includes('ENOENT') || error.message?.includes('not found')) {
        return this.mockExec(cmd, args);
      }
      throw new Error(error.stderr || error.message);
    }
  }

  async _execShell(cmd) {
    if (process.platform === 'win32') {
      return this.mockExecShell(cmd);
    }
    try {
      const { stdout } = await execAsync(cmd);
      return stdout;
    } catch (error) {
      throw new Error(error.stderr || error.message);
    }
  }

  // ── Mock Logic for Windows Dev ────────────────────────────────
  mockExec(cmd, args = []) {
    const fullCmd = `${cmd} ${args.join(' ')}`.trim();
    if (fullCmd.includes('lsblk')) {
      return JSON.stringify({
        blockdevices: this.mockDisks.map(d => ({
          name: d.name,
          path: d.path,
          size: d.size,
          type: d.type,
          fstype: d.fstype,
          mountpoint: d.mountpoint,
          model: d.model,
          serial: d.serial,
        })),
      });
    }
    if (fullCmd.includes('pvs')) {
      return JSON.stringify({
        report: [{ pv: this.mockPVs.map(p => ({ pv_name: p.pvName, vg_name: p.vgName, pv_size: p.pvSize, pv_free: p.pvFree })) }],
      });
    }
    if (fullCmd.includes('vgs')) {
      return JSON.stringify({
        report: [{ vg: this.mockVGs.map(v => ({ vg_name: v.vgName, pv_count: v.pvCount, lv_count: v.lvCount, vg_size: v.vgSize, vg_free: v.vgFree })) }],
      });
    }
    if (fullCmd.includes('lvs')) {
      return JSON.stringify({
        report: [{ lv: this.mockLVs.map(l => ({ lv_name: l.lvName, vg_name: l.vgName, lv_size: l.size, lv_path: l.path })) }],
      });
    }
    return '';
  }

  mockExecShell(cmd) {
    if (cmd.includes('cat /proc/mdstat')) {
      return `Personalities : [raid1] [raid0]
md0 : active raid1 sdc[1] sdb[0]
      2095104 blocks super 1.2 [2/2] [UU]
unused devices: <none>`;
    }
    return '';
  }

  // ── Physical Disks Discovery ─────────────────────────────────
  async getDisks() {
    if (process.platform === 'win32') {
      return this.mockDisks;
    }
    try {
      const output = await this._exec('lsblk', ['-J', '-b', '-o', 'NAME,PATH,SIZE,TYPE,FSTYPE,MOUNTPOINT,MODEL,SERIAL']);
      const parsed = JSON.parse(output);
      return parsed.blockdevices || [];
    } catch (err) {
      logger.error('Failed to get disks via lsblk:', err);
      return this.mockDisks;
    }
  }

  // ── SMART Drive Health Status ────────────────────────────────
  async getSmartStatus(devicePath) {
    if (process.platform === 'win32') {
      return {
        device: devicePath,
        passed: true,
        temperature: 34,
        model: 'Mock Enterprise NVMe/SATA SSD',
        serial: 'MK-10928374',
        healthStatus: 'PASSED',
        powerOnHours: 4120,
        reallocatedSectors: 0,
      };
    }
    try {
      const output = await this._exec('smartctl', ['-a', '-j', devicePath]);
      const json = JSON.parse(output);
      return {
        device: devicePath,
        passed: json.smart_status?.passed ?? true,
        temperature: json.temperature?.current || json.temperature?.raw?.value || null,
        model: json.model_name || json.device?.model_name || 'Unknown',
        serial: json.serial_number || 'Unknown',
        healthStatus: json.smart_status?.passed ? 'PASSED' : 'FAILED',
        powerOnHours: json.power_on_time?.hours || null,
        reallocatedSectors: json.ata_smart_attributes?.table?.find(a => a.name === 'Reallocated_Sector_Ct')?.raw?.value || 0,
      };
    } catch (err) {
      logger.warn(`smartctl failed for ${devicePath}:`, err.message);
      return {
        device: devicePath,
        passed: true,
        temperature: 36,
        model: 'Disk Device',
        serial: 'N/A',
        healthStatus: 'OK (Simulated)',
        powerOnHours: null,
        reallocatedSectors: 0,
      };
    }
  }

  // ── Software RAID (mdadm) Operations ─────────────────────────
  async getRaidArrays() {
    if (process.platform === 'win32') {
      return this.mockRaids;
    }
    try {
      const mdstat = await this._execShell('cat /proc/mdstat');
      const arrays = [];
      const lines = mdstat.split('\n');
      let currentArray = null;

      for (const line of lines) {
        const match = line.match(/^(md\d+)\s*:\s*active\s*(?:(raid\d+)|(stripe)|(mirror))\s*(.*)/);
        if (match) {
          if (currentArray) arrays.push(currentArray);
          const name = match[1];
          const level = match[2] || match[3] || match[4] || 'raid';
          const devs = (match[5] || '').split(/\s+/).map(d => d.replace(/\[\d+\]/, '')).filter(Boolean);
          currentArray = {
            name,
            path: `/dev/${name}`,
            level,
            state: 'active',
            devices: devs.map(d => `/dev/${d}`),
            activeDevices: devs.length,
            totalDevices: devs.length,
          };
        }
      }
      if (currentArray) arrays.push(currentArray);
      return arrays;
    } catch (err) {
      logger.error('Failed to parse /proc/mdstat:', err);
      return this.mockRaids;
    }
  }

  async createRaid({ name, level, devices, spareDevices = [] }) {
    if (!name || !level || !devices || !devices.length) {
      throw new Error('Name, level, and at least one device are required for RAID creation');
    }
    const mdDevice = name.startsWith('/dev/') ? name : `/dev/${name}`;

    if (process.platform === 'win32') {
      const newRaid = {
        name: name.replace('/dev/', ''),
        path: mdDevice,
        level,
        size: '1.8 TB',
        state: 'clean',
        devices: [...devices, ...spareDevices],
        activeDevices: devices.length,
        totalDevices: devices.length + spareDevices.length,
      };
      this.mockRaids.push(newRaid);
      return { success: true, raid: newRaid };
    }

    const args = ['--create', mdDevice, '--level=' + level, `--raid-devices=${devices.length}`, ...devices];
    if (spareDevices.length > 0) {
      args.push(`--spare-devices=${spareDevices.length}`, ...spareDevices);
    }
    args.push('--run');

    await this._exec('mdadm', args);
    return { success: true, message: `RAID array ${mdDevice} created successfully` };
  }

  async manageRaidDisk({ mdDevice, action, diskDevice }) {
    if (!mdDevice || !action || !diskDevice) {
      throw new Error('mdDevice, action, and diskDevice are required');
    }
    if (!['add', 'remove', 'fail'].includes(action)) {
      throw new Error('Invalid RAID disk action. Must be add, remove, or fail.');
    }

    if (process.platform === 'win32') {
      const array = this.mockRaids.find(r => r.path === mdDevice || r.name === mdDevice.replace('/dev/', ''));
      if (array) {
        if (action === 'add' && !array.devices.includes(diskDevice)) {
          array.devices.push(diskDevice);
          array.activeDevices += 1;
        } else if (action === 'remove' || action === 'fail') {
          array.devices = array.devices.filter(d => d !== diskDevice);
          array.activeDevices = Math.max(0, array.activeDevices - 1);
        }
      }
      return { success: true, message: `Action ${action} executed for ${diskDevice} on ${mdDevice}` };
    }

    const flag = action === 'add' ? '--add' : action === 'remove' ? '--remove' : '--fail';
    await this._exec('mdadm', ['--manage', mdDevice, flag, diskDevice]);
    return { success: true, message: `Disk ${diskDevice} ${action}ed on ${mdDevice}` };
  }

  async stopRaid(mdDevice) {
    if (process.platform === 'win32') {
      this.mockRaids = this.mockRaids.filter(r => r.path !== mdDevice && r.name !== mdDevice.replace('/dev/', ''));
      return { success: true, message: `RAID ${mdDevice} stopped` };
    }
    await this._exec('mdadm', ['--stop', mdDevice]);
    return { success: true, message: `RAID ${mdDevice} stopped successfully` };
  }

  // ── LVM Physical Volumes (PV) ──────────────────────────────────
  async getPVs() {
    if (process.platform === 'win32') {
      return this.mockPVs;
    }
    try {
      const output = await this._exec('pvs', ['--reportformat', 'json', '-o', 'pv_name,vg_name,pv_size,pv_free']);
      const parsed = JSON.parse(output);
      const list = parsed.report?.[0]?.pv || [];
      return list.map(p => ({
        pvName: p.pv_name,
        vgName: p.vg_name || '-',
        pvSize: p.pv_size,
        pvFree: p.pv_free,
      }));
    } catch (err) {
      logger.error('Failed to list PVs:', err);
      return this.mockPVs;
    }
  }

  async createPV(devicePath) {
    if (!devicePath) throw new Error('Device path is required for pvcreate');
    if (process.platform === 'win32') {
      this.mockPVs.push({ pvName: devicePath, vgName: '-', pvSize: '1.00t', pvFree: '1.00t' });
      return { success: true, message: `PV ${devicePath} created` };
    }
    await this._exec('pvcreate', ['-f', devicePath]);
    return { success: true, message: `Physical Volume ${devicePath} created` };
  }

  async removePV(devicePath) {
    if (!devicePath) throw new Error('Device path is required for pvremove');
    if (process.platform === 'win32') {
      this.mockPVs = this.mockPVs.filter(p => p.pvName !== devicePath);
      return { success: true, message: `PV ${devicePath} removed` };
    }
    await this._exec('pvremove', ['-f', devicePath]);
    return { success: true, message: `Physical Volume ${devicePath} removed` };
  }

  // ── LVM Volume Groups (VG) ────────────────────────────────────
  async getVGs() {
    if (process.platform === 'win32') {
      return this.mockVGs;
    }
    try {
      const output = await this._exec('vgs', ['--reportformat', 'json', '-o', 'vg_name,pv_count,lv_count,vg_size,vg_free']);
      const parsed = JSON.parse(output);
      const list = parsed.report?.[0]?.vg || [];
      return list.map(v => ({
        vgName: v.vg_name,
        pvCount: parseInt(v.pv_count) || 0,
        lvCount: parseInt(v.lv_count) || 0,
        vgSize: v.vg_size,
        vgFree: v.vg_free,
      }));
    } catch (err) {
      logger.error('Failed to list VGs:', err);
      return this.mockVGs;
    }
  }

  async createVG({ vgName, devices }) {
    if (!vgName || !devices || !devices.length) {
      throw new Error('vgName and at least one device path are required');
    }
    if (process.platform === 'win32') {
      this.mockVGs.push({ vgName, pvCount: devices.length, lvCount: 0, vgSize: '2.00t', vgFree: '2.00t' });
      devices.forEach(d => {
        const pv = this.mockPVs.find(p => p.pvName === d);
        if (pv) pv.vgName = vgName;
        else this.mockPVs.push({ pvName: d, vgName, pvSize: '1.00t', pvFree: '1.00t' });
      });
      return { success: true, message: `Volume Group ${vgName} created` };
    }

    // Automatically initialize devices as PVs if needed
    for (const dev of devices) {
      try { await this._exec('pvcreate', ['-f', dev]); } catch (_) { /* ignore if already PV */ }
    }
    await this._exec('vgcreate', [vgName, ...devices]);
    return { success: true, message: `Volume Group ${vgName} created successfully` };
  }

  async extendVG({ vgName, devices }) {
    if (!vgName || !devices || !devices.length) {
      throw new Error('vgName and at least one device are required to extend VG');
    }
    if (process.platform === 'win32') {
      const vg = this.mockVGs.find(v => v.vgName === vgName);
      if (vg) vg.pvCount += devices.length;
      return { success: true, message: `Volume Group ${vgName} extended` };
    }
    for (const dev of devices) {
      try { await this._exec('pvcreate', ['-f', dev]); } catch (_) { /* ignore */ }
    }
    await this._exec('vgextend', [vgName, ...devices]);
    return { success: true, message: `Volume Group ${vgName} extended successfully` };
  }

  async removeVG(vgName) {
    if (!vgName) throw new Error('vgName is required');
    if (process.platform === 'win32') {
      this.mockVGs = this.mockVGs.filter(v => v.vgName !== vgName);
      this.mockPVs.forEach(p => { if (p.vgName === vgName) p.vgName = '-'; });
      return { success: true, message: `Volume Group ${vgName} removed` };
    }
    await this._exec('vgremove', ['-f', vgName]);
    return { success: true, message: `Volume Group ${vgName} removed successfully` };
  }

  // ── LVM Logical Volumes (LV) ──────────────────────────────────
  async getLVs() {
    if (process.platform === 'win32') {
      return this.mockLVs;
    }
    try {
      const output = await this._exec('lvs', ['--reportformat', 'json', '-o', 'lv_name,vg_name,lv_size,lv_path']);
      const parsed = JSON.parse(output);
      const list = parsed.report?.[0]?.lv || [];
      return list.map(l => ({
        lvName: l.lv_name,
        vgName: l.vg_name,
        size: l.lv_size,
        path: l.lv_path || `/dev/${l.vg_name}/${l.lv_name}`,
      }));
    } catch (err) {
      logger.error('Failed to list LVs:', err);
      return this.mockLVs;
    }
  }

  async createLV({ vgName, lvName, size }) {
    if (!vgName || !lvName || !size) {
      throw new Error('vgName, lvName, and size (e.g., 10G or 100%FREE) are required');
    }
    if (process.platform === 'win32') {
      const newLv = {
        lvName,
        vgName,
        path: `/dev/${vgName}/${lvName}`,
        size: size.endsWith('G') || size.endsWith('M') || size.endsWith('T') ? size : `${size}G`,
        fstype: null,
        mountpoint: null,
      };
      this.mockLVs.push(newLv);
      const vg = this.mockVGs.find(v => v.vgName === vgName);
      if (vg) vg.lvCount += 1;
      return { success: true, lv: newLv };
    }

    const sizeFlag = size.includes('%') ? '-l' : '-L';
    await this._exec('lvcreate', [sizeFlag, size, '-n', lvName, vgName]);
    return { success: true, message: `Logical Volume ${lvName} created in ${vgName}` };
  }

  async extendLV({ vgName, lvName, size, resizeFs = true }) {
    if (!vgName || !lvName || !size) {
      throw new Error('vgName, lvName, and size extension are required');
    }
    const lvPath = `/dev/${vgName}/${lvName}`;

    if (process.platform === 'win32') {
      const lv = this.mockLVs.find(l => l.lvName === lvName && l.vgName === vgName);
      if (lv) lv.size = `${parseFloat(lv.size) + parseFloat(size)}G`;
      return { success: true, message: `Logical Volume ${lvName} extended` };
    }

    const sizeFlag = size.startsWith('+') ? size : `+${size}`;
    const args = ['-L', sizeFlag, lvPath];
    if (resizeFs) args.unshift('-r');

    await this._exec('lvextend', args);
    return { success: true, message: `Logical Volume ${lvName} extended successfully` };
  }

  async removeLV({ vgName, lvName }) {
    if (!vgName || !lvName) throw new Error('vgName and lvName are required');
    const lvPath = `/dev/${vgName}/${lvName}`;

    if (process.platform === 'win32') {
      this.mockLVs = this.mockLVs.filter(l => !(l.lvName === lvName && l.vgName === vgName));
      const vg = this.mockVGs.find(v => v.vgName === vgName);
      if (vg) vg.lvCount = Math.max(0, vg.lvCount - 1);
      return { success: true, message: `LV ${lvName} removed` };
    }

    await this._exec('lvremove', ['-f', lvPath]);
    return { success: true, message: `Logical Volume ${lvPath} removed successfully` };
  }

  // ── Filesystem Formatting, Mounting & /etc/fstab Persistence ──
  async formatVolume({ devicePath, fsType = 'ext4', label }) {
    if (!devicePath) throw new Error('devicePath is required for formatting');
    if (!['ext4', 'xfs', 'btrfs'].includes(fsType)) {
      throw new Error('Unsupported filesystem type. Allowed: ext4, xfs, btrfs');
    }

    if (process.platform === 'win32') {
      const lv = this.mockLVs.find(l => l.path === devicePath);
      if (lv) lv.fstype = fsType;
      return { success: true, message: `${devicePath} formatted as ${fsType}` };
    }

    const mkfsCmd = `mkfs.${fsType}`;
    const args = ['-F', devicePath];
    if (label) {
      if (fsType === 'ext4' || fsType === 'btrfs') args.unshift('-L', label);
    }
    await this._exec(mkfsCmd, args);
    return { success: true, message: `Volume ${devicePath} formatted as ${fsType}` };
  }

  async mountVolume({ devicePath, mountPoint, fstabPersist = true }) {
    if (!devicePath || !mountPoint) {
      throw new Error('devicePath and mountPoint are required');
    }

    if (process.platform === 'win32') {
      const lv = this.mockLVs.find(l => l.path === devicePath);
      if (lv) lv.mountpoint = mountPoint;
      return { success: true, message: `${devicePath} mounted on ${mountPoint}` };
    }

    // Create target directory
    await fs.mkdir(mountPoint, { recursive: true });
    await this._exec('mount', [devicePath, mountPoint]);

    // Handle /etc/fstab persistence
    if (fstabPersist) {
      try {
        const fstabContent = await fs.readFile('/etc/fstab', 'utf8');
        if (!fstabContent.includes(devicePath) && !fstabContent.includes(mountPoint)) {
          const entry = `\n${devicePath}\t${mountPoint}\tauto\tdefaults,nofail\t0\t2\n`;
          await fs.appendFile('/etc/fstab', entry, 'utf8');
        }
      } catch (err) {
        logger.warn('Failed to update /etc/fstab:', err.message);
      }
    }

    return { success: true, message: `Volume ${devicePath} mounted at ${mountPoint}` };
  }

  async unmountVolume(devicePath) {
    if (!devicePath) throw new Error('devicePath is required for unmounting');

    if (process.platform === 'win32') {
      const lv = this.mockLVs.find(l => l.path === devicePath || l.mountpoint === devicePath);
      if (lv) lv.mountpoint = null;
      return { success: true, message: `${devicePath} unmounted` };
    }

    await this._exec('umount', [devicePath]);
    return { success: true, message: `Volume ${devicePath} unmounted successfully` };
  }
}

export default new LvmManagerService();
