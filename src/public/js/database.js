const DB = (() => {
  let modal, explorerModal;
  let restoreModal, autoBackupModal;
  let currentRestoreTarget = { type: null, name: null };
  let activeType = 'mysql';
  let activeDb = null;
  let activeTable = null;
  let activeSchema = 'public';
  let currentPage = 1;
  let currentSort = { column: null, dir: 'ASC' };
  let _historyModal;

  // ── Initialization ───────────────────────────────────

  async function loadData() {
    try {
      const statusRes = await LP.get('/system/check-install');
      const statuses = statusRes?.success ? statusRes.data : {};
      const res = await LP.get('/database');
      if (res?.success) {
        renderDbList('mysql', res.data.mysql || [], statuses.mysql);
        renderDbList('postgres', res.data.postgres || [], statuses.postgres);
        renderDbList('sqlite', res.data.sqlite || [], statuses.sqlite);
      }
    } catch (e) {
      LP.toast('Failed to load databases', 'error');
    }
  }

  function renderDbList(type, dbs, isInstalled) {
    const tbody = document.getElementById(type + 'TableBody');
    if (isInstalled === false && type !== 'sqlite') {
      tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:40px;">
        <h4 style="margin-bottom:15px;">${type.charAt(0).toUpperCase() + type.slice(1)} is not installed</h4>
        <button class="btn-lp btn-lp-primary" onclick="DB.installPackage('${type}')"><i class="bi bi-download"></i> Install ${type.charAt(0).toUpperCase() + type.slice(1)}</button>
      </td></tr>`;
      return;
    }
    LP.paginate(dbs, 10, type + 'TableBody', type + 'Pagination', db => `
      <tr>
        <td class="font-mono"><strong>${LP.escHtml(db)}</strong></td>
        <td style="text-align:center;"><span style="font-size:11px;color:var(--text-muted);">—</span></td>
        <td style="text-align:right">
          <button class="btn-lp btn-lp-ghost btn-lp-sm text-primary me-1" onclick="DB.openExplorer('${LP.escHtml(type)}', '${LP.escHtml(db)}')" title="Explore Database"><i class="bi bi-eye"></i> Explore</button>
          <button class="btn-lp btn-lp-ghost btn-lp-sm text-info me-1" onclick="DB.backupDatabase('${LP.escHtml(type)}', '${LP.escHtml(db)}', this)" title="Backup Database (Download & Simpan)"><i class="bi bi-cloud-arrow-down"></i> Backup</button>
          <button class="btn-lp btn-lp-ghost btn-lp-sm text-warning me-1" onclick="DB.showRestoreModal('${LP.escHtml(type)}', '${LP.escHtml(db)}')" title="Restore Database (Menimpa Seluruh Data)"><i class="bi bi-cloud-arrow-up"></i> Restore</button>
          <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="DB.deleteDb('${LP.escHtml(type)}', '${LP.escHtml(db)}')" title="Delete Database"><i class="bi bi-trash"></i></button>
        </td>
      </tr>
    `, 'No ' + type + ' databases found', 2);
  }

  // ── DB CRUD ──────────────────────────────────────────

  let credentialsModal;

  async function showCredentialsModal() {
    if (!credentialsModal) credentialsModal = new bootstrap.Modal(document.getElementById('dbCredentialsModal'));
    try {
      const res = await LP.get('/database/credentials');
      if (res?.success && res.data) {
        if (res.data.postgres) {
          document.getElementById('credPgHost').value = res.data.postgres.host || 'localhost';
          document.getElementById('credPgPort').value = res.data.postgres.port || 5432;
          document.getElementById('credPgUser').value = res.data.postgres.user || 'postgres';
          document.getElementById('credPgPass').value = res.data.postgres.password || '';
        }
        if (res.data.mysql) {
          document.getElementById('credMysqlHost').value = res.data.mysql.host || 'localhost';
          document.getElementById('credMysqlPort').value = res.data.mysql.port || 3306;
          document.getElementById('credMysqlUser').value = res.data.mysql.user || 'root';
          document.getElementById('credMysqlPass').value = res.data.mysql.password || '';
        }
      }
    } catch (_) {}
    credentialsModal.show();
  }

  async function saveCredentials(e, type) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const oldHtml = btn.innerHTML;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Connecting...';
    btn.disabled = true;

    let payload = { type };
    if (type === 'postgres') {
      payload.host = document.getElementById('credPgHost').value;
      payload.port = document.getElementById('credPgPort').value;
      payload.user = document.getElementById('credPgUser').value;
      payload.password = document.getElementById('credPgPass').value;
    } else if (type === 'mysql') {
      payload.host = document.getElementById('credMysqlHost').value;
      payload.port = document.getElementById('credMysqlPort').value;
      payload.user = document.getElementById('credMysqlUser').value;
      payload.password = document.getElementById('credMysqlPass').value;
    }

    try {
      const res = await LP.post('/database/credentials', payload);
      if (res?.success) {
        LP.toast(`${type.toUpperCase()} connected successfully!`, 'success');
        if (credentialsModal) credentialsModal.hide();
        loadData();
      } else {
        LP.toast(res?.message || 'Connection failed', 'error');
      }
    } catch (err) {
      LP.toast('Failed to save connection credentials', 'error');
    } finally {
      btn.innerHTML = oldHtml;
      btn.disabled = false;
    }
  }

  function showCreateModal() {
    if (!modal) modal = new bootstrap.Modal(document.getElementById('createDbModal'));
    document.getElementById('createDbForm').reset();
    modal.show();
  }

  async function createDatabase(e) {
    e.preventDefault();
    const type = document.getElementById('dbType').value;
    const name = document.getElementById('dbName').value;
    const btn = e.target.querySelector('button[type="submit"]');
    const oldHtml = btn.innerHTML;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
    btn.disabled = true;
    try {
      const res = await LP.post('/database', { type, name });
      if (res?.success) { LP.toast('Database created', 'success'); modal.hide(); loadData(); }
      else LP.toast(res?.message || 'Failed', 'error');
    } catch { LP.toast('Error creating database', 'error'); }
    finally { btn.innerHTML = oldHtml; btn.disabled = false; }
  }

  async function deleteDb(type, name) {
    type = String(type || '').replace(/^["']|["']$/g, '').trim();
    name = String(name || '').replace(/^["']|["']$/g, '').trim();
    if (!(await LP.confirm(`Delete ${type} database "${name}"?`, 'Delete Database'))) return;
    try {
      const res = await LP.delete('/database', { type, name });
      if (res?.success) { LP.toast('Database deleted', 'success'); loadData(); }
      else LP.toast(res?.message || 'Failed', 'error');
    } catch { LP.toast('Error', 'error'); }
  }

  async function installPackage(pkg) {
    if (!(await LP.confirm(`Install ${pkg}? This may take a few minutes.`, 'Install'))) return;
    const spinner = document.createElement('div');
    spinner.id = 'installSpinner';
    spinner.innerHTML = `<div style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.8);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;">
      <div class="spinner-border text-primary" style="width:3rem;height:3rem;"></div>
      <h4 style="color:#fff;margin-top:20px;">Installing ${pkg}...</h4></div>`;
    document.body.appendChild(spinner);
    try {
      const res = await LP.post('/system/install', { package: pkg });
      if (res?.success) {
        LP.toast(`${pkg} installed!`, 'success');
        loadData();
      } else {
        const errMsg = res?.message || 'Installation failed';
        LP.toast('Failed', 'error');
        LP.showManualInstallModal(pkg, errMsg);
      }
    } catch (err) {
      const errMsg = err?.message || 'Installation error';
      LP.toast('Error', 'error');
      LP.showManualInstallModal(pkg, errMsg);
    }
    finally { document.getElementById('installSpinner')?.remove(); }
  }

  // ── Explorer ─────────────────────────────────────────

  // Show the selected schema in the explorer title so the context is always clear
  function updateExplorerTitle() {
    const titleEl = document.getElementById('exploreDbTitle');
    if (!titleEl) return;
    const base = `Explorer: ${activeDb} (${activeType.toUpperCase()})`;
    titleEl.textContent = activeType === 'postgres'
      ? `${base} — schema: ${activeSchema}`
      : base;
    updateBrowseSchemaBadge();
  }

  // Show the active schema as a badge next to the browsed table name (PostgreSQL only)
  function updateBrowseSchemaBadge() {
    const badge = document.getElementById('browseSchemaBadge');
    if (!badge) return;
    if (activeType === 'postgres') {
      badge.textContent = activeSchema;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }

  async function openExplorer(type, db) {
    activeType = String(type || '').replace(/^["']|["']$/g, '').trim();
    activeDb = String(db || '').replace(/^["']|["']$/g, '').trim();
    activeTable = null;
    activeSchema = 'public';
    currentPage = 1;
    currentSort = { column: null, dir: 'ASC' };

    updateExplorerTitle();
    if (!explorerModal) explorerModal = new bootstrap.Modal(document.getElementById('exploreDbModal'));
    explorerModal.show();

    switchExplorerTab('browse');
    await loadSchemas();
    updateExplorerTitle();
    await refreshExplorerTables();
  }

  // PostgreSQL schema selector — loads schemas and shows the dropdown only for postgres
  async function loadSchemas() {
    const group = document.getElementById('explorerSchemaGroup');
    const select = document.getElementById('explorerSchemaSelect');
    if (!group || !select) return;
    if (activeType !== 'postgres') {
      group.style.display = 'none';
      activeSchema = 'public';
      return;
    }
    group.style.display = 'block';
    select.innerHTML = '<option value="public">public</option>';
    try {
      const res = await LP.get(`/database/schemas?type=${activeType}&name=${encodeURIComponent(activeDb)}`);
      const schemas = (res?.success && Array.isArray(res.data) && res.data.length > 0) ? res.data : ['public'];
      if (!schemas.includes(activeSchema)) activeSchema = schemas.includes('public') ? 'public' : schemas[0];
      select.innerHTML = schemas.map(s =>
        `<option value="${LP.escHtml(s)}"${s === activeSchema ? ' selected' : ''}>${LP.escHtml(s)}</option>`
      ).join('');
    } catch {
      activeSchema = 'public';
    }
  }

  // Called when the user picks a different schema — reload tables for that schema
  function switchSchema() {
    const select = document.getElementById('explorerSchemaSelect');
    if (select) activeSchema = select.value || 'public';
    activeTable = null;
    currentPage = 1;
    currentSort = { column: null, dir: 'ASC' };
    updateExplorerTitle();

    // Reset table-specific panels
    document.getElementById('browseTableName').textContent = '—';
    document.getElementById('browseRowInfo').textContent = '0 rows';
    document.getElementById('browseDataHead').innerHTML = '<tr><th>Select a table to browse</th></tr>';
    document.getElementById('browseDataBody').innerHTML = '<tr><td class="text-muted">Click a table name in the left panel.</td></tr>';
    document.getElementById('browsePagination').innerHTML = '';
    document.getElementById('structureContent').innerHTML = '<p class="text-muted">Select a table to view its structure.</p>';
    refreshExplorerTables();
    populateExportTables();
  }

  async function refreshExplorerTables() {
    const listEl = document.getElementById('dbExplorerTablesList');
    listEl.innerHTML = '<p class="text-muted" style="font-size:12px;">Loading...</p>';

    try {
      const res = await LP.get(`/database/explore?type=${activeType}&name=${encodeURIComponent(activeDb)}&schema=${encodeURIComponent(activeSchema)}`);
      if (res?.success && Array.isArray(res.data.tables)) {
        document.getElementById('explorerTableCount').textContent = res.data.tables.length;
        if (res.data.tables.length === 0) {
          listEl.innerHTML = '<p class="text-muted" style="font-size:12px;">No tables found</p>';
        } else {
          listEl.innerHTML = res.data.tables.map(tbl => `
            <button class="btn-lp btn-lp-ghost btn-lp-sm text-start w-100" style="padding:5px 8px;font-size:12px;${activeTable === tbl ? 'background:rgba(99,102,241,0.15);color:var(--accent-primary);' : ''}" onclick="DB.selectTable('${LP.escHtml(tbl)}')">
              <i class="bi bi-table text-info me-1"></i> ${LP.escHtml(tbl)}
            </button>
          `).join('');
        }
      }
    } catch { listEl.innerHTML = '<p class="text-danger" style="font-size:12px;">Error loading tables</p>'; }
  }

  async function selectTable(table) {
    if (typeof table === 'string') {
      try { table = decodeURIComponent(table); } catch (_) {}
      table = table.replace(/^["']|["']$/g, '').trim();
    }
    activeTable = table;
    currentPage = 1;
    currentSort = { column: null, dir: 'ASC' };
    switchExplorerTab('browse');
    await loadTableInfo();
    await loadTableData();
  }

  async function loadTableInfo() {
    if (!activeTable) return;
    try {
      const res = await LP.get(`/database/table-info?type=${activeType}&database=${encodeURIComponent(activeDb)}&table=${encodeURIComponent(activeTable)}&schema=${encodeURIComponent(activeSchema)}`);
      if (res?.success) {
        const info = res.data;
        const el = document.getElementById('structureContent');
        el.innerHTML = `
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:15px;margin-bottom:20px;">
            <div class="lp-glass-card" style="padding:12px;text-align:center;"><div style="font-size:18px;font-weight:600;">${info.columns.length}</div><div style="font-size:11px;color:var(--text-muted);">Columns</div></div>
            <div class="lp-glass-card" style="padding:12px;text-align:center;"><div style="font-size:18px;font-weight:600;">${info.indexes?.length || 0}</div><div style="font-size:11px;color:var(--text-muted);">Indexes</div></div>
            <div class="lp-glass-card" style="padding:12px;text-align:center;"><div style="font-size:18px;font-weight:600;">${info.rowCount || '—'}</div><div style="font-size:11px;color:var(--text-muted);">Rows</div></div>
          </div>
          <h6 style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">Columns</h6>
          <table class="lp-table" style="font-size:12px;"><thead><tr><th>Field</th><th>Type</th><th>Null</th><th>Key</th><th>Default</th><th>Extra</th></tr></thead>
          <tbody>${info.columns.map(c => `<tr><td>${LP.escHtml(c.field)}</td><td style="color:var(--accent-warning);">${LP.escHtml(c.type)}</td><td>${c.nullable ? 'YES' : 'NO'}</td><td>${LP.escHtml(c.key || '')}</td><td>${c.default !== null ? LP.escHtml(c.default) : '<span class="text-muted">null</span>'}</td><td style="color:#888;">${LP.escHtml(c.extra || '')}</td></tr>`).join('')}</tbody></table>
          ${info.indexes?.length > 0 ? `
          <h6 style="font-size:12px;color:var(--text-muted);margin:20px 0 10px;">Indexes</h6>
          <table class="lp-table" style="font-size:12px;"><thead><tr><th>Name</th><th>Unique</th></tr></thead>
          <tbody>${info.indexes.map(i => `<tr><td>${LP.escHtml(i.name)}</td><td>${i.unique ? '<span class="text-success">Yes</span>' : 'No'}</td></tr>`).join('')}</tbody></table>` : ''}
          ${info.foreignKeys?.length > 0 ? `
          <h6 style="font-size:12px;color:var(--text-muted);margin:20px 0 10px;">Foreign Keys</h6>
          <table class="lp-table" style="font-size:12px;"><thead><tr><th>Column</th><th>References Table</th><th>References Column</th></tr></thead>
          <tbody>${info.foreignKeys.map(fk => `<tr><td>${LP.escHtml(fk.COLUMN_NAME || fk.column_name || fk.from)}</td><td>${LP.escHtml(fk.REFERENCED_TABLE_NAME || fk.foreign_table_name || fk.table)}</td><td>${LP.escHtml(fk.REFERENCED_COLUMN_NAME || fk.foreign_column_name || fk.to)}</td></tr>`).join('')}</tbody></table>` : ''}
          ${info.createTable ? `<h6 style="font-size:12px;color:var(--text-muted);margin:20px 0 10px;">CREATE TABLE</h6><pre style="background:rgba(0,0,0,0.3);padding:12px;border-radius:8px;font-size:11px;overflow-x:auto;white-space:pre-wrap;">${LP.escHtml(info.createTable)}</pre>` : ''}
        `;
      }
    } catch { /* ignore */ }
  }

  async function loadTableData() {
    if (!activeTable) return;
    const limit = document.getElementById('browseLimit').value;
    try {
      let url = `/database/table-data?type=${activeType}&database=${encodeURIComponent(activeDb)}&table=${encodeURIComponent(activeTable)}&page=${currentPage}&limit=${limit}&schema=${encodeURIComponent(activeSchema)}`;
      if (currentSort.column) url += `&sortColumn=${encodeURIComponent(currentSort.column)}&sortDir=${currentSort.dir}`;
      const res = await LP.get(url);
      if (res?.success) {
        const { rows, total } = res.data;
        document.getElementById('browseTableName').textContent = activeTable;
        document.getElementById('browseRowInfo').textContent = `${total} total rows`;

        const totalPages = Math.ceil(total / parseInt(limit)) || 1;
        const pagEl = document.getElementById('browsePagination');
        pagEl.innerHTML = `
          <button class="btn-lp btn-lp-ghost btn-lp-sm" onclick="DB.goToPage(${currentPage - 1})" ${currentPage <= 1 ? 'disabled' : ''} style="font-size:11px;padding:2px 8px;"><i class="bi bi-chevron-left"></i></button>
          <span style="font-size:11px;color:var(--text-muted);padding:0 8px;display:flex;align-items:center;">${currentPage} / ${totalPages}</span>
          <button class="btn-lp btn-lp-ghost btn-lp-sm" onclick="DB.goToPage(${currentPage + 1})" ${currentPage >= totalPages ? 'disabled' : ''} style="font-size:11px;padding:2px 8px;"><i class="bi bi-chevron-right"></i></button>
        `;

        renderTableData(rows);
      }
    } catch { LP.toast('Failed to load data', 'error'); }
  }

  function renderTableData(rows) {
    const head = document.getElementById('browseDataHead');
    const body = document.getElementById('browseDataBody');

    if (!Array.isArray(rows) || rows.length === 0) {
      head.innerHTML = '<tr><th>No Data</th></tr>';
      body.innerHTML = '<tr><td class="text-muted">Table is empty.</td></tr>';
      return;
    }

    const columns = Object.keys(rows[0]);
    head.innerHTML = `<tr>${columns.map(c => `<th class="sortable${currentSort.column === c ? ' ' + currentSort.dir.toLowerCase() : ''}" onclick="LP.call('DB.sortColumn', '${LP.encJsArg(c)}')">${LP.escHtml(c)}</th>`).join('')}</tr>`;

    body.innerHTML = rows.map(row => `
      <tr>${columns.map(col => `<td>${formatCellValue(row[col])}</td>`).join('')}</tr>
    `).join('');
  }

  function formatCellValue(val) {
    if (val === null || val === undefined) return '<span class="text-muted">NULL</span>';
    const str = String(val);
    if (str.length > 200) return '<span title="' + LP.escHtml(str) + '">' + LP.escHtml(str.substring(0, 200)) + '...</span>';
    return LP.escHtml(str);
  }

  function goToPage(page) {
    currentPage = page;
    loadTableData();
  }

  function sortColumn(col) {
    if (typeof col === 'string') {
      try { col = decodeURIComponent(col); } catch (_) {}
      col = col.replace(/^["']|["']$/g, '').trim();
    }
    if (currentSort.column === col) {
      currentSort.dir = currentSort.dir === 'ASC' ? 'DESC' : 'ASC';
    } else {
      currentSort.column = col;
      currentSort.dir = 'ASC';
    }
    loadTableData();
  }

  // ── Explorer Tabs ────────────────────────────────────

  function switchExplorerTab(tab) {
    document.querySelectorAll('.explorer-tab').forEach(t => {
      t.style.color = '';
      t.style.borderBottomColor = 'transparent';
    });
    document.querySelectorAll('.explorer-panel').forEach(p => p.style.display = 'none');

    const tabBtn = document.querySelector(`.explorer-tab[data-tab="${tab}"]`);
    if (tabBtn) {
      tabBtn.style.color = 'var(--accent-primary)';
      tabBtn.style.borderBottomColor = 'var(--accent-primary)';
    }

    const panel = document.getElementById('panel-' + tab);
    if (panel) {
      panel.style.display = tab === 'browse' || tab === 'query' ? 'flex' : 'block';
    }

    if (tab === 'history') loadHistory();
    if (tab === 'export') populateExportTables();
  }

  // ── Query ────────────────────────────────────────────

  async function runQuery(customQuery) {
    const query = customQuery || document.getElementById('queryInput').value.trim();
    if (!query) { LP.toast('Enter a query', 'error'); return; }

    const statusEl = document.getElementById('queryStatus');
    statusEl.textContent = '⏳ Running query...';
    statusEl.style.color = 'var(--accent-warning)';

    try {
      const res = await LP.post('/database/explore', { type: activeType, name: activeDb, query });
      if (res?.success && res.data) {
        const { rows, columns, affected } = res.data;
        statusEl.textContent = `✅ Query OK — ${rows.length} rows returned, ${affected || 0} affected`;
        statusEl.style.color = '#22c55e';

        const head = document.getElementById('queryResultsHead');
        const body = document.getElementById('queryResultsBody');
        if (columns && columns.length > 0) {
          head.innerHTML = `<tr>${columns.map(c => `<th>${LP.escHtml(c)}</th>`).join('')}</tr>`;
          body.innerHTML = rows.map(row => `<tr>${columns.map(c => `<td>${formatCellValue(row[c])}</td>`).join('')}</tr>`).join('');
        } else {
          head.innerHTML = '<tr><th>Result</th></tr>';
          body.innerHTML = `<tr><td class="text-muted">${affected} row(s) affected</td></tr>`;
        }
      } else {
        statusEl.textContent = '❌ ' + (res?.message || 'Query failed');
        statusEl.style.color = 'var(--accent-danger)';
      }
    } catch (err) {
      statusEl.textContent = '❌ ' + err.message;
      statusEl.style.color = 'var(--accent-danger)';
    }
  }

  // ── History ──────────────────────────────────────────

  async function loadHistory() {
    try {
      const res = await LP.get('/database/query-history');
      if (res?.success && res.data.history?.length > 0) {
        document.getElementById('historyList').innerHTML = res.data.history.slice(0, 50).map(h => `
          <div class="lp-glass-card" style="padding:10px;margin-bottom:5px;font-size:12px;cursor:pointer;" onclick="document.getElementById('queryInput').value='${LP.escHtml(h.query).replace(/'/g, "\\'")}';DB.switchExplorerTab('query')">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
              <span class="text-info" style="font-size:10px;text-transform:uppercase;">${LP.escHtml(h.type)} / ${LP.escHtml(h.database)}</span>
              <span style="color:var(--text-muted);font-size:10px;">${new Date(h.timestamp).toLocaleString()}</span>
            </div>
            <code style="color:#e0e0e0;">${LP.escHtml(h.query.substring(0, 120))}${h.query.length > 120 ? '...' : ''}</code>
          </div>
        `).join('');
      } else {
        document.getElementById('historyList').innerHTML = '<p class="text-muted">No query history yet.</p>';
      }
    } catch { document.getElementById('historyList').innerHTML = '<p class="text-danger">Failed to load history</p>'; }
  }

  async function clearHistory() {
    try {
      await LP.post('/database/query-history/clear');
      document.getElementById('historyList').innerHTML = '<p class="text-muted">History cleared.</p>';
      LP.toast('History cleared', 'success');
    } catch { LP.toast('Failed to clear history', 'error'); }
  }

  // ── Export ───────────────────────────────────────────

  async function populateExportTables() {
    try {
      const res = await LP.get(`/database/explore?type=${activeType}&name=${encodeURIComponent(activeDb)}&schema=${encodeURIComponent(activeSchema)}`);
      if (res?.success && Array.isArray(res.data.tables)) {
        const html = res.data.tables.map(t => `<option value="${LP.escHtml(t)}">${LP.escHtml(t)}</option>`).join('');
        document.getElementById('exportTableSelect').innerHTML = html;
        document.getElementById('importTableSelect').innerHTML = html;
      }
    } catch {}
  }

  async function exportTable() {
    const table = document.getElementById('exportTableSelect').value;
    const format = document.getElementById('exportFormatSelect').value;
    if (!table) { LP.toast('Select a table', 'error'); return; }

    try {
      const res = await LP.post('/database/export', { type: activeType, database: activeDb, table, format, schema: activeSchema });
      if (res?.success) {
        const { content, filename, mime } = res.data;
        const blob = new Blob([content], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
        LP.toast('Export downloaded', 'success');
      } else LP.toast(res?.message || 'Export failed', 'error');
    } catch { LP.toast('Export error', 'error'); }
  }

  function toggleImportFields() {
    const type = document.getElementById('importTypeSelect').value;
    document.getElementById('importTableGroup').style.display = type === 'csv' ? 'block' : 'none';
  }

  async function importData() {
    const importType = document.getElementById('importTypeSelect').value;
    const content = document.getElementById('importContent').value.trim();
    if (!content) { LP.toast('Enter content to import', 'error'); return; }

    try {
      let res;
      if (importType === 'sql') {
        res = await LP.post('/database/import/sql', { type: activeType, database: activeDb, sql: content, schema: activeSchema });
      } else {
        const table = document.getElementById('importTableSelect').value;
        res = await LP.post('/database/import/csv', { type: activeType, database: activeDb, table, csv: content, schema: activeSchema });
      }
      if (res?.success) LP.toast(res?.message ? `Imported successfully: ${res.message}` : 'Imported successfully', 'success');
      else LP.toast(res?.message || 'Import failed', 'error');
    } catch { LP.toast('Import error', 'error'); }
  }

  // ── Visual Table Data Editor (Row CRUD) ─────────────────────

  let currentColumns = [];

  function renderTableData(rows) {
    const head = document.getElementById('browseDataHead');
    const body = document.getElementById('browseDataBody');

    if (!Array.isArray(rows) || rows.length === 0) {
      head.innerHTML = '<tr><th>No Data</th></tr>';
      body.innerHTML = '<tr><td class="text-muted">Table is empty. <button class="btn-lp btn-lp-primary btn-lp-sm ms-2" onclick="DB.showInsertRowModal()"><i class="bi bi-plus"></i> Add First Row</button></td></tr>';
      return;
    }

    currentColumns = Object.keys(rows[0]);
    const pkCol = currentColumns.find(c => c.toLowerCase() === 'id' || c.toLowerCase().endsWith('_id')) || currentColumns[0];

    head.innerHTML = `
      <tr>
        <th style="width:40px;text-align:center;">#</th>
        ${currentColumns.map(c => `<th class="sortable${currentSort.column === c ? ' ' + currentSort.dir.toLowerCase() : ''}" onclick="LP.call('DB.sortColumn', '${LP.encJsArg(c)}')">${LP.escHtml(c)}</th>`).join('')}
        <th style="width:70px;text-align:center;">Actions</th>
      </tr>
    `;

    body.innerHTML = rows.map((row, idx) => {
      const pkVal = row[pkCol];
      return `
        <tr>
          <td style="text-align:center;color:var(--text-muted);font-size:11px;">${(currentPage - 1) * parseInt(document.getElementById('browseLimit')?.value || 50) + idx + 1}</td>
          ${currentColumns.map(col => `
            <td ondblclick="DB.makeCellEditable(this, '${LP.escHtml(col)}', '${LP.escHtml(pkCol)}', '${LP.escHtml(String(pkVal))}')" title="Double click to edit" style="cursor:pointer;">
              ${formatCellValue(row[col])}
            </td>
          `).join('')}
          <td style="text-align:center;">
            <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" style="padding:2px 6px;" onclick="DB.deleteRow('${LP.escHtml(pkCol)}', '${LP.escHtml(String(pkVal))}')" title="Delete Row">
              <i class="bi bi-trash"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  function makeCellEditable(td, colName, pkCol, pkVal) {
    if (td.querySelector('input')) return;
    const oldText = td.textContent.trim();
    const isNull = oldText === 'NULL';
    const initialVal = isNull ? '' : oldText;

    td.innerHTML = `<input type="text" class="lp-input" value="${LP.escHtml(initialVal)}" style="padding:2px 6px;font-size:11px;width:100%;margin:0;">`;
    const input = td.querySelector('input');
    input.focus();

    async function commit() {
      const newVal = input.value;
      if (newVal === initialVal) {
        td.innerHTML = formatCellValue(isNull ? null : initialVal);
        return;
      }
      try {
        const updatedFields = {};
        updatedFields[colName] = newVal;
        const res = await LP.post('/database/row/update', {
          type: activeType,
          database: activeDb,
          table: activeTable,
          pkColumn: pkCol,
          pkValue: pkVal,
          updatedFields,
          schema: activeSchema,
        });
        if (res?.success) {
          LP.toast('Cell updated', 'success');
          td.innerHTML = formatCellValue(newVal);
        } else {
          LP.toast(res?.message || 'Update failed', 'error');
          td.innerHTML = formatCellValue(isNull ? null : initialVal);
        }
      } catch (err) {
        LP.toast(err.message || 'Error updating cell', 'error');
        td.innerHTML = formatCellValue(isNull ? null : initialVal);
      }
    }

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { input.removeEventListener('blur', commit); commit(); }
      if (e.key === 'Escape') { input.removeEventListener('blur', commit); td.innerHTML = formatCellValue(isNull ? null : initialVal); }
    });
  }

  async function deleteRow(pkCol, pkVal) {
    if (!(await LP.confirm(`Delete row where ${pkCol} = "${pkVal}"?`, 'Delete Row'))) return;
    try {
      const res = await LP.post('/database/row/delete', {
        type: activeType,
        database: activeDb,
        table: activeTable,
        pkColumn: pkCol,
        pkValue: pkVal,
        schema: activeSchema,
      });
      if (res?.success) {
        LP.toast('Row deleted successfully', 'success');
        loadTableData();
      } else {
        LP.toast(res?.message || 'Delete failed', 'error');
      }
    } catch {
      LP.toast('Failed to delete row', 'error');
    }
  }

  async function showInsertRowModal() {
    if (!activeTable) {
      LP.toast('Please select a table first', 'warning');
      return;
    }
    const cols = currentColumns.length > 0 ? currentColumns : ['column1'];
    const fieldsHtml = cols.map(c => `
      <div class="mb-2">
        <label class="lp-label font-mono" style="font-size:11px;">${LP.escHtml(c)}</label>
        <input type="text" name="${LP.escHtml(c)}" class="lp-input" placeholder="Value for ${LP.escHtml(c)}" style="font-size:12px;">
      </div>
    `).join('');

    const modalHtml = `
      <div class="modal fade" id="dbInsertRowModal" tabindex="-1">
        <div class="modal-dialog">
          <div class="modal-content" style="background:#0f172a;border:1px solid var(--glass-border);color:#fff;">
            <div class="modal-header">
              <h5 class="modal-title font-mono" style="font-size:14px;"><i class="bi bi-plus-circle text-primary me-2"></i>Insert Row into <code>${LP.escHtml(activeTable)}</code></h5>
              <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
            </div>
            <form id="insertRowForm" onsubmit="DB.submitInsertRow(event)">
              <div class="modal-body" style="max-height:60vh;overflow-y:auto;">
                ${fieldsHtml}
              </div>
              <div class="modal-footer">
                <button type="button" class="btn-lp btn-lp-ghost" data-bs-dismiss="modal">Cancel</button>
                <button type="submit" class="btn-lp btn-lp-primary"><i class="bi bi-save me-1"></i> Insert Row</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    `;

    const old = document.getElementById('dbInsertRowModal');
    if (old) old.remove();
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const m = new bootstrap.Modal(document.getElementById('dbInsertRowModal'));
    m.show();
  }

  async function submitInsertRow(e) {
    e.preventDefault();
    const form = e.target;
    const inputs = form.querySelectorAll('input[name]');
    const rowData = {};
    inputs.forEach(inp => {
      if (inp.value !== '') rowData[inp.name] = inp.value;
    });

    try {
      const res = await LP.post('/database/row/insert', {
        type: activeType,
        database: activeDb,
        table: activeTable,
        rowData,
        schema: activeSchema,
      });
      if (res?.success) {
        LP.toast('Row inserted successfully!', 'success');
        bootstrap.Modal.getInstance(document.getElementById('dbInsertRowModal'))?.hide();
        loadTableData();
      } else {
        LP.toast(res?.message || 'Insert failed', 'error');
      }
    } catch (err) {
      LP.toast(err.message || 'Error inserting row', 'error');
    }
  }

  // ── SQL Query Explain ────────────────────────────────────────

  async function explainQuery() {
    const query = document.getElementById('queryInput')?.value?.trim();
    if (!query) {
      LP.toast('Please enter a query to explain', 'warning');
      return;
    }
    const statusEl = document.getElementById('queryStatus');
    if (statusEl) {
      statusEl.textContent = '⏳ Generating execution plan...';
      statusEl.style.color = 'var(--accent-warning)';
    }

    try {
      const res = await LP.post('/database/query/explain', { type: activeType, name: activeDb, query });
      if (res?.success && res.data) {
        if (statusEl) {
          statusEl.textContent = '✅ Execution Plan Generated';
          statusEl.style.color = '#22c55e';
        }
        const head = document.getElementById('queryResultsHead');
        const body = document.getElementById('queryResultsBody');
        const { rows, columns } = res.data;

        if (columns && columns.length > 0) {
          head.innerHTML = `<tr>${columns.map(c => `<th>${LP.escHtml(c)}</th>`).join('')}</tr>`;
          body.innerHTML = rows.map(row => `<tr>${columns.map(c => `<td>${formatCellValue(row[c])}</td>`).join('')}</tr>`).join('');
        } else {
          head.innerHTML = '<tr><th>Plan</th></tr>';
          body.innerHTML = `<tr><td class="font-mono">${JSON.stringify(rows, null, 2)}</td></tr>`;
        }
      } else {
        if (statusEl) {
          statusEl.textContent = '❌ ' + (res?.message || 'Explain failed');
          statusEl.style.color = 'var(--accent-danger)';
        }
      }
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = '❌ ' + err.message;
        statusEl.style.color = 'var(--accent-danger)';
      }
    }
  }

  // ── PostgreSQL Config Management ─────────────────────

  async function enablePgRemoteAccess() {
    const btn = document.getElementById('btnEnablePgRemote');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Configuring...';
    }
    try {
      const res = await LP.post('/database/pg-config/enable-remote', {});
      if (res?.success) {
        LP.toast('PostgreSQL configured for Docker & Remote access!', 'success');
        loadPgConfigFiles();
      } else {
        LP.toast(res?.message || 'Failed to enable remote access', 'error');
      }
    } catch (err) {
      LP.toast(err.message || 'Failed to configure PostgreSQL', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-lightning-charge-fill me-1"></i> Enable Docker & Remote Access';
      }
    }
  }

  async function loadPgConfigFiles() {
    try {
      const res = await LP.get('/database/pg-config');
      if (res?.success && res.data) {
        const { confPath, hbaPath, confContent, hbaContent } = res.data;
        const areaConf = document.getElementById('pgConfContent');
        const areaHba = document.getElementById('pgHbaContent');
        const labelConf = document.getElementById('pgConfPathLabel');
        const labelHba = document.getElementById('pgHbaPathLabel');

        if (areaConf) areaConf.value = confContent || '';
        if (areaHba) areaHba.value = hbaContent || '';
        if (labelConf) labelConf.textContent = confPath || 'postgresql.conf';
        if (labelHba) labelHba.textContent = hbaPath || 'pg_hba.conf';
      }
    } catch {
      LP.toast('Failed to load PostgreSQL config files', 'error');
    }
  }

  async function savePgConfigFile(fileType) {
    const isConf = fileType === 'conf' || fileType === 'postgresql.conf';
    const content = isConf ? document.getElementById('pgConfContent').value : document.getElementById('pgHbaContent').value;
    const btn = isConf ? document.getElementById('btnSavePgConf') : document.getElementById('btnSavePgHba');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Saving & Restarting...';
    }
    try {
      const res = await LP.post('/database/pg-config/save', { fileType: isConf ? 'postgresql.conf' : 'pg_hba.conf', content });
      if (res?.success) {
        LP.toast(`${isConf ? 'postgresql.conf' : 'pg_hba.conf'} saved & PostgreSQL restarted!`, 'success');
      } else {
        LP.toast(res?.message || 'Failed to save config file', 'error');
      }
    } catch (err) {
      LP.toast(err.message || 'Failed to save config file', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-save me-1"></i> Save & Restart PostgreSQL';
      }
    }
  }

  // ── Database Backup & Restore ─────────────────────────

  async function backupDatabase(type, name, btnEl) {
    if (!type || !name) return;
    const oldHtml = btnEl ? btnEl.innerHTML : '';
    if (btnEl) {
      btnEl.disabled = true;
      btnEl.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Backup...';
    }

    try {
      const res = await LP.post('/database/backup', { type, name });
      if (res?.success && res.data) {
        LP.toast(`Backup database ${name} berhasil dibuat!`, 'success');

        // Auto trigger browser download
        if (res.data.downloadUrl) {
          const a = document.createElement('a');
          a.href = res.data.downloadUrl;
          a.download = res.data.filename || `${name}_backup.sql`;
          document.body.appendChild(a);
          a.click();
          a.remove();
        }
      } else {
        LP.toast(res?.message || 'Gagal membuat backup database', 'error');
      }
    } catch (err) {
      LP.toast(`Error backup: ${err.message}`, 'error');
    } finally {
      if (btnEl) {
        btnEl.disabled = false;
        btnEl.innerHTML = oldHtml;
      }
    }
  }

  async function showRestoreModal(type, name) {
    currentRestoreTarget = { type, name };
    if (!restoreModal) restoreModal = new bootstrap.Modal(document.getElementById('restoreDbModal'));

    document.getElementById('restoreDbTitle').textContent = `${name} (${type.toUpperCase()})`;
    document.getElementById('restoreFileInput').value = '';
    document.getElementById('confirmOverwriteCheck').checked = false;
    document.getElementById('btnExecuteRestore').disabled = true;

    // Load available server backups for this database
    const selectEl = document.getElementById('restoreServerBackupSelect');
    selectEl.innerHTML = '<option value="">Memuat cadangan server...</option>';

    try {
      const res = await LP.get(`/database/backups?type=${encodeURIComponent(type)}&name=${encodeURIComponent(name)}`);
      if (res?.success && Array.isArray(res.data) && res.data.length > 0) {
        selectEl.innerHTML = res.data.map(b => `
          <option value="${LP.escHtml(b.filename)}">${LP.escHtml(b.filename)} (${LP.formatBytes(b.size)} - ${new Date(b.created).toLocaleString()})</option>
        `).join('');
      } else {
        selectEl.innerHTML = '<option value="">-- Belum ada file cadangan tersimpan di server --</option>';
      }
    } catch (_) {
      selectEl.innerHTML = '<option value="">-- Gagal mengambil daftar backup server --</option>';
    }

    restoreModal.show();
  }

  async function executeRestore() {
    const checkEl = document.getElementById('confirmOverwriteCheck');
    if (!checkEl.checked) {
      LP.toast('Harap centang persetujuan penimpaan database sebelum melanjutkan', 'warning');
      return;
    }

    const { type, name } = currentRestoreTarget;
    if (!type || !name) {
      LP.toast('Target database tidak valid', 'error');
      return;
    }

    const btn = document.getElementById('btnExecuteRestore');
    const oldHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Menimpa database...';

    try {
      const fileInput = document.getElementById('restoreFileInput');
      const hasUploadedFile = fileInput.files && fileInput.files.length > 0;

      if (hasUploadedFile) {
        // Upload FormData
        const fd = new FormData();
        fd.append('type', type);
        fd.append('name', name);
        fd.append('backupFile', fileInput.files[0]);

        const res = await fetch('/api/database/restore', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + (LP.state.accessToken || localStorage.getItem('lp_token') || '')
          },
          body: fd
        }).then(r => r.json());

        if (res?.success) {
          LP.toast(`Database ${name} berhasil di-restore dan data lama telah ditimpa!`, 'success');
          restoreModal.hide();
          loadData();
        } else {
          LP.toast(res?.message || 'Gagal me-restore database', 'error');
        }
      } else {
        // From server backup history
        const selectEl = document.getElementById('restoreServerBackupSelect');
        const backupFilename = selectEl.value;
        if (!backupFilename) {
          LP.toast('Pilih file backup dari komputer atau daftar server', 'warning');
          return;
        }

        const res = await LP.post('/database/restore', {
          type,
          name,
          backupFilename
        });

        if (res?.success) {
          LP.toast(`Database ${name} berhasil di-restore dan data lama telah ditimpa!`, 'success');
          restoreModal.hide();
          loadData();
        } else {
          LP.toast(res?.message || 'Gagal me-restore database', 'error');
        }
      }
    } catch (err) {
      LP.toast(`Error restore: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = oldHtml;
    }
  }

  // ── Database Auto-Backup ─────────────────────────────

  async function showAutoBackupModal() {
    if (!autoBackupModal) autoBackupModal = new bootstrap.Modal(document.getElementById('dbAutoBackupModal'));

    try {
      const res = await LP.get('/database/autobackup');
      if (res?.success && res.data) {
        const c = res.data;
        document.getElementById('abEnabled').checked = !!c.enabled;
        document.getElementById('abFrequency').value = c.frequency || 'daily';
        document.getElementById('abTime').value = c.time || '02:00';
        document.getElementById('abRetention').value = c.retentionDays || 7;
        document.getElementById('abTargetMysql').checked = c.targets?.mysql !== false;
        document.getElementById('abTargetPostgres').checked = c.targets?.postgres !== false;
        document.getElementById('abTargetSqlite').checked = c.targets?.sqlite !== false;
      }
    } catch (_) {}

    autoBackupModal.show();
  }

  async function saveAutoBackup() {
    const payload = {
      enabled: document.getElementById('abEnabled').checked,
      frequency: document.getElementById('abFrequency').value,
      time: document.getElementById('abTime').value,
      retentionDays: parseInt(document.getElementById('abRetention').value) || 7,
      targets: {
        mysql: document.getElementById('abTargetMysql').checked,
        postgres: document.getElementById('abTargetPostgres').checked,
        sqlite: document.getElementById('abTargetSqlite').checked,
      }
    };

    try {
      const res = await LP.post('/database/autobackup', payload);
      if (res?.success) {
        LP.toast('Pengaturan auto-backup berhasil disimpan!', 'success');
        autoBackupModal.hide();
      } else {
        LP.toast(res?.message || 'Gagal menyimpan pengaturan auto-backup', 'error');
      }
    } catch (err) {
      LP.toast(`Error: ${err.message}`, 'error');
    }
  }

  async function runAutoBackupNow() {
    try {
      LP.toast('Menjalankan auto-backup database...', 'info');
      const res = await LP.post('/database/autobackup/run');
      if (res?.success) {
        const count = res.data?.results?.filter(r => r.status === 'success').length || 0;
        LP.toast(`Auto-backup selesai: ${count} database berhasil dicadangkan!`, 'success');
      } else {
        LP.toast(res?.message || 'Auto-backup gagal dijalankan', 'error');
      }
    } catch (err) {
      LP.toast(`Error running auto-backup: ${err.message}`, 'error');
    }
  }

  // ── Keyboard Shortcut ────────────────────────────────

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('queryInput')?.addEventListener('keydown', e => {
      if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); runQuery(); }
    });
    loadData();
  });

  return {
    loadData, showCredentialsModal, saveCredentials, showCreateModal, createDatabase, deleteDb, installPackage,
    openExplorer, refreshExplorerTables, selectTable, loadTableData, loadTableInfo,
    loadSchemas, switchSchema, goToPage, sortColumn, switchExplorerTab,
    runQuery, explainQuery, loadHistory, clearHistory,
    exportTable, toggleImportFields, importData,
    enablePgRemoteAccess, loadPgConfigFiles, savePgConfigFile,
    makeCellEditable, deleteRow, showInsertRowModal, submitInsertRow,
    backupDatabase, showRestoreModal, executeRestore,
    showAutoBackupModal, saveAutoBackup, runAutoBackupNow
  };
})();

window.DB = DB;
window.DatabasePage = DB;
window.DBPage = DB;
