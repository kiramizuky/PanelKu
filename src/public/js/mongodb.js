/**
 * Panelku — mongodb.js
 * MongoDB Manager frontend
 */

const MongoDBPage = {
  createDbModal: null,
  createUserModal: null,
  selectedDb: null,

  async init() {
    await LP.init();
    if (!LP.state.accessToken) return;
    this.refresh();
  },

  async refresh() {
    await Promise.all([
      this.loadStatus(),
      this.loadDatabases(),
      this.loadUsers(),
    ]);
  },

  switchTab(tabId) {
    document.querySelectorAll('.mdb-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.mdb-tab-content').forEach(t => t.classList.remove('active'));
    document.querySelector(`.mdb-tab[data-tab="${tabId}"]`)?.classList.add('active');
    document.getElementById(`tab-${tabId}`)?.classList.add('active');

    if (tabId === 'query') this.populateQueryDbSelect();
    if (tabId === 'backup') this.populateBackupDbSelect();
  },

  // ── Status ───────────────────────────────────────────

  async loadStatus() {
    try {
      const res = await LP.get('/mongodb/status');
      if (res?.success) {
        const status = res.data;
        const banner = document.getElementById('mdbNotInstalledBanner');

        document.getElementById('mdbStatus').textContent = status.running ? '✓ Running' : (status.installed ? '○ Stopped' : '✗ Not installed');

        if (!status.installed || !status.running) {
          if (banner) banner.style.display = 'block';
          return;
        }
        if (banner) banner.style.display = 'none';

        document.getElementById('mdbVersion').textContent = status.version || 'N/A';

        // Load server info for more details
        this.loadServerInfo();
        this.populateQueryDbSelect();
        this.populateBackupDbSelect();
      }
    } catch {}
  },

  async loadServerInfo() {
    try {
      const res = await LP.get('/mongodb/server-info');
      if (res?.success) {
        const { server, databases } = res.data;
        const s = server?.server || {};

        const uptime = s.uptime ? LP.formatUptime(s.uptime) : 'N/A';
        document.getElementById('mdbUptime').textContent = uptime;
        document.getElementById('mdbConnections').textContent = s.connections?.current
          ? `${s.connections.current} active / ${s.connections.available} available`
          : 'N/A';
        document.getElementById('mdbStorageEngine').textContent = s.storageEngine?.name || 'N/A';
        document.getElementById('mdbMemory').textContent = s.mem
          ? `${LP.formatBytes(s.mem.resident * 1024 * 1024)} resident`
          : 'N/A';

        const ops = s.opcounters || {};
        document.getElementById('mdbOps').textContent = ops
          ? `insert:${ops.insert || 0} query:${ops.query || 0} update:${ops.update || 0} delete:${ops.delete || 0}`
          : 'N/A';

        document.getElementById('mdbUserCount').textContent = '—';

        // Database sizes
        const container = document.getElementById('mdbDatabaseSizes');
        if (databases && databases.length > 0) {
          document.getElementById('mdbDbCount').textContent = databases.length;
          container.innerHTML = databases.slice(0, 8).map(d => {
            const size = d.sizeOnDisk ? LP.formatBytes(d.sizeOnDisk) : '< 1KB';
            return `
              <div class="d-flex justify-content-between align-items-center p-2 rounded" style="background:rgba(0,0,0,0.12);border:1px solid var(--glass-border);font-size:12px;">
                <span style="color:var(--text-primary);font-weight:500;">${LP.escHtml(d.name)}</span>
                <span style="color:var(--text-muted);font-family:monospace;">${size}</span>
              </div>
            `;
          }).join('');
        } else {
          container.innerHTML = '<div style="padding:15px;text-align:center;color:var(--text-muted);font-size:13px;">No databases found.</div>';
        }
      }
    } catch {}
  },

  // ── Install MongoDB ─────────────────────────────────

  async installMongo() {
    const btn = document.querySelector('#mdbNotInstalledBanner .btn-lp-primary');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Installing...'; }
    try {
      const res = await LP.post('/mongodb/install');
      if (res?.success) { LP.toast(res.message, 'success'); this.refresh(); }
      else { LP.toast(res?.message || 'Install failed', 'error'); }
    } catch { LP.toast('Error', 'error'); }
    finally { if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-download me-1"></i> Install MongoDB'; } }
  },

  // ── Databases ────────────────────────────────────────

  async loadDatabases() {
    try {
      const res = await LP.get('/mongodb/databases');
      if (res?.success) {
        const dbs = res.data.databases || [];
        const container = document.getElementById('mdbDatabaseList');

        if (!dbs.length) {
          container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px;">No databases found.</div>';
          return;
        }

        container.innerHTML = dbs.map(d => `
          <div class="p-3 rounded d-flex justify-content-between align-items-center" style="background:rgba(0,0,0,0.12);border:1px solid var(--glass-border);cursor:pointer;" onclick="MongoDBPage.showCollections('${LP.encJsArg(d.name)}')">
            <div class="d-flex align-items-center gap-3">
              <i class="bi bi-database ${d.empty ? 'text-muted' : 'text-success'}" style="font-size:18px;"></i>
              <div>
                <strong style="font-size:14px;color:var(--text-primary);">${LP.escHtml(d.name)}</strong>
                <div style="font-size:11px;color:var(--text-muted);">
                  ${d.empty ? 'Empty' : `${LP.formatBytes(d.sizeOnDisk || 0)}`}
                </div>
              </div>
            </div>
            <div class="d-flex gap-2">
              <button class="btn-lp btn-lp-ghost btn-lp-sm text-info" onclick="event.stopPropagation();MongoDBPage.showCollections('${LP.encJsArg(d.name)}')" title="View Collections">
                <i class="bi bi-collection"></i> Collections
              </button>
              ${!['admin','config','local'].includes(d.name) ? `
                <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="event.stopPropagation();MongoDBPage.confirmDropDb('${LP.encJsArg(d.name)}')" title="Drop Database">
                  <i class="bi bi-trash3"></i>
                </button>
              ` : ''}
            </div>
          </div>
        `).join('');
      }
    } catch {}
  },

  showCreateDb() {
    if (!this.createDbModal) this.createDbModal = new bootstrap.Modal(document.getElementById('createMongoDbModal'));
    document.getElementById('mdbNewDbName').value = '';
    this.createDbModal.show();
  },

  async createDatabase() {
    const name = document.getElementById('mdbNewDbName').value.trim();
    if (!name) return LP.toast('Database name required', 'warning');
    this.createDbModal.hide();
    try {
      const res = await LP.post('/mongodb/databases', { name });
      if (res?.success) { LP.toast(`Database "${name}" created`, 'success'); this.loadDatabases(); }
      else { LP.toast(res?.message || 'Failed', 'error'); }
    } catch { LP.toast('Error', 'error'); }
  },

  async confirmDropDb(name) {
    if (!(await LP.confirm(`Drop database "${name}"? THIS CANNOT BE UNDONE!`, 'Drop Database'))) return;
    try {
      const res = await LP.del(`/mongodb/databases/${encodeURIComponent(name)}`);
      if (res?.success) { LP.toast(`"${name}" dropped`, 'success'); this.loadDatabases(); }
      else { LP.toast(res?.message || 'Failed', 'error'); }
    } catch { LP.toast('Error', 'error'); }
  },

  // ── Collections ──────────────────────────────────────

  async showCollections(dbName) {
    this.selectedDb = dbName;
    document.getElementById('mdbCurrentDbName').textContent = dbName;
    document.getElementById('mdbCollectionsPanel').style.display = 'block';
    const container = document.getElementById('mdbCollectionList');
    container.innerHTML = '<div style="padding:15px;text-align:center;color:var(--text-muted);font-size:13px;">Loading collections...</div>';

    try {
      const res = await LP.get(`/mongodb/databases/${encodeURIComponent(dbName)}/collections`);
      if (res?.success) {
        const collections = res.data.collections || [];
        if (!collections.length) {
          container.innerHTML = '<div style="padding:15px;text-align:center;color:var(--text-muted);font-size:13px;">No collections in this database.</div>';
          return;
        }
        container.innerHTML = collections.map(c => `
          <div class="p-2 px-3 rounded d-flex justify-content-between align-items-center" style="background:rgba(0,0,0,0.08);border:1px solid var(--glass-border);">
            <div class="d-flex align-items-center gap-2">
              <i class="bi bi-collection text-info"></i>
              <span style="font-family:monospace;font-size:14px;color:var(--text-primary);">${LP.escHtml(c.name)}</span>
              <span class="lp-badge lp-badge-ghost" style="font-size:9px;">${c.count || 0} docs</span>
            </div>
            <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="MongoDBPage.confirmDropCollection('${LP.encJsArg(dbName)}','${LP.encJsArg(c.name)}')" title="Drop Collection">
              <i class="bi bi-trash3"></i>
            </button>
          </div>
        `).join('');
      }
    } catch {
      container.innerHTML = '<div style="padding:15px;text-align:center;color:var(--accent-danger);font-size:13px;">Failed to load collections.</div>';
    }
  },

  backToDatabases() {
    this.selectedDb = null;
    document.getElementById('mdbCollectionsPanel').style.display = 'none';
  },

  async confirmDropCollection(db, collection) {
    if (!(await LP.confirm(`Drop collection "${collection}" from "${db}"?`, 'Drop Collection'))) return;
    try {
      const res = await LP.del(`/mongodb/databases/${encodeURIComponent(db)}/collections/${encodeURIComponent(collection)}`);
      if (res?.success) { LP.toast(`"${collection}" dropped`, 'success'); this.showCollections(db); }
      else { LP.toast(res?.message || 'Failed', 'error'); }
    } catch { LP.toast('Error', 'error'); }
  },

  // ── Users ────────────────────────────────────────────

  async loadUsers() {
    const tbody = document.getElementById('mdbUsersTableBody');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted)">Loading...</td></tr>';

    try {
      const res = await LP.get('/mongodb/users');
      if (res?.success) {
        const users = res.data.users || [];
        document.getElementById('mdbUserCount').textContent = users.length;

        if (!users.length) {
          tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted)">No users found.</td></tr>';
          return;
        }

        tbody.innerHTML = users.map(u => {
          const roles = (u.roles || []).map(r => `${r.role}@${r.db}`).join(', ');
          return `
            <tr>
              <td style="font-weight:600;">${LP.escHtml(u.user)}</td>
              <td style="font-family:monospace;font-size:12px;color:var(--text-muted);">${LP.escHtml(u.db)}</td>
              <td style="font-size:12px;">${LP.escHtml(roles)}</td>
              <td style="font-size:12px;color:var(--text-muted);">${(u.mechanisms || []).join(', ') || 'SCRAM-SHA-256'}</td>
              <td style="text-align:right;">
                <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="MongoDBPage.confirmDropUser('${LP.encJsArg(u.user)}')" title="Drop User"><i class="bi bi-trash3"></i></button>
              </td>
            </tr>
          `;
        }).join('');
      }
    } catch {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--accent-danger)">Failed to load</td></tr>';
    }
  },

  showCreateUser() {
    if (!this.createUserModal) this.createUserModal = new bootstrap.Modal(document.getElementById('createMongoUserModal'));
    document.getElementById('mdbNewUsername').value = '';
    document.getElementById('mdbNewPassword').value = '';
    document.getElementById('mdbNewUserRoles').value = 'readWrite@admin';
    this.createUserModal.show();
  },

  async createUser() {
    const username = document.getElementById('mdbNewUsername').value.trim();
    const password = document.getElementById('mdbNewPassword').value;
    const rolesStr = document.getElementById('mdbNewUserRoles').value.trim();

    if (!username || !password) return LP.toast('Username and password required', 'warning');

    // Parse roles: "readWrite@myapp, read@anotherdb"
    const roles = rolesStr ? rolesStr.split(',').map(r => {
      const [role, db] = r.trim().split('@');
      return { role: role.trim(), db: (db || 'admin').trim() };
    }).filter(r => r.role) : [{ role: 'readWrite', db: 'admin' }];

    this.createUserModal.hide();
    try {
      const res = await LP.post('/mongodb/users', { username, password, roles });
      if (res?.success) { LP.toast(`User "${username}" created`, 'success'); this.loadUsers(); }
      else { LP.toast(res?.message || 'Failed', 'error'); }
    } catch { LP.toast('Error', 'error'); }
  },

  async confirmDropUser(username) {
    if (!(await LP.confirm(`Drop MongoDB user "${username}"?`, 'Drop User'))) return;
    try {
      const res = await LP.del(`/mongodb/users/${encodeURIComponent(username)}`);
      if (res?.success) { LP.toast(`"${username}" dropped`, 'success'); this.loadUsers(); }
      else { LP.toast(res?.message || 'Failed', 'error'); }
    } catch { LP.toast('Error', 'error'); }
  },

  // ── Query Console ────────────────────────────────────

  populateQueryDbSelect() {
    this._populateSelectFromDbs('mdbQueryDb');
  },

  populateBackupDbSelect() {
    this._populateSelectFromDbs('mdbBackupDb');
  },

  async _populateSelectFromDbs(selectId) {
    try {
      const res = await LP.get('/mongodb/databases');
      if (res?.success) {
        const dbs = res.data.databases || [];
        const sel = document.getElementById(selectId);
        if (!sel) return;
        const current = sel.value;
        sel.innerHTML = '<option value="">Select database...</option>' +
          dbs.filter(d => !d.empty).map(d => `<option value="${LP.escHtml(d.name)}">${LP.escHtml(d.name)}</option>`).join('');
        if (current) sel.value = current;
      }
    } catch {}
  },

  async runQuery() {
    const database = document.getElementById('mdbQueryDb').value;
    const query = document.getElementById('mdbQueryInput').value.trim();
    if (!database) return LP.toast('Select a database', 'warning');
    if (!query) return LP.toast('Enter a query', 'warning');

    const resultDiv = document.getElementById('mdbQueryResult');
    resultDiv.style.display = 'block';
    resultDiv.querySelector('pre').textContent = 'Running query...';

    try {
      const res = await LP.post('/mongodb/query', { database, query });
      if (res?.success) {
        resultDiv.querySelector('pre').textContent = JSON.stringify(res.data.result, null, 2);
      } else {
        resultDiv.querySelector('pre').textContent = `Error: ${res?.message || 'Query failed'}`;
      }
    } catch (err) {
      resultDiv.querySelector('pre').textContent = `Error: ${err.message || 'Connection error'}`;
    }
  },

  // ── Backup & Restore ─────────────────────────────────

  async runBackup() {
    const database = document.getElementById('mdbBackupDb').value;
    LP.toast('Starting MongoDB backup...', 'info');
    try {
      const res = await LP.post('/mongodb/backup', { database: database || undefined });
      if (res?.success) { LP.toast(res.message, 'success'); }
      else { LP.toast(res?.message || 'Backup failed', 'error'); }
    } catch { LP.toast('Backup error', 'error'); }
  },

  async runRestore() {
    const path = document.getElementById('mdbRestorePath').value.trim();
    const database = document.getElementById('mdbRestoreDb').value.trim();
    if (!path) return LP.toast('Backup path is required', 'warning');

    if (!(await LP.confirm(`Restore from "${path}"? This may OVERWRITE existing data!`, 'Restore Backup'))) return;

    LP.toast('Starting MongoDB restore...', 'info');
    try {
      const res = await LP.post('/mongodb/restore', { path, database: database || undefined });
      if (res?.success) { LP.toast(res.message, 'success'); this.loadDatabases(); }
      else { LP.toast(res?.message || 'Restore failed', 'error'); }
    } catch { LP.toast('Restore error', 'error'); }
  },
};

document.addEventListener('DOMContentLoaded', () => MongoDBPage.init());
