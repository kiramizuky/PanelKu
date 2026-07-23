/**
 * Panelku — redis.js
 * Redis Manager frontend
 */

const RedisPage = {
  ttlModal: null,

  async init() {
    await LP.init();
    if (!LP.state.accessToken) return;
    this.refresh();
  },

  async refresh() {
    await this.loadInfo();
  },

  switchTab(tabId) {
    document.querySelectorAll('.rd-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.rd-tab-content').forEach(t => t.classList.remove('active'));
    document.querySelector(`.rd-tab[data-tab="${tabId}"]`)?.classList.add('active');
    document.getElementById(`tab-${tabId}`)?.classList.add('active');

    if (tabId === 'config') this.loadConfig();
    if (tabId === 'clients') this.loadClients();
    if (tabId === 'slowlog') this.loadSlowLog();
  },

  // ── Dashboard ────────────────────────────────────────

  async loadInfo() {
    try {
      const res = await LP.get('/redis/info');
      if (res?.success) {
        const d = res.data;
        const banner = document.getElementById('rdNotConnectedBanner');

        document.getElementById('rdStatus').textContent = d.connected ? '✓ Connected' : '✗ Disconnected';
        document.getElementById('rdConnTarget').textContent = `${location.hostname}:6379`;

        if (!d.connected) {
          if (banner) banner.style.display = 'block';
          return;
        }
        if (banner) banner.style.display = 'none';

        document.getElementById('rdVersion').textContent = d.version || 'N/A';
        document.getElementById('rdMemory').textContent = d.usedMemoryHuman || 'N/A';
        document.getElementById('rdClients').textContent = d.connectedClients || '0';
        document.getElementById('rdOps').textContent = d.instantaneousOpsPerSec || '0';
        document.getElementById('rdHitRatio').textContent = d.hitRatio ? `${d.hitRatio}%` : 'N/A';

        // Server table
        document.getElementById('rdUptime').textContent = LP.formatUptime(d.uptimeInSeconds || 0);
        document.getElementById('rdRole').textContent = d.role || 'N/A';
        document.getElementById('rdMode').textContent = d.serverInfo?.mode || 'N/A';
        document.getElementById('rdPort').textContent = d.serverInfo?.tcpPort || 'N/A';
        document.getElementById('rdOs').textContent = d.serverInfo?.os || 'N/A';
        document.getElementById('rdSlaves').textContent = d.connectedSlaves || '0';

        // Memory table
        document.getElementById('rdMemUsed').textContent = d.usedMemoryHuman || 'N/A';
        document.getElementById('rdMemPeak').textContent = d.usedMemoryPeakHuman || 'N/A';
        document.getElementById('rdMemFrag').textContent = d.memFragmentationRatio ? `${d.memFragmentationRatio}x` : 'N/A';
        document.getElementById('rdCpuSys').textContent = `${d.usedCpuSys || '0'}s`;
        document.getElementById('rdCpuUser').textContent = `${d.usedCpuUser || '0'}s`;

        // Persistence
        document.getElementById('rdRdbEnabled').textContent = d.persistence?.rdbEnabled ? 'In progress' : (d.persistence?.loading ? 'Loading' : 'Idle');
        const lastSave = d.persistence?.rdbLastSave ? new Date(d.persistence.rdbLastSave * 1000).toLocaleString() : 'Never';
        document.getElementById('rdLastSave').textContent = lastSave;
        document.getElementById('rdLastBgsave').textContent = d.persistence?.rdbLastBgsaveStatus || 'N/A';
        document.getElementById('rdAofEnabled').textContent = d.persistence?.aofEnabled ? 'Yes' : 'No';

        // Keyspace
        const ks = d.keyspace || [];
        const ksContainer = document.getElementById('rdKeyspaceList');
        if (ks.length) {
          ksContainer.innerHTML = ks.map(k => `
            <div class="d-flex justify-content-between align-items-center p-2 rounded" style="background:rgba(0,0,0,0.12);border:1px solid var(--glass-border);font-size:12px;">
              <span style="color:var(--text-primary);font-weight:500;">${LP.escHtml(k.db)}</span>
              <span style="color:var(--text-muted);">${k.keys} keys, ${k.expires} expires</span>
            </div>
          `).join('');
        } else {
          ksContainer.innerHTML = '<div style="padding:12px;text-align:center;color:var(--text-muted);font-size:13px;">No keys.</div>';
        }
      }
    } catch {
      document.getElementById('rdNotConnectedBanner').style.display = 'block';
    }
  },

  // ── Operations ───────────────────────────────────────

  async triggerSave() {
    try { const r = await LP.post('/redis/save'); LP.toast(r?.message || 'SAVE triggered', 'success'); } catch { LP.toast('Error', 'error'); }
  },

  async triggerBgsave() {
    try { const r = await LP.post('/redis/bgsave'); LP.toast(r?.message || 'BGSAVE triggered', 'info'); } catch { LP.toast('Error', 'error'); }
  },

  async triggerFlushDb() {
    if (!(await LP.confirm('FLUSHDB: Delete ALL keys in the current database? This CANNOT be undone!', 'FLUSHDB'))) return;
    try { const r = await LP.post('/redis/flushdb'); LP.toast(r?.message || 'FLUSHDB done', 'success'); this.loadInfo(); } catch { LP.toast('Error', 'error'); }
  },

  async triggerFlushAll() {
    if (!(await LP.confirm('FLUSHALL: Delete ALL keys from ALL databases? This CANNOT be undone!', 'FLUSHALL'))) return;
    try { const r = await LP.post('/redis/flushall'); LP.toast(r?.message || 'FLUSHALL done', 'success'); this.loadInfo(); } catch { LP.toast('Error', 'error'); }
  },

  // ── Keys ─────────────────────────────────────────────

  async scanKeys() {
    const db = document.getElementById('rdKeyDb').value;
    const match = document.getElementById('rdKeyPattern').value.trim() || '*';
    const tbody = document.getElementById('rdKeysTableBody');
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:15px;"><div class="spinner-border spinner-border-sm text-primary me-2"></div>Scanning...</td></tr>';

    try {
      const res = await LP.get(`/redis/keys?db=${encodeURIComponent(db)}&match=${encodeURIComponent(match)}&count=100`);
      if (res?.success) {
        const data = res.data;
        const keys = data.keys || [];
        if (!keys.length) {
          tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:15px;color:var(--text-muted);">No keys found.</td></tr>';
          return;
        }
        tbody.innerHTML = keys.map(k => {
          const ttlDisplay = k.ttl === -1 ? '-' : `${k.ttl}s`;
          const typeColors = { string: 'text-success', list: 'text-info', set: 'text-warning', zset: 'text-danger', hash: 'text-primary', stream: 'text-secondary' };
          return `<tr>
            <td style="font-family:monospace;font-size:13px;max-width:350px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${LP.escHtml(k.key)}">${LP.escHtml(k.key)}</td>
            <td><span class="${typeColors[k.type] || ''}" style="font-size:12px;">${LP.escHtml(k.type)}</span></td>
            <td style="font-family:monospace;font-size:12px;color:var(--text-muted);">${ttlDisplay}</td>
            <td style="text-align:right;">
              <button class="btn-lp btn-lp-ghost btn-lp-sm text-info" onclick="LP.call('RedisPage.loadKeyValue', '${LP.encJsArg(k.key)}')" title="View"><i class="bi bi-eye"></i></button>
              <button class="btn-lp btn-lp-ghost btn-lp-sm text-warning" onclick="LP.call('RedisPage.showTtlModal', '${LP.encJsArg(k.key)}', ${k.ttl})" title="Set TTL"><i class="bi bi-clock"></i></button>
              <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="LP.call('RedisPage.confirmDeleteKey', '${LP.encJsArg(k.key)}')" title="Delete"><i class="bi bi-trash3"></i></button>
            </td>
          </tr>`;
        }).join('');

        // Show cursor info if more keys available
        if (data.cursor && data.cursor !== '0') {
          tbody.innerHTML += `<tr><td colspan="4" style="text-align:center;padding:8px;color:var(--text-muted);font-size:12px;">More keys available. Refine your pattern for better results.</td></tr>`;
        }
      }
    } catch {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:15px;color:var(--accent-danger);">Failed to scan keys</td></tr>';
    }
  },

  refreshKeys() {
    this.scanKeys();
  },

  async loadKeyValue(key) {
    const detailDiv = document.getElementById('rdKeyDetail');
    detailDiv.style.display = 'block';
    document.getElementById('rdDetailKeyName').textContent = key;
    document.getElementById('rdDetailValue').textContent = 'Loading...';

    try {
      const res = await LP.get(`/redis/keys/${encodeURIComponent(key)}`);
      if (res?.success) {
        const data = res.data;
        document.getElementById('rdDetailKeyType').textContent = data.type;
        const val = data.value;
        document.getElementById('rdDetailValue').textContent = typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val);
      } else {
        document.getElementById('rdDetailValue').textContent = `Error: ${res?.message || 'Failed'}`;
      }
    } catch (err) {
      document.getElementById('rdDetailValue').textContent = `Error: ${err.message}`;
    }
  },

  closeKeyDetail() {
    document.getElementById('rdKeyDetail').style.display = 'none';
  },

  showTtlModal(key, currentTtl) {
    if (!this.ttlModal) this.ttlModal = new bootstrap.Modal(document.getElementById('setTtlModal'));
    document.getElementById('rdTtlKeyName').textContent = key;
    document.getElementById('rdTtlSeconds').value = currentTtl >= 0 ? currentTtl : -1;
    this.ttlModal.show();
  },

  async setKeyTtl() {
    const key = document.getElementById('rdTtlKeyName').textContent;
    const seconds = document.getElementById('rdTtlSeconds').value;
    this.ttlModal.hide();
    try {
      const res = await LP.post(`/redis/keys/${encodeURIComponent(key)}/ttl`, { seconds: parseInt(seconds) });
      if (res?.success) { LP.toast(res.message, 'success'); this.scanKeys(); }
      else { LP.toast(res?.message || 'Failed', 'error'); }
    } catch { LP.toast('Error', 'error'); }
  },

  async confirmDeleteKey(key) {
    if (!(await LP.confirm(`Delete key "${key}"?`, 'Delete Key'))) return;
    try {
      const res = await LP.del(`/redis/keys/${encodeURIComponent(key)}`);
      if (res?.success) { LP.toast(`"${key}" deleted`, 'success'); this.scanKeys(); }
      else { LP.toast(res?.message || 'Failed', 'error'); }
    } catch { LP.toast('Error', 'error'); }
  },

  // ── Config ───────────────────────────────────────────

  async loadConfig() {
    const tbody = document.getElementById('rdConfigTableBody');
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:15px;"><div class="spinner-border spinner-border-sm text-primary me-2"></div>Loading...</td></tr>';

    const filter = document.getElementById('rdConfigFilter').value.trim() || '*';
    try {
      const res = await LP.get(`/redis/config?pattern=${encodeURIComponent(filter)}`);
      if (res?.success) {
        const configs = res.data.configs || [];
        if (!configs.length) {
          tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:15px;color:var(--text-muted);">No config matching filter.</td></tr>';
          return;
        }
        tbody.innerHTML = configs.map(c => `
          <tr>
            <td style="font-family:monospace;font-size:12px;">${LP.escHtml(c.key)}</td>
            <td style="font-family:monospace;font-size:12px;color:var(--text-muted);max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${LP.escHtml(c.value)}">${LP.escHtml(c.value)}</td>
            <td style="text-align:right;">
              <button class="btn-lp btn-lp-ghost btn-lp-sm text-info" onclick="LP.call('RedisPage.editConfig', '${LP.encJsArg(c.key)}', '${LP.encJsArg(c.value)}')" title="Edit"><i class="bi bi-pencil"></i></button>
            </td>
          </tr>
        `).join('');
      }
    } catch {
      tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:15px;color:var(--accent-danger);">Failed to load config</td></tr>';
    }
  },

  async editConfig(key, _value) {
    const newValue = await LP.prompt(`Edit config: ${key}`, 'text', 'Edit Config');
    if (newValue === null) return;
    try {
      const res = await LP.post('/redis/config', { key, value: newValue });
      if (res?.success) { LP.toast(res.message, 'success'); this.loadConfig(); }
      else { LP.toast(res?.message || 'Failed', 'error'); }
    } catch { LP.toast('Error', 'error'); }
  },

  // ── Clients ──────────────────────────────────────────

  async loadClients() {
    const tbody = document.getElementById('rdClientsTableBody');
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:15px;"><div class="spinner-border spinner-border-sm text-primary me-2"></div>Loading...</td></tr>';
    try {
      const res = await LP.get('/redis/clients');
      if (res?.success) {
        const clients = res.data.clients || [];
        if (!clients.length) {
          tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:15px;color:var(--text-muted);">No connected clients.</td></tr>';
          return;
        }
        tbody.innerHTML = clients.map(c => `
          <tr>
            <td style="font-family:monospace;font-size:11px;">${LP.escHtml(c.id)}</td>
            <td style="font-family:monospace;font-size:11px;">${LP.escHtml(c.addr)}</td>
            <td>${LP.escHtml(c.name || '-')}</td>
            <td>${c.age}s</td>
            <td>${c.idle}s</td>
            <td>${LP.escHtml(c.flags)}</td>
            <td>${c.db}</td>
            <td style="font-family:monospace;font-size:11px;">${LP.escHtml(c.cmd)}</td>
            <td style="text-align:right;">
              <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="LP.call('RedisPage.killClient', '${LP.encJsArg(c.addr)}')" title="Kill"><i class="bi bi-x-circle"></i></button>
            </td>
          </tr>
        `).join('');
      }
    } catch {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:15px;color:var(--accent-danger);">Failed to load clients</td></tr>';
    }
  },

  async killClient(addr) {
    if (!(await LP.confirm(`Kill client "${addr}"?`, 'Kill Client'))) return;
    try {
      const res = await LP.post('/redis/clients/kill', { addr });
      if (res?.success) { LP.toast(res.message, 'success'); this.loadClients(); }
      else { LP.toast(res?.message || 'Failed', 'error'); }
    } catch { LP.toast('Error', 'error'); }
  },

  // ── Slow Log ─────────────────────────────────────────

  async loadSlowLog() {
    const tbody = document.getElementById('rdSlowLogBody');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:15px;"><div class="spinner-border spinner-border-sm text-primary me-2"></div>Loading...</td></tr>';
    try {
      const res = await LP.get('/redis/slowlog?count=20');
      if (res?.success) {
        const entries = res.data.entries || [];
        if (!entries.length) {
          tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:15px;color:var(--text-muted);">No slow queries recorded.</td></tr>';
          return;
        }
        tbody.innerHTML = entries.map(e => `
          <tr>
            <td style="font-family:monospace;font-size:11px;">${e.id}</td>
            <td style="font-size:11px;">${new Date(e.timestamp * 1000).toLocaleString()}</td>
            <td style="font-family:monospace;font-size:12px;color:${e.durationUs > 10000 ? 'var(--accent-danger)' : 'var(--accent-warning)'};">${(e.durationUs / 1000).toFixed(2)} ms</td>
            <td style="font-family:monospace;font-size:11px;max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${LP.escHtml(e.command)}">${LP.escHtml(e.command)}</td>
            <td style="font-family:monospace;font-size:11px;">${LP.escHtml(e.clientAddr)}</td>
          </tr>
        `).join('');
      }
    } catch {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:15px;color:var(--accent-danger);">Failed to load slow log</td></tr>';
    }
  },
};

document.addEventListener('DOMContentLoaded', () => RedisPage.init());
