/**
 * LVM & Software RAID Manager Page Controller
 */

/* global LP, bootstrap */

window.LvmManagerPage = (function() {
  let cachedDisks = [];
  let cachedRaids = [];
  let cachedPVs = [];
  let cachedVGs = [];
  let cachedLVs = [];

  function init() {
    refreshAll();
  }

  async function refreshAll() {
    await Promise.all([
      fetchDisks(),
      fetchRaids(),
      fetchPVs(),
      fetchVGs(),
      fetchLVs(),
    ]);
    populateSmartDriveSelect();
  }

  // ── 1. Disks API ──────────────────────────────────────────────
  async function fetchDisks() {
    try {
      const res = await LP.api('/api/lvm-manager/disks');
      if (res.success) {
        cachedDisks = res.data || [];
        renderDisksTable(cachedDisks);
      }
    } catch (err) {
      LP.toast('Failed to load disk list: ' + err.message, 'danger');
    }
  }

  function renderDisksTable(disks) {
    const tbody = document.getElementById('disksTableBody');
    if (!tbody) return;
    if (!disks.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No storage disks detected.</td></tr>';
      return;
    }

    tbody.innerHTML = disks.map(d => `
      <tr>
        <td><strong>${LP.escapeHtml(d.path || d.name)}</strong></td>
        <td>
          <div style="font-size:13px; font-weight:500;">${LP.escapeHtml(d.model || 'Generic Disk')}</div>
          <small class="text-muted" style="font-size:11px;">SN: ${LP.escapeHtml(d.serial || 'N/A')}</small>
        </td>
        <td><span class="badge bg-secondary font-monospace">${LP.escapeHtml(String(d.size))}</span></td>
        <td><span class="lp-badge ${d.type === 'disk' ? 'lp-badge-primary' : 'lp-badge-info'}">${LP.escapeHtml(d.type || 'disk')}</span></td>
        <td>${d.fstype ? `<span class="badge bg-dark">${LP.escapeHtml(d.fstype)}</span>` : '<span class="text-muted">-</span>'}</td>
        <td>${d.mountpoint ? `<code style="font-size:11px;">${LP.escapeHtml(d.mountpoint)}</code>` : '<span class="text-muted">Unmounted</span>'}</td>
        <td>
          <button class="btn-lp btn-lp-xs btn-lp-secondary me-1" onclick="LvmManagerPage.viewSmart('${LP.escapeHtml(d.path)}')"><i class="bi bi-heart-pulse"></i> SMART</button>
          <button class="btn-lp btn-lp-xs btn-lp-info" onclick="LvmManagerPage.quickCreatePv('${LP.escapeHtml(d.path)}')"><i class="bi bi-plus-circle"></i> Init PV</button>
        </td>
      </tr>
    `).join('');
  }

  // ── 2. RAID API ───────────────────────────────────────────────
  async function fetchRaids() {
    try {
      const res = await LP.api('/api/lvm-manager/raid');
      if (res.success) {
        cachedRaids = res.data || [];
        renderRaidArrays(cachedRaids);
      }
    } catch (err) {
      LP.toast('Failed to load RAID arrays: ' + err.message, 'danger');
    }
  }

  function renderRaidArrays(arrays) {
    const container = document.getElementById('raidArraysContainer');
    if (!container) return;
    if (!arrays.length) {
      container.innerHTML = '<div class="col-12 text-center text-muted py-4">No active software RAID arrays detected.</div>';
      return;
    }

    container.innerHTML = arrays.map(r => `
      <div class="col-12 col-md-6 col-lg-4">
        <div class="lp-glass-card" style="padding:16px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <h6 style="font-size:16px; font-weight:700; margin:0;"><i class="bi bi-disc text-primary me-2"></i>${LP.escapeHtml(r.name || r.path)}</h6>
            <span class="lp-badge lp-badge-success">${LP.escapeHtml(String(r.level).toUpperCase())}</span>
          </div>
          <p style="font-size:12px; color:var(--text-muted); margin-bottom:8px;">Path: <code>${LP.escapeHtml(r.path)}</code></p>
          <p style="font-size:12px; color:var(--text-muted); margin-bottom:12px;">Active Disks: ${r.activeDevices || r.devices?.length || 0} / ${r.totalDevices || r.devices?.length || 0}</p>
          <div style="font-size:11px; color:var(--text-muted); margin-bottom:12px;">
            Members: ${(r.devices || []).map(d => `<span class="badge bg-dark me-1">${LP.escapeHtml(d)}</span>`).join('')}
          </div>
          <div style="display:flex; gap:6px;">
            <button class="btn-lp btn-lp-xs btn-lp-primary flex-grow-1" onclick="LvmManagerPage.openFormatMountModal('${LP.escapeHtml(r.path)}')"><i class="bi bi-folder-plus"></i> Format / Mount</button>
            <button class="btn-lp btn-lp-xs btn-lp-danger" onclick="LvmManagerPage.stopRaid('${LP.escapeHtml(r.path)}')"><i class="bi bi-stop-circle"></i> Stop</button>
          </div>
        </div>
      </div>
    `).join('');
  }

  function openCreateRaidModal() {
    const list = document.getElementById('raidMemberDisksList');
    if (list) {
      const candidates = cachedDisks.filter(d => d.type === 'disk' && !d.mountpoint);
      if (!candidates.length) {
        list.innerHTML = '<span class="text-muted small">No unused unmounted physical disks available.</span>';
      } else {
        list.innerHTML = candidates.map(d => `
          <div class="form-check">
            <input class="form-check-input raid-disk-checkbox" type="checkbox" value="${LP.escapeHtml(d.path)}" id="raidDisk_${d.name}">
            <label class="form-check-label small" for="raidDisk_${d.name}">${LP.escapeHtml(d.path)} (${LP.escapeHtml(d.size)} - ${LP.escapeHtml(d.model || '')})</label>
          </div>
        `).join('');
      }
    }
    const modal = new bootstrap.Modal(document.getElementById('createRaidModal'));
    modal.show();
  }

  async function submitCreateRaid() {
    const name = document.getElementById('raidName').value.trim();
    const level = document.getElementById('raidLevel').value;
    const checkboxes = document.querySelectorAll('.raid-disk-checkbox:checked');
    const devices = Array.from(checkboxes).map(c => c.value);

    if (!name || !devices.length) {
      LP.toast('Please specify a RAID device name and select at least one drive.', 'warning');
      return;
    }

    try {
      const res = await LP.api('/api/lvm-manager/raid/create', 'POST', { name, level, devices });
      if (res.success) {
        LP.toast(res.message || 'RAID array created successfully!', 'success');
        bootstrap.Modal.getInstance(document.getElementById('createRaidModal')).hide();
        refreshAll();
      }
    } catch (err) {
      LP.toast('Failed to create RAID: ' + err.message, 'danger');
    }
  }

  async function stopRaid(mdDevice) {
    if (!confirm(`Are you sure you want to stop RAID array ${mdDevice}?`)) return;
    try {
      const res = await LP.api('/api/lvm-manager/raid/stop', 'POST', { mdDevice });
      if (res.success) {
        LP.toast(res.message, 'success');
        refreshAll();
      }
    } catch (err) {
      LP.toast('Failed to stop RAID: ' + err.message, 'danger');
    }
  }

  // ── 3. Physical Volumes (PV) API ──────────────────────────────
  async function fetchPVs() {
    try {
      const res = await LP.api('/api/lvm-manager/pvs');
      if (res.success) {
        cachedPVs = res.data || [];
        renderPvTable(cachedPVs);
      }
    } catch (err) {
      LP.toast('Failed to load Physical Volumes: ' + err.message, 'danger');
    }
  }

  function renderPvTable(pvs) {
    const tbody = document.getElementById('pvTableBody');
    if (!tbody) return;
    if (!pvs.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No Physical Volumes found.</td></tr>';
      return;
    }

    tbody.innerHTML = pvs.map(p => `
      <tr>
        <td><code>${LP.escapeHtml(p.pvName)}</code></td>
        <td>${p.vgName && p.vgName !== '-' ? `<span class="badge bg-warning text-dark">${LP.escapeHtml(p.vgName)}</span>` : '<span class="text-muted">Unassigned</span>'}</td>
        <td><span class="badge bg-dark">${LP.escapeHtml(p.pvSize)}</span></td>
        <td><span class="badge bg-secondary">${LP.escapeHtml(p.pvFree)}</span></td>
        <td>
          <button class="btn-lp btn-lp-xs btn-lp-danger" onclick="LvmManagerPage.removePv('${LP.escapeHtml(p.pvName)}')"><i class="bi bi-trash"></i> Remove PV</button>
        </td>
      </tr>
    `).join('');
  }

  function openCreatePvModal() {
    document.getElementById('pvDevicePath').value = '';
    const modal = new bootstrap.Modal(document.getElementById('createPvModal'));
    modal.show();
  }

  function quickCreatePv(devicePath) {
    document.getElementById('pvDevicePath').value = devicePath;
    const modal = new bootstrap.Modal(document.getElementById('createPvModal'));
    modal.show();
  }

  async function submitCreatePv() {
    const devicePath = document.getElementById('pvDevicePath').value.trim();
    if (!devicePath) return;

    try {
      const res = await LP.api('/api/lvm-manager/pv/create', 'POST', { devicePath });
      if (res.success) {
        LP.toast(res.message, 'success');
        bootstrap.Modal.getInstance(document.getElementById('createPvModal')).hide();
        refreshAll();
      }
    } catch (err) {
      LP.toast('Failed to create PV: ' + err.message, 'danger');
    }
  }

  async function removePv(devicePath) {
    if (!confirm(`Are you sure you want to remove Physical Volume ${devicePath}?`)) return;
    try {
      const res = await LP.api('/api/lvm-manager/pv/remove', 'POST', { devicePath });
      if (res.success) {
        LP.toast(res.message, 'success');
        refreshAll();
      }
    } catch (err) {
      LP.toast('Failed to remove PV: ' + err.message, 'danger');
    }
  }

  // ── 4. Volume Groups (VG) API ─────────────────────────────────
  async function fetchVGs() {
    try {
      const res = await LP.api('/api/lvm-manager/vgs');
      if (res.success) {
        cachedVGs = res.data || [];
        renderVgTable(cachedVGs);
        populateVgSelectOptions();
      }
    } catch (err) {
      LP.toast('Failed to load Volume Groups: ' + err.message, 'danger');
    }
  }

  function renderVgTable(vgs) {
    const tbody = document.getElementById('vgTableBody');
    if (!tbody) return;
    if (!vgs.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No Volume Groups found.</td></tr>';
      return;
    }

    tbody.innerHTML = vgs.map(v => `
      <tr>
        <td><strong class="text-warning">${LP.escapeHtml(v.vgName)}</strong></td>
        <td><span class="badge bg-info">${v.pvCount} PVs</span></td>
        <td><span class="badge bg-success">${v.lvCount} LVs</span></td>
        <td><span class="badge bg-dark">${LP.escapeHtml(v.vgSize)}</span></td>
        <td><span class="badge bg-secondary">${LP.escapeHtml(v.vgFree)}</span></td>
        <td>
          <button class="btn-lp btn-lp-xs btn-lp-warning me-1" onclick="LvmManagerPage.openExtendVgModal('${LP.escapeHtml(v.vgName)}')"><i class="bi bi-plus"></i> Extend</button>
          <button class="btn-lp btn-lp-xs btn-lp-danger" onclick="LvmManagerPage.removeVg('${LP.escapeHtml(v.vgName)}')"><i class="bi bi-trash"></i> Delete VG</button>
        </td>
      </tr>
    `).join('');
  }

  function populateVgSelectOptions() {
    const select = document.getElementById('createLvVgSelect');
    if (!select) return;
    select.innerHTML = cachedVGs.map(v => `<option value="${LP.escapeHtml(v.vgName)}">${LP.escapeHtml(v.vgName)} (Free: ${LP.escapeHtml(v.vgFree)})</option>`).join('');
  }

  function openCreateVgModal() {
    document.getElementById('vgNameInput').value = '';
    const list = document.getElementById('vgPvSelectList');
    if (list) {
      list.innerHTML = cachedPVs.map(p => `
        <div class="form-check">
          <input class="form-check-input vg-pv-checkbox" type="checkbox" value="${LP.escapeHtml(p.pvName)}" id="vgPv_${p.pvName.replace(/\//g, '_')}">
          <label class="form-check-label small" for="vgPv_${p.pvName.replace(/\//g, '_')}">${LP.escapeHtml(p.pvName)} (Size: ${LP.escapeHtml(p.pvSize)}, VG: ${LP.escapeHtml(p.vgName)})</label>
        </div>
      `).join('');
    }
    const modal = new bootstrap.Modal(document.getElementById('createVgModal'));
    modal.show();
  }

  async function submitCreateVg() {
    const vgName = document.getElementById('vgNameInput').value.trim();
    const checkboxes = document.querySelectorAll('.vg-pv-checkbox:checked');
    const devices = Array.from(checkboxes).map(c => c.value);

    if (!vgName || !devices.length) {
      LP.toast('Please provide a VG name and select at least one PV device.', 'warning');
      return;
    }

    try {
      const res = await LP.api('/api/lvm-manager/vg/create', 'POST', { vgName, devices });
      if (res.success) {
        LP.toast(res.message, 'success');
        bootstrap.Modal.getInstance(document.getElementById('createVgModal')).hide();
        refreshAll();
      }
    } catch (err) {
      LP.toast('Failed to create VG: ' + err.message, 'danger');
    }
  }

  function openExtendVgModal(vgName) {
    document.getElementById('extendVgTargetName').value = vgName;
    const list = document.getElementById('extendVgPvSelectList');
    if (list) {
      const unusedPv = cachedPVs.filter(p => p.vgName === '-' || !p.vgName);
      if (!unusedPv.length) {
        list.innerHTML = '<span class="text-muted small">No unassigned Physical Volumes available. Create a PV first.</span>';
      } else {
        list.innerHTML = unusedPv.map(p => `
          <div class="form-check">
            <input class="form-check-input extend-vg-pv-checkbox" type="checkbox" value="${LP.escapeHtml(p.pvName)}" id="extVgPv_${p.pvName.replace(/\//g, '_')}">
            <label class="form-check-label small" for="extVgPv_${p.pvName.replace(/\//g, '_')}">${LP.escapeHtml(p.pvName)} (${LP.escapeHtml(p.pvSize)})</label>
          </div>
        `).join('');
      }
    }
    const modal = new bootstrap.Modal(document.getElementById('extendVgModal'));
    modal.show();
  }

  async function submitExtendVg() {
    const vgName = document.getElementById('extendVgTargetName').value;
    const checkboxes = document.querySelectorAll('.extend-vg-pv-checkbox:checked');
    const devices = Array.from(checkboxes).map(c => c.value);

    if (!devices.length) {
      LP.toast('Please select at least one PV device to add to VG.', 'warning');
      return;
    }

    try {
      const res = await LP.api('/api/lvm-manager/vg/extend', 'POST', { vgName, devices });
      if (res.success) {
        LP.toast(res.message, 'success');
        bootstrap.Modal.getInstance(document.getElementById('extendVgModal')).hide();
        refreshAll();
      }
    } catch (err) {
      LP.toast('Failed to extend VG: ' + err.message, 'danger');
    }
  }

  async function removeVg(vgName) {
    if (!confirm(`Are you sure you want to remove Volume Group ${vgName}? All Logical Volumes inside will be deleted.`)) return;
    try {
      const res = await LP.api('/api/lvm-manager/vg/remove', 'POST', { vgName });
      if (res.success) {
        LP.toast(res.message, 'success');
        refreshAll();
      }
    } catch (err) {
      LP.toast('Failed to remove VG: ' + err.message, 'danger');
    }
  }

  // ── 5. Logical Volumes (LV) API ───────────────────────────────
  async function fetchLVs() {
    try {
      const res = await LP.api('/api/lvm-manager/lvs');
      if (res.success) {
        cachedLVs = res.data || [];
        renderLvTable(cachedLVs);
      }
    } catch (err) {
      LP.toast('Failed to load Logical Volumes: ' + err.message, 'danger');
    }
  }

  function renderLvTable(lvs) {
    const tbody = document.getElementById('lvTableBody');
    if (!tbody) return;
    if (!lvs.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No Logical Volumes found.</td></tr>';
      return;
    }

    tbody.innerHTML = lvs.map(l => `
      <tr>
        <td><strong class="text-success">${LP.escapeHtml(l.lvName)}</strong></td>
        <td><span class="badge bg-warning text-dark">${LP.escapeHtml(l.vgName)}</span></td>
        <td><code>${LP.escapeHtml(l.path)}</code></td>
        <td><span class="badge bg-dark">${LP.escapeHtml(l.size)}</span></td>
        <td>
          ${l.fstype ? `<span class="badge bg-info me-1">${LP.escapeHtml(l.fstype)}</span>` : '<span class="badge bg-secondary me-1">Unformatted</span>'}
          ${l.mountpoint ? `<code style="font-size:11px;">${LP.escapeHtml(l.mountpoint)}</code>` : '<span class="text-muted">Unmounted</span>'}
        </td>
        <td>
          <button class="btn-lp btn-lp-xs btn-lp-primary me-1" onclick="LvmManagerPage.openFormatMountModal('${LP.escapeHtml(l.path)}')"><i class="bi bi-folder-plus"></i> Format/Mount</button>
          <button class="btn-lp btn-lp-xs btn-lp-success me-1" onclick="LvmManagerPage.openExtendLvModal('${LP.escapeHtml(l.vgName)}', '${LP.escapeHtml(l.lvName)}')"><i class="bi bi-arrows-angle-expand"></i> Extend</button>
          <button class="btn-lp btn-lp-xs btn-lp-danger" onclick="LvmManagerPage.removeLv('${LP.escapeHtml(l.vgName)}', '${LP.escapeHtml(l.lvName)}')"><i class="bi bi-trash"></i> Delete</button>
        </td>
      </tr>
    `).join('');
  }

  function openCreateLvModal() {
    document.getElementById('lvNameInput').value = '';
    document.getElementById('lvSizeInput').value = '';
    const modal = new bootstrap.Modal(document.getElementById('createLvModal'));
    modal.show();
  }

  async function submitCreateLv() {
    const vgName = document.getElementById('createLvVgSelect').value;
    const lvName = document.getElementById('lvNameInput').value.trim();
    const size = document.getElementById('lvSizeInput').value.trim();

    if (!vgName || !lvName || !size) {
      LP.toast('Please fill in all required fields for LV creation.', 'warning');
      return;
    }

    try {
      const res = await LP.api('/api/lvm-manager/lv/create', 'POST', { vgName, lvName, size });
      if (res.success) {
        LP.toast(res.message || 'Logical Volume created!', 'success');
        bootstrap.Modal.getInstance(document.getElementById('createLvModal')).hide();
        refreshAll();
      }
    } catch (err) {
      LP.toast('Failed to create LV: ' + err.message, 'danger');
    }
  }

  function openExtendLvModal(vgName, lvName) {
    document.getElementById('extendLvVgName').value = vgName;
    document.getElementById('extendLvName').value = lvName;
    document.getElementById('extendLvSizeInput').value = '';
    const modal = new bootstrap.Modal(document.getElementById('extendLvModal'));
    modal.show();
  }

  async function submitExtendLv() {
    const vgName = document.getElementById('extendLvVgName').value;
    const lvName = document.getElementById('extendLvName').value;
    const size = document.getElementById('extendLvSizeInput').value.trim();
    const resizeFs = document.getElementById('extendLvResizeFs').checked;

    if (!size) {
      LP.toast('Please enter additional size to extend.', 'warning');
      return;
    }

    try {
      const res = await LP.api('/api/lvm-manager/lv/extend', 'POST', { vgName, lvName, size, resizeFs });
      if (res.success) {
        LP.toast(res.message, 'success');
        bootstrap.Modal.getInstance(document.getElementById('extendLvModal')).hide();
        refreshAll();
      }
    } catch (err) {
      LP.toast('Failed to extend LV: ' + err.message, 'danger');
    }
  }

  async function removeLv(vgName, lvName) {
    if (!confirm(`Are you sure you want to delete Logical Volume ${lvName} from VG ${vgName}? All data will be lost!`)) return;
    try {
      const res = await LP.api('/api/lvm-manager/lv/remove', 'POST', { vgName, lvName });
      if (res.success) {
        LP.toast(res.message, 'success');
        refreshAll();
      }
    } catch (err) {
      LP.toast('Failed to remove LV: ' + err.message, 'danger');
    }
  }

  // ── 6. Format & Mount API ─────────────────────────────────────
  function openFormatMountModal(devicePath) {
    document.getElementById('fmDevicePath').value = devicePath;
    document.getElementById('fmMountPoint').value = `/mnt/${devicePath.replace('/dev/', '').replace(/\//g, '_')}`;
    const modal = new bootstrap.Modal(document.getElementById('formatMountModal'));
    modal.show();
  }

  async function submitFormatMount() {
    const devicePath = document.getElementById('fmDevicePath').value;
    const fsType = document.getElementById('fmFsType').value;
    const mountPoint = document.getElementById('fmMountPoint').value.trim();
    const fstabPersist = document.getElementById('fmFstabPersist').checked;

    if (!devicePath || !mountPoint) {
      LP.toast('Device path and mount point are required.', 'warning');
      return;
    }

    try {
      // Step 1: Format
      const formatRes = await LP.api('/api/lvm-manager/volume/format', 'POST', { devicePath, fsType });
      if (!formatRes.success) throw new Error(formatRes.message);

      // Step 2: Mount with /etc/fstab persistence
      const mountRes = await LP.api('/api/lvm-manager/volume/mount', 'POST', { devicePath, mountPoint, fstabPersist });
      if (mountRes.success) {
        LP.toast(`Formatted as ${fsType} and mounted at ${mountPoint}!`, 'success');
        bootstrap.Modal.getInstance(document.getElementById('formatMountModal')).hide();
        refreshAll();
      }
    } catch (err) {
      LP.toast('Format & Mount failed: ' + err.message, 'danger');
    }
  }

  // ── 7. SMART Health Diagnostics ───────────────────────────────
  function populateSmartDriveSelect() {
    const select = document.getElementById('smartDriveSelect');
    if (!select) return;
    const currentValue = select.value;
    select.innerHTML = '<option value="">-- Choose Device --</option>' + cachedDisks.map(d => `
      <option value="${LP.escapeHtml(d.path)}">${LP.escapeHtml(d.path)} (${LP.escapeHtml(d.model || 'Disk')})</option>
    `).join('');
    if (currentValue) select.value = currentValue;
  }

  function viewSmart(devicePath) {
    document.getElementById('smart-tab').click();
    const select = document.getElementById('smartDriveSelect');
    if (select) {
      select.value = devicePath;
      fetchSmartDetails(devicePath);
    }
  }

  async function fetchSmartDetails(devicePath) {
    const container = document.getElementById('smartDetailsContainer');
    if (!devicePath) {
      container.innerHTML = '<div class="text-center text-muted py-4">Select a drive above to view S.M.A.R.T. health diagnostics.</div>';
      return;
    }

    container.innerHTML = '<div class="text-center text-muted py-4"><div class="spinner-border spinner-border-sm me-2"></div>Reading S.M.A.R.T. health data...</div>';

    try {
      const res = await LP.api(`/api/lvm-manager/smart?device=${encodeURIComponent(devicePath)}`);
      if (res.success) {
        const s = res.data;
        container.innerHTML = `
          <div class="row g-3">
            <div class="col-12 col-md-4">
              <div class="p-3 border rounded" style="background:rgba(0,0,0,0.2);">
                <small class="text-muted d-block mb-1">Health Status</small>
                <h4 class="${s.passed ? 'text-success' : 'text-danger'} font-weight-bold mb-0">
                  <i class="bi ${s.passed ? 'bi-check-circle-fill' : 'bi-x-circle-fill'} me-2"></i>${LP.escapeHtml(s.healthStatus || 'OK')}
                </h4>
              </div>
            </div>
            <div class="col-12 col-md-4">
              <div class="p-3 border rounded" style="background:rgba(0,0,0,0.2);">
                <small class="text-muted d-block mb-1">Drive Temperature</small>
                <h4 class="text-info font-weight-bold mb-0">${s.temperature !== null ? `${s.temperature} °C` : 'N/A'}</h4>
              </div>
            </div>
            <div class="col-12 col-md-4">
              <div class="p-3 border rounded" style="background:rgba(0,0,0,0.2);">
                <small class="text-muted d-block mb-1">Reallocated Sectors</small>
                <h4 class="${s.reallocatedSectors > 0 ? 'text-warning' : 'text-light'} font-weight-bold mb-0">${s.reallocatedSectors}</h4>
              </div>
            </div>
            <div class="col-12">
              <table class="table lp-table table-sm align-middle mt-2">
                <tr><th>Device Path</th><td><code>${LP.escapeHtml(s.device)}</code></td></tr>
                <tr><th>Model Name</th><td>${LP.escapeHtml(s.model)}</td></tr>
                <tr><th>Serial Number</th><td><code>${LP.escapeHtml(s.serial)}</code></td></tr>
                <tr><th>Power On Hours</th><td>${s.powerOnHours !== null ? `${s.powerOnHours} hours` : 'N/A'}</td></tr>
              </table>
            </div>
          </div>
        `;
      }
    } catch (err) {
      container.innerHTML = `<div class="alert alert-danger mb-0">Failed to fetch SMART status: ${LP.escapeHtml(err.message)}</div>`;
    }
  }

  // Document ready handler
  document.addEventListener('DOMContentLoaded', init);

  return {
    refreshAll,
    openCreateRaidModal,
    submitCreateRaid,
    stopRaid,
    openCreatePvModal,
    quickCreatePv,
    submitCreatePv,
    removePv,
    openCreateVgModal,
    submitCreateVg,
    openExtendVgModal,
    submitExtendVg,
    removeVg,
    openCreateLvModal,
    submitCreateLv,
    openExtendLvModal,
    submitExtendLv,
    removeLv,
    openFormatMountModal,
    submitFormatMount,
    viewSmart,
    fetchSmartDetails,
  };
})();
