const GPU = (() => {
  async function loadData() {
    const noGpuEl = document.getElementById('gpuNoGpu');
    const contentEl = document.getElementById('gpuContent');
    noGpuEl.style.display = 'none';
    contentEl.style.display = 'none';

    try {
      const res = await LP.get('/gpu/status');
      if (res?.success && res.data) {
        if (!res.data.available || res.data.count === 0) {
          noGpuEl.style.display = 'block';
          return;
        }
        contentEl.style.display = 'block';
        renderInfoCards(res.data);
        renderGpuCards(res.data.gpus);
        renderPowerSelect(res.data.gpus);
        loadProcesses();
      } else {
        noGpuEl.style.display = 'block';
      }
    } catch { noGpuEl.style.display = 'block'; }
  }

  function renderInfoCards(info) {
    const cards = [
      { label: 'GPUs', value: info.count, icon: 'bi-cpu', color: 'text-primary' },
      { label: 'Driver', value: info.driverVersion || '—', icon: 'bi-gear', color: 'text-info' },
      { label: 'CUDA', value: info.cudaVersion || 'Not found', icon: 'bi-box', color: 'text-success' },
      { label: 'cuDNN', value: info.cudnnVersion || 'Not found', icon: 'bi-layers', color: 'text-warning' },
    ];
    document.getElementById('gpuInfoCards').innerHTML = cards.map(c => `
      <div class="lp-glass-card" style="padding:15px;text-align:center;">
        <i class="bi ${c.icon} ${c.color}" style="font-size:24px;"></i>
        <div style="font-size:20px;font-weight:700;margin:5px 0;">${c.value}</div>
        <div style="font-size:11px;color:var(--text-muted);">${c.label}</div>
      </div>
    `).join('');
  }

  function renderGpuCards(gpus) {
    const el = document.getElementById('gpuCards');
    el.innerHTML = gpus.map((gpu, idx) => `
      <div class="lp-glass-card" style="padding:20px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;">
          <div>
            <h5 style="font-size:15px;font-weight:600;margin:0;">GPU ${gpu.index}: ${gpu.name}</h5>
            <span style="font-size:11px;color:var(--text-muted);">UUID: ${gpu.uuid?.substring(0, 20)}... | PCIe Gen ${gpu.pcieGen} x${gpu.pcieWidth}</span>
          </div>
          <div style="display:flex;gap:15px;align-items:center;">
            <span style="font-size:11px;color:var(--text-muted);">${gpu.temperature}°C</span>
            <span style="font-size:11px;color:var(--text-muted);">Fan: ${gpu.fanSpeed}%</span>
          </div>
        </div>
        <!-- Gauges -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;">
          <div>
            <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:5px;">
              <span>GPU Utilization</span><span>${gpu.gpuUtil}%</span>
            </div>
            <div style="height:8px;background:rgba(255,255,255,0.08);border-radius:4px;overflow:hidden;">
              <div style="width:${gpu.gpuUtil}%;height:100%;background:${gpu.gpuUtil > 80 ? '#ef4444' : gpu.gpuUtil > 50 ? '#f59e0b' : '#22c55e'};border-radius:4px;transition:width 0.5s;"></div>
            </div>
          </div>
          <div>
            <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:5px;">
              <span>Memory Utilization</span><span>${gpu.memUtil}%</span>
            </div>
            <div style="height:8px;background:rgba(255,255,255,0.08);border-radius:4px;overflow:hidden;">
              <div style="width:${gpu.memUtil}%;height:100%;background:${gpu.memUtil > 80 ? '#ef4444' : gpu.memUtil > 50 ? '#f59e0b' : '#22c55e'};border-radius:4px;transition:width 0.5s;"></div>
            </div>
          </div>
          <div>
            <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:5px;">
              <span>Power</span><span>${gpu.powerDraw}W / ${gpu.powerLimit}W</span>
            </div>
            <div style="height:8px;background:rgba(255,255,255,0.08);border-radius:4px;overflow:hidden;">
              <div style="width:${gpu.powerLimit > 0 ? (gpu.powerDraw / gpu.powerLimit * 100).toFixed(0) : 0}%;height:100%;background:#6366f1;border-radius:4px;transition:width 0.5s;"></div>
            </div>
          </div>
        </div>
        <!-- Details -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:15px;padding-top:15px;border-top:1px solid rgba(255,255,255,0.05);font-size:11px;color:var(--text-muted);">
          <div><strong>Memory:</strong> ${(gpu.memUsed / 1024).toFixed(1)}GB / ${(gpu.memTotal / 1024).toFixed(1)}GB</div>
          <div><strong>Clocks:</strong> ${gpu.clockGraphics}MHz / ${gpu.clockMemory}MHz</div>
          <div><strong>Fan:</strong> ${gpu.fanSpeed}%</div>
          <div><strong>Temp:</strong> ${gpu.temperature}°C</div>
        </div>
      </div>
    `).join('');
  }

  async function loadProcesses() {
    try {
      const res = await LP.get('/gpu/processes');
      if (res?.success) {
        const procs = res.data.processes || [];
        document.getElementById('gpuProcessCount').textContent = `(${procs.length} running)`;
        const tbody = document.getElementById('gpuProcessesBody');
        if (procs.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" class="text-muted" style="text-align:center;">No processes using GPU.</td></tr>';
          return;
        }
        tbody.innerHTML = procs.map(p => `
          <tr>
            <td>${p.pid}</td>
            <td>${LP.escHtml(p.name)}</td>
            <td>${p.usedMemory} MB</td>
            <td>${p.busId}</td>
            <td>
              <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="GPU.killProcess(${p.pid}, '${LP.encJsArg(p.name)}')"><i class="bi bi-x-circle"></i> Kill</button>
            </td>
          </tr>
        `).join('');
      }
    } catch {}
  }

  function renderPowerSelect(gpus) {
    const sel = document.getElementById('gpuPowerSelect');
    sel.innerHTML = gpus.map(g => `<option value="${g.index}">GPU ${g.index}: ${g.name}</option>`).join('');
  }

  async function killProcess(pid, name) {
    if (!(await LP.confirm(`Kill process ${pid} (${name})?`, 'Kill Process'))) return;
    try {
      const res = await LP.post('/gpu/kill', { pid });
      if (res?.success) { LP.toast('Process killed: ' + res.data.method, 'success'); loadProcesses(); }
      else LP.toast('Failed to kill process', 'error');
    } catch { LP.toast('Error killing process', 'error'); }
  }

  async function setPowerLimit() {
    const gpuIndex = document.getElementById('gpuPowerSelect').value;
    const watts = document.getElementById('gpuPowerWatts').value;
    if (!watts) { LP.toast('Enter power limit in watts', 'error'); return; }
    try {
      const res = await LP.post('/gpu/power-limit', { gpuIndex: parseInt(gpuIndex), watts: parseInt(watts) });
      if (res?.success) LP.toast(`Power limit set to ${watts}W`, 'success');
      else LP.toast('Failed', 'error');
    } catch { LP.toast('Error', 'error'); }
  }

  async function resetGpu() {
    const gpuIndex = document.getElementById('gpuPowerSelect').value;
    if (!(await LP.confirm(`Reset GPU ${gpuIndex}? This may disrupt running processes.`, 'Reset GPU'))) return;
    try {
      const res = await LP.post('/gpu/reset', { gpuIndex: parseInt(gpuIndex) });
      if (res?.success) LP.toast('GPU reset initiated', 'success');
      else LP.toast('Failed', 'error');
    } catch { LP.toast('Error', 'error'); }
  }

  async function checkGpu() { loadData(); }

  document.addEventListener('DOMContentLoaded', loadData);

  return { loadData, checkGpu, killProcess, setPowerLimit, resetGpu };
})();

window.GPU = GPU;
