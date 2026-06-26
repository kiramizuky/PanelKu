/**
 * Linux Panel — docker.js
 * Docker frontend management
 */

const DockerPage = (() => {
  let socket = null;
  let term = null;
  let fitAddon = null;

  async function loadSummary() {
    const res = await LP.get('/docker/summary');
    if (!res?.success) return;
    const { containers, containersRunning, containersStopped, images } = res.data;
    
    document.getElementById('statTotal').textContent = containers;
    document.getElementById('statRunning').textContent = containersRunning;
    document.getElementById('statStopped').textContent = containersStopped;
    document.getElementById('statImages').textContent = images;
  }

  async function loadContainers(isInstalled) {
    const tbody = document.getElementById('containersTableBody');
    if (isInstalled === false) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;">
        <h4 style="margin-bottom:15px;">Docker is not installed</h4>
        <button class="btn-lp btn-lp-primary" onclick="DockerPage.installPackage('docker')"><i class="bi bi-download"></i> Install Docker</button>
      </td></tr>`;
      return;
    }

    const res = await LP.get('/docker/containers');
    if (!res?.success) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger">${res?.message || 'Error'}</td></tr>`;
      return;
    }

    const { containers } = res.data;
    if (!containers.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No containers found</td></tr>';
      return;
    }

    tbody.innerHTML = containers.map(c => {
      const isRunning = c.state === 'running';
      const badgeClass = isRunning ? 'lp-badge-success' : 'lp-badge-danger';
      const ports = c.ports?.map(p => `${p.PublicPort || p.PrivatePort}/${p.Type}`).join(', ') || '—';

      return `
        <tr>
          <td>
            <div class="font-mono" style="font-weight:600;color:var(--text-primary)">${c.names[0]}</div>
            <div style="font-size:11px;color:var(--text-muted)">ID: ${c.id}</div>
          </td>
          <td><span class="lp-badge ${badgeClass}"><span class="lp-badge-dot"></span>${c.state}</span></td>
          <td class="font-mono" style="font-size:12px">${c.image}</td>
          <td class="font-mono" style="font-size:11px">${ports}</td>
          <td style="font-size:12px;color:var(--text-muted)">${new Date(c.created * 1000).toLocaleString()}</td>
          <td style="text-align:right">
            ${isRunning 
              ? `<button class="btn-lp btn-lp-ghost btn-lp-sm" onclick="DockerPage.action('stop', '${c.id}')" title="Stop"><i class="bi bi-stop-fill text-danger"></i></button>
                 <button class="btn-lp btn-lp-ghost btn-lp-sm" onclick="DockerPage.action('restart', '${c.id}')" title="Restart"><i class="bi bi-arrow-clockwise text-warning"></i></button>`
              : `<button class="btn-lp btn-lp-ghost btn-lp-sm" onclick="DockerPage.action('start', '${c.id}')" title="Start"><i class="bi bi-play-fill text-success"></i></button>`
            }
            <button class="btn-lp btn-lp-ghost btn-lp-sm" onclick="DockerPage.viewLogs('${c.id}', '${c.names[0]}')" title="Logs"><i class="bi bi-justify-left"></i></button>
            <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="DockerPage.action('delete', '${c.id}')" title="Delete"><i class="bi bi-trash"></i></button>
          </td>
        </tr>
      `;
    }).join('');
  }

  async function loadImages(isInstalled) {
    const tbody = document.getElementById('imagesTableBody');
    if (isInstalled === false) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:40px;">
        <h4 style="margin-bottom:15px;">Docker is not installed</h4>
        <button class="btn-lp btn-lp-primary" onclick="DockerPage.installPackage('docker')"><i class="bi bi-download"></i> Install Docker</button>
      </td></tr>`;
      return;
    }

    const res = await LP.get('/docker/images');
    if (!res?.success) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger">${res?.message || 'Error'}</td></tr>`;
      return;
    }

    const { images } = res.data;
    if (!images.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No images found</td></tr>';
      return;
    }

    tbody.innerHTML = images.map(img => {
      const tag = img.tags[0] || '<none>:<none>';
      return `
        <tr>
          <td class="font-mono" style="color:var(--text-primary)">${tag}</td>
          <td class="font-mono" style="font-size:12px;color:var(--text-muted)">${img.id}</td>
          <td style="font-size:12px">${LP.formatBytes(img.size)}</td>
          <td style="font-size:12px;color:var(--text-muted)">${new Date(img.created * 1000).toLocaleString()}</td>
          <td style="text-align:right">
            <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="DockerPage.deleteImage('${img.id}')" title="Delete"><i class="bi bi-trash"></i></button>
          </td>
        </tr>
      `;
    }).join('');
  }

  async function action(type, id) {
    let method = 'POST';
    let url = `/docker/containers/${id}/${type}`;
    
    if (type === 'delete') {
      const confirmed = await LP.confirm('Delete this container?', 'Delete Container');
      if (!confirmed) return;
      method = 'DELETE';
      url = `/docker/containers/${id}?force=true`;
    } else {
      LP.toast(`Executing ${type}...`, 'info', null, 1000);
    }

    const res = await fetch(`/api${url}`, {
      method,
      headers: { 'Authorization': `Bearer ${LP.state.accessToken}` }
    }).then(r => r.json());

    if (res?.success) {
      LP.toast(`Container ${type} successful`, 'success');
      loadData();
    } else {
      LP.toast(res?.message || 'Action failed', 'error');
    }
  }

  async function deleteImage(id) {
    const confirmed = await LP.confirm('Delete this image?', 'Delete Image');
    if (!confirmed) return;

    const res = await LP.del(`/docker/images/${id}?force=true`);
    if (res?.success) {
      LP.toast('Image deleted', 'success');
      loadImages();
      loadSummary();
    } else {
      LP.toast(res?.message || 'Failed to delete image', 'error');
    }
  }

  function initSocket() {
    const token = localStorage.getItem('lp_token');
    if (!token) return;

    socket = io('/docker', { auth: { token }, transports: ['websocket'] });
    
    socket.on('logs:data', (data) => {
      if (term) term.write(data + '\r\n');
    });
    
    socket.on('logs:error', (err) => {
      if (term) term.write(`\x1b[31m[Log Error: ${err}]\x1b[0m\r\n`);
    });
  }

  function initTerminal() {
    term = new Terminal({
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 13,
      theme: { background: '#0a0e1a', foreground: '#e2e8f0' },
      convertEol: true,
      disableStdin: true
    });
    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(document.getElementById('logTerminal'));
  }

  function viewLogs(id, name) {
    document.getElementById('logModalTitle').textContent = `Logs: ${name}`;
    const modal = new bootstrap.Modal(document.getElementById('logModal'));
    
    modal.show();
    
    setTimeout(() => {
      fitAddon.fit();
      term.clear();
      if (socket?.connected) {
        socket.emit('logs:attach', { containerId: id });
      }
    }, 200);
  }

  function detachLogs() {
    if (socket?.connected) {
      socket.emit('detach');
    }
    term?.clear();
  }

  async function loadData() {
    try {
      const statusRes = await LP.get('/system/check-install');
      const isInstalled = statusRes?.success ? statusRes.data.docker : true;
      
      if (isInstalled) loadSummary();
      loadContainers(isInstalled);
      loadImages(isInstalled);
    } catch (e) {
      console.error('Failed to load docker data', e);
    }
  }

  async function installPackage(pkgName) {
    if (!(await LP.confirm(`Do you want to install ${pkgName}? This may take a few minutes.`, 'Install Docker'))) return;
    
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

  return {
    async init() {
      await LP.init();
      if (!LP.state.accessToken) return;
      
      initSocket();
      initTerminal();
      loadData();
    },
    loadData,
    action,
    deleteImage,
    viewLogs,
    detachLogs,
    installPackage
  };
})();

document.addEventListener('DOMContentLoaded', () => DockerPage.init());
