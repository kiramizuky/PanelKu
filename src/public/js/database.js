const DatabasePage = (() => {
  let modal;

  async function loadData() {
    try {
      const statusRes = await LP.get('/system/check-install');
      const statuses = statusRes?.success ? statusRes.data : {};
      
      const res = await LP.get('/database');
      if (res?.success) {
        renderMysql(res.data.mysql || [], statuses.mysql);
        renderPostgres(res.data.postgres || [], statuses.postgres);
        renderSqlite(res.data.sqlite || []);
      }
    } catch (e) {
      console.error(e);
      LP.toast('Failed to load databases', 'error');
    }
  }

  let installModal = null;

  async function installPackage(pkgName) {
    if (pkgName === 'mysql' || pkgName === 'postgres') {
      document.getElementById('installPkgName').value = pkgName;
      document.getElementById('installConfigTitle').textContent = `Install & Configure ${pkgName === 'mysql' ? 'MySQL' : 'PostgreSQL'}`;
      document.getElementById('installConfigDescription').textContent = `Set a secure password for the '${pkgName === 'mysql' ? 'root' : 'postgres'}' database administrator user. This password will also be automatically saved to Panelku configuration.`;
      document.getElementById('installPasswordLabel').textContent = `${pkgName === 'mysql' ? 'Root' : 'Postgres'} Password`;
      document.getElementById('installPassword').value = '';
      
      installModal = new bootstrap.Modal(document.getElementById('installConfigModal'));
      installModal.show();
    } else {
      if (!(await LP.confirm(`Do you want to install ${pkgName}? This may take a few minutes.`, 'Install Package'))) return;
      runInstall(pkgName);
    }
  }

  async function submitInstall(e) {
    e.preventDefault();
    const pkgName = document.getElementById('installPkgName').value;
    const password = document.getElementById('installPassword').value;
    
    const modalEl = document.getElementById('installConfigModal');
    const modalInstance = bootstrap.Modal.getInstance(modalEl);
    if (modalInstance) {
      modalInstance.hide();
    }
    
    await runInstall(pkgName, password);
  }

  async function runInstall(pkgName, password = '') {
    // Show a global loading spinner
    const spinner = document.createElement('div');
    spinner.id = 'installSpinner';
    spinner.innerHTML = `
      <div style="position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.8); z-index:9999; display:flex; flex-direction:column; align-items:center; justify-content:center;">
        <div class="spinner-border text-primary" style="width: 3rem; height: 3rem;" role="status"></div>
        <h4 style="color:#fff; margin-top:20px;">Installing ${pkgName}... Please wait.</h4>
      </div>
    `;
    document.body.appendChild(spinner);

    try {
      const res = await LP.post('/system/install', { package: pkgName, password });
      if (res?.success) {
        LP.toast(`${pkgName} installed successfully!`, 'success');
        loadData();
      } else {
        LP.toast(`Failed to install ${pkgName}: ${res?.message}`, 'error');
      }
    } catch (e) {
      LP.toast(`Error installing ${pkgName}`, 'error');
    } finally {
      document.getElementById('installSpinner')?.remove();
    }
  }

  function renderMysql(dbs, isInstalled) {
    const tbody = document.getElementById('mysqlTableBody');
    if (isInstalled === false) {
      tbody.innerHTML = `<tr><td colspan="2" style="text-align:center;padding:40px;">
        <h4 style="margin-bottom:15px;">MySQL is not installed</h4>
        <button class="btn-lp btn-lp-primary" onclick="DatabasePage.installPackage('mysql')"><i class="bi bi-download"></i> Install MySQL</button>
      </td></tr>`;
      return;
    }
    LP.paginate(dbs, 10, 'mysqlTableBody', 'mysqlPagination', db => `
      <tr>
        <td class="font-mono"><strong>${LP.escHtml(db)}</strong></td>
        <td style="text-align:right">
          <button class="btn-lp btn-lp-ghost btn-lp-sm text-primary me-1" onclick="LP.call('DatabasePage.openExplorer', '${LP.encJsArg('mysql')}', '${LP.encJsArg(db)}')" title="Explore Database"><i class="bi bi-eye"></i> Explore</button>
          <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="LP.call('DatabasePage.deleteDb', '${LP.encJsArg('mysql')}', '${LP.encJsArg(db)}')"><i class="bi bi-trash"></i></button>
        </td>
      </tr>
    `, 'No MySQL databases found', 2);
  }

  function renderPostgres(dbs, isInstalled) {
    const tbody = document.getElementById('postgresTableBody');
    if (isInstalled === false) {
      tbody.innerHTML = `<tr><td colspan="2" style="text-align:center;padding:40px;">
        <h4 style="margin-bottom:15px;">PostgreSQL is not installed</h4>
        <button class="btn-lp btn-lp-primary" onclick="DatabasePage.installPackage('postgres')"><i class="bi bi-download"></i> Install PostgreSQL</button>
      </td></tr>`;
      return;
    }
    LP.paginate(dbs, 10, 'postgresTableBody', 'postgresPagination', db => `
      <tr>
        <td class="font-mono"><strong>${LP.escHtml(db)}</strong></td>
        <td style="text-align:right">
          <button class="btn-lp btn-lp-ghost btn-lp-sm text-primary me-1" onclick="LP.call('DatabasePage.openExplorer', '${LP.encJsArg('postgres')}', '${LP.encJsArg(db)}')" title="Explore Database"><i class="bi bi-eye"></i> Explore</button>
          <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="LP.call('DatabasePage.deleteDb', '${LP.encJsArg('postgres')}', '${LP.encJsArg(db)}')"><i class="bi bi-trash"></i></button>
        </td>
      </tr>
    `, 'No PostgreSQL databases found', 2);
  }

  function renderSqlite(dbs) {
    const tbody = document.getElementById('sqliteTableBody');
    LP.paginate(dbs, 10, 'sqliteTableBody', 'sqlitePagination', db => `
      <tr>
        <td class="font-mono"><strong>${LP.escHtml(db)}</strong></td>
        <td style="text-align:right">
          <button class="btn-lp btn-lp-ghost btn-lp-sm text-primary me-1" onclick="LP.call('DatabasePage.openExplorer', '${LP.encJsArg('sqlite')}', '${LP.encJsArg(db)}')" title="Explore Database"><i class="bi bi-eye"></i> Explore</button>
          <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="LP.call('DatabasePage.deleteDb', '${LP.encJsArg('sqlite')}', '${LP.encJsArg(db)}')"><i class="bi bi-trash"></i></button>
        </td>
      </tr>
    `, 'No SQLite databases found', 2);
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
    
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const oldHtml = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Creating...';
    submitBtn.disabled = true;
    
    try {
      const res = await LP.post('/database', { type, name });
      if (res?.success) {
        LP.toast(`Database ${name} created successfully`, 'success');
        modal.hide();
        loadData();
      } else {
        LP.toast(res?.message || 'Failed to create database', 'error');
      }
    } catch (err) {
      LP.toast('Error creating database', 'error');
    } finally {
      submitBtn.innerHTML = oldHtml;
      submitBtn.disabled = false;
    }
  }

  async function deleteDb(type, name) {
    if (!(await LP.confirm(`Are you sure you want to delete the ${type} database "${name}"? This action cannot be undone.`, 'Delete Database'))) return;
    try {
      const res = await LP.delete('/database', { type, name });
      if (res?.success) {
        LP.toast('Database deleted', 'success');
        loadData();
      } else {
        LP.toast(res?.message || 'Failed to delete database', 'error');
      }
    } catch (e) {
      LP.toast('Error deleting database', 'error');
    }
  }

  let activeExplorerType = null;
  let activeExplorerName = null;

  async function openExplorer(type, name) {
    activeExplorerType = type;
    activeExplorerName = name;
    
    document.getElementById('exploreDbTitle').textContent = `Database Explorer: ${name} (${type.toUpperCase()})`;
    document.getElementById('dbQueryInput').value = '';
    
    document.getElementById('dbExplorerResultsHead').innerHTML = '<tr><th>Query results will be displayed here</th></tr>';
    document.getElementById('dbExplorerResultsBody').innerHTML = '<tr><td class="text-muted">Execute a query or select a table to begin.</td></tr>';
    
    const modal = new bootstrap.Modal(document.getElementById('exploreDbModal'));
    modal.show();

    const listEl = document.getElementById('dbExplorerTablesList');
    listEl.innerHTML = '<p class="text-muted" style="font-size:12px;">Loading tables...</p>';
    
    try {
      const res = await LP.get(`/database/explore?type=${type}&name=${encodeURIComponent(name)}`);
      if (res?.success && Array.isArray(res.data.tables)) {
        if (res.data.tables.length === 0) {
          listEl.innerHTML = '<p class="text-muted" style="font-size:12px;">No tables found</p>';
        } else {
          listEl.innerHTML = res.data.tables.map(tbl => `
            <button class="btn-lp btn-lp-ghost btn-lp-sm text-start w-100 mb-1" style="padding: 4px 8px; font-size:12px;" onclick="LP.call('DatabasePage.loadTablePreview', '${LP.encJsArg(tbl)}')">
              <i class="bi bi-table text-info me-1"></i> ${LP.escHtml(tbl)}
            </button>
          `).join('');
        }
      } else {
        listEl.innerHTML = '<p class="text-danger" style="font-size:12px;">Failed to load tables</p>';
      }
    } catch {
      listEl.innerHTML = '<p class="text-danger" style="font-size:12px;">Error loading tables</p>';
    }
  }

  async function runExplorerQuery(customQuery = null) {
    const query = customQuery || document.getElementById('dbQueryInput').value.trim();
    if (!query) {
      LP.toast('Please enter a query', 'error');
      return;
    }

    const statusEl = document.getElementById('dbQueryStatus');
    statusEl.textContent = 'Running query...';
    
    try {
      const res = await LP.post('/database/explore', {
        type: activeExplorerType,
        name: activeExplorerName,
        query
      });

      if (res?.success && res.data.result) {
        statusEl.textContent = 'Query executed successfully';
        renderQueryResult(res.data.result);
      } else {
        statusEl.textContent = 'Failed to execute query';
        LP.toast(res?.message || 'Query failed', 'error');
      }
    } catch (err) {
      statusEl.textContent = 'Error: ' + err.message;
      LP.toast('Connection error', 'error');
    }
  }

  function loadTablePreview(tableName) {
    const query = `SELECT * FROM \`${tableName}\` LIMIT 50;`;
    document.getElementById('dbQueryInput').value = query;
    runExplorerQuery(query);
  }

  function renderQueryResult(result) {
    const head = document.getElementById('dbExplorerResultsHead');
    const body = document.getElementById('dbExplorerResultsBody');

    if (!Array.isArray(result) || result.length === 0) {
      head.innerHTML = '<tr><th>Result</th></tr>';
      body.innerHTML = `<tr><td class="text-muted">${JSON.stringify(result) || 'Query executed (no rows returned).'}</td></tr>`;
      return;
    }

    const columns = Object.keys(result[0]);
    head.innerHTML = `<tr>${columns.map(c => `<th>${c}</th>`).join('')}</tr>`;
    
    body.innerHTML = result.map(row => `
      <tr>
        ${columns.map(col => `<td>${row[col] !== null ? escHtml(row[col]) : '<span class="text-muted">NULL</span>'}</td>`).join('')}
      </tr>
    `).join('');
  }

  function escHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Initialize
  document.addEventListener('DOMContentLoaded', () => {
    loadData();
  });

  return {
    loadData,
    showCreateModal,
    createDatabase,
    deleteDb,
    installPackage,
    submitInstall,
    openExplorer,
    loadTablePreview,
    runExplorerQuery
  };
  
})();

window.DatabasePage = DatabasePage;
