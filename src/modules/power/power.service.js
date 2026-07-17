import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

class PowerService {
  constructor() {
    this.cpuBasePath = '/sys/devices/system/cpu';
  }

  // ── CPU Governor ─────────────────────────────────────────

  async getCpuInfo() {
    const info = {
      cpus: [],
      currentGovernor: null,
      availableGovernors: [],
      scalingDrivers: [],
      architecture: null,
    };

    try {
      // Get architecture
      const { stdout: arch } = await execAsync('uname -m 2>/dev/null');
      info.architecture = arch.trim();

      // Get CPU model
      const { stdout: model } = await execAsync('cat /proc/cpuinfo | grep "model name" | head -1 | cut -d: -f2');
      info.model = model.trim() || null;

      // Get total cores/threads
      const { stdout: cores } = await execAsync('nproc 2>/dev/null');
      info.totalCores = parseInt(cores.trim()) || 0;

      // Get CPU info per core
      for (let i = 0; i < info.totalCores; i++) {
        const cpuDir = `${this.cpuBasePath}/cpu${i}`;
        try {
          await fs.access(cpuDir);
        } catch { continue; }

        const cpu = { index: i };

        try {
          const gov = await fs.readFile(`${cpuDir}/cpufreq/scaling_governor`, 'utf8');
          cpu.governor = gov.trim();
        } catch { cpu.governor = 'unknown'; }

        try {
          const maxFreq = await fs.readFile(`${cpuDir}/cpufreq/scaling_max_freq`, 'utf8');
          cpu.maxFreq = parseInt(maxFreq.trim());
        } catch { cpu.maxFreq = 0; }

        try {
          const minFreq = await fs.readFile(`${cpuDir}/cpufreq/scaling_min_freq`, 'utf8');
          cpu.minFreq = parseInt(minFreq.trim());
        } catch { cpu.minFreq = 0; }

        try {
          const curFreq = await fs.readFile(`${cpuDir}/cpufreq/scaling_cur_freq`, 'utf8');
          cpu.currentFreq = parseInt(curFreq.trim());
        } catch { cpu.currentFreq = 0; }

        try {
          const availGovs = await fs.readFile(`${cpuDir}/cpufreq/scaling_available_governors`, 'utf8');
          cpu.availableGovernors = availGovs.trim().split(/\s+/);
        } catch { cpu.availableGovernors = []; }

        // Online status
        try {
          const online = await fs.readFile(`${cpuDir}/online`, 'utf8');
          cpu.online = parseInt(online.trim()) === 1;
        } catch { cpu.online = true; }

        info.cpus.push(cpu);
      }

      // Aggregate available governors from first CPU
      if (info.cpus.length > 0) {
        info.availableGovernors = info.cpus[0].availableGovernors;
        info.currentGovernor = info.cpus[0].governor;
      }
    } catch (e) {
      // Fallback to cpupower
      try {
        const { stdout } = await execAsync('cpupower frequency-info 2>/dev/null | head -20');
        info.fallbackInfo = stdout.trim();
      } catch {}
    }

    return info;
  }

  /**
   * Set CPU governor for all cores.
   * Governor names are validated against known safe values.
   */
  async setGovernor(governor) {
    // Validate governor name — only known safe values
    const validGovernors = ['performance', 'powersave', 'ondemand', 'conservative', 'schedutil', 'userspace'];
    if (!validGovernors.includes(governor)) {
      throw new Error(`Invalid governor "${governor}". Valid: ${validGovernors.join(', ')}`);
    }

    if (process.platform === 'win32') {
      return { success: true, governor, simulated: true };
    }

    let updated = 0;
    const totalCores = parseInt((await execAsync('nproc 2>/dev/null')).stdout.trim()) || 1;

    for (let i = 0; i < totalCores; i++) {
      const govPath = `${this.cpuBasePath}/cpu${i}/cpufreq/scaling_governor`;
      try {
        await fs.writeFile(govPath, governor, 'utf8');
        updated++;
      } catch {
        // Try with tee
        try {
          const { stdout } = await execAsync(`echo "${governor}" | sudo tee ${govPath} 2>/dev/null`);
          if (stdout.trim()) updated++;
        } catch {}
      }
    }

    return { success: updated > 0, updated, total: totalCores, governor };
  }

  /**
   * Set CPU frequency in kHz for all cores (userspace governor required).
   */
  async setFrequency(khz) {
    const freq = parseInt(khz);
    if (!freq || freq < 100000 || freq > 10000000) throw new Error('Invalid frequency. Use kHz (e.g., 2400000 for 2.4GHz)');

    let updated = 0;
    const totalCores = parseInt((await execAsync('nproc 2>/dev/null')).stdout.trim()) || 1;

    for (let i = 0; i < totalCores; i++) {
      const freqPath = `${this.cpuBasePath}/cpu${i}/cpufreq/scaling_setspeed`;
      try {
        await fs.writeFile(freqPath, String(freq), 'utf8');
        updated++;
      } catch {
        try {
          await execAsync(`echo "${freq}" | sudo tee ${freqPath} 2>/dev/null`);
          updated++;
        } catch {}
      }
    }

    return { success: updated > 0, updated, total: totalCores, frequencyKhz: freq };
  }

  // ── Power Profiles ───────────────────────────────────────

  async getPowerProfiles() {
    // Check if power-profiles-daemon is available
    let profilesAvailable = false;
    let current = null;
    let available = [];

    try {
      const { stdout } = await execAsync('powerprofilesctl list 2>/dev/null || echo ""');
      if (stdout.trim()) {
        profilesAvailable = true;
        const lines = stdout.split('\n');
        for (const line of lines) {
          if (line.includes('*')) current = line.replace('*', '').trim().split(':')[0].trim();
          if (line.includes(':')) {
            const name = line.replace('*', '').trim().split(':')[0].trim();
            if (name && !available.includes(name)) available.push(name);
          }
        }
      }
    } catch {}

    // Fallback: detect via sysfs
    if (!profilesAvailable) {
      try {
        const { stdout } = await execAsync('cat /sys/firmware/acpi/platform_profile 2>/dev/null');
        current = stdout.trim();
        available = ['low-power', 'balanced', 'performance'];
        profilesAvailable = true;
      } catch {}
    }

    return {
      available: profilesAvailable,
      current,
      profiles: available,
    };
  }

  async setPowerProfile(profile) {
    const valid = ['performance', 'balanced', 'power-saver', 'low-power'];
    if (!valid.includes(profile)) throw new Error(`Invalid profile "${profile}".`);

    try {
      await execAsync(`powerprofilesctl set ${profile} 2>/dev/null || echo "${profile}" | sudo tee /sys/firmware/acpi/platform_profile 2>/dev/null`);
      return { success: true, profile };
    } catch (err) {
      throw new Error('Failed to set power profile: ' + err.message);
    }
  }

  // ── Suspend / Hibernate ───────────────────────────────────

  async suspend() {
    try {
      await execAsync('sudo systemctl suspend 2>/dev/null');
      return { success: true, action: 'suspend' };
    } catch (err) {
      throw new Error('Suspend failed: ' + err.message);
    }
  }

  async hibernate() {
    try {
      await execAsync('sudo systemctl hibernate 2>/dev/null');
      return { success: true, action: 'hibernate' };
    } catch (err) {
      throw new Error('Hibernate failed: ' + err.message);
    }
  }

  async hybridSleep() {
    try {
      await execAsync('sudo systemctl hybrid-sleep 2>/dev/null');
      return { success: true, action: 'hybrid-sleep' };
    } catch (err) {
      throw new Error('Hybrid sleep failed: ' + err.message);
    }
  }

  // ── Thermal Monitoring ───────────────────────────────────

  async getThermalInfo() {
    const zones = [];
    let thermalDir = '/sys/class/thermal';

    try {
      await fs.access(thermalDir);
      const entries = await fs.readdir(thermalDir);

      for (const entry of entries) {
        if (!entry.startsWith('thermal_zone')) continue;
        const zonePath = path.join(thermalDir, entry);
        try {
          const type = (await fs.readFile(path.join(zonePath, 'type'), 'utf8')).trim();
          const temp = parseInt((await fs.readFile(path.join(zonePath, 'temp'), 'utf8')).trim()) / 1000;
          const mode = (await fs.readFile(path.join(zonePath, 'mode'), 'utf8')).trim();
          const policy = (await fs.readFile(path.join(zonePath, 'policy'), 'utf8')).trim();

          zones.push({
            zone: entry,
            type,
            tempCelsius: temp,
            mode,
            policy,
          });
        } catch {}
      }
    } catch {}

    // Also try to get CPU temperature via sensors
    let cpuTemp = null;
    try {
      const { stdout } = await execAsync('sensors -u 2>/dev/null | grep -i "temp" | head -5');
      const lines = stdout.split('\n');
      for (const line of lines) {
        const match = line.match(/(\d+\.\d+)/);
        if (match) { cpuTemp = parseFloat(match[1]); break; }
      }
    } catch {}

    return {
      zones,
      cpuTemp,
      criticalZones: zones.filter(z => z.tempCelsius > 85),
      maxTemp: Math.max(...zones.map(z => z.tempCelsius), 0),
    };
  }

  // ── Fan Control ──────────────────────────────────────────

  async getFanInfo() {
    let pwmControls = [];
    try {
      const hwmonDir = '/sys/class/hwmon';
      await fs.access(hwmonDir);
      const devices = await fs.readdir(hwmonDir);

      for (const device of devices) {
        const devPath = path.join(hwmonDir, device);
        try {
          const name = (await fs.readFile(path.join(devPath, 'name'), 'utf8')).trim();
          const entries = await fs.readdir(devPath);

          for (const entry of entries) {
            if (entry.startsWith('fan') && entry.endsWith('_input')) {
              const idx = entry.match(/\d+/);
              if (!idx) continue;
              const fanNum = idx[0];
              const rpm = parseInt((await fs.readFile(path.join(devPath, entry), 'utf8')).trim());
              pwmControls.push({
                device: name,
                fan: fanNum,
                rpm,
                label: `Fan ${fanNum} on ${name}`,
              });
            }
          }
        } catch {}
      }
    } catch {}

    // Also try sensors for fan info
    try {
      const { stdout } = await execAsync('sensors 2>/dev/null | grep -i "fan" | head -5');
      const lines = stdout.split('\n');
      for (const line of lines) {
        const match = line.match(/Fan\s+(\d+):\s+(\d+)/i);
        if (match) {
          pwmControls.push({
            device: 'sensors',
            fan: match[1],
            rpm: parseInt(match[2]),
            label: match[0].trim(),
          });
        }
      }
    } catch {}

    return pwmControls;
  }

  async setFanSpeed(device, fanIndex, pwmValue) {
    const pwm = parseInt(pwmValue);
    if (isNaN(pwm) || pwm < 0 || pwm > 255) throw new Error('PWM value must be 0-255');

    const fan = parseInt(fanIndex);
    if (isNaN(fan) || fan < 0 || fan > 255) throw new Error('Invalid fan index');

    // [SECURITY] Validate device name — only alphanumeric, hyphens, underscores
    // Prevents directory traversal outside /sys/class/hwmon/
    if (!device || !/^[a-zA-Z0-9_-]+$/.test(device)) {
      throw new Error('Invalid device name');
    }

    // Try to find the hwmon device
    try {
      const hwmonDir = '/sys/class/hwmon';
      const devices = await fs.readdir(hwmonDir);
      for (const dev of devices) {
        // [SECURITY] Validate hwmon directory entry before using
        if (!/^hwmon\d+$/.test(dev)) continue;
        try {
          const name = (await fs.readFile(path.join(hwmonDir, dev, 'name'), 'utf8')).trim();
          if (name === device) {
            const pwmPath = path.join(hwmonDir, dev, `pwm${fan}`);
            try {
              await fs.access(pwmPath);
              await fs.writeFile(path.join(hwmonDir, dev, `pwm${fan}_enable`), '1', 'utf8');
              await fs.writeFile(pwmPath, String(pwm), 'utf8');
              return { success: true, device, fan, pwm };
            } catch {
              // Try with sudo
              await execAsync(`echo "${pwm}" | sudo tee ${pwmPath} 2>/dev/null`);
              return { success: true, device, fan, pwm };
            }
          }
        } catch {}
      }
    } catch {}
    throw new Error('Could not find fan control for device: ' + device);
  }

  // ── Power Statistics ─────────────────────────────────────

  async getPowerStats() {
    const stats = {};

    try {
      // Battery info
      const { stdout: batOut } = await execAsync('cat /sys/class/power_supply/BAT0/uevent 2>/dev/null | head -10');
      if (batOut.trim()) {
        const lines = batOut.split('\n');
        for (const line of lines) {
          const [key, ...vals] = line.split('=');
          if (key && vals.length) stats[key.replace('POWER_SUPPLY_', '')] = vals.join('=');
        }
      }
    } catch {}

    try {
      // ACPI info
      const { stdout: acpiOut } = await execAsync('acpi -V 2>/dev/null | head -5');
      if (acpiOut.trim()) stats.acpi = acpiOut.trim();
    } catch {}

    return stats;
  }
}

export default new PowerService();
