import { exec } from 'child_process';
import { promisify } from 'util';

// ─────────────────────────────────────────────
// Response helpers
// ─────────────────────────────────────────────
function successResponse(res, data = null, message = 'OK', statusCode = 200) {
  return res.status(statusCode).json({ success: true, message, data });
}
function errorResponse(res, message = 'Error', statusCode = 500) {
  return res.status(statusCode).json({ success: false, message });
}

const execAsync = promisify(exec);

async function run(cmd) {
  const { stdout } = await execAsync(cmd, { timeout: 30000 });
  return stdout.trim();
}

// ─────────────────────────────────────────────
// Parsers & Helpers
// ─────────────────────────────────────────────
function parseG(s) { return parseFloat((s || '0').replace(/,/g, '.').replace(/[^0-9.]/g, '')) || 0; }

function parseSizeToG(s) {
  if (!s) return 0;
  const str = s.toString().trim().replace(/,/g, '.');
  const num = parseFloat(str.replace(/[^0-9.]/g, '')) || 0;
  if (/t/i.test(str)) return num * 1024;
  if (/m/i.test(str)) return num / 1024;
  if (/k/i.test(str)) return num / (1024 * 1024);
  if (/b/i.test(str)) return num / (1024 * 1024 * 1024);
  return num;
}


function findMountpoint(lvPath, vgName, lvName, mountMap) {
  if (!lvPath) return '';
  if (mountMap.has(lvPath)) return mountMap.get(lvPath);

  // Try mapper format: /dev/mapper/vg--name-lv--name
  const escapedVg = vgName.replace(/-/g, '--');
  const escapedLv = lvName.replace(/-/g, '--');
  const mapperPath = `/dev/mapper/${escapedVg}-${escapedLv}`;
  if (mountMap.has(mapperPath)) return mountMap.get(mapperPath);

  // Fallback: search key containing both VG and LV names
  for (const [source, target] of mountMap.entries()) {
    if (source.includes(vgName) && source.includes(lvName)) {
      return target;
    }
  }
  return '';
}

function parsePvs(raw) {
  return raw.split('\n').filter(line => line.includes('|')).map(line => {
    const p = line.trim().split('|').map(s => s.trim());
    return { name: p[0]||'', vg: p[1]||'(none)', fmt: p[2]||'lvm2', size: p[3]||'0g', free: p[4]||'0g', attr: p[5]||'' };
  });
}

function parseVgs(raw) {
  return raw.split('\n').filter(line => line.includes('|')).map(line => {
    const p = line.trim().split('|').map(s => s.trim());
    return { name: p[0]||'', pvCount: parseInt(p[1])||0, lvCount: parseInt(p[2])||0, attr: p[3]||'', size: p[4]||'0g', free: p[5]||'0g' };
  });
}

function parseLvs(raw) {
  return raw.split('\n').filter(line => line.includes('|')).map(line => {
    const p = line.trim().split('|').map(s => s.trim());
    return { name: p[0]||'', vg: p[1]||'', attr: p[2]||'', size: p[3]||'0g', origin: p[4]||'', mountpoint: p[5]||'' };
  });
}

// ─────────────────────────────────────────────
// Ensure LVM2 and disk dependencies are installed
// ─────────────────────────────────────────────
async function ensureLvmInstalled() {
  if (process.platform !== 'linux') return true;
  try {
    await run('which lvm || which pvs || which pvcreate');
    return true;
  } catch (_) {
    let installCmd = '';
    if (await run('which apt-get').catch(() => '')) {
      installCmd = 'DEBIAN_FRONTEND=noninteractive apt-get update -y && DEBIAN_FRONTEND=noninteractive apt-get install -y lvm2 smartmontools e2fsprogs xfsprogs 2>&1';
    } else if (await run('which dnf').catch(() => '')) {
      installCmd = 'dnf install -y lvm2 smartmontools e2fsprogs xfsprogs 2>&1';
    } else if (await run('which yum').catch(() => '')) {
      installCmd = 'yum install -y lvm2 smartmontools e2fsprogs xfsprogs 2>&1';
    } else if (await run('which pacman').catch(() => '')) {
      installCmd = 'pacman -S --noconfirm lvm2 smartmontools e2fsprogs xfsprogs 2>&1';
    } else {
      throw new Error('Permintaan gagal: paket "lvm2" (pvcreate) belum terinstal di server dan package manager tidak ditemukan. Silakan jalankan "sudo apt install lvm2" secara manual.');
    }

    try {
      await run(installCmd);
      return true;
    } catch (err) {
      throw new Error(`Permintaan gagal: Perintah "pvcreate" / "lvm2" belum terpasang dan instalasi otomatis gagal: ${err.message}. Silakan jalankan "sudo apt install lvm2 smartmontools" pada server.`);
    }
  }
}

// ─────────────────────────────────────────────
// Gather full LVM + health data
// ─────────────────────────────────────────────
async function getLvmData() {
  const isLinux = process.platform === 'linux';
  let lvmAvailable = false;

  if (isLinux) {
    try {
      await run('which lvm || which pvs');
      lvmAvailable = true;
    } catch (_) {
      try {
        await ensureLvmInstalled();
        lvmAvailable = true;
      } catch (_) {
        lvmAvailable = false;
      }
    }
  }

  if (!lvmAvailable) {
    // Rich mock data for dev/non-Linux
    return {
      available: false,
      pvs: [
        { name: '/dev/sda', vg: 'vg-data', fmt: 'lvm2', size: '500.00g', free: '100.00g', attr: 'a--' },
        { name: '/dev/sdb', vg: 'vg-data', fmt: 'lvm2', size: '1000.00g', free: '400.00g', attr: 'a--' }
      ],
      vgs: [
        { name: 'vg-data', pvCount: 2, lvCount: 3, attr: 'wz--n-', size: '1460.00g', free: '500.00g' }
      ],
      lvs: [
        { name: 'lv-root', vg: 'vg-data', attr: '-wi-ao----', size: '200.00g', origin: '', mountpoint: '/' },
        { name: 'lv-docker', vg: 'vg-data', attr: '-wi-ao----', size: '300.00g', origin: '', mountpoint: '/var/lib/docker' },
        { name: 'lv-backup', vg: 'vg-data', attr: '-wi-ao----', size: '460.00g', origin: '', mountpoint: '/backup' },
        { name: 'lv-root-snap', vg: 'vg-data', attr: 'swi-a-s---', size: '10.00g', origin: 'lv-root', mountpoint: '' }
      ],
      blockDevices: [
        { name: 'sda', size: '500G', type: 'disk', fstype: '', mountpoint: '', used: true, smart: 'PASSED', temp: 38, readMB: 12400, writeMB: 8200, model: 'Samsung 870 EVO' },
        { name: 'sdb', size: '1T', type: 'disk', fstype: '', mountpoint: '', used: true, smart: 'PASSED', temp: 41, readMB: 98000, writeMB: 54000, model: 'WD Blue 1TB' },
        { name: 'sdc', size: '2T', type: 'disk', fstype: '', mountpoint: '', used: false, smart: 'PASSED', temp: 35, readMB: 100, writeMB: 50, model: 'Seagate Barracuda 2TB' }
      ],
      dfStats: [
        { mount: '/', size: '196G', used: '87G', avail: '109G', pct: 44 },
        { mount: '/var/lib/docker', size: '295G', used: '210G', avail: '85G', pct: 71 },
        { mount: '/backup', size: '453G', used: '30G', avail: '423G', pct: 7 }
      ]
    };
  }

  const [pvsRaw, vgsRaw, lvsRaw, lsblkRaw, dfRaw, mountsRaw] = await Promise.all([
    run('pvs --noheadings --units g --separator "|" -o pv_name,vg_name,pv_fmt,pv_size,pv_free,pv_attr 2>/dev/null').catch(() => ''),
    run('vgs --noheadings --units g --separator "|" -o vg_name,pv_count,lv_count,vg_attr,vg_size,vg_free 2>/dev/null').catch(() => ''),
    run('lvs --noheadings --units g --separator "|" -o lv_name,vg_name,lv_attr,lv_size,origin,lv_path 2>/dev/null').catch(() => ''),
    run('lsblk -J -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT,MODEL 2>/dev/null').catch(() => '{"blockdevices":[]}'),
    run('df -BG --output=target,size,used,avail,pcent 2>/dev/null | tail -n +2').catch(() => ''),
    run('findmnt -l -o SOURCE,TARGET 2>/dev/null || cat /proc/mounts | awk \'{print $1, $2}\'').catch(() => '')
  ]);

  const pvs = parsePvs(pvsRaw);
  const vgs = parseVgs(vgsRaw);
  const lvs = parseLvs(lvsRaw);

  const mountMap = new Map();
  if (mountsRaw) {
    mountsRaw.split('\n').forEach(line => {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2) {
        mountMap.set(parts[0], parts[1]);
      }
    });
  }

  lvs.forEach(lv => {
    const lvPath = lv.mountpoint;
    lv.mountpoint = findMountpoint(lvPath, lv.vg, lv.name, mountMap);
  });

  // Parse df output
  const dfStats = dfRaw.split('\n').filter(Boolean).map(line => {
    const p = line.trim().split(/\s+/);
    return { mount: p[0]||'', size: p[1]||'', used: p[2]||'', avail: p[3]||'', pct: parseInt((p[4]||'0').replace('%',''))||0 };
  }).filter(d => d.mount && d.mount !== 'tmpfs');

  // Parse lsblk + get SMART + temp per disk
  let blockDevices = [];
  try {
    const flattenDevices = (devices) => {
      let list = [];
      for (const d of devices) {
        list.push(d);
        if (d.children) {
          list = list.concat(flattenDevices(d.children));
        }
      }
      return list;
    };

    const lsblkData = JSON.parse(lsblkRaw);
    const pvNames = pvs.map(p => p.name);
    const allFlat = flattenDevices(lsblkData.blockdevices || []);
    // Filter physical disks (type === 'disk'), exclude child partitions to prevent duplicate device counts
    const rawDisks = allFlat.filter(d => d.type === 'disk');
    const disks = rawDisks.length > 0 ? rawDisks : allFlat.filter(d => d.type === 'disk' || d.type === 'part');

    const getMountpoints = (device) => {
      let mounts = [];
      if (device.mountpoint) mounts.push(device.mountpoint);
      if (device.children && Array.isArray(device.children)) {
        for (const child of device.children) {
          mounts = mounts.concat(getMountpoints(child));
        }
      }
      return mounts;
    };

    blockDevices = await Promise.all(disks.map(async d => {
      const used = pvNames.some(pv => {
        const pvClean = pv.replace('/dev/', '');
        return pvClean === d.name || pvClean.startsWith(d.name) || pv.includes(d.name);
      });

      const mounts = getMountpoints(d);
      const isSystem = mounts.some(m => m === '/' || m.startsWith('/boot') || m.startsWith('/etc'));
      const isMounted = mounts.length > 0;

      let smart = 'N/A', temp = null, readMB = 0, writeMB = 0;

      // SMART health
      try {
        const smartOut = await run(`smartctl -H /dev/${d.name} 2>/dev/null | grep -i 'overall-health\\|result'`);
        smart = smartOut.toLowerCase().includes('passed') ? 'PASSED' : 'FAILED';
      } catch (_) {}

      // Disk temperature via smartctl
      try {
        const tempOut = await run(`smartctl -A /dev/${d.name} 2>/dev/null | grep -i 'temperature\\|Temp' | head -1 | awk '{print $10}'`);
        const t = parseInt(tempOut);
        if (!isNaN(t) && t > 0 && t < 100) temp = t;
      } catch (_) {}

      // I/O stats from /proc/diskstats (sectors read/written, 1 sector = 512 bytes)
      try {
        const stats = await run(`grep -w '${d.name}' /proc/diskstats 2>/dev/null | awk '{print $6, $10}'`);
        if (stats) {
          const [r, w] = stats.split(' ').map(Number);
          readMB = Math.round((r * 512) / 1024 / 1024);
          writeMB = Math.round((w * 512) / 1024 / 1024);
        }
      } catch (_) {}

      return {
        name: d.name,
        size: d.size,
        type: d.type,
        fstype: d.fstype || '',
        mountpoint: d.mountpoint || '',
        mounts,
        isSystem,
        isMounted,
        model: (d.model || '').trim(),
        used,
        smart,
        temp,
        readMB,
        writeMB
      };
    }));
  } catch (_) {}

  return { available: true, pvs, vgs, lvs, blockDevices, dfStats };
}

// ─────────────────────────────────────────────
// HTML helpers
// ─────────────────────────────────────────────
function usageBar(sizeStr, freeStr, height = 8) {
  const total = parseG(sizeStr);
  const free = parseG(freeStr);
  if (total === 0) return '<span style="color:var(--text-muted);font-size:11px;">N/A</span>';
  const used = total - free;
  const pct = Math.min(100, Math.round((used / total) * 100));
  const color = pct > 85 ? '#ef4444' : pct > 65 ? '#f59e0b' : '#10b981';
  return `
    <div style="min-width:100px;">
      <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-muted);margin-bottom:3px;">
        <span>${used.toFixed(0)}G / ${total.toFixed(0)}G</span><span style="color:${color};font-weight:600;">${pct}%</span>
      </div>
      <div style="background:rgba(255,255,255,0.08);border-radius:99px;height:${height}px;overflow:hidden;">
        <div style="width:${pct}%;height:100%;background:${color};border-radius:99px;transition:width 0.6s ease;"></div>
      </div>
    </div>`;
}

function smartBadge(status) {
  if (status === 'PASSED') return '<span style="background:rgba(16,185,129,0.15);color:#10b981;border:1px solid rgba(16,185,129,0.3);font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;"><i class="bi bi-check-circle-fill me-1"></i>PASSED</span>';
  if (status === 'FAILED') return '<span style="background:rgba(239,68,68,0.15);color:#ef4444;border:1px solid rgba(239,68,68,0.3);font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;"><i class="bi bi-x-circle-fill me-1"></i>FAILED</span>';
  return '<span style="background:rgba(255,255,255,0.06);color:var(--text-muted);font-size:10px;padding:2px 8px;border-radius:99px;">N/A</span>';
}

function tempBadge(temp) {
  if (temp === null) return '<span style="color:var(--text-muted);font-size:12px;">—</span>';
  const color = temp > 55 ? '#ef4444' : temp > 45 ? '#f59e0b' : '#10b981';
  const icon = temp > 55 ? 'bi-thermometer-high' : temp > 45 ? 'bi-thermometer-half' : 'bi-thermometer-low';
  return `<span style="color:${color};font-size:12px;font-weight:600;"><i class="bi ${icon} me-1"></i>${temp}°C</span>`;
}

function formatBytes(mb) {
  if (mb >= 1024 * 1024) return (mb / 1024 / 1024).toFixed(1) + ' TB';
  if (mb >= 1024) return (mb / 1024).toFixed(1) + ' GB';
  return mb + ' MB';
}

// ─────────────────────────────────────────────
// Plugin registration
// ─────────────────────────────────────────────
export default {
  register(app, io) {

    // ── GET /plugins/lvm-manager ──────────────────────────
    app.get('/plugins/lvm-manager', async (req, res) => {
      try {
        const data = await getLvmData();
        const parseG = s => parseFloat((s||'0').replace(/,/g, '.').replace(/[^0-9.]/g,''))||0;

        // ── Summary stats
        const lvmTotalG     = data.pvs.reduce((a, p) => a + parseSizeToG(p.size), 0);
        const lvmFreeG      = data.pvs.reduce((a, p) => a + parseSizeToG(p.free), 0);
        const lvmUsedG      = lvmTotalG - lvmFreeG;

        const physicalTotalG    = data.blockDevices.reduce((a, d) => a + parseSizeToG(d.size), 0);
        const unallocatedDisksG = data.blockDevices.filter(d => !d.used).reduce((a, d) => a + parseSizeToG(d.size), 0);

        const totalStorageG = physicalTotalG > 0 ? physicalTotalG : lvmTotalG;
        const usedStorageG  = lvmUsedG;
        const freeStorageG  = totalStorageG - usedStorageG;
        const overallPct    = totalStorageG > 0 ? Math.min(100, Math.round((usedStorageG / totalStorageG) * 100)) : 0;

        const lvCount       = data.lvs.filter(l => !l.attr.includes('s')).length;
        const snapCount     = data.lvs.filter(l => l.attr.includes('s')).length;
        const healthStatus  = data.blockDevices.some(d => d.smart === 'FAILED') ? 'DEGRADED' :
                              data.blockDevices.every(d => d.smart === 'PASSED') ? 'HEALTHY' : 'UNKNOWN';
        const healthColor   = healthStatus === 'HEALTHY' ? '#10b981' : healthStatus === 'DEGRADED' ? '#ef4444' : '#f59e0b';

        // ── Donut SVG helper
        const donut = (pct, color, size = 80) => {
          const r = size / 2 - 8;
          const circ = 2 * Math.PI * r;
          const dash = (pct / 100) * circ;
          const cx = size / 2, cy = size / 2;
          return `<svg width="${size}" height="${size}" style="transform:rotate(-90deg);">
            <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="8"/>
            <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="8" stroke-dasharray="${dash.toFixed(1)} ${circ.toFixed(1)}" stroke-linecap="round" style="transition:stroke-dasharray 0.8s ease;"/>
          </svg>`;
        };

        // ── Stat Cards
        const statCards = `
<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;margin-bottom:24px;">

  <!-- Total Capacity -->
  <div class="lp-glass-card p-3" style="display:flex;align-items:center;gap:16px;">
    <div style="position:relative;width:80px;height:80px;flex-shrink:0;">
      ${donut(overallPct, overallPct > 85 ? '#ef4444' : overallPct > 65 ? '#f59e0b' : '#10b981')}
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:${overallPct > 85 ? '#ef4444' : '#fff'};">${overallPct}%</div>
    </div>
    <div>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px;">Total Storage</div>
      <div style="font-size:18px;font-weight:800;">${totalStorageG >= 1024 ? (totalStorageG/1024).toFixed(1)+'T' : totalStorageG.toFixed(0)+'G'}</div>
      <div style="font-size:11px;color:var(--text-muted);">${usedStorageG.toFixed(0)}G LVM used ${unallocatedDisksG > 0 ? `· <span style="color:#f59e0b;">${unallocatedDisksG.toFixed(0)}G unallocated</span>` : `· ${freeStorageG.toFixed(0)}G free`}</div>
    </div>
  </div>

  <!-- Health Status -->
  <div class="lp-glass-card p-3" style="display:flex;align-items:center;gap:16px;border:1px solid ${healthColor}30;">
    <div style="width:56px;height:56px;border-radius:16px;background:${healthColor}18;display:flex;align-items:center;justify-content:center;font-size:28px;flex-shrink:0;">
      <i class="bi ${healthStatus==='HEALTHY'?'bi-shield-fill-check':healthStatus==='DEGRADED'?'bi-shield-fill-x':'bi-shield-fill-exclamation'}" style="color:${healthColor};"></i>
    </div>
    <div>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px;">Storage Health</div>
      <div style="font-size:17px;font-weight:800;color:${healthColor};">${healthStatus}</div>
      <div style="font-size:11px;color:var(--text-muted);">${data.blockDevices.length} disk${data.blockDevices.length!==1?'s':''} monitored</div>
    </div>
  </div>

  <!-- Volume Groups -->
  <div class="lp-glass-card p-3" style="display:flex;align-items:center;gap:16px;">
    <div style="width:56px;height:56px;border-radius:16px;background:rgba(167,139,250,0.1);display:flex;align-items:center;justify-content:center;font-size:28px;flex-shrink:0;">
      <i class="bi bi-folder2-open" style="color:#a78bfa;"></i>
    </div>
    <div>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px;">Volume Groups</div>
      <div style="font-size:17px;font-weight:800;">${data.vgs.length}</div>
      <div style="font-size:11px;color:var(--text-muted);">${data.pvs.length} PV · ${lvCount} LV · ${snapCount} snap</div>
    </div>
  </div>

  <!-- Disk Count -->
  <div class="lp-glass-card p-3" style="display:flex;align-items:center;gap:16px;">
    <div style="width:56px;height:56px;border-radius:16px;background:rgba(56,189,248,0.1);display:flex;align-items:center;justify-content:center;font-size:28px;flex-shrink:0;">
      <i class="bi bi-hdd-stack" style="color:#38bdf8;"></i>
    </div>
    <div>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px;">Physical Disks</div>
      <div style="font-size:17px;font-weight:800;">${data.blockDevices.length}</div>
      <div style="font-size:11px;color:var(--text-muted);">${data.blockDevices.filter(d=>d.used).length} in LVM · <span style="${data.blockDevices.some(d=>!d.used)?'color:#f59e0b;':''}">${data.blockDevices.filter(d=>!d.used).length} unallocated</span></div>
    </div>
  </div>

</div>`;

        // ── Disk Health Cards
        const diskHealthCards = data.blockDevices.map(d => {
          const totalReadGB = (d.readMB / 1024).toFixed(1);
          const totalWriteGB = (d.writeMB / 1024).toFixed(1);
          const tempC = d.temp !== null ? d.temp : null;
          const tempColor = tempC > 55 ? '#ef4444' : tempC > 45 ? '#f59e0b' : '#10b981';
          const tempPct = tempC ? Math.min(100, Math.round(((tempC - 20) / 60) * 100)) : 0;
          return `
  <div class="lp-glass-card p-4" style="border:1px solid ${d.smart==='FAILED'?'rgba(239,68,68,0.4)':d.smart==='PASSED'?'rgba(16,185,129,0.15)':'rgba(255,255,255,0.06)'};">
    <!-- Disk header -->
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
      <div style="width:44px;height:44px;border-radius:12px;background:rgba(56,189,248,0.1);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">
        <i class="bi bi-hdd-fill" style="color:#38bdf8;"></i>
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:14px;">/dev/${d.name}</div>
        <div style="font-size:11px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${d.model || 'Unknown Model'} · ${d.size}</div>
      </div>
      ${smartBadge(d.smart)}
    </div>

    <!-- Temperature bar -->
    ${tempC !== null ? `
    <div style="margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <span style="font-size:11px;color:var(--text-muted);">Temperature</span>
        ${tempBadge(tempC)}
      </div>
      <div style="background:rgba(255,255,255,0.08);border-radius:99px;height:6px;overflow:hidden;">
        <div style="width:${tempPct}%;height:100%;background:${tempColor};border-radius:99px;transition:width 0.6s;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--text-muted);margin-top:2px;"><span>20°C</span><span>80°C</span></div>
    </div>` : ''}

    <!-- I/O Stats -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;">
      <div style="background:rgba(0,0,0,0.2);border-radius:10px;padding:10px;text-align:center;">
        <div style="font-size:10px;color:var(--text-muted);margin-bottom:3px;"><i class="bi bi-arrow-down-circle me-1 text-success"></i>Total Read</div>
        <div style="font-size:14px;font-weight:700;color:#10b981;">${totalReadGB} GB</div>
      </div>
      <div style="background:rgba(0,0,0,0.2);border-radius:10px;padding:10px;text-align:center;">
        <div style="font-size:10px;color:var(--text-muted);margin-bottom:3px;"><i class="bi bi-arrow-up-circle me-1 text-warning"></i>Total Write</div>
        <div style="font-size:14px;font-weight:700;color:#f59e0b;">${totalWriteGB} GB</div>
      </div>
    </div>

    <!-- LVM status -->
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:11px;color:var(--text-muted);">Disk Usage</span>
      <span class="lp-badge ${d.used ? 'lp-badge-info' : d.isSystem ? 'lp-badge-warning' : d.isMounted ? 'lp-badge-warning' : 'lp-badge-success'}" style="font-size:10px;">
        <span class="lp-badge-dot"></span>${d.used ? 'In LVM' : d.isSystem ? 'System OS Disk' : d.isMounted ? `Mounted (${d.mounts.join(', ')})` : 'Unallocated'}
      </span>
    </div>
    ${!d.used && !d.isSystem && !d.isMounted ? `
    <button class="btn-lp btn-lp-primary w-100 mt-3" onclick="LvmPage.showInitDiskModal('/dev/${d.name}')" style="font-size:11px;padding:6px 0;">
      <i class="bi bi-plus-circle me-1"></i>Initialize for LVM
    </button>` : d.isSystem ? `
    <div class="mt-3 p-2 text-center" style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:8px;font-size:10px;color:#f59e0b;">
      <i class="bi bi-shield-lock-fill me-1"></i>Protected System OS Disk
    </div>` : ''}
  </div>`;
        }).join('');

        // ── VG Capacity Cards (per VG)
        const vgCapacityCards = data.vgs.map(vg => {
          const total = parseG(vg.size);
          const free = parseG(vg.free);
          const used = total - free;
          const pct = total > 0 ? Math.min(100, Math.round((used/total)*100)) : 0;
          const color = pct > 85 ? '#ef4444' : pct > 65 ? '#f59e0b' : '#10b981';
          const vgLvs = data.lvs.filter(lv => lv.vg === vg.name && !lv.attr.includes('s'));
          const r = 50, circ = 2*Math.PI*r, dash = (pct/100)*circ;
          return `
  <div class="lp-glass-card p-4">
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px;">
      <!-- SVG Donut -->
      <div style="position:relative;width:120px;height:120px;flex-shrink:0;">
        <svg width="120" height="120" style="transform:rotate(-90deg);">
          <circle cx="60" cy="60" r="${r}" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="12"/>
          <circle cx="60" cy="60" r="${r}" fill="none" stroke="${color}" stroke-width="12"
            stroke-dasharray="${dash.toFixed(1)} ${circ.toFixed(1)}" stroke-linecap="round"
            style="transition:stroke-dasharray 0.8s ease;"/>
        </svg>
        <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">
          <span style="font-size:22px;font-weight:900;color:${pct>85?'#ef4444':'#fff'};">${pct}%</span>
          <span style="font-size:9px;color:var(--text-muted);">used</span>
        </div>
      </div>
      <div style="flex:1;">
        <div style="font-size:11px;color:var(--text-muted);">Volume Group</div>
        <div style="font-size:18px;font-weight:800;color:#a78bfa;margin-bottom:4px;">${vg.name}</div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:2px;">
          <i class="bi bi-hdd me-1"></i>${vg.pvCount} PV &nbsp;
          <i class="bi bi-layers me-1"></i>${vg.lvCount} LV
        </div>
        <div style="font-size:13px;font-weight:600;">${used.toFixed(1)}G <span style="color:var(--text-muted);font-weight:400;">/ ${total.toFixed(1)}G</span></div>
        <div style="font-size:11px;color:#10b981;">${free.toFixed(1)}G free</div>
      </div>
    </div>

    <!-- LV breakdown within this VG -->
    ${vgLvs.length > 0 ? `
    <div style="border-top:1px solid var(--glass-border);padding-top:12px;">
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Logical Volumes</div>
      ${vgLvs.map(lv => {
        const lvPct = total > 0 ? Math.min(100, Math.round((parseG(lv.size)/total)*100)) : 0;
        const lvColor = ['#6366f1','#10b981','#f59e0b','#38bdf8','#a78bfa','#ec4899'][vgLvs.indexOf(lv) % 6];
        return `
        <div style="margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
            <span style="font-size:12px;font-weight:500;"><i class="bi bi-layers me-1" style="color:${lvColor};"></i>${lv.name}</span>
            <span style="font-size:11px;color:var(--text-muted);">${lv.size} <span style="color:${lvColor};">(${lvPct}%)</span></span>
          </div>
          <div style="background:rgba(255,255,255,0.06);border-radius:99px;height:5px;overflow:hidden;">
            <div style="width:${lvPct}%;height:100%;background:${lvColor};border-radius:99px;opacity:0.8;"></div>
          </div>
          ${lv.mountpoint ? `<div style="font-size:9px;color:var(--text-muted);margin-top:2px;"><i class="bi bi-link-45deg me-1"></i>${lv.mountpoint}</div>` : ''}
        </div>`;
      }).join('')}
    </div>` : ''}

    <!-- Actions -->
    <div style="display:flex;gap:8px;margin-top:14px;">
      <button class="btn-lp btn-lp-ghost btn-lp-sm" onclick="LvmPage.showExtendVgModal('${vg.name}')" style="font-size:11px;flex:1;">
        <i class="bi bi-plus-circle me-1"></i>Add Disk
      </button>
      <button class="btn-lp btn-lp-primary btn-lp-sm" onclick="LvmPage.showCreateLvModal('${vg.name}')" style="font-size:11px;flex:1;">
        <i class="bi bi-layers me-1"></i>New LV
      </button>
    </div>
  </div>`;
        }).join('');

        // ── Filesystem Usage (df) table
        const dfRows = (data.dfStats || []).slice(0, 15).map(d => {
          const pct = d.pct || 0;
          const color = pct > 85 ? '#ef4444' : pct > 65 ? '#f59e0b' : '#10b981';
          return `
          <tr>
            <td><code style="font-size:12px;color:#38bdf8;">${d.mount}</code></td>
            <td style="font-size:12px;">${d.size}</td>
            <td style="font-size:12px;">${d.used}</td>
            <td style="font-size:12px;color:#10b981;">${d.avail}</td>
            <td style="min-width:120px;">
              <div style="display:flex;align-items:center;gap:6px;">
                <div style="flex:1;background:rgba(255,255,255,0.08);border-radius:99px;height:6px;overflow:hidden;">
                  <div style="width:${pct}%;height:100%;background:${color};border-radius:99px;"></div>
                </div>
                <span style="font-size:10px;color:${color};font-weight:700;white-space:nowrap;">${pct}%</span>
              </div>
            </td>
          </tr>`;
        }).join('');

        // ── Storage Hierarchy Tree
        const treeHtml = data.vgs.map(vg => {
          const vgLvs = data.lvs.filter(lv => lv.vg === vg.name);
          const vgPvs = data.pvs.filter(pv => pv.vg === vg.name);
          return `
  <div class="lp-glass-card p-4 mb-3">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
      <i class="bi bi-folder2-open" style="color:#a78bfa;font-size:18px;"></i>
      <span style="font-size:14px;font-weight:700;color:#a78bfa;">${vg.name}</span>
      <span style="font-size:11px;color:var(--text-muted);">Volume Group · ${vg.size}</span>
    </div>

    <!-- PV branches -->
    <div style="margin-left:24px;margin-bottom:12px;">
      <div style="font-size:11px;color:var(--text-muted);font-weight:600;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">Physical Volumes</div>
      ${vgPvs.map(pv => `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:rgba(245,158,11,0.06);border-left:2px solid #f59e0b;border-radius:0 8px 8px 0;margin-bottom:4px;">
        <i class="bi bi-hdd" style="color:#f59e0b;font-size:13px;"></i>
        <span style="font-size:12px;font-weight:600;color:#f59e0b;">${pv.name}</span>
        <span style="font-size:11px;color:var(--text-muted);">${pv.size} · ${pv.free} free</span>
        <code style="margin-left:auto;font-size:9px;color:var(--text-muted);">${pv.attr}</code>
      </div>`).join('')}
    </div>

    <!-- LV branches -->
    <div style="margin-left:24px;">
      <div style="font-size:11px;color:var(--text-muted);font-weight:600;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">Logical Volumes</div>
      ${vgLvs.map((lv, i) => {
        const isSnap = lv.attr.includes('s');
        const colors = ['#6366f1','#10b981','#f59e0b','#38bdf8','#a78bfa','#ec4899'];
        const c = colors[i % colors.length];
        return `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:${isSnap?'rgba(245,158,11,0.05)':'rgba(99,102,241,0.06)'};border-left:2px solid ${isSnap?'#f59e0b':c};border-radius:0 8px 8px 0;margin-bottom:4px;flex-wrap:wrap;">
        <i class="bi ${isSnap?'bi-camera':'bi-layers'}" style="color:${isSnap?'#f59e0b':c};font-size:13px;"></i>
        <span style="font-size:12px;font-weight:600;color:${isSnap?'#f59e0b':c};">${lv.name}</span>
        ${isSnap?'<span style="font-size:9px;background:rgba(245,158,11,0.2);color:#f59e0b;border-radius:4px;padding:1px 5px;">SNAP</span>':''}
        <span style="font-size:11px;color:var(--text-muted);">${lv.size}</span>
        ${lv.origin?`<span style="font-size:10px;color:var(--text-muted);">← ${lv.origin}</span>`:''}
        ${lv.mountpoint?`<code style="font-size:10px;color:#38bdf8;margin-left:auto;"><i class="bi bi-link-45deg"></i>${lv.mountpoint}</code>`:''}
        <div style="display:flex;gap:4px;margin-left:${lv.mountpoint?'0':'auto'};">
          ${!isSnap?`
          <button class="btn-lp btn-lp-ghost" onclick="LvmPage.showExtendLvModal('${lv.name}','${lv.vg}')" style="font-size:9px;padding:2px 7px;">Extend</button>
          <button class="btn-lp btn-lp-ghost" onclick="LvmPage.showSnapshotModal('${lv.name}','${lv.vg}')" style="font-size:9px;padding:2px 7px;color:#f59e0b;">Snap</button>
          `:`
          <button class="btn-lp btn-lp-ghost" onclick="LvmPage.restoreSnapshot('${lv.name}','${lv.vg}')" style="font-size:9px;padding:2px 7px;color:#10b981;">Restore</button>
          `}
        </div>
      </div>`;
      }).join('')}
    </div>
  </div>`;
        }).join('');

        // ── Logical Volumes full table
        const lvRows = data.lvs.map(lv => {
          const isSnap = lv.attr.includes('s');
          return `
          <tr>
            <td>
              <div style="display:flex;align-items:center;gap:8px;">
                <i class="bi ${isSnap?'bi-camera text-warning':'bi-layers text-primary'}" style="font-size:14px;"></i>
                <div>
                  <div style="font-weight:600;font-size:13px;">${lv.name}</div>
                  ${isSnap?`<span style="font-size:9px;color:#f59e0b;">SNAPSHOT of ${lv.origin}</span>`:''}
                </div>
              </div>
            </td>
            <td><span style="color:#a78bfa;font-size:12px;">${lv.vg}</span></td>
            <td><span style="font-size:12px;font-weight:600;">${lv.size}</span></td>
            <td><code style="font-size:10px;color:var(--text-muted);">${lv.mountpoint||'—'}</code></td>
            <td><code style="font-size:9px;color:var(--text-muted);">${lv.attr}</code></td>
            <td style="text-align:right;">
              <div style="display:flex;gap:5px;justify-content:flex-end;flex-wrap:wrap;">
                ${!isSnap?`
                  <button class="btn-lp btn-lp-ghost btn-lp-sm" onclick="LvmPage.showExtendLvModal('${lv.name}','${lv.vg}')" style="font-size:10px;padding:3px 8px;">
                    <i class="bi bi-arrows-expand"></i>
                  </button>
                  <button class="btn-lp btn-lp-ghost btn-lp-sm" onclick="LvmPage.showSnapshotModal('${lv.name}','${lv.vg}')" style="font-size:10px;padding:3px 8px;color:#f59e0b;">
                    <i class="bi bi-camera"></i>
                  </button>
                `:`
                  <button class="btn-lp btn-lp-ghost btn-lp-sm" onclick="LvmPage.restoreSnapshot('${lv.name}','${lv.vg}')" style="font-size:10px;padding:3px 8px;color:#10b981;">
                    <i class="bi bi-arrow-counterclockwise"></i>
                  </button>
                `}
              </div>
            </td>
          </tr>`;
        }).join('') || `<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted);">No Logical Volumes found</td></tr>`;

        const notAvailableBanner = !data.available ? `
          <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.3);border-radius:12px;padding:14px 18px;margin-bottom:20px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
            <i class="bi bi-exclamation-triangle-fill text-warning" style="font-size:20px;"></i>
            <div style="flex:1;">
              <strong style="color:#f59e0b;">LVM tools not detected</strong>
              <span style="color:var(--text-muted);font-size:13px;display:block;">Install with: <code>apt install lvm2</code> · Showing demo data.</span>
            </div>
            <button class="btn-lp btn-lp-primary btn-lp-sm" onclick="LvmPage.installLvm()" style="font-size:11px;">
              <i class="bi bi-download me-1"></i>Install LVM2
            </button>
          </div>` : '';

        res.render('layout', {
          title: 'LVM Manager',
          layout: false,
          body: `
<!-- ═══════════════════════════════════════════════ LVM MANAGER ═══ -->
<div class="lp-page-header" style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:20px;flex-wrap:wrap;gap:10px;">
  <div>
    <h1 class="lp-page-title" style="font-size:24px;font-weight:700;margin:0;"><i class="bi bi-hdd-stack-fill text-warning me-2"></i>LVM Manager</h1>
    <p class="lp-page-subtitle" style="color:var(--text-muted);margin:0;">Storage health, capacity, and volume management</p>
  </div>
  <div style="display:flex;gap:8px;">
    <button class="btn-lp btn-lp-ghost btn-lp-sm" onclick="LvmPage.refresh()" id="refreshBtn">
      <i class="bi bi-arrow-clockwise me-1"></i>Refresh
    </button>
    <button class="btn-lp btn-lp-primary btn-lp-sm" onclick="LvmPage.showCreateLvModal()">
      <i class="bi bi-plus-lg me-1"></i>New LV
    </button>
  </div>
</div>

${notAvailableBanner}

<!-- ── Summary Stats ── -->
${statCards}

<!-- ── Tab Navigation ── -->
<ul class="nav" id="lvmTabs" style="border-bottom:1px solid var(--glass-border);margin-bottom:20px;gap:4px;">
  ${[
    ['overview',    'bi-grid-1x2', 'Overview'],
    ['disks',       'bi-hdd-fill', 'Disk Health'],
    ['capacity',    'bi-pie-chart-fill', 'Capacity'],
    ['volumes',     'bi-layers', 'Volumes'],
    ['filesystem',  'bi-file-earmark-binary', 'Filesystem'],
    ['tree',        'bi-diagram-3', 'Storage Map'],
  ].map(([id,icon,label], i) => `
    <li class="nav-item">
      <button class="btn-lp btn-lp-ghost lvm-tab-btn ${i===0?'lvm-tab-active':''}" onclick="LvmPage.switchTab('${id}')" data-tab="${id}" style="border-radius:8px 8px 0 0;font-size:13px;padding:8px 14px;border-bottom:2px solid ${i===0?'#f59e0b':'transparent'};">
        <i class="bi ${icon} me-1"></i>${label}
      </button>
    </li>`).join('')}
</ul>

<!-- ── Tab: Overview ── -->
<div id="tab-overview" class="lvm-tab">
  ${data.blockDevices.some(d => !d.used && !d.isSystem && !d.isMounted) ? `
  <div class="lp-glass-card p-3 mb-4" style="border:1px solid rgba(245,158,11,0.3);background:rgba(245,158,11,0.05);">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <div style="width:40px;height:40px;border-radius:10px;background:rgba(245,158,11,0.15);display:flex;align-items:center;justify-content:center;font-size:20px;">
          <i class="bi bi-hdd-network-fill text-warning"></i>
        </div>
        <div>
          <div style="font-weight:700;font-size:14px;color:#f59e0b;">Unallocated Storage Detected</div>
          <div style="font-size:12px;color:var(--text-muted);">
            ${data.blockDevices.filter(d => !d.used && !d.isSystem && !d.isMounted).map(d => `<code>/dev/${d.name}</code> (${d.size})`).join(', ')} — Not initialized in LVM
          </div>
        </div>
      </div>
      <button class="btn-lp btn-lp-primary btn-lp-sm" onclick="LvmPage.switchTab('disks')" style="background:#f59e0b;color:#000;border:none;">
        <i class="bi bi-lightning-fill me-1"></i>Manage Disks
      </button>
    </div>
  </div>` : ''}

  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;">
    ${vgCapacityCards || '<p style="color:var(--text-muted);">No volume groups found.</p>'}
  </div>
</div>

<!-- ── Tab: Disk Health ── -->
<div id="tab-disks" class="lvm-tab" style="display:none;">
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;">
    ${diskHealthCards || '<p style="color:var(--text-muted);">No block devices detected.</p>'}
  </div>
</div>

<!-- ── Tab: Capacity (VG detail) ── -->
<div id="tab-capacity" class="lvm-tab" style="display:none;">
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:14px;">
    ${vgCapacityCards || '<p style="color:var(--text-muted);">No volume groups found.</p>'}
  </div>
</div>

<!-- ── Tab: Volumes ── -->
<div id="tab-volumes" class="lvm-tab" style="display:none;">
  <div class="lp-glass-card p-0" style="display:flex;flex-direction:column;">
    <div style="padding:16px 20px;flex-shrink:0;display:flex;justify-content:space-between;align-items:center;">
      <h5 style="font-weight:700;font-size:14px;margin:0;"><i class="bi bi-layers me-2 text-primary"></i>All Logical Volumes</h5>
      <span style="font-size:11px;color:var(--text-muted);">${data.lvs.length} volumes</span>
    </div>
    <div style="overflow:auto;max-height:500px;flex:1;">
      <table class="lp-table" style="font-size:12px;">
        <thead style="position:sticky;top:0;z-index:1;background:rgba(15,20,30,0.95);backdrop-filter:blur(10px);">
          <tr>
            <th>Name</th><th>VG</th><th>Size</th><th>Mount</th><th>Attr</th><th style="text-align:right;">Actions</th>
          </tr>
        </thead>
        <tbody>${lvRows}</tbody>
      </table>
    </div>
  </div>
</div>

<!-- ── Tab: Filesystem ── -->
<div id="tab-filesystem" class="lvm-tab" style="display:none;">
  <div class="lp-glass-card p-0">
    <div style="padding:16px 20px;display:flex;justify-content:space-between;align-items:center;">
      <h5 style="font-weight:700;font-size:14px;margin:0;"><i class="bi bi-file-earmark-binary me-2 text-info"></i>Filesystem Usage</h5>
      <span style="font-size:11px;color:var(--text-muted);">via <code>df</code></span>
    </div>
    <div style="overflow:auto;max-height:480px;">
      <table class="lp-table" style="font-size:12px;">
        <thead style="position:sticky;top:0;z-index:1;background:rgba(15,20,30,0.95);backdrop-filter:blur(10px);">
          <tr><th>Mount Point</th><th>Total</th><th>Used</th><th>Available</th><th>Usage</th></tr>
        </thead>
        <tbody>
          ${dfRows || '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted);">No filesystem data</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>
</div>

<!-- ── Tab: Storage Map ── -->
<div id="tab-tree" class="lvm-tab" style="display:none;">
  <div style="max-height:600px;overflow-y:auto;">
    ${treeHtml || '<p style="color:var(--text-muted);">No LVM data to display.</p>'}
  </div>
</div>


<!-- ══════════════════════════ MODALS ══════════════════════════ -->

<!-- Initialize Disk -->
<div class="modal fade" id="initDiskModal" tabindex="-1">
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content lp-glass-card" style="border:1px solid rgba(255,255,255,0.1);background:rgba(20,20,25,0.97);">
      <div class="modal-header" style="border-bottom:1px solid rgba(255,255,255,0.1);">
        <h5 class="modal-title" style="font-size:15px;font-weight:700;"><i class="bi bi-hdd-fill text-warning me-2"></i>Initialize Disk for LVM</h5>
        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
      </div>
      <div class="modal-body">
        <input type="hidden" id="initDiskDevice">
        <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.3);border-radius:10px;padding:12px;margin-bottom:16px;font-size:12px;color:#f59e0b;">
          <i class="bi bi-exclamation-triangle me-1"></i>
          Runs <code>pvcreate</code> — any existing data on the disk will be erased!
        </div>
        <div class="mb-3">
          <label class="lp-label" style="font-size:11px;">Device</label>
          <input type="text" id="initDiskDeviceDisplay" class="lp-input" readonly style="font-family:monospace;">
        </div>
        <div class="mb-3">
          <label class="lp-label" style="font-size:11px;">Add to Volume Group (optional)</label>
          <input type="text" id="initDiskVg" class="lp-input" placeholder="e.g. vg-data (leave blank to skip)">
        </div>
        <div class="form-check">
          <input class="form-check-input" type="checkbox" id="initDiskConfirm">
          <label class="form-check-label" style="font-size:12px;cursor:pointer;">I understand this is irreversible</label>
        </div>
      </div>
      <div class="modal-footer" style="border-top:1px solid rgba(255,255,255,0.1);">
        <button type="button" class="btn-lp btn-lp-ghost" data-bs-dismiss="modal">Cancel</button>
        <button type="button" class="btn-lp btn-lp-primary" onclick="LvmPage.initDisk()" style="background:#f59e0b;color:#000;">
          <i class="bi bi-lightning-fill me-1"></i>Initialize
        </button>
      </div>
    </div>
  </div>
</div>

<!-- Create LV -->
<div class="modal fade" id="createLvModal" tabindex="-1">
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content lp-glass-card" style="border:1px solid rgba(255,255,255,0.1);background:rgba(20,20,25,0.97);">
      <div class="modal-header" style="border-bottom:1px solid rgba(255,255,255,0.1);">
        <h5 class="modal-title" style="font-size:15px;font-weight:700;"><i class="bi bi-plus-circle-fill text-success me-2"></i>Create Logical Volume</h5>
        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
      </div>
      <div class="modal-body">
        <div class="mb-3">
          <label class="lp-label" style="font-size:11px;">LV Name</label>
          <input type="text" id="createLvName" class="lp-input" placeholder="e.g. lv-data">
        </div>
        <div class="mb-3">
          <label class="lp-label" style="font-size:11px;">Volume Group</label>
          <input type="text" id="createLvVg" class="lp-input" placeholder="e.g. vg-data">
        </div>
        <div class="mb-3">
          <label class="lp-label" style="font-size:11px;">Size (GB)</label>
          <input type="number" id="createLvSize" class="lp-input" min="1" placeholder="e.g. 50">
        </div>
        <div class="mb-3">
          <label class="lp-label" style="font-size:11px;">Filesystem</label>
          <select id="createLvFs" class="lp-input">
            <option value="ext4">ext4 (recommended)</option>
            <option value="xfs">xfs</option>
            <option value="none">None (raw)</option>
          </select>
        </div>
        <div class="mb-3">
          <label class="lp-label" style="font-size:11px;">Mount Point (optional)</label>
          <input type="text" id="createLvMount" class="lp-input" placeholder="e.g. /data">
          <small style="color:var(--text-muted);font-size:10px;">Directory created automatically, added to /etc/fstab.</small>
        </div>
      </div>
      <div class="modal-footer" style="border-top:1px solid rgba(255,255,255,0.1);">
        <button type="button" class="btn-lp btn-lp-ghost" data-bs-dismiss="modal">Cancel</button>
        <button type="button" class="btn-lp btn-lp-primary" onclick="LvmPage.createLv()">
          <i class="bi bi-check-lg me-1"></i>Create
        </button>
      </div>
    </div>
  </div>
</div>

<!-- Extend LV -->
<div class="modal fade" id="extendLvModal" tabindex="-1">
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content lp-glass-card" style="border:1px solid rgba(255,255,255,0.1);background:rgba(20,20,25,0.97);">
      <div class="modal-header" style="border-bottom:1px solid rgba(255,255,255,0.1);">
        <h5 class="modal-title" style="font-size:15px;font-weight:700;"><i class="bi bi-arrows-expand text-info me-2"></i>Extend Logical Volume</h5>
        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
      </div>
      <div class="modal-body">
        <input type="hidden" id="extendLvName">
        <input type="hidden" id="extendLvVg">
        <div class="mb-3">
          <label class="lp-label" style="font-size:11px;">Logical Volume</label>
          <input type="text" id="extendLvDisplay" class="lp-input" readonly style="font-family:monospace;">
        </div>
        <div class="mb-3">
          <label class="lp-label" style="font-size:11px;">Add Size (GB)</label>
          <input type="number" id="extendLvSize" class="lp-input" min="1" placeholder="e.g. 20">
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px;background:rgba(0,0,0,0.15);border-radius:8px;border:1px solid var(--glass-border);">
          <span style="font-size:12px;">Auto-resize filesystem</span>
          <div class="form-check form-switch" style="margin:0;">
            <input class="form-check-input" type="checkbox" id="extendLvResizeFs" checked>
          </div>
        </div>
      </div>
      <div class="modal-footer" style="border-top:1px solid rgba(255,255,255,0.1);">
        <button type="button" class="btn-lp btn-lp-ghost" data-bs-dismiss="modal">Cancel</button>
        <button type="button" class="btn-lp btn-lp-primary" onclick="LvmPage.extendLv()">Extend</button>
      </div>
    </div>
  </div>
</div>

<!-- Extend VG -->
<div class="modal fade" id="extendVgModal" tabindex="-1">
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content lp-glass-card" style="border:1px solid rgba(255,255,255,0.1);background:rgba(20,20,25,0.97);">
      <div class="modal-header" style="border-bottom:1px solid rgba(255,255,255,0.1);">
        <h5 class="modal-title" style="font-size:15px;font-weight:700;"><i class="bi bi-plus-circle text-primary me-2"></i>Add Disk to Volume Group</h5>
        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
      </div>
      <div class="modal-body">
        <input type="hidden" id="extendVgName">
        <div class="mb-3">
          <label class="lp-label" style="font-size:11px;">Volume Group</label>
          <input type="text" id="extendVgDisplay" class="lp-input" readonly style="color:#a78bfa;">
        </div>
        <div class="mb-3">
          <label class="lp-label" style="font-size:11px;">New Disk Device</label>
          <input type="text" id="extendVgDevice" class="lp-input" placeholder="e.g. /dev/sdc">
          <small style="color:var(--text-muted);font-size:10px;">Runs pvcreate + vgextend automatically.</small>
        </div>
      </div>
      <div class="modal-footer" style="border-top:1px solid rgba(255,255,255,0.1);">
        <button type="button" class="btn-lp btn-lp-ghost" data-bs-dismiss="modal">Cancel</button>
        <button type="button" class="btn-lp btn-lp-primary" onclick="LvmPage.extendVg()">Add Disk</button>
      </div>
    </div>
  </div>
</div>

<!-- Snapshot -->
<div class="modal fade" id="snapshotModal" tabindex="-1">
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content lp-glass-card" style="border:1px solid rgba(255,255,255,0.1);background:rgba(20,20,25,0.97);">
      <div class="modal-header" style="border-bottom:1px solid rgba(255,255,255,0.1);">
        <h5 class="modal-title" style="font-size:15px;font-weight:700;"><i class="bi bi-camera-fill text-warning me-2"></i>Create LVM Snapshot</h5>
        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
      </div>
      <div class="modal-body">
        <input type="hidden" id="snapshotOriginLv">
        <input type="hidden" id="snapshotVg">
        <div class="mb-3">
          <label class="lp-label" style="font-size:11px;">Source LV</label>
          <input type="text" id="snapshotOriginDisplay" class="lp-input" readonly style="font-family:monospace;">
        </div>
        <div class="mb-3">
          <label class="lp-label" style="font-size:11px;">Snapshot Name</label>
          <input type="text" id="snapshotName" class="lp-input">
        </div>
        <div class="mb-3">
          <label class="lp-label" style="font-size:11px;">Snapshot Size (GB)</label>
          <input type="number" id="snapshotSize" class="lp-input" min="1" value="5">
        </div>
      </div>
      <div class="modal-footer" style="border-top:1px solid rgba(255,255,255,0.1);">
        <button type="button" class="btn-lp btn-lp-ghost" data-bs-dismiss="modal">Cancel</button>
        <button type="button" class="btn-lp btn-lp-primary" onclick="LvmPage.createSnapshot()" style="background:#f59e0b;color:#000;">
          <i class="bi bi-camera me-1"></i>Snapshot
        </button>
      </div>
    </div>
  </div>
</div>

<!-- Log Output -->
<div class="modal fade" id="lvmLogModal" tabindex="-1">
  <div class="modal-dialog modal-lg modal-dialog-centered">
    <div class="modal-content lp-glass-card" style="border:1px solid rgba(255,255,255,0.1);background:rgba(15,15,20,0.98);">
      <div class="modal-header" style="border-bottom:1px solid rgba(255,255,255,0.1);">
        <h5 class="modal-title font-mono" style="font-size:13px;" id="lvmLogTitle">LVM Output</h5>
        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
      </div>
      <div class="modal-body">
        <pre id="lvmLogContent" style="background:#0a0a0f;color:#a3e635;padding:16px;border-radius:10px;font-size:12px;max-height:400px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;"></pre>
      </div>
      <div class="modal-footer" style="border-top:1px solid rgba(255,255,255,0.1);">
        <button type="button" class="btn-lp btn-lp-ghost" data-bs-dismiss="modal">Close</button>
        <button type="button" class="btn-lp btn-lp-ghost" onclick="LvmPage.refresh()"><i class="bi bi-arrow-clockwise me-1"></i>Refresh</button>
      </div>
    </div>
  </div>
</div>

<!-- ═══════════════════════════ SCRIPT ═══════════════════════════ -->
<script>
const LvmPage = (() => {
  const _modals = {};
  const getModal = id => {
    if (!_modals[id]) _modals[id] = new bootstrap.Modal(document.getElementById(id));
    return _modals[id];
  };

  function showLog(title, text, isError = false) {
    document.getElementById('lvmLogTitle').textContent = title;
    const el = document.getElementById('lvmLogContent');
    el.textContent = text;
    el.style.color = isError ? '#f87171' : '#a3e635';
    getModal('lvmLogModal').show();
  }

  async function apiPost(path, body) { return LP.post(path, body); }

  // ── Tabs
  function switchTab(id) {
    document.querySelectorAll('.lvm-tab').forEach(t => t.style.display = 'none');
    document.querySelectorAll('.lvm-tab-btn').forEach(b => {
      b.classList.remove('lvm-tab-active');
      b.style.borderBottom = '2px solid transparent';
    });
    const tab = document.getElementById('tab-' + id);
    if (tab) tab.style.display = '';
    const btn = document.querySelector(\`[data-tab="\${id}"]\`);
    if (btn) { btn.classList.add('lvm-tab-active'); btn.style.borderBottom = '2px solid #f59e0b'; }
  }

  // ── Init Disk
  function showInitDiskModal(device) {
    document.getElementById('initDiskDevice').value = device;
    document.getElementById('initDiskDeviceDisplay').value = device;
    document.getElementById('initDiskVg').value = '';
    document.getElementById('initDiskConfirm').checked = false;
    getModal('initDiskModal').show();
  }
  async function initDisk() {
    if (!document.getElementById('initDiskConfirm').checked) { LP.toast('Confirm the destructive operation.','error'); return; }
    const device = document.getElementById('initDiskDevice').value;
    const vg = document.getElementById('initDiskVg').value.trim();
    LP.toast('Initializing disk…','info'); getModal('initDiskModal').hide();
    const res = await apiPost('/api/plugins/lvm-manager/init-disk', { device, vg });
    res?.success ? showLog('pvcreate Output', res.data?.output||'Done.') : showLog('Error', res?.message||'Failed', true);
    LP.toast(res?.success ? 'Done!' : res?.message||'Failed', res?.success?'success':'error');
  }

  // ── Create LV
  function showCreateLvModal(vg) {
    if (vg) document.getElementById('createLvVg').value = vg;
    getModal('createLvModal').show();
  }
  async function createLv() {
    const name = document.getElementById('createLvName').value.trim();
    const vg   = document.getElementById('createLvVg').value.trim();
    const size = document.getElementById('createLvSize').value;
    const fs   = document.getElementById('createLvFs').value;
    const mount= document.getElementById('createLvMount').value.trim();
    if (!name||!vg||!size) { LP.toast('Name, VG, and Size required.','error'); return; }
    LP.toast('Creating LV…','info'); getModal('createLvModal').hide();
    const res = await apiPost('/api/plugins/lvm-manager/create-lv', { name, vg, size:+size, fs, mount });
    res?.success ? showLog('lvcreate Output', res.data?.output||'Done.') : showLog('Error', res?.message||'Failed', true);
    LP.toast(res?.success ? 'LV created!' : res?.message||'Failed', res?.success?'success':'error');
  }

  // ── Extend LV
  function showExtendLvModal(name, vg) {
    document.getElementById('extendLvName').value = name;
    document.getElementById('extendLvVg').value = vg;
    document.getElementById('extendLvDisplay').value = \`\${vg}/\${name}\`;
    document.getElementById('extendLvSize').value = '';
    getModal('extendLvModal').show();
  }
  async function extendLv() {
    const name = document.getElementById('extendLvName').value;
    const vg   = document.getElementById('extendLvVg').value;
    const size = document.getElementById('extendLvSize').value;
    const resizeFs = document.getElementById('extendLvResizeFs').checked;
    if (!size||+size<1) { LP.toast('Enter valid GB size.','error'); return; }
    LP.toast('Extending LV…','info'); getModal('extendLvModal').hide();
    const res = await apiPost('/api/plugins/lvm-manager/extend-lv', { name, vg, size:+size, resizeFs });
    res?.success ? showLog('lvextend Output', res.data?.output||'Done.') : showLog('Error', res?.message||'Failed', true);
    LP.toast(res?.success ? 'Extended!' : res?.message||'Failed', res?.success?'success':'error');
  }

  // ── Extend VG
  function showExtendVgModal(vgName) {
    document.getElementById('extendVgName').value = vgName;
    document.getElementById('extendVgDisplay').value = vgName;
    document.getElementById('extendVgDevice').value = '';
    getModal('extendVgModal').show();
  }
  async function extendVg() {
    const vg = document.getElementById('extendVgName').value;
    const device = document.getElementById('extendVgDevice').value.trim();
    if (!device) { LP.toast('Enter device path.','error'); return; }
    LP.toast('Adding disk to VG…','info'); getModal('extendVgModal').hide();
    const res = await apiPost('/api/plugins/lvm-manager/extend-vg', { vg, device });
    res?.success ? showLog('vgextend Output', res.data?.output||'Done.') : showLog('Error', res?.message||'Failed', true);
    LP.toast(res?.success ? 'Disk added!' : res?.message||'Failed', res?.success?'success':'error');
  }

  // ── Snapshot
  function showSnapshotModal(lv, vg) {
    document.getElementById('snapshotOriginLv').value = lv;
    document.getElementById('snapshotVg').value = vg;
    document.getElementById('snapshotOriginDisplay').value = \`\${vg}/\${lv}\`;
    document.getElementById('snapshotName').value = lv + '-snap';
    document.getElementById('snapshotSize').value = '5';
    getModal('snapshotModal').show();
  }
  async function createSnapshot() {
    const origin = document.getElementById('snapshotOriginLv').value;
    const vg   = document.getElementById('snapshotVg').value;
    const name = document.getElementById('snapshotName').value.trim();
    const size = document.getElementById('snapshotSize').value;
    if (!name||!size) { LP.toast('Name and size required.','error'); return; }
    LP.toast('Creating snapshot…','info'); getModal('snapshotModal').hide();
    const res = await apiPost('/api/plugins/lvm-manager/snapshot', { origin, vg, name, size:+size });
    res?.success ? showLog('Snapshot Output', res.data?.output||'Done.') : showLog('Error', res?.message||'Failed', true);
    LP.toast(res?.success ? 'Snapshot created!' : res?.message||'Failed', res?.success?'success':'error');
  }
  async function restoreSnapshot(snapName, vg) {
    if (!confirm(\`Restore \${snapName}? This will overwrite the origin volume!\`)) return;
    LP.toast('Restoring…','info');
    const res = await apiPost('/api/plugins/lvm-manager/restore-snapshot', { snapName, vg });
    res?.success ? showLog('Restore Output', res.data?.output||'Done.') : showLog('Error', res?.message||'Failed', true);
    LP.toast(res?.success ? 'Restored!' : res?.message||'Failed', res?.success?'success':'error');
  }
  async function installLvm() {
    LP.toast('Installing LVM2…','info');
    const res = await apiPost('/api/plugins/lvm-manager/install-lvm', {});
    res?.success ? (showLog('Install Output', res.data?.output||'Done.'), setTimeout(()=>location.reload(),2000)) : showLog('Error', res?.message||'Failed', true);
  }

  function refresh() {
    const btn = document.getElementById('refreshBtn');
    if (btn) { btn.innerHTML='<i class="bi bi-arrow-clockwise me-1 spin"></i>...'; btn.disabled=true; }
    location.reload();
  }

  return { switchTab, showInitDiskModal, initDisk, showCreateLvModal, createLv,
           showExtendLvModal, extendLv, showExtendVgModal, extendVg,
           showSnapshotModal, createSnapshot, restoreSnapshot, installLvm, refresh };
})();
</script>

<style>
.lvm-tab-active { color: #f59e0b !important; }
.spin { animation: lvm-spin 1s linear infinite; display:inline-block; }
@keyframes lvm-spin { from {transform:rotate(0deg);} to {transform:rotate(360deg);} }
</style>
          `
        });
      } catch (err) {
        res.status(500).send(`LVM Manager Error: ${err.message}`);
      }
    });

    // ── API: Install LVM2
    app.post('/api/plugins/lvm-manager/install-lvm', async (req, res) => {
      try {
        let out = '';
        if (await run('which apt-get').catch(()=>'')) out = await run('DEBIAN_FRONTEND=noninteractive apt-get install -y lvm2 smartmontools 2>&1');
        else if (await run('which dnf').catch(()=>'')) out = await run('dnf install -y lvm2 smartmontools 2>&1');
        else if (await run('which pacman').catch(()=>'')) out = await run('pacman -S --noconfirm lvm2 smartmontools 2>&1');
        else return errorResponse(res, 'Cannot detect package manager.', 400);
        return successResponse(res, { output: out }, 'LVM2 + smartmontools installed');
      } catch (e) { return errorResponse(res, e.message, 500); }
    });

    // ── API: Init disk
    app.post('/api/plugins/lvm-manager/init-disk', async (req, res) => {
      try {
        await ensureLvmInstalled();
        const { device, vg } = req.body;
        if (!device || !/^\/dev\/[\w]+$/.test(device)) return errorResponse(res, 'Invalid device', 400);
        let out = await run(`pvcreate -y ${device} 2>&1`);
        if (vg && /^[\w-]+$/.test(vg)) {
          try { out += '\n' + await run(`vgextend ${vg} ${device} 2>&1 || vgcreate ${vg} ${device} 2>&1`); } catch(e) { out += '\n' + e.message; }
        }
        return successResponse(res, { output: out }, 'Disk initialized');
      } catch (e) { return errorResponse(res, e.message, 500); }
    });

    // ── API: Create LV
    app.post('/api/plugins/lvm-manager/create-lv', async (req, res) => {
      try {
        await ensureLvmInstalled();
        const { name, vg, size, fs, mount } = req.body;
        if (!name || !/^[\w-]+$/.test(name)) return errorResponse(res, 'Invalid LV name', 400);
        if (!vg   || !/^[\w-]+$/.test(vg))   return errorResponse(res, 'Invalid VG name', 400);
        if (!size || size < 1)                return errorResponse(res, 'Invalid size', 400);
        let out = await run(`lvcreate -L ${size}G -n ${name} ${vg} 2>&1`);
        const lvPath = `/dev/${vg}/${name}`;
        if (fs && fs !== 'none') out += '\n' + await run(`mkfs.${fs} ${lvPath} 2>&1`);
        if (mount && /^\/[\w/\-_]+$/.test(mount)) {
          out += '\n' + await run(`mkdir -p ${mount} 2>&1`);
          out += '\n' + await run(`mount ${lvPath} ${mount} 2>&1`);
          const fstab = await run('cat /etc/fstab').catch(()=>'');
          if (!fstab.includes(lvPath)) out += '\n' + await run(`printf '\\n%s\\n' '${lvPath} ${mount} ${fs||'ext4'} defaults 0 2' >> /etc/fstab && echo 'Added to /etc/fstab'`);
        }
        return successResponse(res, { output: out }, 'LV created');
      } catch (e) { return errorResponse(res, e.message, 500); }
    });

    // ── API: Extend LV
    app.post('/api/plugins/lvm-manager/extend-lv', async (req, res) => {
      try {
        await ensureLvmInstalled();
        const { name, vg, size, resizeFs } = req.body;
        if (!name || !/^[\w-]+$/.test(name)) return errorResponse(res, 'Invalid LV name', 400);
        if (!vg   || !/^[\w-]+$/.test(vg))   return errorResponse(res, 'Invalid VG name', 400);
        if (!size || size < 1)                return errorResponse(res, 'Invalid size', 400);
        const lvPath = `/dev/${vg}/${name}`;
        let out = await run(`lvextend -L +${size}G ${lvPath} 2>&1`);
        if (resizeFs) {
          try { out += '\n' + await run(`resize2fs ${lvPath} 2>&1`); } catch(_) {
            try {
              const mp = (await run(`findmnt -n -o TARGET ${lvPath} 2>/dev/null`).catch(()=>'')).trim();
              if (mp) out += '\n' + await run(`xfs_growfs ${mp} 2>&1`);
            } catch(_) {}
          }
        }
        return successResponse(res, { output: out }, 'LV extended');
      } catch (e) { return errorResponse(res, e.message, 500); }
    });

    // ── API: Extend VG
    app.post('/api/plugins/lvm-manager/extend-vg', async (req, res) => {
      try {
        await ensureLvmInstalled();
        const { vg, device } = req.body;
        if (!vg     || !/^[\w-]+$/.test(vg))       return errorResponse(res, 'Invalid VG name', 400);
        if (!device || !/^\/dev\/[\w]+$/.test(device)) return errorResponse(res, 'Invalid device', 400);
        let out = await run(`pvcreate -y ${device} 2>&1`);
        out += '\n' + await run(`vgextend ${vg} ${device} 2>&1`);
        return successResponse(res, { output: out }, 'VG extended');
      } catch (e) { return errorResponse(res, e.message, 500); }
    });

    // ── API: Snapshot
    app.post('/api/plugins/lvm-manager/snapshot', async (req, res) => {
      try {
        await ensureLvmInstalled();
        const { origin, vg, name, size } = req.body;
        if (!origin || !/^[\w-]+$/.test(origin)) return errorResponse(res, 'Invalid origin', 400);
        if (!vg     || !/^[\w-]+$/.test(vg))     return errorResponse(res, 'Invalid VG', 400);
        if (!name   || !/^[\w-]+$/.test(name))   return errorResponse(res, 'Invalid snapshot name', 400);
        if (!size   || size < 1)                  return errorResponse(res, 'Invalid size', 400);
        const out = await run(`lvcreate -s -L ${size}G -n ${name} /dev/${vg}/${origin} 2>&1`);
        return successResponse(res, { output: out }, 'Snapshot created');
      } catch (e) { return errorResponse(res, e.message, 500); }
    });

    // ── API: Restore Snapshot
    app.post('/api/plugins/lvm-manager/restore-snapshot', async (req, res) => {
      try {
        await ensureLvmInstalled();
        const { snapName, vg } = req.body;
        if (!snapName || !/^[\w-]+$/.test(snapName)) return errorResponse(res, 'Invalid snapshot name', 400);
        if (!vg       || !/^[\w-]+$/.test(vg))       return errorResponse(res, 'Invalid VG', 400);
        const out = await run(`lvconvert --merge /dev/${vg}/${snapName} 2>&1`);
        return successResponse(res, { output: out }, 'Snapshot merge scheduled');
      } catch (e) { return errorResponse(res, e.message, 500); }
    });
  }
};
