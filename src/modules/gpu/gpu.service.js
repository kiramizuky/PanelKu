import { exec, execFile } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

class GpuService {
  constructor() {
    this.nvidiaSmiPath = null;
  }

  // ── Detection ────────────────────────────────────────────

  async _findNvidiaSmi() {
    if (this.nvidiaSmiPath) return this.nvidiaSmiPath;
    const candidates = ['nvidia-smi', '/usr/bin/nvidia-smi', '/usr/local/bin/nvidia-smi'];
    for (const cmd of candidates) {
      try {
        const { stdout } = await execAsync(`command -v ${cmd} 2>/dev/null || which ${cmd} 2>/dev/null || echo ""`);
        if (stdout.trim()) {
          this.nvidiaSmiPath = cmd;
          return cmd;
        }
      } catch {}
    }
    return null;
  }

  async isNvidiaAvailable() {
    const smi = await this._findNvidiaSmi();
    if (!smi) return false;
    try {
      await execAsync(`${smi} --query-gpu=count --format=csv,noheader,nounits 2>/dev/null`);
      return true;
    } catch { return false; }
  }

  async getGpuCount() {
    const smi = await this._findNvidiaSmi();
    if (!smi) return 0;
    try {
      const { stdout } = await execAsync(`${smi} --query-gpu=count --format=csv,noheader,nounits 2>/dev/null`);
      return parseInt(stdout.trim()) || 0;
    } catch { return 0; }
  }

  // ── Full GPU Info ────────────────────────────────────────

  async getGpuInfo() {
    const smi = await this._findNvidiaSmi();
    const available = !!smi;
    let gpus = [];
    let cudaVersion = null;
    let driverVersion = null;

    if (available) {
      try {
        // Get GPU list with all metrics
        const { stdout: gpuJson } = await execAsync(
          `${smi} --query-gpu=index,name,uuid,utilization.gpu,utilization.memory,memory.total,memory.used,memory.free,temperature.gpu,fan.speed,power.draw,power.limit,pcie.link.gen.current,pcie.link.width.current,clocks.current.graphics,clocks.current.memory,clocks.current.sm --format=csv,noheader,nounits 2>/dev/null`
        );
        const lines = gpuJson.trim().split('\n').filter(l => l.trim());
        gpus = lines.map(line => {
          const parts = line.split(',').map(p => p.trim());
          return {
            index: parseInt(parts[0]) || 0,
            name: parts[1] || 'Unknown',
            uuid: parts[2] || '',
            gpuUtil: parseFloat(parts[3]) || 0,
            memUtil: parseFloat(parts[4]) || 0,
            memTotal: parseFloat(parts[5]) || 0,
            memUsed: parseFloat(parts[6]) || 0,
            memFree: parseFloat(parts[7]) || 0,
            temperature: parseFloat(parts[8]) || 0,
            fanSpeed: parseFloat(parts[9]) || 0,
            powerDraw: parseFloat(parts[10]) || 0,
            powerLimit: parseFloat(parts[11]) || 0,
            pcieGen: parseInt(parts[12]) || 0,
            pcieWidth: parseInt(parts[13]) || 0,
            clockGraphics: parseInt(parts[14]) || 0,
            clockMemory: parseInt(parts[15]) || 0,
            clockSm: parseInt(parts[16]) || 0,
          };
        });

        // Get CUDA & Driver version
        const { stdout: verOut } = await execAsync(`${smi} --query-gpu=driver_version --format=csv,noheader,nounits 2>/dev/null | head -1`);
        driverVersion = verOut.trim() || null;

        try {
          const { stdout: nvccOut } = await execAsync('nvcc --version 2>/dev/null | grep "release" | awk \'{print $6}\' | cut -d, -f1');
          cudaVersion = nvccOut.trim() || null;
        } catch {
          try {
            const { stdout: cudaFile } = await execAsync('cat /usr/local/cuda/version.txt 2>/dev/null || cat /usr/local/cuda/version.json 2>/dev/null || echo ""');
            const match = cudaFile.match(/(\d+\.\d+)/);
            cudaVersion = match ? match[1] : null;
          } catch { cudaVersion = null; }
        }
      } catch (e) {
        gpus = [];
      }
    }

    // Check for CUDA Toolkit
    let cudaToolkit = false;
    try {
      await execAsync('test -f /usr/local/cuda/bin/nvcc 2>/dev/null && echo "yes"');
      cudaToolkit = true;
    } catch { cudaToolkit = false; }

    // Check cuDNN
    let cudnnVersion = null;
    try {
      const { stdout } = await execAsync('cat /usr/local/cuda/include/cudnn_version.h 2>/dev/null | grep CUDNN_MAJOR -A 2 | head -3');
      const major = stdout.match(/#define CUDNN_MAJOR\s+(\d+)/);
      const minor = stdout.match(/#define CUDNN_MINOR\s+(\d+)/);
      const patch = stdout.match(/#define CUDNN_PATCHLEVEL\s+(\d+)/);
      if (major && minor && patch) cudnnVersion = `${major[1]}.${minor[1]}.${patch[1]}`;
    } catch {}

    return {
      available,
      count: gpus.length,
      driverVersion,
      cudaVersion,
      cudaToolkit,
      cudnnVersion,
      gpus,
    };
  }

  // ── GPU Processes ────────────────────────────────────────

  async getGpuProcesses(gpuIndex = null) {
    const smi = await this._findNvidiaSmi();
    if (!smi) return [];

    try {
      const query = gpuIndex !== null ? `--id=${parseInt(gpuIndex)}` : '';
      const { stdout } = await execAsync(
        `${smi} ${query} --query-compute-apps=pid,process_name,used_memory,gpu_bus_id --format=csv,noheader,nounits 2>/dev/null`
      );
      const lines = stdout.trim().split('\n').filter(l => l.trim());
      return lines.map(line => {
        const parts = line.split(',').map(p => p.trim());
        return {
          pid: parseInt(parts[0]) || 0,
          name: parts[1] || 'Unknown',
          usedMemory: parseFloat(parts[2]) || 0,
          busId: parts[3] || '',
        };
      });
    } catch { return []; }
  }

  // ── Kill GPU Process ─────────────────────────────────────

  /**
   * Kill a process by PID using SIGTERM first, then SIGKILL after timeout.
   * PID is validated as an integer to prevent shell injection.
   */
  async killProcess(pid) {
    const numericPid = parseInt(pid);
    if (!numericPid || numericPid < 1 || numericPid > 999999) {
      throw new Error('Invalid PID');
    }

    try {
      // Try SIGTERM first
      await execFile('kill', ['-15', String(numericPid)], { timeout: 5000 });
      // Wait briefly to see if it dies
      await new Promise(r => setTimeout(r, 2000));
      // If still alive, SIGKILL
      try {
        await execFile('kill', ['-0', String(numericPid)], { timeout: 3000 });
        await execFile('kill', ['-9', String(numericPid)], { timeout: 5000 });
        return { killed: true, method: 'SIGKILL' };
      } catch {
        return { killed: true, method: 'SIGTERM' };
      }
    } catch (err) {
      throw new Error('Failed to kill process: ' + err.message);
    }
  }

  // ── Reset GPU ────────────────────────────────────────────

  async resetGpu(gpuIndex) {
    const smi = await this._findNvidiaSmi();
    if (!smi) throw new Error('NVIDIA GPU not available');
    const idx = parseInt(gpuIndex);
    if (isNaN(idx)) throw new Error('Invalid GPU index');

    try {
      const { stdout } = await execAsync(`${smi} --id=${idx} -r 2>&1`);
      return { success: true, output: stdout.trim() };
    } catch (err) {
      throw new Error('GPU reset failed (requires sudo): ' + err.message);
    }
  }

  // ── Set GPU Clock / Power Limit ──────────────────────────

  async setPowerLimit(gpuIndex, watts) {
    const smi = await this._findNvidiaSmi();
    if (!smi) throw new Error('NVIDIA GPU not available');
    const idx = parseInt(gpuIndex);
    const power = parseInt(watts);
    if (isNaN(idx) || isNaN(power) || power < 10 || power > 1000) throw new Error('Invalid GPU index or power limit');

    try {
      await execAsync(`${smi} --id=${idx} --power-limit=${power} 2>&1`);
      return { success: true, powerLimit: power };
    } catch (err) {
      throw new Error('Failed to set power limit: ' + err.message);
    }
  }
}

export default new GpuService();
