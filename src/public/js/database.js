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
        renderMongo(res.data.mongodb || [], statuses.mongodb);
        renderSqlite(res.data.sqlite || []);
      }
    } catch (e) {
      console.error(e);
      LP.toast('Failed to load databases', 'error');
    }
  }

  async function installPackage(pkgName) {
    if (!confirm(`Do you want to install ${pkgName}? This may take a few minutes.`)) return;
    
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
      const res = await LP.post('/system/install', { package: pkgName });
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
    if (!dbs.length) {
      tbody.innerHTML = '<tr><td colspan="2" style="text-align:center;padding:20px;color:var(--text-muted)">No MySQL databases found</td></tr>';
      return;
    }
    tbody.innerHTML = dbs.map(db => `
      <tr>
        <td class="font-mono"><strong>${db}</strong></td>
        <td style="text-align:right">
          <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="DatabasePage.deleteDb('mysql', '${db}')"><i class="bi bi-trash"></i></button>
        </td>
      </tr>
    `).join('');
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
    if (!dbs.length) {
      tbody.innerHTML = '<tr><td colspan="2" style="text-align:center;padding:20px;color:var(--text-muted)">No PostgreSQL databases found</td></tr>';
      return;
    }
    tbody.innerHTML = dbs.map(db => `
      <tr>
        <td class="font-mono"><strong>${db}</strong></td>
        <td style="text-align:right">
          <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="DatabasePage.deleteDb('postgres', '${db}')"><i class="bi bi-trash"></i></button>
        </td>
      </tr>
    `).join('');
  }

  function renderMongo(dbs, isInstalled) {
    const tbody = document.getElementById('mongoTableBody');
    if (isInstalled === false) {
      tbody.innerHTML = `<tr><td style="text-align:center;padding:40px;">
        <h4 style="margin-bottom:15px;">MongoDB is not installed</h4>
        <button class="btn-lp btn-lp-primary" onclick="DatabasePage.installPackage('mongodb')"><i class="bi bi-download"></i> Install MongoDB</button>
      </td></tr>`;
      return;
    }
    if (!dbs.length) {
      tbody.innerHTML = '<tr><td style="text-align:center;padding:20px;color:var(--text-muted)">No MongoDB databases found</td></tr>';
      return;
    }
    tbody.innerHTML = dbs.map(db => `
      <tr>
        <td class="font-mono"><strong>${db}</strong></td>
      </tr>
    `).join('');
  }

  function renderSqlite(dbs) {
    const tbody = document.getElementById('sqliteTableBody');
    if (!dbs.length) {
      tbody.innerHTML = '<tr><td colspan="2" style="text-align:center;padding:20px;color:var(--text-muted)">No SQLite databases found</td></tr>';
      return;
    }
    tbody.innerHTML = dbs.map(db => `
      <tr>
        <td class="font-mono"><strong>${db}</strong></td>
        <td style="text-align:right">
          <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="DatabasePage.deleteDb('sqlite', '${db}')"><i class="bi bi-trash"></i></button>
        </td>
      </tr>
    `).join('');
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
    }
  }

  async function deleteDb(type, name) {
    if (!confirm(`Are you sure you want to delete the ${type} database "${name}"? This action cannot be undone.`)) return;
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

  // Initialize
  document.addEventListener('DOMContentLoaded', () => {
    loadData();
  });

  return {
    loadData,
    showCreateModal,
    createDatabase,
    deleteDb
  };
})();
