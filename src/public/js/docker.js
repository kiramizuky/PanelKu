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
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger">${LP.escHtml(res?.message || 'Error')}</td></tr>`;
      return;
    }

    const { containers } = res.data;
    LP.paginate(containers, 10, 'containersTableBody', 'containersPagination', c => {
      const isRunning = c.state === 'running';
      const badgeClass = isRunning ? 'lp-badge-success' : 'lp-badge-danger';
      const ports = c.ports?.map(p => `${p.PublicPort || p.PrivatePort}/${p.Type}`).join(', ') || '—';
      const containerId = String(c.id || '').replace(/^["']|["']$/g, '').trim();
      const containerName = String(c.names[0] || '').replace(/^["']|["']$/g, '').trim();

      return `
        <tr>
          <td>
            <div class="font-mono" style="font-weight:600;color:var(--text-primary)">${LP.escHtml(containerName)}</div>
            <div style="font-size:11px;color:var(--text-muted)">ID: ${LP.escHtml(containerId.substring(0, 12))}</div>
          </td>
          <td><span class="lp-badge ${badgeClass}"><span class="lp-badge-dot"></span>${LP.escHtml(c.state)}</span></td>
          <td class="font-mono" style="font-size:12px">${LP.escHtml(c.image)}</td>
          <td class="font-mono" style="font-size:11px">${LP.escHtml(ports)}</td>
          <td style="font-size:12px;color:var(--text-muted)">${new Date(c.created * 1000).toLocaleString()}</td>
          <td style="text-align:right">
            ${isRunning 
              ? `<button class="btn-lp btn-lp-ghost btn-lp-sm text-danger me-1" onclick="DockerPage.action('stop', '${LP.escHtml(containerId)}')" title="Stop"><i class="bi bi-stop-fill"></i> Stop</button>
                 <button class="btn-lp btn-lp-ghost btn-lp-sm text-warning me-1" onclick="DockerPage.action('restart', '${LP.escHtml(containerId)}')" title="Restart"><i class="bi bi-arrow-clockwise"></i> Restart</button>`
              : `<button class="btn-lp btn-lp-ghost btn-lp-sm text-success me-1" onclick="DockerPage.action('start', '${LP.escHtml(containerId)}')" title="Start"><i class="bi bi-play-fill"></i> Start</button>`
            }
            <button class="btn-lp btn-lp-ghost btn-lp-sm text-primary me-1" onclick="DockerPage.showResourceModal('${LP.escHtml(containerId)}', '${LP.escHtml(containerName)}')" title="Resource Limits &amp; Stats"><i class="bi bi-sliders"></i> Resources</button>
            <button class="btn-lp btn-lp-ghost btn-lp-sm text-info me-1" onclick="DockerPage.viewLogs('${LP.escHtml(containerId)}', '${LP.escHtml(containerName)}')" title="Logs"><i class="bi bi-justify-left"></i> Logs</button>
            ${isRunning ? `<button class="btn-lp btn-lp-ghost btn-lp-sm text-light me-1" onclick="DockerPage.viewConsole('${LP.escHtml(containerId)}', '${LP.escHtml(containerName)}')" title="Terminal Console"><i class="bi bi-terminal"></i> Console</button>` : ''}
            <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="DockerPage.action('delete', '${LP.escHtml(containerId)}')" title="Delete"><i class="bi bi-trash"></i> Delete</button>
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
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger">${LP.escHtml(res?.message || 'Error')}</td></tr>`;
      return;
    }

    const { images } = res.data;
    LP.paginate(images, 10, 'imagesTableBody', 'imagesPagination', img => {
      const tag = img.tags[0] || '<none>:<none>';
      const imgId = String(img.id || '').replace(/^["']|["']$/g, '').trim();
      
      let inUseHtml = '<span class="text-muted">—</span>';
      let hasRunningContainers = false;
      
      if (img.containers && img.containers.length > 0) {
        hasRunningContainers = img.containers.some(c => c.state === 'running');
        inUseHtml = img.containers.map(c => {
          const color = c.state === 'running' ? 'var(--accent-success)' : 'var(--text-muted)';
          return `<span style="color:${color};font-size:11px;margin-right:4px;" title="State: ${LP.escHtml(c.state)}">${LP.escHtml(c.names[0])}</span>`;
        }).join('');
      }

      return `
        <tr>
          <td class="font-mono" style="color:var(--text-primary)">${LP.escHtml(tag)}</td>
          <td class="font-mono" style="font-size:12px;color:var(--text-muted)">${LP.escHtml(imgId.substring(0, 12))}</td>
          <td>${inUseHtml}</td>
          <td style="font-size:12px">${LP.formatBytes(img.size)}</td>
          <td style="font-size:12px;color:var(--text-muted)">${new Date(img.created * 1000).toLocaleString()}</td>
          <td style="text-align:right">
            <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="DockerPage.deleteImage('${LP.escHtml(imgId)}', ${hasRunningContainers})" title="Delete"><i class="bi bi-trash"></i> Delete</button>
          </td>
        </tr>
      `;
    }, 'No images found', 6);
  }

  async function action(type, id) {
    type = String(type || '').replace(/^["']|["']$/g, '').trim();
    id = String(id || '').replace(/^["']|["']$/g, '').trim();

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
    id = String(id || '').replace(/^["']|["']$/g, '').trim();
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
    const container = document.getElementById('portsContainer') || document.getElementById('portMappingsContainer');
    if (!container) return;
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
    const container = document.getElementById('volumesContainer') || document.getElementById('volumeMappingsContainer');
    if (!container) return;
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
    if (!container) return;
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

    const name = document.getElementById('cName')?.value?.trim() || '';
    const image = document.getElementById('cImage')?.value?.trim() || '';
    const restart = document.getElementById('cRestart')?.value || 'unless-stopped';
    const cStartEl = document.getElementById('cStart');
    const startAfterCreate = cStartEl ? cStartEl.checked : true;

    // Fetch port mappings
    const ports = [];
    const portsContainer = document.getElementById('portsContainer') || document.getElementById('portMappingsContainer');
    if (portsContainer) {
      portsContainer.querySelectorAll('.dynamic-row').forEach(row => {
        const hostVal = row.querySelector('[data-type="host"]')?.value;
        const containerVal = row.querySelector('[data-type="container"]')?.value;
        if (hostVal && containerVal) {
          ports.push({ hostPort: parseInt(hostVal, 10), containerPort: parseInt(containerVal, 10) });
        }
      });
    }

    // Fetch volume mappings
    const volumes = [];
    const volumesContainer = document.getElementById('volumesContainer') || document.getElementById('volumeMappingsContainer');
    if (volumesContainer) {
      volumesContainer.querySelectorAll('.dynamic-row').forEach(row => {
        const hostPath = row.querySelector('[data-type="host-path"]')?.value?.trim();
        const containerPath = row.querySelector('[data-type="container-path"]')?.value?.trim();
        if (hostPath && containerPath) {
          volumes.push({ hostPath, containerPath });
        }
      });
    }

    // Fetch envs
    const env = [];
    const envContainer = document.getElementById('envContainer');
    if (envContainer) {
      envContainer.querySelectorAll('.dynamic-row').forEach(row => {
        const key = row.querySelector('[data-type="env-key"]')?.value?.trim();
        const value = row.querySelector('[data-type="env-value"]')?.value?.trim();
        if (key && value) {
          env.push({ key, value });
        }
      });
    }

    LP.toast('Creating container...', 'info');

    const res = await LP.post('/docker/containers', {
      name, image, restart, startAfterCreate, ports, volumes, env
    });

    if (res?.success) {
      LP.toast('Container deployed successfully!', 'success');
      document.getElementById('createContainerForm')?.reset();
      if (portsContainer) portsContainer.innerHTML = '';
      if (volumesContainer) volumesContainer.innerHTML = '';
      if (envContainer) envContainer.innerHTML = '';
      loadData();
    } else {
      LP.toast(res?.message || 'Failed to create container', 'error');
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
        resultsContainer.innerHTML = `<p class="text-muted text-center py-3">No images found for "${LP.escHtml(term)}"</p>`;
        return;
      }

      resultsContainer.innerHTML = res.data.results.map(img => `
        <div style="padding:10px; border-bottom:1px solid var(--glass-border); display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div class="font-mono" style="font-weight:600; font-size:12px; color:var(--text-primary)">${LP.escHtml(img.name)}</div>
            <div style="font-size:10px; color:var(--text-muted); max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${LP.escHtml(img.description || 'No description')}</div>
            <div style="font-size:10px; color:var(--accent-info)">★ ${LP.escHtml(img.star_count)} stars | Official: ${img.is_official ? 'Yes' : 'No'}</div>
          </div>
          <button class="btn-lp btn-lp-primary btn-lp-sm" style="padding: 2px 8px;" onclick="LP.call('DockerPage.selectOnlineImage', '${LP.encJsArg(img.name)}')">Select</button>
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

  // ══════════════════════════════════════════════════════════════
  //  DOCKER COMPOSE VISUAL STUDIO & STACKS ENGINE
  // ══════════════════════════════════════════════════════════════

  const COMPOSE_TEMPLATES = {
    wordpress: `version: '3.8'

services:
  db:
    image: mariadb:10.11
    restart: unless-stopped
    environment:
      - MYSQL_ROOT_PASSWORD=root_secret_pass_123
      - MYSQL_DATABASE=wordpress
      - MYSQL_USER=wordpress
      - MYSQL_PASSWORD=wp_secret_pass_123
    volumes:
      - ./db_data:/var/lib/mysql

  wordpress:
    image: wordpress:latest
    restart: unless-stopped
    ports:
      - "8080:80"
    environment:
      - WORDPRESS_DB_HOST=db:3306
      - WORDPRESS_DB_USER=wordpress
      - WORDPRESS_DB_PASSWORD=wp_secret_pass_123
      - WORDPRESS_DB_NAME=wordpress
    volumes:
      - ./wp_data:/var/www/html
`,
    nextcloud: `version: '3.8'

services:
  db:
    image: postgres:15-alpine
    restart: unless-stopped
    environment:
      - POSTGRES_DB=nextcloud
      - POSTGRES_USER=nextcloud
      - POSTGRES_PASSWORD=nc_secret_pass_123
    volumes:
      - ./db_data:/var/lib/postgresql/data

  app:
    image: nextcloud:apache
    restart: unless-stopped
    ports:
      - "8085:80"
    environment:
      - POSTGRES_HOST=db
      - POSTGRES_DB=nextcloud
      - POSTGRES_USER=nextcloud
      - POSTGRES_PASSWORD=nc_secret_pass_123
    volumes:
      - ./nextcloud_data:/var/www/html
`,
    n8n: `version: '3.8'

services:
  n8n:
    image: docker.n8n.io/n8nio/n8n
    restart: unless-stopped
    ports:
      - "5678:5678"
    environment:
      - N8N_HOST=0.0.0.0
      - N8N_PORT=5678
      - N8N_PROTOCOL=http
      - WEBHOOK_URL=http://localhost:5678/
    volumes:
      - ./n8n_data:/home/node/.n8n
`,
    vaultwarden: `version: '3.8'

services:
  vaultwarden:
    image: vaultwarden/server:latest
    restart: unless-stopped
    ports:
      - "8088:80"
    environment:
      - WEBSOCKET_ENABLED=true
      - SIGNUPS_ALLOWED=true
    volumes:
      - ./vw_data:/data
`,
    ghost: `version: '3.8'

services:
  ghost:
    image: ghost:5-alpine
    restart: unless-stopped
    ports:
      - "2368:2368"
    environment:
      - url=http://localhost:2368
      - NODE_ENV=production
    volumes:
      - ./ghost_data:/var/lib/ghost/content
`
  };

  let composeStudioServices = [];
  let activeStudioMode = 'visual';
  let activeLogsStack = null;

  function parseYamlToServices(yamlStr) {
    if (!yamlStr || typeof yamlStr !== 'string') return [];
    const lines = yamlStr.split('\n');
    const services = [];
    let inServices = false;
    let currentService = null;
    let currentArrayKey = null;

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      if (/^services:\s*$/.test(line) || (/^services:/.test(rawLine.trimStart()) && !rawLine.startsWith(' '))) {
        inServices = true;
        continue;
      }

      if (inServices && /^[a-zA-Z0-9_-]+:\s*$/.test(rawLine) && !rawLine.startsWith(' ') && !rawLine.startsWith('\t')) {
        inServices = false;
        if (currentService) services.push(currentService);
        currentService = null;
        continue;
      }

      if (!inServices) continue;

      const serviceMatch = rawLine.match(/^(\s{2}|\t)([a-zA-Z0-9_-]+):\s*$/);
      if (serviceMatch) {
        if (currentService) services.push(currentService);
        currentService = {
          name: serviceMatch[2],
          image: '',
          containerName: '',
          restart: 'unless-stopped',
          command: '',
          ports: [],
          environment: [],
          volumes: [],
        };
        currentArrayKey = null;
        continue;
      }

      if (!currentService) continue;

      // Array items with - (e.g. "      - '8080:80'")
      const itemMatch = rawLine.match(/^\s*-\s+(.*)$/);
      if (itemMatch && currentArrayKey) {
        const itemVal = itemMatch[1].trim().replace(/^["']|["']$/g, '');
        if (currentArrayKey === 'ports') {
          const parts = itemVal.split(':');
          currentService.ports.push({ host: parts[0] || '', container: parts[1] || '' });
        } else if (currentArrayKey === 'environment') {
          const parts = itemVal.split('=');
          currentService.environment.push({ key: parts[0] || '', value: parts.slice(1).join('=') || '' });
        } else if (currentArrayKey === 'volumes') {
          const parts = itemVal.split(':');
          currentService.volumes.push({ host: parts[0] || '', container: parts[1] || '' });
        }
        continue;
      }

      // Nested key-value with 6+ spaces (e.g. "      POSTGRES_DB: mydb")
      const envKvMatch = rawLine.match(/^(\s{6,}|\t{3,})([a-zA-Z0-9_.-]+):\s*(.*)$/);
      if (envKvMatch && currentArrayKey === 'environment') {
        const k = envKvMatch[2];
        const v = envKvMatch[3].trim().replace(/^["']|["']$/g, '');
        currentService.environment.push({ key: k, value: v });
        continue;
      }

      // Properties with 4 spaces (e.g. "    image: nginx:alpine")
      const propMatch = rawLine.match(/^(\s{4}|\t{2})([a-zA-Z0-9_-]+):\s*(.*)$/);
      if (propMatch) {
        const key = propMatch[2];
        const val = propMatch[3].trim().replace(/^["']|["']$/g, '');
        currentArrayKey = null;

        if (key === 'image') currentService.image = val;
        else if (key === 'container_name') currentService.containerName = val;
        else if (key === 'restart') currentService.restart = val;
        else if (key === 'command') currentService.command = val;
        else if (key === 'ports') currentArrayKey = 'ports';
        else if (key === 'environment') currentArrayKey = 'environment';
        else if (key === 'volumes') currentArrayKey = 'volumes';
        continue;
      }
    }

    if (currentService) services.push(currentService);
    return services;
  }

  function generateYamlFromServices(services) {
    let yaml = "version: '3.8'\n\nservices:\n";
    for (const s of services) {
      yaml += `  ${s.name || 'app'}:\n`;
      if (s.image) yaml += `    image: ${s.image}\n`;
      if (s.containerName) yaml += `    container_name: ${s.containerName}\n`;
      if (s.restart) yaml += `    restart: ${s.restart}\n`;
      if (s.command) yaml += `    command: ${s.command}\n`;

      if (Array.isArray(s.ports) && s.ports.length > 0) {
        const validPorts = s.ports.filter(p => p.host || p.container);
        if (validPorts.length > 0) {
          yaml += `    ports:\n`;
          for (const p of validPorts) {
            yaml += `      - "${p.host}:${p.container}"\n`;
          }
        }
      }

      if (Array.isArray(s.environment) && s.environment.length > 0) {
        const validEnvs = s.environment.filter(e => e.key);
        if (validEnvs.length > 0) {
          yaml += `    environment:\n`;
          for (const e of validEnvs) {
            yaml += `      - ${e.key}=${e.value}\n`;
          }
        }
      }

      if (Array.isArray(s.volumes) && s.volumes.length > 0) {
        const validVols = s.volumes.filter(v => v.host || v.container);
        if (validVols.length > 0) {
          yaml += `    volumes:\n`;
          for (const v of validVols) {
            yaml += `      - ${v.host}:${v.container}\n`;
          }
        }
      }
      yaml += `\n`;
    }
    return yaml.trimEnd() + '\n';
  }

  async function loadComposeStacks() {
    const container = document.getElementById('composeStacksContainer');
    if (!container) return;

    container.innerHTML = `
      <div class="col-12 text-center py-5">
        <div class="spinner-border spinner-border-sm text-primary" role="status"></div>
        <p class="text-muted small mt-2">Loading Compose stacks...</p>
      </div>`;

    try {
      const res = await LP.get('/docker/compose/stacks');
      if (!res?.success) {
        container.innerHTML = `<div class="col-12 text-center py-4 text-danger">${LP.escHtml(res?.message || 'Failed to load stacks')}</div>`;
        return;
      }
      renderComposeStacks(res.data?.stacks || []);
    } catch (err) {
      container.innerHTML = `<div class="col-12 text-center py-4 text-danger">${LP.escHtml(err.message || 'Error loading stacks')}</div>`;
    }
  }

  function renderComposeStacks(stacks) {
    const container = document.getElementById('composeStacksContainer');
    if (!container) return;

    if (!stacks || stacks.length === 0) {
      container.innerHTML = `
        <div class="col-12">
          <div class="lp-glass-card text-center py-5">
            <div style="width:64px; height:64px; border-radius:16px; background:rgba(99,102,241,0.1); color:var(--accent-primary); display:flex; align-items:center; justify-content:center; font-size:30px; margin:0 auto 16px auto;">
              <i class="bi bi-layers-half"></i>
            </div>
            <h4 style="font-size:16px; font-weight:700; margin-bottom:8px;">No Compose Stacks Found</h4>
            <p class="text-muted small mb-4" style="max-width:400px; margin-left:auto; margin-right:auto;">
              Compose Studio allows you to visually build, run, and map domains to multi-container applications.
            </p>
            <div class="d-flex justify-content-center gap-2">
              <button class="btn-lp btn-lp-primary" onclick="DockerPage.openNewStudio()"><i class="bi bi-plus-lg me-1"></i> Create First Stack</button>
              <button class="btn-lp btn-lp-ghost" onclick="DockerPage.newStudioFromTemplate('wordpress')"><i class="bi bi-box-seam me-1"></i> Load Template</button>
            </div>
          </div>
        </div>`;
      return;
    }

    container.innerHTML = stacks.map(s => {
      const isRunning = s.status === 'running';
      const isPartial = s.status === 'partial';
      const badgeClass = isRunning ? 'lp-badge-success' : isPartial ? 'lp-badge-warning' : 'lp-badge-secondary';
      const statusText = isRunning ? 'RUNNING' : isPartial ? 'PARTIAL' : 'STOPPED';

      const portsHtml = (s.exposedPorts || []).length > 0 ? (
        `<div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:10px;">` +
        s.exposedPorts.map(ep => `
          <div class="d-flex align-items-center gap-2 p-1 px-2 rounded" style="background:rgba(0,0,0,0.3); border:1px solid var(--glass-border); font-size:11px;">
            <span class="font-mono" style="color:var(--accent-info); font-weight:600;"><i class="bi bi-hdd-network me-1"></i>${ep.hostPort} &rarr; ${ep.containerPort}</span>
            <button class="btn-lp btn-lp-primary btn-lp-sm" style="padding: 1px 6px; font-size:10px; height:20px; line-height:1;" onclick="DockerPage.openAutoProxyModal('${LP.encJsArg(s.name)}', '${LP.encJsArg(ep.service)}', ${ep.hostPort})" title="Map to Domain with SSL">
              <i class="bi bi-shield-lock me-1"></i>HTTPS Proxy
            </button>
          </div>
        `).join('') +
        `</div>`
      ) : `<div class="text-muted" style="font-size:11px; margin-top:8px;">No host port mappings configured</div>`;

      const servicesHtml = (s.services || []).map(svc => `
        <span class="lp-badge lp-badge-info" style="font-size:10px; margin-right:4px;">
          ${LP.escHtml(svc.name)} <small style="opacity:0.7">(${LP.escHtml(svc.image || 'custom')})</small>
        </span>
      `).join('');

      return `
        <div class="col-12 col-lg-6">
          <div class="lp-glass-card p-4 h-100 d-flex flex-column justify-content-between" style="border:1px solid var(--glass-border);">
            <div>
              <div class="d-flex justify-content-between align-items-start mb-2">
                <div>
                  <h4 class="font-mono" style="font-size:16px; font-weight:700; color:var(--text-primary); margin:0;">
                    ${LP.escHtml(s.name)}
                  </h4>
                  <small class="text-muted">${s.servicesCount || 0} service(s) &bull; ${s.containers?.length || 0} container(s)</small>
                </div>
                <span class="lp-badge ${badgeClass}"><span class="lp-badge-dot"></span>${statusText}</span>
              </div>

              <div class="mb-2 mt-3">
                <small class="text-muted d-block mb-1" style="font-size:10px; font-weight:600; text-transform:uppercase;">Services</small>
                <div>${servicesHtml || '<span class="text-muted small">None</span>'}</div>
              </div>

              <div class="mb-3">
                <small class="text-muted d-block mb-1" style="font-size:10px; font-weight:600; text-transform:uppercase;">Exposed Ports &amp; Reverse Proxy</small>
                ${portsHtml}
              </div>
            </div>

            <div class="d-flex justify-content-between align-items-center pt-3 mt-2 flex-wrap gap-2" style="border-top:1px solid rgba(255,255,255,0.06);">
              <div class="d-flex gap-1">
                ${isRunning
                  ? `<button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="DockerPage.stopStack('${LP.encJsArg(s.name)}')"><i class="bi bi-stop-fill me-1"></i>Stop</button>
                     <button class="btn-lp btn-lp-ghost btn-lp-sm text-warning" onclick="DockerPage.restartStack('${LP.encJsArg(s.name)}')"><i class="bi bi-arrow-clockwise me-1"></i>Restart</button>`
                  : `<button class="btn-lp btn-lp-ghost btn-lp-sm text-success" onclick="DockerPage.startStack('${LP.encJsArg(s.name)}')"><i class="bi bi-play-fill me-1"></i>Start</button>`
                }
                <button class="btn-lp btn-lp-ghost btn-lp-sm text-info" onclick="DockerPage.openStackLogs('${LP.encJsArg(s.name)}')"><i class="bi bi-terminal me-1"></i>Logs</button>
              </div>
              <div class="d-flex gap-1">
                <button class="btn-lp btn-lp-primary btn-lp-sm" onclick="DockerPage.openEditStudio('${LP.encJsArg(s.name)}')"><i class="bi bi-pencil-square me-1"></i>Edit Studio</button>
                <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="DockerPage.deleteStack('${LP.encJsArg(s.name)}')"><i class="bi bi-trash"></i></button>
              </div>
            </div>
          </div>
        </div>`;
    }).join('');
  }

  function openNewStudio() {
    document.getElementById('composeListView').style.display = 'none';
    document.getElementById('composeStudioView').style.display = 'block';
    document.getElementById('studioTitle').innerHTML = '<i class="bi bi-sliders2 text-primary me-2"></i>New Compose Stack';
    document.getElementById('studioProjectName').value = `stack-${Date.now().toString().slice(-4)}`;
    document.getElementById('studioProjectName').readOnly = false;
    document.getElementById('studioTemplateSelect').value = '';

    composeStudioServices = [
      {
        name: 'web',
        image: 'nginx:alpine',
        containerName: '',
        restart: 'unless-stopped',
        command: '',
        ports: [{ host: '8080', container: '80' }],
        environment: [],
        volumes: [],
      }
    ];

    activeStudioMode = 'visual';
    setStudioMode('visual');
    renderVisualServices();
  }

  async function openEditStudio(projectName) {
    document.getElementById('composeListView').style.display = 'none';
    document.getElementById('composeStudioView').style.display = 'block';
    document.getElementById('studioTitle').innerHTML = `<i class="bi bi-pencil-square text-primary me-2"></i>Edit Stack: <span class="text-white">${LP.escHtml(projectName)}</span>`;
    document.getElementById('studioProjectName').value = projectName;
    document.getElementById('studioProjectName').readOnly = true;

    try {
      const res = await LP.get(`/docker/compose/stacks/${encodeURIComponent(projectName)}`);
      if (res?.success && res.data?.stack) {
        const stack = res.data.stack;
        document.getElementById('studioYaml').value = stack.yaml || '';
        composeStudioServices = parseYamlToServices(stack.yaml || '');
        if (composeStudioServices.length === 0) {
          composeStudioServices = [
            { name: 'app', image: '', restart: 'unless-stopped', ports: [], environment: [], volumes: [] }
          ];
        }
      } else {
        LP.toast(res?.message || 'Failed to load stack details', 'error');
      }
    } catch (err) {
      LP.toast(err.message || 'Error loading stack', 'error');
    }

    activeStudioMode = 'visual';
    setStudioMode('visual');
    renderVisualServices();
  }

  function closeStudio() {
    document.getElementById('composeStudioView').style.display = 'none';
    document.getElementById('composeListView').style.display = 'block';
    loadComposeStacks();
  }

  function setStudioMode(mode) {
    activeStudioMode = mode;
    const btnVisual = document.getElementById('btnModeVisual');
    const btnYaml = document.getElementById('btnModeYaml');
    const visualSec = document.getElementById('studioVisualSection');
    const yamlSec = document.getElementById('studioYamlSection');

    if (mode === 'visual') {
      // Sync from YAML to Visual
      syncVisualFromYaml();
      btnVisual.className = 'btn-lp btn-lp-primary btn-lp-sm';
      btnYaml.className = 'btn-lp btn-lp-ghost btn-lp-sm';
      visualSec.style.display = 'block';
      yamlSec.style.display = 'none';
      renderVisualServices();
    } else {
      // Sync from Visual to YAML
      syncVisualFromForm();
      const yaml = generateYamlFromServices(composeStudioServices);
      document.getElementById('studioYaml').value = yaml;
      btnVisual.className = 'btn-lp btn-lp-ghost btn-lp-sm';
      btnYaml.className = 'btn-lp btn-lp-primary btn-lp-sm';
      visualSec.style.display = 'none';
      yamlSec.style.display = 'block';
    }
  }

  function onStudioTemplateChange(templateId) {
    if (!templateId || !COMPOSE_TEMPLATES[templateId]) return;
    const yaml = COMPOSE_TEMPLATES[templateId];
    document.getElementById('studioYaml').value = yaml;
    composeStudioServices = parseYamlToServices(yaml);
    document.getElementById('studioProjectName').value = `${templateId}-${Date.now().toString().slice(-4)}`;
    renderVisualServices();
    LP.toast(`Template ${templateId} loaded!`, 'info');
  }

  function newStudioFromTemplate(templateId) {
    openNewStudio();
    document.getElementById('studioTemplateSelect').value = templateId;
    onStudioTemplateChange(templateId);
  }

  function syncVisualFromForm() {
    const container = document.getElementById('visualServicesContainer');
    if (!container) return;
    const serviceCards = container.querySelectorAll('.studio-service-card');

    composeStudioServices = [];
    serviceCards.forEach((card, sIdx) => {
      const name = (card.querySelector('.svc-name')?.value || `service_${sIdx + 1}`).trim();
      const image = (card.querySelector('.svc-image')?.value || '').trim();
      const containerName = (card.querySelector('.svc-container-name')?.value || '').trim();
      const restart = card.querySelector('.svc-restart')?.value || 'unless-stopped';
      const command = (card.querySelector('.svc-command')?.value || '').trim();

      const ports = [];
      card.querySelectorAll('.svc-port-row').forEach(row => {
        const host = (row.querySelector('.port-host')?.value || '').trim();
        const containerPort = (row.querySelector('.port-container')?.value || '').trim();
        if (host || containerPort) ports.push({ host, container: containerPort });
      });

      const environment = [];
      card.querySelectorAll('.svc-env-row').forEach(row => {
        const key = (row.querySelector('.env-key')?.value || '').trim();
        const value = (row.querySelector('.env-value')?.value || '').trim();
        if (key) environment.push({ key, value });
      });

      const volumes = [];
      card.querySelectorAll('.svc-vol-row').forEach(row => {
        const host = (row.querySelector('.vol-host')?.value || '').trim();
        const containerPath = (row.querySelector('.vol-container')?.value || '').trim();
        if (host || containerPath) volumes.push({ host, container: containerPath });
      });

      composeStudioServices.push({
        name,
        image,
        containerName,
        restart,
        command,
        ports,
        environment,
        volumes,
      });
    });
  }

  function syncVisualFromYaml() {
    const yaml = document.getElementById('studioYaml').value;
    if (yaml && yaml.trim()) {
      const parsed = parseYamlToServices(yaml);
      if (parsed.length > 0) {
        composeStudioServices = parsed;
      }
    }
  }

  function renderVisualServices() {
    const container = document.getElementById('visualServicesContainer');
    const countEl = document.getElementById('serviceCount');
    if (!container) return;

    if (countEl) countEl.textContent = composeStudioServices.length;

    container.innerHTML = composeStudioServices.map((svc, sIdx) => `
      <div class="studio-service-card lp-glass-card p-3" style="background:rgba(15,23,42,0.6); border:1px solid var(--glass-border); border-radius:12px;">
        <div class="d-flex justify-content-between align-items-center mb-3 pb-2" style="border-bottom:1px solid rgba(255,255,255,0.06);">
          <div class="d-flex align-items-center gap-2">
            <span style="width:24px; height:24px; border-radius:6px; background:rgba(99,102,241,0.2); color:var(--accent-primary); display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:700;">${sIdx + 1}</span>
            <strong class="font-mono text-white" style="font-size:13px;">Service: ${LP.escHtml(svc.name || 'unnamed')}</strong>
          </div>
          ${composeStudioServices.length > 1 ? `<button type="button" class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="DockerPage.removeVisualService(${sIdx})" title="Remove Service"><i class="bi bi-trash"></i></button>` : ''}
        </div>

        <div class="row g-2 mb-3">
          <div class="col-md-4">
            <label class="lp-label" style="font-size:10px; font-weight:600;">Service Name</label>
            <input type="text" class="lp-input font-mono svc-name" value="${LP.escHtml(svc.name || '')}" placeholder="e.g. web, api, db" required>
          </div>
          <div class="col-md-5">
            <label class="lp-label" style="font-size:10px; font-weight:600;">Docker Image</label>
            <input type="text" class="lp-input font-mono svc-image" value="${LP.escHtml(svc.image || '')}" placeholder="e.g. nginx:alpine, redis:7" required>
          </div>
          <div class="col-md-3">
            <label class="lp-label" style="font-size:10px; font-weight:600;">Restart Policy</label>
            <select class="lp-input svc-restart">
              <option value="unless-stopped" ${svc.restart === 'unless-stopped' ? 'selected' : ''}>Unless Stopped</option>
              <option value="always" ${svc.restart === 'always' ? 'selected' : ''}>Always</option>
              <option value="on-failure" ${svc.restart === 'on-failure' ? 'selected' : ''}>On Failure</option>
              <option value="no" ${svc.restart === 'no' ? 'selected' : ''}>No</option>
            </select>
          </div>
        </div>

        <!-- Port Mappings -->
        <div class="mb-3 p-2 rounded" style="background:rgba(0,0,0,0.2);">
          <div class="d-flex justify-content-between align-items-center mb-1">
            <label class="lp-label mb-0" style="font-size:10px; font-weight:700;"><i class="bi bi-hdd-network me-1 text-primary"></i>Port Bindings (Host : Container)</label>
            <button type="button" class="btn-lp btn-lp-ghost btn-lp-sm py-0" style="font-size:10px;" onclick="DockerPage.addVisualPort(${sIdx})">+ Add Port</button>
          </div>
          <div class="svc-ports-container">
            ${(svc.ports || []).map((p, pIdx) => `
              <div class="d-flex gap-2 align-items-center mb-1 svc-port-row">
                <input type="number" class="lp-input font-mono port-host" style="height:28px; font-size:11px;" placeholder="Host Port (e.g. 8080)" value="${LP.escHtml(String(p.host || ''))}">
                <span>:</span>
                <input type="number" class="lp-input font-mono port-container" style="height:28px; font-size:11px;" placeholder="Container Port (e.g. 80)" value="${LP.escHtml(String(p.container || ''))}">
                <button type="button" class="btn-lp btn-lp-ghost text-danger py-0 px-2" style="height:28px;" onclick="DockerPage.removeVisualPort(${sIdx}, ${pIdx})">&times;</button>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Environment Variables -->
        <div class="mb-3 p-2 rounded" style="background:rgba(0,0,0,0.2);">
          <div class="d-flex justify-content-between align-items-center mb-1">
            <label class="lp-label mb-0" style="font-size:10px; font-weight:700;"><i class="bi bi-key me-1 text-warning"></i>Environment Variables (KEY = VALUE)</label>
            <button type="button" class="btn-lp btn-lp-ghost btn-lp-sm py-0" style="font-size:10px;" onclick="DockerPage.addVisualEnv(${sIdx})">+ Add Variable</button>
          </div>
          <div class="svc-envs-container">
            ${(svc.environment || []).map((e, eIdx) => `
              <div class="d-flex gap-2 align-items-center mb-1 svc-env-row">
                <input type="text" class="lp-input font-mono env-key" style="height:28px; font-size:11px;" placeholder="KEY (e.g. NODE_ENV)" value="${LP.escHtml(e.key || '')}">
                <span>=</span>
                <input type="text" class="lp-input font-mono env-value" style="height:28px; font-size:11px;" placeholder="VALUE (e.g. production)" value="${LP.escHtml(e.value || '')}">
                <button type="button" class="btn-lp btn-lp-ghost text-danger py-0 px-2" style="height:28px;" onclick="DockerPage.removeVisualEnv(${sIdx}, ${eIdx})">&times;</button>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Volumes -->
        <div class="p-2 rounded" style="background:rgba(0,0,0,0.2);">
          <div class="d-flex justify-content-between align-items-center mb-1">
            <label class="lp-label mb-0" style="font-size:10px; font-weight:700;"><i class="bi bi-folder2-open me-1 text-success"></i>Volume Mounts (Host Path : Container Path)</label>
            <button type="button" class="btn-lp btn-lp-ghost btn-lp-sm py-0" style="font-size:10px;" onclick="DockerPage.addVisualVolume(${sIdx})">+ Add Volume</button>
          </div>
          <div class="svc-vols-container">
            ${(svc.volumes || []).map((v, vIdx) => `
              <div class="d-flex gap-2 align-items-center mb-1 svc-vol-row">
                <input type="text" class="lp-input font-mono vol-host" style="height:28px; font-size:11px;" placeholder="./data or /var/storage" value="${LP.escHtml(v.host || '')}">
                <span>:</span>
                <input type="text" class="lp-input font-mono vol-container" style="height:28px; font-size:11px;" placeholder="/app/data or /var/lib/mysql" value="${LP.escHtml(v.container || '')}">
                <button type="button" class="btn-lp btn-lp-ghost text-danger py-0 px-2" style="height:28px;" onclick="DockerPage.removeVisualVolume(${sIdx}, ${vIdx})">&times;</button>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `).join('');
  }

  function addVisualService() {
    syncVisualFromForm();
    composeStudioServices.push({
      name: `service_${composeStudioServices.length + 1}`,
      image: '',
      containerName: '',
      restart: 'unless-stopped',
      command: '',
      ports: [],
      environment: [],
      volumes: [],
    });
    renderVisualServices();
  }

  function removeVisualService(sIdx) {
    syncVisualFromForm();
    composeStudioServices.splice(sIdx, 1);
    renderVisualServices();
  }

  function addVisualPort(sIdx) {
    syncVisualFromForm();
    if (composeStudioServices[sIdx]) {
      if (!composeStudioServices[sIdx].ports) composeStudioServices[sIdx].ports = [];
      composeStudioServices[sIdx].ports.push({ host: '', container: '' });
      renderVisualServices();
    }
  }

  function removeVisualPort(sIdx, pIdx) {
    syncVisualFromForm();
    if (composeStudioServices[sIdx]?.ports) {
      composeStudioServices[sIdx].ports.splice(pIdx, 1);
      renderVisualServices();
    }
  }

  function addVisualEnv(sIdx) {
    syncVisualFromForm();
    if (composeStudioServices[sIdx]) {
      if (!composeStudioServices[sIdx].environment) composeStudioServices[sIdx].environment = [];
      composeStudioServices[sIdx].environment.push({ key: '', value: '' });
      renderVisualServices();
    }
  }

  function removeVisualEnv(sIdx, eIdx) {
    syncVisualFromForm();
    if (composeStudioServices[sIdx]?.environment) {
      composeStudioServices[sIdx].environment.splice(eIdx, 1);
      renderVisualServices();
    }
  }

  function addVisualVolume(sIdx) {
    syncVisualFromForm();
    if (composeStudioServices[sIdx]) {
      if (!composeStudioServices[sIdx].volumes) composeStudioServices[sIdx].volumes = [];
      composeStudioServices[sIdx].volumes.push({ host: '', container: '' });
      renderVisualServices();
    }
  }

  function removeVisualVolume(sIdx, vIdx) {
    syncVisualFromForm();
    if (composeStudioServices[sIdx]?.volumes) {
      composeStudioServices[sIdx].volumes.splice(vIdx, 1);
      renderVisualServices();
    }
  }

  async function submitStudioDeploy() {
    const projectName = (document.getElementById('studioProjectName').value || '').trim();
    if (!projectName) {
      LP.toast('Project Name is required', 'warning');
      return;
    }

    let yaml = '';
    if (activeStudioMode === 'visual') {
      syncVisualFromForm();
      yaml = generateYamlFromServices(composeStudioServices);
    } else {
      yaml = document.getElementById('studioYaml').value;
    }

    if (!yaml || !yaml.trim()) {
      LP.toast('Compose YAML content is empty', 'warning');
      return;
    }

    const btn = document.getElementById('btnDeployStudioStack');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Deploying Compose Stack...';

    try {
      const res = await LP.post('/docker/compose', { projectName, yaml });
      if (res?.success) {
        LP.toast(`Stack ${projectName} deployed successfully!`, 'success');
        closeStudio();
      } else {
        LP.toast(res?.message || 'Failed to deploy stack', 'error');
      }
    } catch (err) {
      LP.toast(err.message || 'Error deploying stack', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-rocket-takeoff me-1"></i> Deploy Stack Now';
    }
  }

  async function startStack(name) {
    LP.toast(`Starting stack ${name}...`, 'info');
    const res = await LP.post(`/docker/compose/stacks/${encodeURIComponent(name)}/start`, {});
    if (res?.success) {
      LP.toast(`Stack ${name} started!`, 'success');
      loadComposeStacks();
    } else {
      LP.toast(res?.message || 'Failed to start stack', 'error');
    }
  }

  async function stopStack(name) {
    LP.toast(`Stopping stack ${name}...`, 'info');
    const res = await LP.post(`/docker/compose/stacks/${encodeURIComponent(name)}/stop`, {});
    if (res?.success) {
      LP.toast(`Stack ${name} stopped!`, 'success');
      loadComposeStacks();
    } else {
      LP.toast(res?.message || 'Failed to stop stack', 'error');
    }
  }

  async function restartStack(name) {
    LP.toast(`Restarting stack ${name}...`, 'info');
    const res = await LP.post(`/docker/compose/stacks/${encodeURIComponent(name)}/restart`, {});
    if (res?.success) {
      LP.toast(`Stack ${name} restarted!`, 'success');
      loadComposeStacks();
    } else {
      LP.toast(res?.message || 'Failed to restart stack', 'error');
    }
  }

  async function deleteStack(name) {
    if (!(await LP.confirm(`Are you sure you want to delete Compose Stack "${name}"? This will stop all associated containers.`, 'Delete Compose Stack'))) return;
    LP.toast(`Deleting stack ${name}...`, 'info');
    const res = await LP.delete(`/docker/compose/stacks/${encodeURIComponent(name)}`);
    if (res?.success) {
      LP.toast(`Stack ${name} deleted successfully!`, 'success');
      loadComposeStacks();
    } else {
      LP.toast(res?.message || 'Failed to delete stack', 'error');
    }
  }

  async function openStackLogs(name) {
    activeLogsStack = name;
    document.getElementById('stackLogsTitle').textContent = `Logs: ${name}`;
    const termEl = document.getElementById('stackLogsTerminal');
    termEl.textContent = 'Fetching stack logs...';

    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('composeStackLogsModal'));
    modal.show();

    await refreshStackLogs();
  }

  async function refreshStackLogs() {
    if (!activeLogsStack) return;
    const termEl = document.getElementById('stackLogsTerminal');
    try {
      const res = await LP.get(`/docker/compose/stacks/${encodeURIComponent(activeLogsStack)}/logs?lines=200`);
      if (res?.success) {
        termEl.textContent = res.data?.logs || 'No logs available for this stack.';
        termEl.scrollTop = termEl.scrollHeight;
      } else {
        termEl.textContent = `Error loading logs: ${res?.message || 'Unknown error'}`;
      }
    } catch (err) {
      termEl.textContent = `Error loading logs: ${err.message}`;
    }
  }

  function openAutoProxyModal(projectName, serviceName, port) {
    document.getElementById('proxyProjectName').value = projectName || '';
    document.getElementById('proxyServiceName').value = serviceName || 'web';
    document.getElementById('proxyTargetPort').value = port || '';
    document.getElementById('proxyDomain').value = '';

    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('composeProxyModal'));
    modal.show();
  }

  async function submitAutoProxy(e) {
    e.preventDefault();
    const projectName = document.getElementById('proxyProjectName').value;
    const serviceName = document.getElementById('proxyServiceName').value;
    const port = document.getElementById('proxyTargetPort').value;
    const domain = (document.getElementById('proxyDomain').value || '').trim();

    if (!domain) {
      LP.toast('Domain is required', 'warning');
      return;
    }

    const btn = document.getElementById('btnSubmitAutoProxy');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Provisioning HTTPS Proxy...';

    try {
      const res = await LP.post('/docker/compose/proxy', {
        projectName,
        serviceName,
        port: parseInt(port, 10),
        domain,
      });

      if (res?.success) {
        LP.toast(`HTTPS Reverse Proxy created for https://${domain}!`, 'success');
        bootstrap.Modal.getInstance(document.getElementById('composeProxyModal')).hide();
      } else {
        LP.toast(res?.message || 'Failed to create HTTPS proxy', 'error');
      }
    } catch (err) {
      LP.toast(err.message || 'Error creating reverse proxy', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-shield-lock me-1"></i> Provision HTTPS Proxy';
    }
  }

  // --- Log Terminal Logic ---

  let activeTerminalMode = null;

  function initSocket() {
    const token = localStorage.getItem('lp_token');
    if (!token) return;

    socket = io('/docker', { auth: { token }, transports: ['websocket'] });
    
    socket.on('logs:data', (data) => {
      if (term && activeTerminalMode === 'logs') term.write(data + '\r\n');
    });
    
    socket.on('logs:error', (err) => {
      if (term && activeTerminalMode === 'logs') term.write(`\x1b[31m[Log Error: ${err}]\x1b[0m\r\n`);
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
    activeTerminalMode = 'logs';
    document.getElementById('logModalTitle').textContent = `Logs: ${name}`;
    const modal = new bootstrap.Modal(document.getElementById('logModal'));
    modal.show();

    setTimeout(() => {
      if (!term) initTerminal();
      else term.clear();
      if (fitAddon) fitAddon.fit();
      
      term.options.disableStdin = true;
      
      if (!socket) initSocket();
      socket.emit('logs:attach', id);
    }, 300);
  }

  function viewConsole(id, name) {
    activeTerminalMode = 'console';
    document.getElementById('logModalTitle').textContent = `Console: ${name}`;
    const modal = new bootstrap.Modal(document.getElementById('logModal'));
    modal.show();

    setTimeout(() => {
      if (!term) initTerminal();
      else term.clear();
      if (fitAddon) fitAddon.fit();
      
      term.options.disableStdin = false;
      
      if (!socket) initSocket();
      
      socket.off('exec:data');
      socket.off('exec:end');
      socket.off('exec:error');

      socket.on('exec:data', (data) => {
        if (term && activeTerminalMode === 'console') term.write(data);
      });
      socket.on('exec:error', (err) => {
        if (term && activeTerminalMode === 'console') term.write(`\x1b[31m[Exec Error: ${err}]\x1b[0m\r\n`);
      });
      socket.on('exec:end', () => {
        if (term && activeTerminalMode === 'console') term.write('\r\n\x1b[33m[Session Closed]\x1b[0m\r\n');
      });

      // Clear previous onData handlers to avoid double sending
      if (term._onDataHandler) term._onDataHandler.dispose();
      term._onDataHandler = term.onData((data) => {
        if (socket && activeTerminalMode === 'console') {
          socket.emit('exec:input', data);
        }
      });

      socket.emit('exec:create', { containerId: id, shell: 'sh' });
    }, 300);
  }

  function detachLogs() {
    if (socket) {
      socket.emit('detach');
      socket.off('exec:data');
      socket.off('exec:end');
      socket.off('exec:error');
    }
    activeTerminalMode = null;
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

  function loadComposeTemplate(val) {
    onStudioTemplateChange(val);
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
        const errMsg = res?.message || 'Installation failed';
        LP.toast(`Failed to install ${pkgName}: ${errMsg}`, 'error');
        LP.showManualInstallModal(pkgName, errMsg);
      }
    } catch (e) {
      const errMsg = e?.message || 'Error installing package';
      LP.toast(`Error installing ${pkgName}`, 'error');
      LP.showManualInstallModal(pkgName, errMsg);
    } finally {
      document.getElementById('installSpinner')?.remove();
    }
  }

  // ── 1-Click App Store Logic ──────────────────────────────
  let appStoreCatalog = [];
  let currentCategory = 'all';
  let activeTemplate = null;

  async function loadAppStore() {
    const grid = document.getElementById('appStoreGrid');
    if (!grid) return;
    grid.innerHTML = '<div class="col-12 text-center p-4"><p class="text-muted"><i class="spinner-border spinner-border-sm me-2"></i>Loading App Store Catalog...</p></div>';

    try {
      const res = await LP.get('/docker/appstore');
      if (res?.success && res.data?.catalog) {
        appStoreCatalog = res.data.catalog;
        renderAppStoreGrid();
      } else {
        grid.innerHTML = `<div class="col-12 text-center text-danger p-4">${LP.escHtml(res?.message || 'Failed to load App Store')}</div>`;
      }
    } catch {
      grid.innerHTML = '<div class="col-12 text-center text-danger p-4">Error loading App Store catalog.</div>';
    }
  }

  function renderAppStoreGrid(filteredList = null) {
    const grid = document.getElementById('appStoreGrid');
    if (!grid) return;

    let list = filteredList || appStoreCatalog;
    if (currentCategory !== 'all' && !filteredList) {
      list = appStoreCatalog.filter(a => a.category === currentCategory);
    }

    if (list.length === 0) {
      grid.innerHTML = '<div class="col-12 text-center p-4 text-muted"><i class="bi bi-inbox me-1"></i> No matching apps found.</div>';
      return;
    }

    grid.innerHTML = list.map(app => `
      <div class="col-12 col-md-6 col-xl-4">
        <div class="lp-glass-card h-100 p-3 d-flex flex-column justify-content-between" style="border-radius:14px; transition: transform 0.2s, border-color 0.2s;">
          <div>
            <div style="display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:12px;">
              <div style="display:flex; align-items:center; gap:12px;">
                <div style="width:42px; height:42px; border-radius:12px; background:rgba(255,255,255,0.06); display:flex; align-items:center; justify-content:center; font-size:22px; color:${app.color || 'var(--accent-primary)'}; box-shadow: 0 4px 12px rgba(0,0,0,0.2);">
                  <i class="bi ${app.icon || 'bi-box-seam'}"></i>
                </div>
                <div>
                  <h5 style="font-size:14px; font-weight:700; margin:0; color:#fff;">${LP.escHtml(app.name)}</h5>
                  <span class="lp-badge lp-badge-primary mt-1" style="font-size:9.5px; padding:2px 6px;">${LP.escHtml(app.category)}</span>
                </div>
              </div>
            </div>
            <p style="font-size:11.5px; color:var(--text-muted); line-height:1.45; margin-bottom:14px;">${LP.escHtml(app.description)}</p>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid rgba(255,255,255,0.06); padding-top:10px;">
            <small class="text-muted font-mono" style="font-size:10.5px;">Port: ${app.defaultPort || 'Custom'}</small>
            <button class="btn-lp btn-lp-primary btn-lp-sm" onclick="DockerPage.showAppInstallModal('${app.id}')" style="font-size:11.5px; padding:4px 12px;">
              <i class="bi bi-download me-1"></i> Install
            </button>
          </div>
        </div>
      </div>
    `).join('');
  }

  function filterAppStore(category, btn) {
    currentCategory = category;
    const container = document.getElementById('appStoreCategories');
    if (container) {
      container.querySelectorAll('button').forEach(b => {
        b.className = 'btn-lp btn-lp-ghost btn-lp-sm';
      });
    }
    if (btn) btn.className = 'btn-lp btn-lp-primary btn-lp-sm';
    renderAppStoreGrid();
  }

  function searchAppStore(term) {
    const q = (term || '').toLowerCase().trim();
    if (!q) {
      renderAppStoreGrid();
      return;
    }
    const filtered = appStoreCatalog.filter(a =>
      a.name.toLowerCase().includes(q) ||
      a.description.toLowerCase().includes(q) ||
      a.category.toLowerCase().includes(q)
    );
    renderAppStoreGrid(filtered);
  }

  function showAppInstallModal(templateId) {
    const template = appStoreCatalog.find(t => t.id === templateId);
    if (!template) return;
    activeTemplate = template;

    document.getElementById('appModalTitle').textContent = `Install ${template.name}`;
    document.getElementById('appModalCategory').textContent = template.category;
    document.getElementById('appModalDesc').textContent = template.description;
    document.getElementById('appProjectName').value = `${template.id}-app`;

    const iconEl = document.getElementById('appModalIcon');
    iconEl.innerHTML = `<i class="bi ${template.icon || 'bi-box-seam'}"></i>`;
    iconEl.style.color = template.color || 'var(--accent-primary)';
    iconEl.style.background = 'rgba(255,255,255,0.06)';

    const fieldsContainer = document.getElementById('appDynamicFields');
    fieldsContainer.innerHTML = template.fields.map(f => `
      <div class="lp-form-group mb-0">
        <label class="lp-label" style="font-size:11px; font-weight:600; color:var(--text-muted);">${LP.escHtml(f.label)}</label>
        <input type="${f.type === 'password' ? 'password' : (f.type === 'number' ? 'number' : 'text')}" 
               id="app_field_${f.key}" 
               class="lp-input font-mono" 
               value="${LP.escHtml(String(f.default))}" 
               style="font-size:12px;" required>
      </div>
    `).join('');

    new bootstrap.Modal(document.getElementById('appInstallModal')).show();
  }

  async function submitAppInstall(e) {
    e.preventDefault();
    if (!activeTemplate) return;

    const btn = document.getElementById('btnDeployApp');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Deploying App...';

    const projectName = document.getElementById('appProjectName').value.trim();
    const customValues = {};
    for (const f of activeTemplate.fields) {
      const input = document.getElementById(`app_field_${f.key}`);
      if (input) customValues[f.key] = input.value;
    }

    try {
      const res = await LP.post('/docker/appstore/install', {
        templateId: activeTemplate.id,
        projectName,
        customValues,
      });

      if (res?.success) {
        LP.toast(`${activeTemplate.name} deployed successfully!`, 'success');
        bootstrap.Modal.getInstance(document.getElementById('appInstallModal')).hide();
        loadData();
      } else {
        LP.toast(res?.message || 'Failed to deploy app', 'error');
      }
    } catch (err) {
      LP.toast(err.message || 'Error deploying app', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-rocket-takeoff me-1"></i> Deploy App Now';
    }
  }

  // ── Container Resource Limits & Live Stats ────────────────
  async function showResourceModal(containerId, containerName) {
    document.getElementById('resContainerId').value = containerId;
    const titleEl = document.getElementById('resModalTitle');
    if (titleEl) titleEl.innerHTML = `<i class="bi bi-sliders text-primary me-2"></i>Limits: ${LP.escHtml(containerName || containerId)}`;
    document.getElementById('resLiveCpu').textContent = 'Loading...';
    document.getElementById('resLiveMem').textContent = 'Loading...';
    document.getElementById('resMemoryLimit').value = '';
    document.getElementById('resNanoCpus').value = '';

    new bootstrap.Modal(document.getElementById('resourceModal')).show();

    try {
      const res = await LP.get(`/docker/containers/${containerId}/stats`);
      if (res?.success && res.data?.stats) {
        const s = res.data.stats;
        document.getElementById('resLiveCpu').textContent = `${s.cpuPercent}%`;
        document.getElementById('resLiveMem').textContent = `${s.memoryUsageMb} MB / ${s.memoryLimitMb} MB (${s.memoryPercent}%)`;
      }
    } catch {
      document.getElementById('resLiveCpu').textContent = 'Unavailable';
      document.getElementById('resLiveMem').textContent = 'Unavailable';
    }
  }

  async function saveContainerResources(e) {
    e.preventDefault();
    const containerId = document.getElementById('resContainerId').value;
    const memoryLimitMb = document.getElementById('resMemoryLimit').value;
    const nanoCpus = document.getElementById('resNanoCpus').value;
    const restartPolicy = document.getElementById('resRestartPolicy').value;

    const btn = document.getElementById('btnSaveResources');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Applying...';

    try {
      const res = await LP.post(`/docker/containers/${containerId}/resources`, {
        memoryLimitMb: memoryLimitMb ? parseInt(memoryLimitMb, 10) : undefined,
        nanoCpus: nanoCpus ? parseFloat(nanoCpus) : undefined,
        restartPolicy,
      });

      if (res?.success) {
        LP.toast('Container resource limits updated successfully!', 'success');
        bootstrap.Modal.getInstance(document.getElementById('resourceModal')).hide();
        loadData();
      } else {
        LP.toast(res?.message || 'Failed to update resource limits', 'error');
      }
    } catch (err) {
      LP.toast(err.message || 'Error updating resource limits', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-check2-circle me-1"></i> Apply Resource Limits';
    }
  }

  return {
    loadData,
    action,
    deleteImage,
    pruneImages,
    viewLogs,
    viewConsole,
    detachLogs,
    addPortRow,
    addVolumeRow,
    addEnvRow,
    submitContainer,
    searchOnline,
    selectOnlineImage,
    deployCompose: submitStudioDeploy,
    loadComposeTemplate,
    installPackage,
    loadAppStore,
    filterAppStore,
    searchAppStore,
    showAppInstallModal,
    submitAppInstall,
    showResourceModal,
    saveContainerResources,
    // Compose Studio & Stacks
    loadComposeStacks,
    openNewStudio,
    openEditStudio,
    closeStudio,
    setStudioMode,
    onStudioTemplateChange,
    newStudioFromTemplate,
    addVisualService,
    removeVisualService,
    addVisualPort,
    removeVisualPort,
    addVisualEnv,
    removeVisualEnv,
    addVisualVolume,
    removeVisualVolume,
    submitStudioDeploy,
    startStack,
    stopStack,
    restartStack,
    deleteStack,
    openStackLogs,
    refreshStackLogs,
    openAutoProxyModal,
    submitAutoProxy,
  };
})();

window.DockerPage = DockerPage;

document.addEventListener('DOMContentLoaded', () => {
  DockerPage.loadData();
});

