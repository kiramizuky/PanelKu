/**
 * Panelku — dns.js
 * Advanced DNS Manager with Multi-Provider support
 */

const DNSPage = {
  activeProvider: null,
  activeZoneId: null,
  zones: [],
  records: [],
  providers: [],

  async init() {
    await LP.init();
    await this.loadProviders();
  },

  // ── Providers ────────────────────────────────────────────────────

  async loadProviders() {
    try {
      const res = await LP.get('/dns/providers');
      if (res?.success) {
        this.providers = res.data || [];
        this.renderProviders();
      }
    } catch { /* ignore */ }
  },

  renderProviders() {
    const row = document.getElementById('providersRow');
    const providerIcons = {
      cloudflare: 'bi-cloud-lightning',
      digitalocean: 'bi-water',
      duckdns: 'bi-duck',
      noip: 'bi-globe',
      generic: 'bi-server',
    };
    const providerColors = {
      cloudflare: '#f6821f',
      digitalocean: '#0060ff',
      duckdns: '#e8a317',
      noip: '#00bfff',
      generic: '#38bdf8',
    };

    row.innerHTML = '<div class="col-12"><div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">Select Provider:</div></div>' +
      this.providers.map(p => `
        <div class="col-6 col-md-3 col-lg">
          <div class="lp-glass-card provider-card p-3 text-center ${this.activeProvider === p.id ? 'active' : ''}"
               onclick="DNSPage.selectProvider('${p.id}')">
            <i class="bi ${providerIcons[p.id] || 'bi-globe2'}" style="font-size:24px;color:${providerColors[p.id] || 'var(--text-muted)'};display:block;margin-bottom:6px;"></i>
            <div style="font-weight:600;font-size:13px;">${p.name}</div>
            <div style="font-size:10px;color:var(--text-muted);margin-top:2px;">
              ${p.configured ? '<span style="color:var(--accent-success);"><i class="bi bi-check-circle-fill"></i> Configured</span>' : '<span style="color:var(--text-muted);"><i class="bi bi-slash-circle"></i> Not configured</span>'}
            </div>
          </div>
        </div>
      `).join('');
  },

  async selectProvider(id) {
    this.activeProvider = id;
    this.activeZoneId = null;
    this.renderProviders();

    document.getElementById('dnsWorkspace').style.display = 'block';
    document.getElementById('currentProviderName').innerHTML = `<i class="bi bi-cloud-check me-1"></i> ${this.providers.find(p => p.id === id)?.name || id}`;
    document.getElementById('currentProviderStatus').textContent = 'Loading...';
    document.getElementById('zonesList').innerHTML = '<div style="padding:10px;color:var(--text-muted);"><div class="spinner-border spinner-border-sm me-1"></div>Loading zones...</div>';
    document.getElementById('recordsTableBody').innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted)">Select a zone</td></tr>';
    document.getElementById('currentZoneName').textContent = 'No Zone Selected';
    document.getElementById('addRecordBtn').style.display = 'none';

    // DuckDNS and No-IP don't have zones — show Dynamic DNS tab
    if (id === 'duckdns' || id === 'noip') {
      document.getElementById('currentProviderStatus').textContent = 'Use the Dynamic DNS tab to update your IP address.';
      this.switchTab('dynamic');
      return;
    }

    try {
      const res = await LP.get(`/dns/${id}/zones`);
      if (res?.success) {
        this.zones = res.data || [];
        this.renderZones();
        document.getElementById('currentProviderStatus').textContent = `${this.zones.length} zones loaded`;
      } else {
        document.getElementById('currentProviderStatus').textContent = 'Failed to load zones';
        document.getElementById('zonesList').innerHTML = '<div style="padding:10px;color:var(--accent-danger);">Failed to load zones. Check provider config.</div>';
      }
    } catch {
      document.getElementById('currentProviderStatus').textContent = 'Error loading zones';
    }
  },

  // ── Zones ────────────────────────────────────────────────────────

  renderZones() {
    const container = document.getElementById('zonesList');
    if (this.zones.length === 0) {
      container.innerHTML = '<div style="padding:10px;color:var(--text-muted);">No zones found for this provider. Check your API token.</div>';
      return;
    }
    container.innerHTML = this.zones.map(z =>
      `<div class="lp-glass-card" style="padding:10px 14px;cursor:pointer;border:1px solid ${this.activeZoneId === z.id ? 'var(--accent-primary)' : 'transparent'};"
            onclick="DNSPage.selectZone('${z.id}','${LP.escHtml(z.name)}')" onmouseover="this.style.borderColor='var(--accent-primary)'" onmouseout="this.style.borderColor='${this.activeZoneId === z.id ? 'var(--accent-primary)' : 'transparent'}'">
        <div style="font-weight:600;font-size:13px;color:var(--text-primary);">${LP.escHtml(z.name)}</div>
        <div style="font-size:11px;color:var(--text-muted);">
          ${z.status || 'active'} ${z.plan ? '· ' + z.plan : ''}
        </div>
      </div>`
    ).join('');
  },

  async selectZone(id, name) {
    this.activeZoneId = id;
    document.getElementById('currentZoneName').textContent = name;
    document.getElementById('addRecordBtn').style.display = 'inline-block';
    this.renderZones();
    await this.loadRecords();
    await this.loadDNSSEC();
  },

  // ── Records ──────────────────────────────────────────────────────

  async loadRecords() {
    if (!this.activeProvider || !this.activeZoneId) return;
    const tbody = document.getElementById('recordsTableBody');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted);"><div class="spinner-border spinner-border-sm me-1"></div>Loading records...</td></tr>';

    try {
      const res = await LP.get(`/dns/${this.activeProvider}/zones/${this.activeZoneId}/records`);
      if (res?.success) {
        this.records = res.data || [];
        this.renderRecords();
      } else {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--accent-danger);">${LP.escHtml(res?.message || 'Failed to load records')}</td></tr>`;
      }
    } catch {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--accent-danger);">Failed to load records</td></tr>';
    }
  },

  renderRecords() {
    const tbody = document.getElementById('recordsTableBody');
    LP.paginate(this.records, 10, 'recordsTableBody', 'dnsPagination', r => `
      <tr>
        <td><span class="lp-badge lp-badge-info" style="font-size:10px;font-family:monospace;">${r.type}</span></td>
        <td style="font-family:monospace;font-size:13px;color:var(--text-primary);">${LP.escHtml(r.name)}</td>
        <td style="font-family:monospace;font-size:12px;color:var(--text-secondary);max-width:200px;overflow:hidden;text-overflow:ellipsis;" title="${LP.escHtml(r.content)}">${LP.escHtml(r.content)}</td>
        <td style="font-size:12px;color:var(--text-muted);font-family:monospace;">${r.ttl === 1 ? 'Auto' : r.ttl + 's'}</td>
        <td style="text-align:right;white-space:nowrap;">
          <button class="btn-lp btn-lp-ghost btn-lp-sm text-info" onclick="DNSPage.editRecord('${LP.encJsArg(r.id)}')" title="Edit"><i class="bi bi-pencil"></i></button>
          <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="DNSPage.deleteRecord('${LP.encJsArg(r.id)}')" title="Delete"><i class="bi bi-trash"></i></button>
        </td>
      </tr>
    `, 'No records found', 10);
  },

  filterRecords() {
    const q = document.getElementById('recordFilter').value.toLowerCase();
    const filtered = this.records.filter(r =>
      r.name.toLowerCase().includes(q) || r.type.toLowerCase().includes(q) || (r.content || '').toLowerCase().includes(q)
    );
    const tbody = document.getElementById('recordsTableBody');
    LP.paginate(filtered, 10, 'recordsTableBody', 'dnsPagination', r => `
      <tr>
        <td><span class="lp-badge lp-badge-info" style="font-size:10px;font-family:monospace;">${r.type}</span></td>
        <td style="font-family:monospace;font-size:13px;color:var(--text-primary);">${LP.escHtml(r.name)}</td>
        <td style="font-family:monospace;font-size:12px;color:var(--text-secondary);max-width:200px;overflow:hidden;">${LP.escHtml(r.content)}</td>
        <td style="font-size:12px;color:var(--text-muted);font-family:monospace;">${r.ttl === 1 ? 'Auto' : r.ttl + 's'}</td>
        <td style="text-align:right;white-space:nowrap;">
          <button class="btn-lp btn-lp-ghost btn-lp-sm text-info" onclick="DNSPage.editRecord('${LP.encJsArg(r.id)}')"><i class="bi bi-pencil"></i></button>
          <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="DNSPage.deleteRecord('${LP.encJsArg(r.id)}')"><i class="bi bi-trash"></i></button>
        </td>
      </tr>
    `, 'No matching records', 10);
  },

  // ── Add/Edit Record ──────────────────────────────────────────────

  showAddRecordModal() {
    document.getElementById('recModalTitle').textContent = 'Add DNS Record';
    document.getElementById('recEditId').value = '';
    document.getElementById('recType').value = 'A';
    document.getElementById('recName').value = '';
    document.getElementById('recContent').value = '';
    document.getElementById('recTtl').value = '1';
    document.getElementById('recPriority').value = '10';
    document.getElementById('recWeight').value = '5';
    document.getElementById('recPort').value = '443';
    document.getElementById('recProxied').checked = this.activeProvider === 'cloudflare';
    this.toggleRecordFields();
    new bootstrap.Modal(document.getElementById('recordModal')).show();
  },

  editRecord(id) {
    const r = this.records.find(rec => rec.id === id || rec.id === parseInt(id));
    if (!r) return;

    document.getElementById('recModalTitle').textContent = 'Edit DNS Record';
    document.getElementById('recEditId').value = r.id;
    document.getElementById('recType').value = r.type;
    document.getElementById('recName').value = r.name;
    document.getElementById('recContent').value = r.content;
    document.getElementById('recTtl').value = r.ttl || '1';
    document.getElementById('recPriority').value = r.priority || '10';
    document.getElementById('recWeight').value = r.weight || '5';
    document.getElementById('recPort').value = r.port || '443';
    document.getElementById('recProxied').checked = r.proxied ?? true;
    this.toggleRecordFields();
    new bootstrap.Modal(document.getElementById('recordModal')).show();
  },

  toggleRecordFields() {
    const type = document.getElementById('recType').value;
    document.getElementById('recPriorityGroup').style.display = (type === 'MX' || type === 'SRV') ? 'block' : 'none';
    document.getElementById('recSrvGroup').style.display = type === 'SRV' ? 'block' : 'none';
    document.getElementById('recProxyGroup').style.display = (type === 'A' || type === 'AAAA' || type === 'CNAME') && this.activeProvider === 'cloudflare' ? 'block' : 'none';

    const contentLabel = document.querySelector('label[for="recContent"]');
    if (contentLabel) {
      const labels = { A: 'IPv4 Address', AAAA: 'IPv6 Address', CNAME: 'Target Domain', TXT: 'Text Value', MX: 'Mail Server', NS: 'Name Server', SRV: 'Target Hostname', CAA: 'CA Domain' };
      contentLabel.textContent = 'Content / ' + (labels[type] || 'Value');
    }
  },

  async saveRecord() {
    const editId = document.getElementById('recEditId').value;
    const payload = {
      type: document.getElementById('recType').value,
      name: document.getElementById('recName').value,
      content: document.getElementById('recContent').value,
      ttl: parseInt(document.getElementById('recTtl').value) || 1,
    };

    if (['MX', 'SRV'].includes(payload.type)) payload.priority = parseInt(document.getElementById('recPriority').value) || 10;
    if (payload.type === 'SRV') {
      payload.weight = parseInt(document.getElementById('recWeight').value) || 5;
      payload.port = parseInt(document.getElementById('recPort').value) || 443;
    }
    if ((payload.type === 'A' || payload.type === 'AAAA' || payload.type === 'CNAME') && this.activeProvider === 'cloudflare') {
      payload.proxied = document.getElementById('recProxied').checked;
    }

    try {
      let res;
      if (editId) {
        res = await LP.put(`/dns/${this.activeProvider}/zones/${this.activeZoneId}/records/${editId}`, payload);
      } else {
        res = await LP.post(`/dns/${this.activeProvider}/zones/${this.activeZoneId}/records`, payload);
      }

      if (res?.success) {
        LP.toast(editId ? 'Record updated!' : 'Record created!', 'success');
        bootstrap.Modal.getInstance(document.getElementById('recordModal')).hide();
        await this.loadRecords();
      } else {
        LP.toast(res?.message || 'Failed to save record', 'error');
      }
    } catch (err) {
      LP.toast('Error saving record: ' + err.message, 'error');
    }
  },

  async deleteRecord(id) {
    if (!(await LP.confirm('Delete this DNS record?', 'Delete Record'))) return;
    try {
      const res = await LP.del(`/dns/${this.activeProvider}/zones/${this.activeZoneId}/records/${id}`);
      if (res?.success) {
        LP.toast('Record deleted', 'success');
        await this.loadRecords();
      } else {
        LP.toast(res?.message || 'Failed to delete', 'error');
      }
    } catch {
      LP.toast('Error deleting record', 'error');
    }
  },

  // ── Provider Config ──────────────────────────────────────────────

  showConfig() {
    const p = this.providers.find(pv => pv.id === this.activeProvider);
    if (!p) return;

    document.getElementById('pcTitle').textContent = `Configure ${p.name}`;

    const configFields = {
      cloudflare: [{ id: 'apiKey', label: 'API Token', type: 'password', placeholder: 'Enter Cloudflare API Token' }],
      digitalocean: [{ id: 'token', label: 'Personal Access Token', type: 'password', placeholder: 'Enter DigitalOcean Token' }],
      duckdns: [{ id: 'token', label: 'DuckDNS Token', type: 'password', placeholder: 'Enter DuckDNS Token' }],
      noip: [
        { id: 'username', label: 'Username', type: 'text', placeholder: 'No-IP Username' },
        { id: 'password', label: 'Password', type: 'password', placeholder: 'No-IP Password' },
      ],
    };

    const fields = configFields[this.activeProvider] || [{ id: 'token', label: 'API Token', type: 'password', placeholder: 'Enter token' }];
    document.getElementById('pcFields').innerHTML = fields.map(f =>
      `<div class="lp-form-group mb-3">
        <label class="lp-label">${f.label}</label>
        <input type="${f.type}" id="pc_${f.id}" class="lp-input" placeholder="${f.placeholder}" style="font-size:13px;">
      </div>`
    ).join('');

    new bootstrap.Modal(document.getElementById('providerConfigModal')).show();
  },

  async saveProviderConfig() {
    const config = {};
    document.querySelectorAll('#pcFields input').forEach(el => {
      const id = el.id.replace('pc_', '');
      if (el.value.trim()) config[id] = el.value.trim();
    });

    try {
      const res = await LP.post(`/dns/providers/${this.activeProvider}`, config);
      if (res?.success) {
        LP.toast('Provider configured!', 'success');
        bootstrap.Modal.getInstance(document.getElementById('providerConfigModal')).hide();
        await this.loadProviders();
        // Auto-test connection
        this.testConnection();
      } else {
        LP.toast(res?.message || 'Failed to save config', 'error');
      }
    } catch {
      LP.toast('Error saving config', 'error');
    }
  },

  async testConnection() {
    try {
      const res = await LP.post(`/dns/providers/${this.activeProvider}/test`);
      if (res?.success) {
        LP.toast(res.message || 'Connection OK!', 'success');
        document.getElementById('currentProviderStatus').textContent = 'Connection OK ✓';
        // Reload zones
        await this.selectProvider(this.activeProvider);
      } else {
        LP.toast(res?.message || 'Connection failed', 'error');
        document.getElementById('currentProviderStatus').textContent = 'Connection failed ✗';
      }
    } catch {
      LP.toast('Connection test failed', 'error');
    }
  },

  // ── DNSSEC ───────────────────────────────────────────────────────

  async loadDNSSEC() {
    const container = document.getElementById('dnssecContent');
    if (!this.activeProvider || !this.activeZoneId) return;

    try {
      const res = await LP.get(`/dns/${this.activeProvider}/zones/${this.activeZoneId}/dnssec`);
      if (res?.success) {
        const d = res.data;
        if (d.status === 'unsupported') {
          container.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-muted);background:rgba(0,0,0,0.1);border-radius:10px;">
            <i class="bi bi-shield-exclamation" style="font-size:32px;display:block;margin-bottom:8px;"></i>
            DNSSEC not supported for this provider.
          </div>`;
          return;
        }

        const isEnabled = d.enabled;
        container.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h5 style="font-size:15px;font-weight:600;margin:0;">
              <i class="bi bi-shield-check text-success me-1"></i> DNSSEC Status
            </h5>
            <button class="btn-lp ${isEnabled ? 'btn-lp-warning' : 'btn-lp-primary'} btn-sm" onclick="DNSPage.toggleDNSSEC()">
              <i class="bi ${isEnabled ? 'bi-shield-x' : 'bi-shield-check'} me-1"></i> ${isEnabled ? 'Disable' : 'Enable'} DNSSEC
            </button>
          </div>
          <div style="background:${isEnabled ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)'};border:1px solid ${isEnabled ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'};border-radius:10px;padding:14px;">
            <div style="display:flex;align-items:center;gap:10px;">
              <i class="bi ${isEnabled ? 'bi-shield-fill-check' : 'bi-shield-x'} text-${isEnabled ? 'success' : 'danger'}" style="font-size:24px;"></i>
              <div>
                <div style="font-weight:600;color:var(--text-primary);">${isEnabled ? 'DNSSEC is Active' : 'DNSSEC is Disabled'}</div>
                <div style="font-size:12px;color:var(--text-muted);">${isEnabled ? 'Zone is signed and protected against DNS spoofing' : 'Enable DNSSEC to protect against DNS spoofing attacks'}</div>
              </div>
            </div>
          </div>
          ${isEnabled ? `
          <div style="margin-top:16px;">
            <h6 style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:10px;">DS Record Details</h6>
            <div style="background:rgba(0,0,0,0.15);border-radius:8px;padding:12px;font-family:monospace;font-size:11px;line-height:1.6;">
              <div>Key Tag: <span style="color:var(--accent-warning);">${d.keyTag || '—'}</span></div>
              <div>Algorithm: <span style="color:var(--accent-info);">${d.algorithm || '—'}</span></div>
              <div>Digest Type: <span style="color:var(--accent-info);">${d.digestType || '—'}</span></div>
              <div style="word-break:break-all;margin-top:4px;">Digest: <span style="color:var(--text-secondary);">${d.digest || '—'}</span></div>
              ${d.ds ? `<div style="word-break:break-all;margin-top:4px;">DS: <span style="color:var(--accent-success);">${d.ds}</span></div>` : ''}
            </div>
          </div>` : ''}
        `;
      }
    } catch {
      container.innerHTML = '<div style="padding:20px;color:var(--accent-danger);">Failed to load DNSSEC status</div>';
    }
  },

  async toggleDNSSEC() {
    try {
      // Get current DNSSEC state
      const statusRes = await LP.get(`/dns/${this.activeProvider}/zones/${this.activeZoneId}/dnssec`);
      const isEnabled = statusRes?.data?.enabled === true;

      const endpoint = isEnabled ? 'disable' : 'enable';
      const res = await LP.post(`/dns/${this.activeProvider}/zones/${this.activeZoneId}/dnssec/${endpoint}`);

      if (res?.success) {
        LP.toast(isEnabled ? 'DNSSEC disabled' : 'DNSSEC enabled!', isEnabled ? 'warning' : 'success');
        await this.loadDNSSEC();
      } else {
        LP.toast(res?.message || 'Failed to toggle DNSSEC', 'error');
      }
    } catch (err) {
      LP.toast('Error toggling DNSSEC: ' + (err.message || err), 'error');
    }
  },

  // ── Dynamic DNS ──────────────────────────────────────────────────

  async updateDuckDNS() {
    const domain = document.getElementById('ddDomain').value.trim();
    if (!domain) { LP.toast('Domain is required', 'error'); return; }

    try {
      const res = await LP.post('/dns/duckdns/dynamic', {
        domain,
        ip: document.getElementById('ddIp').value.trim() || undefined,
        ipv6: document.getElementById('ddIpv6').value.trim() || undefined,
      });
      if (res?.success) {
        LP.toast('DuckDNS updated!', 'success');
      } else {
        LP.toast(res?.message || 'Update failed', 'error');
      }
    } catch { LP.toast('Error updating DuckDNS', 'error'); }
  },

  async updateNoIP() {
    const hostname = document.getElementById('niHostname').value.trim();
    if (!hostname) { LP.toast('Hostname is required', 'error'); return; }

    try {
      const res = await LP.post('/dns/noip/dynamic', {
        hostname,
        ip: document.getElementById('niIp').value.trim() || undefined,
      });
      if (res?.success) {
        LP.toast('No-IP updated!', 'success');
      } else {
        LP.toast(res?.message || 'Update failed', 'error');
      }
    } catch { LP.toast('Error updating No-IP', 'error'); }
  },

  // ── Tab Switching ────────────────────────────────────────────────

  switchTab(tabId) {
    document.querySelectorAll('.dns-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.dns-tab-content').forEach(t => t.classList.remove('active'));
    const btn = document.querySelector(`.dns-tab[data-tab="${tabId}"]`);
    if (btn) btn.classList.add('active');
    const content = document.getElementById(`tab-${tabId}`);
    if (content) content.classList.add('active');
  },
};

document.addEventListener('DOMContentLoaded', () => DNSPage.init());
