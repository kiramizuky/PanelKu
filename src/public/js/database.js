const DB = (() => {
  let modal, explorerModal;
  let activeType = 'mysql';
  let activeDb = null;
  let activeTable = null;
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
          <button class="btn-lp btn-lp-ghost btn-lp-sm text-primary me-1" onclick="DB.openExplorer('${LP.encJsArg(type)}', '${LP.encJsArg(db)}')" title="Explore"><i class="bi bi-eye"></i> Explore</button>
          <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="DB.deleteDb('${LP.encJsArg(type)}', '${LP.encJsArg(db)}')"><i class="bi bi-trash"></i></button>
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
      if (res?.success) LP.toast(`${pkg} installed!`, 'success');
      else LP.toast('Failed', 'error');
      loadData();
    } catch { LP.toast('Error', 'error'); }
    finally { document.getElementById('installSpinner')?.remove(); }
  }

  // ── Explorer ─────────────────────────────────────────

  async function openExplorer(type, db) {
    activeType = type;
    activeDb = db;
    activeTable = null;
    currentPage = 1;

    document.getElementById('exploreDbTitle').textContent = `Explorer: ${db} (${type.toUpperCase()})`;
    if (!explorerModal) explorerModal = new bootstrap.Modal(document.getElementById('exploreDbModal'));
    explorerModal.show();

    switchExplorerTab('browse');
    await refreshExplorerTables();
  }

  async function refreshExplorerTables() {
    const listEl = document.getElementById('dbExplorerTablesList');
    listEl.innerHTML = '<p class="text-muted" style="font-size:12px;">Loading...</p>';

    try {
      const res = await LP.get(`/database/explore?type=${activeType}&name=${encodeURIComponent(activeDb)}`);
      if (res?.success && Array.isArray(res.data.tables)) {
        document.getElementById('explorerTableCount').textContent = res.data.tables.length;
        if (res.data.tables.length === 0) {
          listEl.innerHTML = '<p class="text-muted" style="font-size:12px;">No tables found</p>';
        } else {
          listEl.innerHTML = res.data.tables.map(tbl => `
            <button class="btn-lp btn-lp-ghost btn-lp-sm text-start w-100" style="padding:5px 8px;font-size:12px;${activeTable === tbl ? 'background:rgba(99,102,241,0.15);color:var(--accent-primary);' : ''}" onclick="DB.selectTable('${LP.encJsArg(tbl)}')">
              <i class="bi bi-table text-info me-1"></i> ${LP.escHtml(tbl)}
            </button>
          `).join('');
        }
      }
    } catch { listEl.innerHTML = '<p class="text-danger" style="font-size:12px;">Error loading tables</p>'; }
  }

  async function selectTable(table) {
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
      const res = await LP.get(`/database/table-info?type=${activeType}&database=${encodeURIComponent(activeDb)}&table=${encodeURIComponent(activeTable)}`);
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
      let url = `/database/table-data?type=${activeType}&database=${encodeURIComponent(activeDb)}&table=${encodeURIComponent(activeTable)}&page=${currentPage}&limit=${limit}`;
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
    head.innerHTML = `<tr>${columns.map(c => `<th class="sortable${currentSort.column === c ? ' ' + currentSort.dir.toLowerCase() : ''}" onclick="DB.sortColumn('${LP.encJsArg(c)}')">${LP.escHtml(c)}</th>`).join('')}</tr>`;

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
      const res = await LP.get(`/database/explore?type=${activeType}&name=${encodeURIComponent(activeDb)}`);
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
      const res = await LP.post('/database/export', { type: activeType, database: activeDb, table, format });
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
        res = await LP.post('/database/import/sql', { type: activeType, database: activeDb, sql: content });
      } else {
        const table = document.getElementById('importTableSelect').value;
        res = await LP.post('/database/import/csv', { type: activeType, database: activeDb, table, csv: content });
      }
      if (res?.success) LP.toast(`Imported successfully: ${res.message}`, 'success');
      else LP.toast(res?.message || 'Import failed', 'error');
    } catch { LP.toast('Import error', 'error'); }
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
    goToPage, sortColumn, switchExplorerTab,
    runQuery, loadHistory, clearHistory,
    exportTable, toggleImportFields, importData,
  };
})();

window.DB = DB;
