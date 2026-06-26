const DNSPage = {
  activeZoneId: null,

  async init() {
    const token = localStorage.getItem('cf_token');
    if (token) {
      document.getElementById('cfTokenInput').value = token;
      await this.loadZones();
    }
  },

  async saveToken() {
    const token = document.getElementById('cfTokenInput').value;
    if (!token) return LP.toast('Token is required', 'error');
    
    localStorage.setItem('cf_token', token);
    await this.loadZones();
  },

  getHeaders() {
    return {
      'Authorization': `Bearer ${LP.state.accessToken}`,
      'cf-token': localStorage.getItem('cf_token')
    };
  },

  async loadZones() {
    try {
      document.getElementById('zonesList').innerHTML = '<div style="color:var(--text-muted)">Loading...</div>';
      const res = await fetch('/api/dns/zones', { headers: this.getHeaders() }).then(r => r.json());
      
      if (res?.success) {
        document.getElementById('dnsWorkspace').style.display = 'flex';
        const zones = res.data;
        
        if (zones.length === 0) {
          document.getElementById('zonesList').innerHTML = '<div style="color:var(--text-muted)">No zones found for this token.</div>';
          return;
        }

        document.getElementById('zonesList').innerHTML = zones.map(z => `
          <div class="lp-zone-item" onclick="DNSPage.selectZone('${z.id}', '${z.name}')" 
               style="padding:10px 15px; background:rgba(255,255,255,0.02); border:1px solid var(--glass-border); border-radius:8px; cursor:pointer; transition:all 0.2s;">
            <div style="font-weight:600; font-family:var(--font-mono)">${z.name}</div>
            <div style="font-size:11px; color:var(--text-muted)">${z.status}</div>
          </div>
        `).join('');
      } else {
        LP.toast(res.message, 'error');
        document.getElementById('zonesList').innerHTML = '<div style="color:var(--accent-danger)">Error loading zones. Check your token.</div>';
      }
    } catch (err) {
      LP.toast('Connection error', 'error');
    }
  },

  async selectZone(id, name) {
    this.activeZoneId = id;
    document.getElementById('currentZoneName').textContent = name;
    document.getElementById('addRecordBtn').style.display = 'block';
    await this.loadRecords();
  },

  async loadRecords() {
    if (!this.activeZoneId) return;
    const tbody = document.getElementById('recordsTableBody');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted)">Loading records...</td></tr>';
    
    try {
      const res = await fetch(`/api/dns/zones/${this.activeZoneId}/records`, { headers: this.getHeaders() }).then(r => r.json());
      
      if (res?.success) {
        const records = res.data;
        LP.paginate(records, 10, 'recordsTableBody', 'dnsPagination', r => `
          <tr>
            <td style="font-weight:600;color:var(--accent-info)">${r.type}</td>
            <td class="font-mono">${r.name}</td>
            <td class="font-mono" style="font-size:13px;color:var(--text-secondary);max-width:200px;overflow:hidden;text-overflow:ellipsis;">${r.content}</td>
            <td>
              ${r.proxied 
                ? '<i class="bi bi-cloud-fill" style="color:#f6821f" title="Proxied"></i>' 
                : '<i class="bi bi-cloud" style="color:var(--text-muted)" title="DNS Only"></i>'}
            </td>
            <td style="text-align:right">
              <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="DNSPage.deleteRecord('${r.id}')">
                <i class="bi bi-trash"></i> Delete
              </button>
            </td>
          </tr>
        `, 'No records found', 5);
      } else {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--accent-danger)">Error: ${res.message}</td></tr>`;
      }
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--accent-danger)">Failed to load records</td></tr>';
    }
  },

  showAddRecordModal() {
    new bootstrap.Modal(document.getElementById('addRecordModal')).show();
  },

  async addRecord(e) {
    e.preventDefault();
    if (!this.activeZoneId) return;

    const payload = {
      type: document.getElementById('recordType').value,
      name: document.getElementById('recordName').value,
      content: document.getElementById('recordContent').value,
      proxied: document.getElementById('recordProxied').checked,
      ttl: 1 // Auto
    };

    try {
      const res = await fetch(`/api/dns/zones/${this.activeZoneId}/records`, {
        method: 'POST',
        headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(r => r.json());

      if (res?.success) {
        LP.toast('Record added successfully', 'success');
        bootstrap.Modal.getInstance(document.getElementById('addRecordModal')).hide();
        document.getElementById('addRecordForm').reset();
        this.loadRecords();
      } else {
        LP.toast(res.message, 'error');
      }
    } catch (err) {
      LP.toast('Connection error', 'error');
    }
  },

  async deleteRecord(recordId) {
    if (!(await LP.confirm('Are you sure you want to delete this record?', 'Delete Record'))) return;
    
    try {
      const res = await fetch(`/api/dns/zones/${this.activeZoneId}/records/${recordId}`, {
        method: 'DELETE',
        headers: this.getHeaders()
      }).then(r => r.json());

      if (res?.success) {
        LP.toast('Record deleted', 'success');
        this.loadRecords();
      } else {
        LP.toast(res.message, 'error');
      }
    } catch (err) {
      LP.toast('Connection error', 'error');
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  DNSPage.init();
});
