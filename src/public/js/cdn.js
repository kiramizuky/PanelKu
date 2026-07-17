const CDN = (() => {
  let cfKey = '', cfEmail = '', _cfZoneId = '';

  async function loadData() {
    await Promise.allSettled([loadVarnish(), loadRedis(), loadFpc()]);
  }

  // ── Cloudflare ───────────────────────────────────────

  async function loadCfZones() {
    cfKey = document.getElementById('cfApiKey').value.trim();
    cfEmail = document.getElementById('cfEmail').value.trim();
    if (!cfKey || !cfEmail) { LP.toast('Enter API key and email', 'error'); return; }

    try {
      const res = await LP.post('/cdn/cloudflare/zones', { apiKey: cfKey, email: cfEmail });
      if (res?.success && res.data.zones) {
        document.getElementById('cfZoneContent').style.display = 'block';
        document.getElementById('cfZonesList').innerHTML = res.data.zones.map(z => `
          <div class="lp-glass-card" style="padding:12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
            <div>
              <strong>${LP.escHtml(z.name)}</strong>
              <span class="text-muted" style="font-size:11px;margin-left:10px;">${z.status} | ${z.plan || 'Free'}</span>
            </div>
            <div style="display:flex;gap:6px;">
              <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="CDN.purgeZone('${z.id}','${LP.encJsArg(z.name)}')"><i class="bi bi-trash"></i> Purge</button>
            </div>
          </div>
        `).join('');
        LP.toast(`Found ${res.data.zones.length} zones`, 'success');
      } else LP.toast('Failed to load zones', 'error');
    } catch { LP.toast('Cloudflare API error', 'error'); }
  }

  async function purgeZone(zoneId, zoneName) {
    if (!(await LP.confirm(`Purge cache for ${zoneName}?`, 'Purge Cache'))) return;
    try {
      const res = await LP.post('/cdn/cloudflare/purge', { apiKey: cfKey, email: cfEmail, zoneId });
      if (res?.success) LP.toast(`${zoneName} cache purged`, 'success');
      else LP.toast('Failed', 'error');
    } catch { LP.toast('Error', 'error'); }
  }

  async function purgeAll() {
    if (!cfKey) { LP.toast('Load zones first', 'error'); return; }
    if (!(await LP.confirm('Purge ALL Cloudflare zones?', 'Purge All'))) return;
    try {
      const res = await LP.post('/cdn/cloudflare/zones', { apiKey: cfKey, email: cfEmail });
      if (res?.success && res.data.zones) {
        for (const z of res.data.zones) {
          await LP.post('/cdn/cloudflare/purge', { apiKey: cfKey, email: cfEmail, zoneId: z.id });
        }
        LP.toast('All zones purged', 'success');
      }
    } catch { LP.toast('Error', 'error'); }
  }

  async function loadCfAnalytics() {
    if (!cfKey) { LP.toast('Load zones first', 'error'); return; }
    const el = document.getElementById('cfAnalyticsContent');
    el.style.display = 'block';
    el.innerHTML = '<p class="text-muted">Fetching analytics...</p>';

    try {
      const zonesRes = await LP.post('/cdn/cloudflare/zones', { apiKey: cfKey, email: cfEmail });
      if (zonesRes?.success && zonesRes.data.zones) {
        const html = [];
        for (const z of zonesRes.data.zones.slice(0, 5)) {
          const a = await LP.post('/cdn/cloudflare/analytics', { apiKey: cfKey, email: cfEmail, zoneId: z.id });
          if (a?.success && a.data) {
            html.push(`<div class="lp-glass-card" style="padding:10px;margin-bottom:8px;font-size:12px;">
              <strong>${LP.escHtml(z.name)}</strong>
              <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:8px;">
                <div>Requests: ${a.data.requests?.all || 0}</div>
                <div>Bandwidth: ${(a.data.bandwidth?.all / 1024 / 1024).toFixed(2) || 0} MB</div>
                <div>Threats: ${a.data.threats?.all || 0}</div>
                <div>SSL: ${a.data.requests?.ssl || 0}</div>
              </div>
            </div>`);
          }
        }
        el.innerHTML = html.join('') || '<p class="text-muted">No analytics data.</p>';
      }
    } catch { el.innerHTML = '<p class="text-danger">Failed to load analytics</p>'; }
  }

  // ── Varnish ──────────────────────────────────────────

  async function loadVarnish() {
    const el = document.getElementById('varnishStatus');
    try {
      const res = await LP.get('/cdn/varnish/status');
      if (res?.success) {
        const s = res.data;
        el.innerHTML = `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div>Status: ${s.active ? '<span class="text-success"><i class="bi bi-check-circle"></i> Active</span>' : '<span class="text-danger"><i class="bi bi-x-circle"></i> Inactive</span>'}</div>
            <div>Version: ${s.version || '—'}</div>
          </div>
          ${s.stats ? '<pre style="font-size:11px;margin-top:10px;background:rgba(0,0,0,0.2);padding:10px;border-radius:8px;">' + Object.entries(s.stats).slice(0, 10).map(([k, v]) => k + ': ' + v).join('\n') + '</pre>' : ''}
        `;
        document.getElementById('varnishControls').style.display = 'flex';

        // Load VCL
        const cfgRes = await LP.get('/cdn/varnish/config');
        if (cfgRes?.success) document.getElementById('varnishVclInput').value = cfgRes.data.config || '';
      } else el.innerHTML = '<p class="text-muted">Varnish not available.</p>';
    } catch { el.innerHTML = '<p class="text-danger">Failed</p>'; }
  }

  async function varnishAction(action) {
    try {
      const res = await LP.post('/cdn/varnish/control', { action });
      if (res?.success) { LP.toast(`Varnish ${action}ed`, 'success'); loadVarnish(); }
      else LP.toast('Failed', 'error');
    } catch { LP.toast('Error', 'error'); }
  }

  async function saveVcl() {
    const config = document.getElementById('varnishVclInput').value;
    try {
      const res = await LP.post('/cdn/varnish/config', { config });
      if (res?.success) LP.toast('VCL saved & reloaded', 'success');
      else LP.toast('Failed', 'error');
    } catch { LP.toast('Error', 'error'); }
  }

  async function varnishPurge() {
    try {
      const res = await LP.post('/cdn/varnish/purge');
      if (res?.success) LP.toast('Varnish cache purged', 'success');
      else LP.toast('Failed', 'error');
    } catch { LP.toast('Error', 'error'); }
  }

  // ── Redis Cache ─────────────────────────────────────

  async function loadRedis() {
    const el = document.getElementById('redisCacheInfo');
    try {
      const res = await LP.get('/cdn/redis');
      if (res?.success && Object.keys(res.data).length > 0) {
        el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;">
          <div class="lp-glass-card" style="padding:12px;text-align:center;"><div style="font-size:18px;font-weight:600;color:#22c55e;">${res.data.hits || 0}</div><div style="font-size:11px;color:var(--text-muted);">Cache Hits</div></div>
          <div class="lp-glass-card" style="padding:12px;text-align:center;"><div style="font-size:18px;font-weight:600;color:#ef4444;">${res.data.misses || 0}</div><div style="font-size:11px;color:var(--text-muted);">Cache Misses</div></div>
          <div class="lp-glass-card" style="padding:12px;text-align:center;"><div style="font-size:18px;font-weight:600;color:#6366f1;">${res.data.hitRate || '0%'}</div><div style="font-size:11px;color:var(--text-muted);">Hit Rate</div></div>
          <div class="lp-glass-card" style="padding:12px;text-align:center;"><div style="font-size:18px;font-weight:600;">${res.data.expired || 0}</div><div style="font-size:11px;color:var(--text-muted);">Expired</div></div>
        </div>`;
      } else el.innerHTML = '<p class="text-muted">Redis cache info not available.</p>';
    } catch { el.innerHTML = '<p class="text-danger">Failed</p>'; }
  }

  async function flushRedis() {
    if (!(await LP.confirm('Flush all Redis cache?', 'Flush Redis'))) return;
    try {
      const res = await LP.post('/cdn/redis/flush');
      if (res?.success) { LP.toast('Redis flushed', 'success'); loadRedis(); }
      else LP.toast('Failed', 'error');
    } catch { LP.toast('Error', 'error'); }
  }

  // ── Full Page Cache ─────────────────────────────────

  async function loadFpc() {
    const el = document.getElementById('fpcInfo');
    try {
      const res = await LP.get('/cdn/fpc');
      if (res?.success) {
        el.innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="lp-glass-card" style="padding:12px;text-align:center;"><div style="font-size:18px;font-weight:600;">${res.data.cachedPages || 0}</div><div style="font-size:11px;color:var(--text-muted);">Cached Pages</div></div>
          <div class="lp-glass-card" style="padding:12px;text-align:center;"><div style="font-size:18px;font-weight:600;">${res.data.cacheSize || '0'}</div><div style="font-size:11px;color:var(--text-muted);">Cache Size</div></div>
        </div>
        <div style="margin-top:10px;font-size:12px;">Nginx FPC: ${res.data.nginxFpcEnabled ? '<span class="text-success">Enabled</span>' : '<span class="text-muted">Not detected</span>'}</div>`;
      } else el.innerHTML = '<p class="text-muted">No FPC data.</p>';
    } catch { el.innerHTML = '<p class="text-danger">Failed</p>'; }
  }

  async function flushFpc() {
    if (!(await LP.confirm('Flush full page cache?', 'Flush FPC'))) return;
    try {
      const res = await LP.post('/cdn/fpc/flush');
      if (res?.success) { LP.toast('FPC flushed', 'success'); loadFpc(); }
      else LP.toast('Failed', 'error');
    } catch { LP.toast('Error', 'error'); }
  }

  document.addEventListener('DOMContentLoaded', loadData);

  return { loadData, loadCfZones, purgeZone, purgeAll, loadCfAnalytics,
    loadVarnish, varnishAction, saveVcl, varnishPurge,
    loadRedis, flushRedis, loadFpc, flushFpc };
})();

window.CDN = CDN;
