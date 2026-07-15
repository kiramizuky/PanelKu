import { exec } from 'child_process';
import { promisify } from 'util';

// ─────────────────────────────────────────────
// Inline response helpers (compatible with LP format)
// ─────────────────────────────────────────────
function successResponse(res, data = null, message = 'OK', statusCode = 200) {
  return res.status(statusCode).json({ success: true, message, data });
}
function errorResponse(res, message = 'Error', statusCode = 500) {
  return res.status(statusCode).json({ success: false, message });
}

const execAsync = promisify(exec);

// ─────────────────────────────────────────────
// Helper: run a command safely
// ─────────────────────────────────────────────
async function run(cmd) {
  const { stdout } = await execAsync(cmd, { timeout: 30000 });
  return stdout.trim();
}

// ─────────────────────────────────────────────
// Parse: pvs output → array of PV objects
// ─────────────────────────────────────────────
function parsePvs(raw) {
  return raw.split('\n').filter(Boolean).map(line => {
    const parts = line.trim().split(/\s{2,}|\t/);
    return {
      name: parts[0] || '',
      vg: parts[1] || '(none)',
      fmt: parts[2] || 'lvm2',
      size: parts[3] || '0g',
      free: parts[4] || '0g',
      attr: parts[5] || ''
    };
  });
}

// ─────────────────────────────────────────────
// Parse: vgs output → array of VG objects
// ─────────────────────────────────────────────
function parseVgs(raw) {
  return raw.split('\n').filter(Boolean).map(line => {
    const parts = line.trim().split(/\s{2,}|\t/);
    return {
      name: parts[0] || '',
      pvCount: parseInt(parts[1]) || 0,
      lvCount: parseInt(parts[2]) || 0,
      attr: parts[3] || '',
      size: parts[4] || '0g',
      free: parts[5] || '0g'
    };
  });
}

// ─────────────────────────────────────────────
// Parse: lvs output → array of LV objects
// ─────────────────────────────────────────────
function parseLvs(raw) {
  return raw.split('\n').filter(Boolean).map(line => {
    const parts = line.trim().split(/\s{2,}|\t/);
    return {
      name: parts[0] || '',
      vg: parts[1] || '',
      attr: parts[2] || '',
      size: parts[3] || '0g',
      origin: parts[4] || '',
      mountpoint: parts[5] || ''
    };
  });
}

// ─────────────────────────────────────────────
// Gather all LVM data
// ─────────────────────────────────────────────
async function getLvmData() {
  const isLinux = process.platform === 'linux';
  let lvmAvailable = false;

  if (isLinux) {
    try {
      await run('which lvm || which pvs');
      lvmAvailable = true;
    } catch (_) {}
  }

  if (!lvmAvailable) {
    // Return mock data for dev/non-Linux environments
    return {
      available: false,
      pvs: [
        { name: '/dev/sda', vg: 'vg-data', fmt: 'lvm2', size: '500.00g', free: '100.00g', attr: 'a--' },
        { name: '/dev/sdb', vg: 'vg-data', fmt: 'lvm2', size: '1.00t', free: '400.00g', attr: 'a--' }
      ],
      vgs: [
        { name: 'vg-data', pvCount: 2, lvCount: 3, attr: 'wz--n-', size: '1.46t', free: '500.00g' }
      ],
      lvs: [
        { name: 'lv-root', vg: 'vg-data', attr: '-wi-ao----', size: '200.00g', origin: '', mountpoint: '/' },
        { name: 'lv-docker', vg: 'vg-data', attr: '-wi-ao----', size: '300.00g', origin: '', mountpoint: '/var/lib/docker' },
        { name: 'lv-backup', vg: 'vg-data', attr: '-wi-ao----', size: '400.00g', origin: '', mountpoint: '/backup' }
      ],
      blockDevices: [
        { name: 'sda', size: '500G', type: 'disk', fstype: '', mountpoint: '', used: true },
        { name: 'sdb', size: '1T', type: 'disk', fstype: '', mountpoint: '', used: true },
        { name: 'sdc', size: '2T', type: 'disk', fstype: '', mountpoint: '', used: false }
      ]
    };
  }

  const [pvsRaw, vgsRaw, lvsRaw, lsblkRaw] = await Promise.all([
    run('pvs --noheadings --units g --separator "  " -o pv_name,vg_name,pv_fmt,pv_size,pv_free,pv_attr 2>/dev/null').catch(() => ''),
    run('vgs --noheadings --units g --separator "  " -o vg_name,pv_count,lv_count,vg_attr,vg_size,vg_free 2>/dev/null').catch(() => ''),
    run('lvs --noheadings --units g --separator "  " -o lv_name,vg_name,lv_attr,lv_size,origin,lv_path 2>/dev/null').catch(() => ''),
    run('lsblk -J -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT 2>/dev/null').catch(() => '{"blockdevices":[]}')
  ]);

  let blockDevices = [];
  try {
    const lsblkData = JSON.parse(lsblkRaw);
    const pvNames = pvsRaw.split('\n').map(l => l.trim().split(/\s+/)[0]).filter(Boolean);
    blockDevices = (lsblkData.blockdevices || [])
      .filter(d => d.type === 'disk')
      .map(d => ({
        name: d.name,
        size: d.size,
        type: d.type,
        fstype: d.fstype || '',
        mountpoint: d.mountpoint || '',
        used: pvNames.some(pv => pv.includes(d.name))
      }));
  } catch (_) {}

  return {
    available: true,
    pvs: parsePvs(pvsRaw),
    vgs: parseVgs(vgsRaw),
    lvs: parseLvs(lvsRaw),
    blockDevices
  };
}

// ─────────────────────────────────────────────
// Build a color/status badge
// ─────────────────────────────────────────────
function usageBar(sizeStr, freeStr) {
  const parseG = s => parseFloat((s || '0').replace(/[^0-9.]/g, '')) || 0;
  const total = parseG(sizeStr);
  const free = parseG(freeStr);
  if (total === 0) return '<div style="color:var(--text-muted);font-size:11px;">N/A</div>';
  const used = total - free;
  const pct = Math.round((used / total) * 100);
  const color = pct > 85 ? '#ef4444' : pct > 65 ? '#f59e0b' : '#10b981';
  return `
    <div style="margin-top:4px;">
      <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-muted);margin-bottom:3px;">
        <span>${used.toFixed(1)}G used</span><span>${pct}%</span>
      </div>
      <div style="background:rgba(255,255,255,0.08);border-radius:99px;height:6px;overflow:hidden;">
        <div style="width:${pct}%;height:100%;background:${color};border-radius:99px;transition:width 0.5s;"></div>
      </div>
    </div>`;
}

// ─────────────────────────────────────────────
// Plugin entry point
// ─────────────────────────────────────────────
export default {
  register(app, io) {

    // ── GET /plugins/lvm-manager ──────────────────────
    app.get('/plugins/lvm-manager', async (req, res) => {
      try {
        const data = await getLvmData();

        const pvRows = data.pvs.length
          ? data.pvs.map(pv => `
            <tr>
              <td><code style="color:#f59e0b;font-size:12px;">${pv.name}</code></td>
              <td><span style="font-size:12px;color:var(--text-secondary);">${pv.vg}</span></td>
              <td><span style="font-size:12px;">${pv.size}</span></td>
              <td><span style="font-size:12px;color:#10b981;">${pv.free}</span></td>
              <td><code style="font-size:10px;color:var(--text-muted);">${pv.attr}</code></td>
            </tr>`).join('')
          : `<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted);">No Physical Volumes found</td></tr>`;

        const vgRows = data.vgs.length
          ? data.vgs.map(vg => `
            <tr>
              <td><strong style="color:#a78bfa;">${vg.name}</strong></td>
              <td style="text-align:center;">${vg.pvCount}</td>
              <td style="text-align:center;">${vg.lvCount}</td>
              <td>${vg.size}</td>
              <td>${usageBar(vg.size, vg.free)}</td>
              <td>
                <button class="btn-lp btn-lp-ghost btn-lp-sm" onclick="LvmPage.showExtendVgModal('${vg.name}')" style="font-size:10px;padding:4px 8px;">
                  <i class="bi bi-plus-circle me-1"></i>Add Disk
                </button>
              </td>
            </tr>`).join('')
          : `<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted);">No Volume Groups found</td></tr>`;

        const lvRows = data.lvs.length
          ? data.lvs.map(lv => {
            const isSnap = lv.attr.includes('s');
            return `
            <tr>
              <td>
                <div style="display:flex;align-items:center;gap:8px;">
                  <i class="bi ${isSnap ? 'bi-camera text-warning' : 'bi-layers text-primary'}" style="font-size:14px;"></i>
                  <div>
                    <div style="font-weight:600;font-size:13px;">${lv.name}</div>
                    ${isSnap ? '<span style="font-size:10px;color:#f59e0b;">SNAPSHOT</span>' : ''}
                  </div>
                </div>
              </td>
              <td><span style="color:#a78bfa;font-size:12px;">${lv.vg}</span></td>
              <td><span style="font-size:12px;">${lv.size}</span></td>
              <td><code style="font-size:10px;color:var(--text-muted);">${lv.mountpoint || '—'}</code></td>
              <td style="text-align:right;">
                <div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap;">
                  ${!isSnap ? `
                    <button class="btn-lp btn-lp-ghost btn-lp-sm" onclick="LvmPage.showExtendLvModal('${lv.name}','${lv.vg}')" style="font-size:10px;padding:4px 8px;">
                      <i class="bi bi-arrows-expand me-1"></i>Extend
                    </button>
                    <button class="btn-lp btn-lp-ghost btn-lp-sm" onclick="LvmPage.showSnapshotModal('${lv.name}','${lv.vg}')" style="font-size:10px;padding:4px 8px;color:#f59e0b;">
                      <i class="bi bi-camera me-1"></i>Snapshot
                    </button>
                  ` : `
                    <button class="btn-lp btn-lp-ghost btn-lp-sm" onclick="LvmPage.restoreSnapshot('${lv.name}','${lv.vg}')" style="font-size:10px;padding:4px 8px;color:#10b981;">
                      <i class="bi bi-arrow-counterclockwise me-1"></i>Restore
                    </button>
                  `}
                </div>
              </td>
            </tr>`;
          }).join('')
          : `<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted);">No Logical Volumes found</td></tr>`;

        const diskCards = data.blockDevices.map(d => `
          <div class="lp-glass-card p-3" style="border:1px solid ${d.used ? 'rgba(167,139,250,0.2)' : 'rgba(16,185,129,0.3)'};">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
              <div style="width:40px;height:40px;border-radius:10px;background:${d.used ? 'rgba(167,139,250,0.1)' : 'rgba(16,185,129,0.1)'};display:flex;align-items:center;justify-content:center;font-size:20px;">
                <i class="bi bi-hdd-fill" style="color:${d.used ? '#a78bfa' : '#10b981'};"></i>
              </div>
              <div>
                <div style="font-weight:700;font-size:14px;">/dev/${d.name}</div>
                <div style="font-size:11px;color:var(--text-muted);">${d.size} — ${d.type}</div>
              </div>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span class="lp-badge ${d.used ? 'lp-badge-info' : 'lp-badge-success'}" style="font-size:10px;">
                <span class="lp-badge-dot"></span>${d.used ? 'In LVM' : 'Free / Unused'}
              </span>
              ${!d.used ? `
                <button class="btn-lp btn-lp-primary btn-lp-sm" onclick="LvmPage.showInitDiskModal('/dev/${d.name}')" style="font-size:10px;padding:4px 10px;">
                  <i class="bi bi-plus-circle me-1"></i>Initialize
                </button>
              ` : ''}
            </div>
          </div>`).join('');

        const notAvailableBanner = !data.available ? `
          <div class="alert alert-warning" style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:12px;padding:16px;margin-bottom:20px;display:flex;align-items:center;gap:12px;">
            <i class="bi bi-exclamation-triangle-fill text-warning" style="font-size:20px;"></i>
            <div>
              <strong style="color:#f59e0b;">LVM tools not found.</strong>
              <span style="color:var(--text-muted);font-size:13px;display:block;">Install with: <code>apt install lvm2</code> / <code>dnf install lvm2</code>. Showing demo data.</span>
            </div>
            <button class="btn-lp btn-lp-primary btn-lp-sm ms-auto" onclick="LvmPage.installLvm()" style="font-size:11px;white-space:nowrap;">
              <i class="bi bi-download me-1"></i>Install LVM2
            </button>
          </div>` : '';

        res.render('layout', {
          title: 'LVM Manager',
          layout: false,
          body: `
<!-- LVM Manager -->
<div class="lp-page-header" style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:20px;">
  <div>
    <h1 class="lp-page-title" style="font-size:24px;font-weight:600;margin:0;"><i class="bi bi-hdd-stack-fill text-warning me-2"></i>LVM Manager</h1>
    <p class="lp-page-subtitle" style="color:var(--text-muted);margin:0;">Manage Physical Volumes, Volume Groups, and Logical Volumes</p>
  </div>
  <div style="display:flex;gap:8px;">
    <button class="btn-lp btn-lp-ghost btn-lp-sm" onclick="LvmPage.refresh()" id="refreshBtn">
      <i class="bi bi-arrow-clockwise me-1"></i>Refresh
    </button>
    <button class="btn-lp btn-lp-primary btn-lp-sm" onclick="LvmPage.showCreateLvModal()">
      <i class="bi bi-plus-lg me-1"></i>New Logical Volume
    </button>
  </div>
</div>

${notAvailableBanner}

<!-- Disk Overview -->
<div class="lp-glass-card p-4 mb-4">
  <h5 style="font-weight:700;margin-bottom:15px;font-size:15px;"><i class="bi bi-hdd me-2 text-primary"></i>Block Devices</h5>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;" id="diskGrid">
    ${diskCards || '<p style="color:var(--text-muted);font-size:13px;">No block devices detected.</p>'}
  </div>
</div>

<!-- Three-panel layout -->
<div class="row g-4">
  <!-- Physical Volumes -->
  <div class="col-12 col-lg-4">
    <div class="lp-glass-card p-0" style="display:flex;flex-direction:column;">
      <div style="padding:16px 20px 0;flex-shrink:0;">
        <h5 style="font-weight:700;font-size:14px;margin:0;"><i class="bi bi-device-hdd me-2 text-warning"></i>Physical Volumes (PV)</h5>
        <p style="color:var(--text-muted);font-size:11px;margin:4px 0 12px;">Raw disks/partitions initialized for LVM</p>
      </div>
      <div style="overflow:auto;max-height:320px;flex:1;">
        <table class="lp-table" style="font-size:12px;">
          <thead style="position:sticky;top:0;z-index:1;background:rgba(15,20,30,0.95);backdrop-filter:blur(10px);">
            <tr>
              <th>Device</th><th>VG</th><th>Size</th><th>Free</th><th>Attr</th>
            </tr>
          </thead>
          <tbody id="pvTableBody">${pvRows}</tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- Volume Groups -->
  <div class="col-12 col-lg-4">
    <div class="lp-glass-card p-0" style="display:flex;flex-direction:column;">
      <div style="padding:16px 20px 0;flex-shrink:0;">
        <h5 style="font-weight:700;font-size:14px;margin:0;"><i class="bi bi-folder2-open me-2 text-primary"></i>Volume Groups (VG)</h5>
        <p style="color:var(--text-muted);font-size:11px;margin:4px 0 12px;">Pools of physical volumes acting as single storage</p>
      </div>
      <div style="overflow:auto;max-height:320px;flex:1;">
        <table class="lp-table" style="font-size:12px;">
          <thead style="position:sticky;top:0;z-index:1;background:rgba(15,20,30,0.95);backdrop-filter:blur(10px);">
            <tr>
              <th>Name</th><th>PVs</th><th>LVs</th><th>Size</th><th>Usage</th><th></th>
            </tr>
          </thead>
          <tbody id="vgTableBody">${vgRows}</tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- Logical Volumes -->
  <div class="col-12 col-lg-4">
    <div class="lp-glass-card p-0" style="display:flex;flex-direction:column;">
      <div style="padding:16px 20px 0;flex-shrink:0;">
        <h5 style="font-weight:700;font-size:14px;margin:0;"><i class="bi bi-layers me-2 text-success"></i>Logical Volumes (LV)</h5>
        <p style="color:var(--text-muted);font-size:11px;margin:4px 0 12px;">Flexible virtual partitions mounted on the system</p>
      </div>
      <div style="overflow:auto;max-height:320px;flex:1;">
        <table class="lp-table" style="font-size:12px;">
          <thead style="position:sticky;top:0;z-index:1;background:rgba(15,20,30,0.95);backdrop-filter:blur(10px);">
            <tr>
              <th>Name</th><th>VG</th><th>Size</th><th>Mount</th><th style="text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody id="lvTableBody">${lvRows}</tbody>
        </table>
      </div>
    </div>
  </div>
</div>

<!-- ──────────── MODALS ──────────── -->

<!-- Initialize Disk Modal -->
<div class="modal fade" id="initDiskModal" tabindex="-1">
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content lp-glass-card" style="border:1px solid rgba(255,255,255,0.1);background:rgba(20,20,25,0.97);">
      <div class="modal-header" style="border-bottom:1px solid rgba(255,255,255,0.1);">
        <h5 class="modal-title" style="font-size:15px;font-weight:700;"><i class="bi bi-hdd-fill text-warning me-2"></i>Initialize Disk for LVM</h5>
        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
      </div>
      <div class="modal-body">
        <input type="hidden" id="initDiskDevice">
        <div class="alert" style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:10px;padding:12px;margin-bottom:16px;font-size:12px;color:#f59e0b;">
          <i class="bi bi-exclamation-triangle me-1"></i>
          This will run <code>pvcreate</code> on the selected disk. Any existing data will be erased!
        </div>
        <div class="mb-3">
          <label class="lp-label" style="font-size:11px;">Device</label>
          <input type="text" id="initDiskDeviceDisplay" class="lp-input" readonly style="font-family:monospace;">
        </div>
        <div class="mb-3">
          <label class="lp-label" style="font-size:11px;">Add to Volume Group (optional)</label>
          <input type="text" id="initDiskVg" class="lp-input" placeholder="e.g. vg-data (leave blank to skip)">
          <small style="color:var(--text-muted);font-size:10px;">If specified, the disk will be added to this VG after initialization.</small>
        </div>
        <div class="form-check" style="margin-bottom:5px;">
          <input class="form-check-input" type="checkbox" id="initDiskConfirm" style="cursor:pointer;">
          <label class="form-check-label" style="font-size:12px;cursor:pointer;">I understand this is a destructive operation</label>
        </div>
      </div>
      <div class="modal-footer" style="border-top:1px solid rgba(255,255,255,0.1);">
        <button type="button" class="btn-lp btn-lp-ghost" data-bs-dismiss="modal">Cancel</button>
        <button type="button" class="btn-lp btn-lp-primary" onclick="LvmPage.initDisk()" style="background:#f59e0b;">
          <i class="bi bi-lightning-fill me-1"></i>Initialize Disk
        </button>
      </div>
    </div>
  </div>
</div>

<!-- Create LV Modal -->
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
          <div style="display:flex;gap:8px;align-items:center;">
            <input type="number" id="createLvSize" class="lp-input" min="1" placeholder="e.g. 50">
            <span style="color:var(--text-muted);font-size:12px;white-space:nowrap;">GB</span>
          </div>
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
          <small style="color:var(--text-muted);font-size:10px;">Directory will be created automatically and added to /etc/fstab.</small>
        </div>
      </div>
      <div class="modal-footer" style="border-top:1px solid rgba(255,255,255,0.1);">
        <button type="button" class="btn-lp btn-lp-ghost" data-bs-dismiss="modal">Cancel</button>
        <button type="button" class="btn-lp btn-lp-primary" onclick="LvmPage.createLv()">
          <i class="bi bi-check-lg me-1"></i>Create Volume
        </button>
      </div>
    </div>
  </div>
</div>

<!-- Extend LV Modal -->
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
          <div style="display:flex;gap:8px;align-items:center;">
            <input type="number" id="extendLvSize" class="lp-input" min="1" placeholder="e.g. 20">
            <span style="color:var(--text-muted);font-size:12px;white-space:nowrap;">GB</span>
          </div>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px;background:rgba(0,0,0,0.15);border-radius:8px;border:1px solid var(--glass-border);">
          <span style="font-size:12px;">Auto-resize filesystem</span>
          <div class="form-check form-switch" style="margin:0;">
            <input class="form-check-input" type="checkbox" id="extendLvResizeFs" checked style="cursor:pointer;">
          </div>
        </div>
        <small style="color:var(--text-muted);font-size:10px;display:block;margin-top:6px;">Runs resize2fs (ext4) or xfs_growfs (xfs) after extending.</small>
      </div>
      <div class="modal-footer" style="border-top:1px solid rgba(255,255,255,0.1);">
        <button type="button" class="btn-lp btn-lp-ghost" data-bs-dismiss="modal">Cancel</button>
        <button type="button" class="btn-lp btn-lp-primary" onclick="LvmPage.extendLv()">
          <i class="bi bi-arrows-expand me-1"></i>Extend Volume
        </button>
      </div>
    </div>
  </div>
</div>

<!-- Extend VG Modal -->
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
          <input type="text" id="extendVgDisplay" class="lp-input" readonly style="font-family:monospace;color:#a78bfa;">
        </div>
        <div class="mb-3">
          <label class="lp-label" style="font-size:11px;">New Disk Device</label>
          <input type="text" id="extendVgDevice" class="lp-input" placeholder="e.g. /dev/sdc">
          <small style="color:var(--text-muted);font-size:10px;">Will run pvcreate + vgextend automatically.</small>
        </div>
        <div class="alert" style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);border-radius:8px;padding:10px;margin-top:8px;font-size:11px;color:#f59e0b;">
          <i class="bi bi-exclamation-triangle me-1"></i> The disk must be empty and not mounted.
        </div>
      </div>
      <div class="modal-footer" style="border-top:1px solid rgba(255,255,255,0.1);">
        <button type="button" class="btn-lp btn-lp-ghost" data-bs-dismiss="modal">Cancel</button>
        <button type="button" class="btn-lp btn-lp-primary" onclick="LvmPage.extendVg()">
          <i class="bi bi-plus-lg me-1"></i>Add Disk
        </button>
      </div>
    </div>
  </div>
</div>

<!-- Snapshot Modal -->
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
          <label class="lp-label" style="font-size:11px;">Source Logical Volume</label>
          <input type="text" id="snapshotOriginDisplay" class="lp-input" readonly style="font-family:monospace;">
        </div>
        <div class="mb-3">
          <label class="lp-label" style="font-size:11px;">Snapshot Name</label>
          <input type="text" id="snapshotName" class="lp-input" placeholder="e.g. lv-root-snap">
        </div>
        <div class="mb-3">
          <label class="lp-label" style="font-size:11px;">Snapshot Size (GB)</label>
          <div style="display:flex;gap:8px;align-items:center;">
            <input type="number" id="snapshotSize" class="lp-input" min="1" placeholder="e.g. 5">
            <span style="color:var(--text-muted);font-size:12px;white-space:nowrap;">GB</span>
          </div>
          <small style="color:var(--text-muted);font-size:10px;">Reserve enough for expected changes during snapshot lifetime.</small>
        </div>
      </div>
      <div class="modal-footer" style="border-top:1px solid rgba(255,255,255,0.1);">
        <button type="button" class="btn-lp btn-lp-ghost" data-bs-dismiss="modal">Cancel</button>
        <button type="button" class="btn-lp btn-lp-primary" onclick="LvmPage.createSnapshot()" style="background:#f59e0b;color:#000;">
          <i class="bi bi-camera me-1"></i>Take Snapshot
        </button>
      </div>
    </div>
  </div>
</div>

<!-- Result Log Modal -->
<div class="modal fade" id="lvmLogModal" tabindex="-1">
  <div class="modal-dialog modal-lg modal-dialog-centered">
    <div class="modal-content lp-glass-card" style="border:1px solid rgba(255,255,255,0.1);background:rgba(15,15,20,0.98);">
      <div class="modal-header" style="border-bottom:1px solid rgba(255,255,255,0.1);">
        <h5 class="modal-title" style="font-size:14px;font-family:monospace;" id="lvmLogTitle">LVM Output</h5>
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

<script>
const LvmPage = (() => {
  let modals = {};

  function getModal(id) {
    if (!modals[id]) modals[id] = new bootstrap.Modal(document.getElementById(id));
    return modals[id];
  }

  function showLog(title, text, isError = false) {
    document.getElementById('lvmLogTitle').textContent = title;
    const el = document.getElementById('lvmLogContent');
    el.textContent = text;
    el.style.color = isError ? '#f87171' : '#a3e635';
    getModal('lvmLogModal').show();
  }

  async function apiPost(path, body) {
    return LP.post(path, body);
  }

  // ── Initialize disk ──────────────────
  function showInitDiskModal(device) {
    document.getElementById('initDiskDevice').value = device;
    document.getElementById('initDiskDeviceDisplay').value = device;
    document.getElementById('initDiskVg').value = '';
    document.getElementById('initDiskConfirm').checked = false;
    getModal('initDiskModal').show();
  }

  async function initDisk() {
    if (!document.getElementById('initDiskConfirm').checked) {
      LP.toast('Please confirm the destructive operation.', 'error');
      return;
    }
    const device = document.getElementById('initDiskDevice').value;
    const vg = document.getElementById('initDiskVg').value.trim();
    LP.toast('Initializing disk…', 'info');
    getModal('initDiskModal').hide();
    try {
      const res = await apiPost('/api/plugins/lvm-manager/init-disk', { device, vg });
      if (res?.success) {
        showLog('pvcreate / vgextend Output', res.data?.output || 'Done.');
        LP.toast('Disk initialized successfully!', 'success');
      } else {
        showLog('Error', res?.message || 'Unknown error', true);
        LP.toast(res?.message || 'Failed', 'error');
      }
    } catch (e) {
      showLog('Error', e.message, true);
      LP.toast('Network error', 'error');
    }
  }

  // ── Create LV ──────────────────
  function showCreateLvModal() {
    getModal('createLvModal').show();
  }

  async function createLv() {
    const name = document.getElementById('createLvName').value.trim();
    const vg = document.getElementById('createLvVg').value.trim();
    const size = document.getElementById('createLvSize').value;
    const fs = document.getElementById('createLvFs').value;
    const mount = document.getElementById('createLvMount').value.trim();
    if (!name || !vg || !size) {
      LP.toast('Name, Volume Group, and Size are required.', 'error');
      return;
    }
    LP.toast('Creating Logical Volume…', 'info');
    getModal('createLvModal').hide();
    try {
      const res = await apiPost('/api/plugins/lvm-manager/create-lv', { name, vg, size: parseInt(size), fs, mount });
      if (res?.success) {
        showLog('lvcreate Output', res.data?.output || 'Done.');
        LP.toast('Logical Volume created!', 'success');
      } else {
        showLog('Error', res?.message || 'Unknown error', true);
        LP.toast(res?.message || 'Failed', 'error');
      }
    } catch (e) {
      showLog('Error', e.message, true);
      LP.toast('Network error', 'error');
    }
  }

  // ── Extend LV ──────────────────
  function showExtendLvModal(name, vg) {
    document.getElementById('extendLvName').value = name;
    document.getElementById('extendLvVg').value = vg;
    document.getElementById('extendLvDisplay').value = \`\${vg}/\${name}\`;
    document.getElementById('extendLvSize').value = '';
    getModal('extendLvModal').show();
  }

  async function extendLv() {
    const name = document.getElementById('extendLvName').value;
    const vg = document.getElementById('extendLvVg').value;
    const size = document.getElementById('extendLvSize').value;
    const resizeFs = document.getElementById('extendLvResizeFs').checked;
    if (!size || parseInt(size) < 1) {
      LP.toast('Enter a valid size in GB.', 'error');
      return;
    }
    LP.toast('Extending Logical Volume…', 'info');
    getModal('extendLvModal').hide();
    try {
      const res = await apiPost('/api/plugins/lvm-manager/extend-lv', { name, vg, size: parseInt(size), resizeFs });
      if (res?.success) {
        showLog('lvextend Output', res.data?.output || 'Done.');
        LP.toast('Volume extended!', 'success');
      } else {
        showLog('Error', res?.message || 'Unknown error', true);
        LP.toast(res?.message || 'Failed', 'error');
      }
    } catch (e) {
      showLog('Error', e.message, true);
      LP.toast('Network error', 'error');
    }
  }

  // ── Extend VG ──────────────────
  function showExtendVgModal(vgName) {
    document.getElementById('extendVgName').value = vgName;
    document.getElementById('extendVgDisplay').value = vgName;
    document.getElementById('extendVgDevice').value = '';
    getModal('extendVgModal').show();
  }

  async function extendVg() {
    const vg = document.getElementById('extendVgName').value;
    const device = document.getElementById('extendVgDevice').value.trim();
    if (!device) {
      LP.toast('Enter the device path.', 'error');
      return;
    }
    LP.toast('Adding disk to Volume Group…', 'info');
    getModal('extendVgModal').hide();
    try {
      const res = await apiPost('/api/plugins/lvm-manager/extend-vg', { vg, device });
      if (res?.success) {
        showLog('vgextend Output', res.data?.output || 'Done.');
        LP.toast('Disk added to VG!', 'success');
      } else {
        showLog('Error', res?.message || 'Unknown error', true);
        LP.toast(res?.message || 'Failed', 'error');
      }
    } catch (e) {
      showLog('Error', e.message, true);
      LP.toast('Network error', 'error');
    }
  }

  // ── Snapshot ──────────────────
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
    const vg = document.getElementById('snapshotVg').value;
    const name = document.getElementById('snapshotName').value.trim();
    const size = document.getElementById('snapshotSize').value;
    if (!name || !size) {
      LP.toast('Snapshot name and size are required.', 'error');
      return;
    }
    LP.toast('Creating snapshot…', 'info');
    getModal('snapshotModal').hide();
    try {
      const res = await apiPost('/api/plugins/lvm-manager/snapshot', { origin, vg, name, size: parseInt(size) });
      if (res?.success) {
        showLog('lvcreate Snapshot Output', res.data?.output || 'Done.');
        LP.toast('Snapshot created!', 'success');
      } else {
        showLog('Error', res?.message || 'Unknown error', true);
        LP.toast(res?.message || 'Failed', 'error');
      }
    } catch (e) {
      showLog('Error', e.message, true);
      LP.toast('Network error', 'error');
    }
  }

  async function restoreSnapshot(snapName, vg) {
    if (!confirm(\`Restore snapshot \${snapName}? This will OVERWRITE the origin volume!\`)) return;
    LP.toast('Restoring snapshot…', 'info');
    try {
      const res = await apiPost('/api/plugins/lvm-manager/restore-snapshot', { snapName, vg });
      if (res?.success) {
        showLog('Restore Output', res.data?.output || 'Done.');
        LP.toast('Snapshot restored!', 'success');
      } else {
        showLog('Error', res?.message || 'Unknown error', true);
        LP.toast(res?.message || 'Failed', 'error');
      }
    } catch (e) {
      showLog('Error', e.message, true);
      LP.toast('Network error', 'error');
    }
  }

  async function installLvm() {
    LP.toast('Installing LVM2…', 'info');
    try {
      const res = await apiPost('/api/plugins/lvm-manager/install-lvm', {});
      if (res?.success) {
        showLog('Install Output', res.data?.output || 'Done.');
        LP.toast('LVM2 installed! Refreshing…', 'success');
        setTimeout(() => location.reload(), 2000);
      } else {
        showLog('Error', res?.message || 'Unknown error', true);
        LP.toast(res?.message || 'Failed', 'error');
      }
    } catch (e) {
      showLog('Error', e.message, true);
    }
  }

  function refresh() {
    const btn = document.getElementById('refreshBtn');
    if (btn) { btn.innerHTML = '<i class="bi bi-arrow-clockwise me-1 spin"></i>Refreshing…'; btn.disabled = true; }
    location.reload();
  }

  return { showInitDiskModal, initDisk, showCreateLvModal, createLv,
           showExtendLvModal, extendLv, showExtendVgModal, extendVg,
           showSnapshotModal, createSnapshot, restoreSnapshot, installLvm, refresh };
})();
</script>

<style>
.spin { animation: spin 1s linear infinite; display:inline-block; }
@keyframes spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
</style>
          `
        });
      } catch (err) {
        res.status(500).send(`LVM Manager Error: ${err.message}`);
      }
    });

    // ── API: Install LVM2 ─────────────────────────────────
    app.post('/api/plugins/lvm-manager/install-lvm', async (req, res) => {
      try {
        let out = '';
        if (await run('which apt-get').catch(() => '')) {
          out = await run('DEBIAN_FRONTEND=noninteractive apt-get install -y lvm2');
        } else if (await run('which dnf').catch(() => '')) {
          out = await run('dnf install -y lvm2');
        } else if (await run('which pacman').catch(() => '')) {
          out = await run('pacman -S --noconfirm lvm2');
        } else {
          return errorResponse(res, 'Cannot detect package manager to install lvm2.', 400);
        }
        return successResponse(res, { output: out }, 'LVM2 installed');
      } catch (e) {
        return errorResponse(res, e.message, 500);
      }
    });

    // ── API: Initialize disk (pvcreate) ───────────────────
    app.post('/api/plugins/lvm-manager/init-disk', async (req, res) => {
      try {
        const { device, vg } = req.body;
        if (!device || !/^\/dev\/[\w]+$/.test(device)) {
          return errorResponse(res, 'Invalid device path', 400);
        }
        let out = await run(`pvcreate -y ${device} 2>&1`);
        if (vg && /^[\w-]+$/.test(vg)) {
          try {
            // Try vgextend first; if VG doesn't exist, create it
            out += '\n' + await run(`vgextend ${vg} ${device} 2>&1 || vgcreate ${vg} ${device} 2>&1`);
          } catch (e) {
            out += '\n' + e.message;
          }
        }
        return successResponse(res, { output: out }, 'Disk initialized');
      } catch (e) {
        return errorResponse(res, e.message, 500);
      }
    });

    // ── API: Create Logical Volume ────────────────────────
    app.post('/api/plugins/lvm-manager/create-lv', async (req, res) => {
      try {
        const { name, vg, size, fs, mount } = req.body;
        if (!name || !/^[\w-]+$/.test(name)) return errorResponse(res, 'Invalid LV name', 400);
        if (!vg || !/^[\w-]+$/.test(vg)) return errorResponse(res, 'Invalid VG name', 400);
        if (!size || size < 1) return errorResponse(res, 'Invalid size', 400);

        let out = await run(`lvcreate -L ${size}G -n ${name} ${vg} 2>&1`);
        const lvPath = `/dev/${vg}/${name}`;

        if (fs && fs !== 'none') {
          out += '\n' + await run(`mkfs.${fs} ${lvPath} 2>&1`);
        }
        if (mount && /^\/[\w/\-_]+$/.test(mount)) {
          out += '\n' + await run(`mkdir -p ${mount} 2>&1`);
          out += '\n' + await run(`mount ${lvPath} ${mount} 2>&1`);
          // Add to fstab if not already there
          const fstabEntry = `${lvPath} ${mount} ${fs || 'ext4'} defaults 0 2`;
          const fstab = await run('cat /etc/fstab').catch(() => '');
          if (!fstab.includes(lvPath)) {
            out += '\n' + await run(`echo '${fstabEntry}' >> /etc/fstab && echo 'Added to /etc/fstab' 2>&1`);
          }
        }
        return successResponse(res, { output: out }, 'Logical Volume created');
      } catch (e) {
        return errorResponse(res, e.message, 500);
      }
    });

    // ── API: Extend Logical Volume ────────────────────────
    app.post('/api/plugins/lvm-manager/extend-lv', async (req, res) => {
      try {
        const { name, vg, size, resizeFs } = req.body;
        if (!name || !/^[\w-]+$/.test(name)) return errorResponse(res, 'Invalid LV name', 400);
        if (!vg || !/^[\w-]+$/.test(vg)) return errorResponse(res, 'Invalid VG name', 400);
        if (!size || size < 1) return errorResponse(res, 'Invalid size', 400);

        const lvPath = `/dev/${vg}/${name}`;
        let out = await run(`lvextend -L +${size}G ${lvPath} 2>&1`);

        if (resizeFs) {
          // Try ext4 resize first, then xfs
          try {
            out += '\n' + await run(`resize2fs ${lvPath} 2>&1`);
          } catch (_) {
            try {
              // XFS requires mount point
              const mount = (await run(`findmnt -n -o TARGET ${lvPath} 2>/dev/null`).catch(() => '')).trim();
              if (mount) out += '\n' + await run(`xfs_growfs ${mount} 2>&1`);
            } catch (_) {}
          }
        }
        return successResponse(res, { output: out }, 'Logical Volume extended');
      } catch (e) {
        return errorResponse(res, e.message, 500);
      }
    });

    // ── API: Extend Volume Group ──────────────────────────
    app.post('/api/plugins/lvm-manager/extend-vg', async (req, res) => {
      try {
        const { vg, device } = req.body;
        if (!vg || !/^[\w-]+$/.test(vg)) return errorResponse(res, 'Invalid VG name', 400);
        if (!device || !/^\/dev\/[\w]+$/.test(device)) return errorResponse(res, 'Invalid device path', 400);

        let out = await run(`pvcreate -y ${device} 2>&1`);
        out += '\n' + await run(`vgextend ${vg} ${device} 2>&1`);
        return successResponse(res, { output: out }, 'Volume Group extended');
      } catch (e) {
        return errorResponse(res, e.message, 500);
      }
    });

    // ── API: Create Snapshot ──────────────────────────────
    app.post('/api/plugins/lvm-manager/snapshot', async (req, res) => {
      try {
        const { origin, vg, name, size } = req.body;
        if (!origin || !/^[\w-]+$/.test(origin)) return errorResponse(res, 'Invalid origin LV', 400);
        if (!vg || !/^[\w-]+$/.test(vg)) return errorResponse(res, 'Invalid VG name', 400);
        if (!name || !/^[\w-]+$/.test(name)) return errorResponse(res, 'Invalid snapshot name', 400);
        if (!size || size < 1) return errorResponse(res, 'Invalid size', 400);

        const out = await run(`lvcreate -s -L ${size}G -n ${name} /dev/${vg}/${origin} 2>&1`);
        return successResponse(res, { output: out }, 'Snapshot created');
      } catch (e) {
        return errorResponse(res, e.message, 500);
      }
    });

    // ── API: Restore Snapshot ─────────────────────────────
    app.post('/api/plugins/lvm-manager/restore-snapshot', async (req, res) => {
      try {
        const { snapName, vg } = req.body;
        if (!snapName || !/^[\w-]+$/.test(snapName)) return errorResponse(res, 'Invalid snapshot name', 400);
        if (!vg || !/^[\w-]+$/.test(vg)) return errorResponse(res, 'Invalid VG name', 400);

        // Merge snapshot into origin (requires origin to be unmounted or use --background)
        const out = await run(`lvconvert --merge /dev/${vg}/${snapName} 2>&1`);
        return successResponse(res, { output: out }, 'Snapshot merge scheduled');
      } catch (e) {
        return errorResponse(res, e.message, 500);
      }
    });
  }
};
