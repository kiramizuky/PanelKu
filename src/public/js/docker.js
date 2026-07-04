/**
 * Linux Panel — docker.js
 * Docker frontend management with search, create container, and compose deployment
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
    LP.paginate(containers, 10, 'containersTableBody', 'containersPagination', c => {
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
    }, 'No containers found', 6);
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
    LP.paginate(images, 10, 'imagesTableBody', 'imagesPagination', img => {
      const tag = img.tags[0] || '<none>:<none>';
      
      let inUseHtml = '<span class="text-muted">—</span>';
      let hasRunningContainers = false;
      
      if (img.containers && img.containers.length > 0) {
        hasRunningContainers = img.containers.some(c => c.state === 'running');
        inUseHtml = img.containers.map(c => {
          const color = c.state === 'running' ? 'var(--accent-success)' : 'var(--text-muted)';
          return `<span style="color:${color};font-size:11px;margin-right:4px;" title="State: ${c.state}">${c.names[0]}</span>`;
        }).join('');
      }

      return `
        <tr>
          <td class="font-mono" style="color:var(--text-primary)">${tag}</td>
          <td class="font-mono" style="font-size:12px;color:var(--text-muted)">${img.id}</td>
          <td>${inUseHtml}</td>
          <td style="font-size:12px">${LP.formatBytes(img.size)}</td>
          <td style="font-size:12px;color:var(--text-muted)">${new Date(img.created * 1000).toLocaleString()}</td>
          <td style="text-align:right">
            <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="DockerPage.deleteImage('${img.id}', ${hasRunningContainers})" title="Delete"><i class="bi bi-trash"></i></button>
          </td>
        </tr>
      `;
    }, 'No images found', 6);
  }

  async function action(type, id) {
    if (type === 'delete') {
      const confirmed = await LP.confirm('Delete this container?', 'Delete Container');
      if (!confirmed) return;
      const res = await LP.del(`/docker/containers/${id}?force=true`);
      if (res?.success) {
        LP.toast(`Container deleted successfully`, 'success');
        loadData();
      } else {
        LP.toast(res?.message || 'Delete failed', 'error');
      }
      return;
    }
    
    LP.toast(`Executing ${type}...`, 'info');
    const res = await LP.post(`/docker/containers/${id}/${type}`);
    if (res?.success) {
      LP.toast(`Container ${type} successful`, 'success');
      loadData();
    } else {
      LP.toast(res?.message || 'Action failed', 'error');
    }
  }

  async function deleteImage(id, hasRunningContainers) {
    if (hasRunningContainers) {
      LP.toast('Cannot delete image: It is currently used by running container(s). Please stop them first.', 'error');
      return;
    }
    const confirmed = await LP.confirm('Delete this image?', 'Delete Image');
    if (!confirmed) return;

    const res = await LP.del(`/docker/images/${id}?force=true`);
    if (res?.success) {
      LP.toast('Image deleted', 'success');
      loadData();
    } else {
      LP.toast(res?.message || 'Failed to delete image', 'error');
    }
  }

  async function pruneImages() {
    const confirmed = await LP.confirm('Are you sure you want to prune all unused images? This cannot be undone.', 'Prune Images');
    if (!confirmed) return;

    LP.toast('Pruning unused images...', 'info');
    const res = await LP.post('/docker/images/prune');
    if (res?.success) {
      const { count, reclaimed } = res.data;
      LP.toast(`Pruned ${count} images (${LP.formatBytes(reclaimed)} reclaimed)`, 'success');
      loadData();
    } else {
      LP.toast(res?.message || 'Failed to prune images', 'error');
    }
  }

  // --- Search, Create Container, and Compose Logic ---

  function addPortRow() {
    const container = document.getElementById('portMappingsContainer');
    const row = document.createElement('div');
    row.className = 'dynamic-row';
    row.innerHTML = `
      <input type="number" class="lp-input" placeholder="Host Port (e.g. 8080)" data-type="host">
      <input type="number" class="lp-input" placeholder="Container Port (e.g. 80)" data-type="container">
      <button type="button" class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="this.parentElement.remove()">X</button>
    `;
    container.appendChild(row);
  }

  function addVolumeRow() {
    const container = document.getElementById('volumeMappingsContainer');
    const row = document.createElement('div');
    row.className = 'dynamic-row';
    row.innerHTML = `
      <input type="text" class="lp-input" placeholder="Host Path (e.g. /opt/data)" data-type="host-path">
      <input type="text" class="lp-input" placeholder="Container Path (e.g. /app/data)" data-type="container-path">
      <button type="button" class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="this.parentElement.remove()">X</button>
    `;
    container.appendChild(row);
  }

  function addEnvRow() {
    const container = document.getElementById('envContainer');
    const row = document.createElement('div');
    row.className = 'dynamic-row';
    row.innerHTML = `
      <input type="text" class="lp-input" placeholder="Variable Name (e.g. NODE_ENV)" data-type="env-key">
      <input type="text" class="lp-input" placeholder="Value" data-type="env-value">
      <button type="button" class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="this.parentElement.remove()">X</button>
    `;
    container.appendChild(row);
  }

  async function submitContainer(e) {
    e.preventDefault();

    const name = document.getElementById('cName').value.trim();
    const image = document.getElementById('cImage').value.trim();
    const restart = document.getElementById('cRestart').value;
    const startAfterCreate = document.getElementById('cStart').checked;

    // Fetch port mappings
    const ports = [];
    document.querySelectorAll('#portMappingsContainer .dynamic-row').forEach(row => {
      const hostVal = row.querySelector('[data-type="host"]').value;
      const containerVal = row.querySelector('[data-type="container"]').value;
      if (hostVal && containerVal) {
        ports.push({ hostPort: parseInt(hostVal), containerPort: parseInt(containerVal) });
      }
    });

    // Fetch volume mappings
    const volumes = [];
    document.querySelectorAll('#volumeMappingsContainer .dynamic-row').forEach(row => {
      const hostPath = row.querySelector('[data-type="host-path"]').value.trim();
      const containerPath = row.querySelector('[data-type="container-path"]').value.trim();
      if (hostPath && containerPath) {
        volumes.push({ hostPath, containerPath });
      }
    });

    // Fetch envs
    const env = [];
    document.querySelectorAll('#envContainer .dynamic-row').forEach(row => {
      const key = row.querySelector('[data-type="env-key"]').value.trim();
      const value = row.querySelector('[data-type="env-value"]').value.trim();
      if (key && value) {
        env.push({ key, value });
      }
    });

    LP.toast('Creating container...', 'info');

    const res = await LP.post('/docker/containers', {
      name, image, restart, startAfterCreate, ports, volumes, env
    });

    if (res?.success) {
      LP.toast('Container deployed successfully!', 'success');
      document.getElementById('createContainerForm').reset();
      document.getElementById('portMappingsContainer').innerHTML = '';
      document.getElementById('volumeMappingsContainer').innerHTML = '';
      document.getElementById('envContainer').innerHTML = '';
      loadData();
    } else {
      LP.toast(`Failed to create container: ${res?.message}`, 'error');
    }
  }

  async function searchOnline() {
    const term = document.getElementById('dockerSearchTerm').value.trim();
    if (!term) return;

    const resultsContainer = document.getElementById('onlineSearchResults');
    resultsContainer.innerHTML = `<div class="text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div> Searching...</div>`;

    const res = await LP.get(`/docker/images/search?term=${encodeURIComponent(term)}`);
    if (res?.success && res.data.results) {
      if (res.data.results.length === 0) {
        resultsContainer.innerHTML = `<p class="text-muted text-center py-3">No images found for "${term}"</p>`;
        return;
      }

      resultsContainer.innerHTML = res.data.results.map(img => `
        <div style="padding:10px; border-bottom:1px solid var(--glass-border); display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div class="font-mono" style="font-weight:600; font-size:12px; color:var(--text-primary)">${img.name}</div>
            <div style="font-size:10px; color:var(--text-muted); max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${img.description || 'No description'}</div>
            <div style="font-size:10px; color:var(--accent-info)">★ ${img.star_count} stars | Official: ${img.is_official ? 'Yes' : 'No'}</div>
          </div>
          <button class="btn-lp btn-lp-primary btn-lp-sm" style="padding: 2px 8px;" onclick="DockerPage.selectOnlineImage('${img.name}')">Select</button>
        </div>
      `).join('');
    } else {
      resultsContainer.innerHTML = `<p class="text-danger text-center py-3">Error searching Docker Hub</p>`;
    }
  }

  function selectOnlineImage(imageName) {
    document.getElementById('cImage').value = imageName;
    LP.toast(`Selected image: ${imageName}`, 'success');
  }

  async function deployCompose(e) {
    e.preventDefault();

    const projectName = document.getElementById('composeProjectName').value.trim();
    const yaml = document.getElementById('composeYaml').value;

    LP.toast('Deploying Compose Stack...', 'info');

    const res = await LP.post('/docker/compose', { projectName, yaml });
    if (res?.success) {
      LP.toast('Compose Stack deployed successfully!', 'success');
      loadData();
    } else {
      LP.toast(`Deployment failed: ${res?.message}`, 'error');
    }
  }

  // --- Log Terminal Logic ---

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
      if (!term) initTerminal();
      else term.clear();
      if (fitAddon) fitAddon.fit();
      
      if (!socket) initSocket();
      socket.emit('logs:attach', id);
    }, 300);
  }

  function detachLogs() {
    if (socket) {
      socket.emit('logs:detach');
    }
  }

  async function loadData() {
    try {
      const statusRes = await LP.get('/system/check-install');
      const statuses = statusRes?.success ? statusRes.data : {};
      
      loadSummary();
      loadContainers(statuses.docker);
      loadImages(statuses.docker);
    } catch (e) {
      LP.toast('Failed to load docker summary', 'error');
    }
  }

  async function installPackage(pkgName) {
    if (!(await LP.confirm(`Do you want to install ${pkgName}? This may take a few minutes.`, 'Install Package'))) return;
    
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
    loadData,
    action,
    deleteImage,
    pruneImages,
    viewLogs,
    detachLogs,
    addPortRow,
    addVolumeRow,
    addEnvRow,
    submitContainer,
    searchOnline,
    selectOnlineImage,
    deployCompose,
    installPackage
  };
})();

window.DockerPage = DockerPage;

document.addEventListener('DOMContentLoaded', () => {
  DockerPage.loadData();
});
