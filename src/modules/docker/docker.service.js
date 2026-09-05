import Docker from 'dockerode';
import logger from '../../config/logger.js';
import packageManager from '../system/package-manager.js';
import APP_STORE_CATALOG from './appstore.catalog.js';


/**
 * [R3-H2 FIX] Validate a docker-compose project name.
 * Blocks shell injection (`docker compose -p ${projectName}`) and path
 * traversal (projectName is also used as the compose directory name).
 * Letters/digits/_/- only, first char must be alphanumeric, max 64 chars.
 */
export function validateProjectName(projectName) {
  return typeof projectName === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(projectName);
}

/**
 * Helper to parse docker-compose YAML into structured service objects
 */
export function parseComposeServices(yamlStr) {
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

    // Detect 'services:' top level key
    if (/^services:\s*$/.test(line) || (/^services:/.test(rawLine.trimStart()) && !rawLine.startsWith(' ') && !rawLine.startsWith('\t'))) {
      inServices = true;
      continue;
    }

    // Detect top-level sections after services (e.g. volumes:, networks:, configs:)
    if (inServices && /^[a-zA-Z0-9_-]+:\s*$/.test(rawLine) && !rawLine.startsWith(' ') && !rawLine.startsWith('\t')) {
      inServices = false;
      if (currentService) services.push(currentService);
      currentService = null;
      continue;
    }

    if (!inServices) continue;

    // Detect service name: 2 spaces indentation (e.g. "  web:")
    const serviceMatch = rawLine.match(/^(\s{2}|\t)([a-zA-Z0-9_-]+):\s*$/);
    if (serviceMatch) {
      if (currentService) services.push(currentService);
      currentService = {
        name: serviceMatch[2],
        image: '',
        containerName: '',
        restart: 'unless-stopped',
        ports: [],
        environment: [],
        volumes: [],
        command: '',
      };
      currentArrayKey = null;
      continue;
    }

    if (!currentService) continue;

    // Array items with - (e.g. "      - '8080:80'")
    const itemMatch = rawLine.match(/^\s*-\s+(.*)$/);
    if (itemMatch && currentArrayKey) {
      const itemVal = itemMatch[1].trim().replace(/^["']|["']$/g, '');
      if (currentArrayKey === 'ports') currentService.ports.push(itemVal);
      else if (currentArrayKey === 'environment') currentService.environment.push(itemVal);
      else if (currentArrayKey === 'volumes') currentService.volumes.push(itemVal);
      continue;
    }

    // Nested key-value with 6+ spaces (e.g. "      POSTGRES_DB: mydb")
    const envKvMatch = rawLine.match(/^(\s{6,}|\t{3,})([a-zA-Z0-9_.-]+):\s*(.*)$/);
    if (envKvMatch && currentArrayKey === 'environment') {
      const k = envKvMatch[2];
      const v = envKvMatch[3].trim().replace(/^["']|["']$/g, '');
      currentService.environment.push(`${k}=${v}`);
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

export function generateComposeYaml({ services = [] }) {
  let yaml = "version: '3.8'\n\nservices:\n";
  for (const s of services) {
    yaml += `  ${s.name || 'app'}:\n`;
    if (s.image) yaml += `    image: ${s.image}\n`;
    if (s.containerName) yaml += `    container_name: ${s.containerName}\n`;
    if (s.restart) yaml += `    restart: ${s.restart}\n`;
    if (s.command) yaml += `    command: ${s.command}\n`;

    if (Array.isArray(s.ports) && s.ports.length > 0) {
      yaml += `    ports:\n`;
      for (const p of s.ports) {
        if (p) yaml += `      - "${p}"\n`;
      }
    }

    if (Array.isArray(s.environment) && s.environment.length > 0) {
      yaml += `    environment:\n`;
      for (const env of s.environment) {
        if (env) yaml += `      - ${env}\n`;
      }
    }

    if (Array.isArray(s.volumes) && s.volumes.length > 0) {
      yaml += `    volumes:\n`;
      for (const v of s.volumes) {
        if (v) yaml += `      - ${v}\n`;
      }
    }
    yaml += `\n`;
  }
  return yaml.trimEnd() + '\n';
}

class DockerService {
  constructor() {
    const isWindows = process.platform === 'win32';
    this.docker = new Docker(isWindows ? { socketPath: '//./pipe/docker_engine' } : { socketPath: '/var/run/docker.sock' });
  }

  async getInfo() {
    try {
      return await this.docker.info();
    } catch (error) {
      throw new Error('Docker daemon is not reachable. Is Docker installed and running?');
    }
  }

  async getDashboardSummary() {
    try {
      const info = await this.docker.info();
      return {
        containers: info.Containers,
        containersRunning: info.ContainersRunning,
        containersStopped: info.ContainersStopped,
        images: info.Images,
        operatingSystem: info.OperatingSystem,
      };
    } catch (error) {
      return null;
    }
  }

  async listContainers(all = true) {
    try {
      const containers = await this.docker.listContainers({ all });
      return containers.map(c => ({
        id: c.Id.substring(0, 12),
        names: c.Names.map(n => n.replace('/', '')),
        image: c.Image,
        state: c.State,
        status: c.Status,
        ports: c.Ports,
        created: c.Created
      }));
    } catch (error) {
      throw new Error(`Failed to list containers: ${error.message}`);
    }
  }

  async getContainerInfo(id) {
    try {
      const container = this.docker.getContainer(id);
      return await container.inspect();
    } catch (error) {
      throw new Error(`Failed to inspect container: ${error.message}`);
    }
  }

  async startContainer(id) {
    try {
      const container = this.docker.getContainer(id);
      await container.start();
      return true;
    } catch (error) {
      throw new Error(`Failed to start container: ${error.message}`);
    }
  }

  async stopContainer(id) {
    try {
      const container = this.docker.getContainer(id);
      await container.stop();
      return true;
    } catch (error) {
      // 304 means container is already stopped
      if (error.statusCode === 304) return true;

      // Handle AppArmor / containerd signal permission denied on Linux
      if (error.message && error.message.toLowerCase().includes('permission denied')) {
        try {
          const container = this.docker.getContainer(id);
          await container.kill();
          return true;
        } catch (killErr) {
          if (killErr.statusCode === 304 || killErr.statusCode === 404) return true;
          try {
            const { exec } = await import('child_process');
            const { promisify } = await import('util');
            const execAsync = promisify(exec);
            await execAsync(`sudo docker stop -t 1 ${id} 2>/dev/null || sudo docker kill ${id} 2>/dev/null`);
            return true;
          } catch (_) {}
        }
      }

      throw new Error(`Failed to stop container: ${error.message}`);
    }
  }

  async restartContainer(id) {
    try {
      const container = this.docker.getContainer(id);
      await container.restart();
      return true;
    } catch (error) {
      throw new Error(`Failed to restart container: ${error.message}`);
    }
  }

  async killContainer(id) {
    try {
      const container = this.docker.getContainer(id);
      await container.kill();
      return true;
    } catch (error) {
      if (error.statusCode === 304 || error.statusCode === 404) return true;
      if (error.message && error.message.toLowerCase().includes('permission denied')) {
        try {
          const { exec } = await import('child_process');
          const { promisify } = await import('util');
          const execAsync = promisify(exec);
          await execAsync(`sudo docker kill ${id} 2>/dev/null`);
          return true;
        } catch (_) {}
      }
      throw new Error(`Failed to kill container: ${error.message}`);
    }
  }

  async removeContainer(id, force = false) {
    try {
      const container = this.docker.getContainer(id);
      await container.remove({ force });
      return true;
    } catch (error) {
      throw new Error(`Failed to remove container: ${error.message}`);
    }
  }

  async listImages() {
    try {
      const images = await this.docker.listImages();
      const containers = await this.docker.listContainers({ all: true });
      return images.map(img => {
        const usingContainers = containers.filter(c => c.ImageID === img.Id).map(c => ({
          id: c.Id.substring(0, 12),
          names: c.Names.map(n => n.replace('/', '')),
          state: c.State
        }));
        return {
          id: img.Id.split(':')[1].substring(0, 12),
          rawId: img.Id,
          tags: img.RepoTags || [],
          size: img.Size,
          created: img.Created,
          containers: usingContainers
        };
      });
    } catch (error) {
      throw new Error(`Failed to list images: ${error.message}`);
    }
  }

  async removeImage(id, force = false) {
    try {
      const image = this.docker.getImage(id);
      await image.remove({ force });
      return true;
    } catch (error) {
      throw new Error(`Failed to remove image: ${error.message}`);
    }
  }

  async pruneImages() {
    try {
      const res = await this.docker.pruneImages({ filters: { dangling: ['false'] } });
      return res;
    } catch (error) {
      throw new Error(`Failed to prune unused images: ${error.message}`);
    }
  }

  async searchImages(term) {
    try {
      return await this.docker.searchImages({ term });
    } catch (error) {
      throw new Error(`Failed to search images: ${error.message}`);
    }
  }

  async createContainer(data) {
    try {
      // 1. Ensure the image is present locally, pull if not
      let imageExists = false;
      try {
        await this.docker.getImage(data.image).inspect();
        imageExists = true;
      } catch (err) {
        // Image not found locally
      }

      if (!imageExists) {
        logger.info(`Image ${data.image} not found locally. Pulling from Docker Hub...`);
        // Pull image stream helper
        await new Promise((resolve, reject) => {
          this.docker.pull(data.image, (err, stream) => {
            if (err) return reject(err);
            this.docker.modem.followProgress(stream, onFinished, onProgress);

            function onFinished(err, output) {
              if (err) return reject(err);
              resolve(output);
            }
            function onProgress(_event) {
              // Can log progress
            }
          });
        });
      }

      // Map ports
      const PortBindings = {};
      const ExposedPorts = {};
      if (data.ports && Array.isArray(data.ports)) {
        data.ports.forEach(p => {
          if (p.containerPort && p.hostPort) {
            const containerPortProto = `${p.containerPort}/tcp`;
            ExposedPorts[containerPortProto] = {};
            PortBindings[containerPortProto] = [{ HostPort: String(p.hostPort) }];
          }
        });
      }

      // Map volumes
      const Binds = [];
      if (data.volumes && Array.isArray(data.volumes)) {
        data.volumes.forEach(v => {
          if (v.hostPath && v.containerPath) {
            Binds.push(`${v.hostPath}:${v.containerPath}`);
          }
        });
      }

      // Map envs
      const Env = [];
      if (data.env && Array.isArray(data.env)) {
        data.env.forEach(e => {
          if (e.key && e.value) {
            Env.push(`${e.key}=${e.value}`);
          }
        });
      }

      const optsf = {
        Image: data.image,
        name: data.name,
        ExposedPorts,
        HostConfig: {
          PortBindings,
          Binds,
          RestartPolicy: { Name: data.restart || 'unless-stopped' }
        },
        Env
      };

      const container = await this.docker.createContainer(optsf);
      if (data.startAfterCreate) {
        await container.start();
      }
      return { id: container.id.substring(0, 12) };
    } catch (error) {
      throw new Error(`Failed to create container: ${error.message}`);
    }
  }

  async deployCompose(projectName, composeYaml) {
    try {
      // [R3-H2 FIX] Defense-in-depth: validate here too because projectName is
      // interpolated into the compose command AND used as a directory name
      // (path traversal). All plugin callers pass hardcoded/validated names
      // (adguard, minio, ... or `_validatePkg` output), so this never rejects
      // legitimate use.
      if (!validateProjectName(projectName)) {
        throw new Error('Invalid project name: use letters, digits, underscore or dash (max 64 chars)');
      }

      const fs = (await import('fs/promises')).default;
      const path = (await import('path')).default;
      const { exec } = await import('child_process');
      const util = (await import('util')).default;
      const execAsync = util.promisify(exec);

      const composeDir = path.resolve('storage', 'docker-compose', projectName);
      await fs.mkdir(composeDir, { recursive: true });

      const composePath = path.join(composeDir, 'docker-compose.yml');
      await fs.writeFile(composePath, composeYaml, 'utf-8');

      /** Run the compose command, trying V2 first then V1 */
      const runCompose = async () => {
        try {
          const res = await execAsync(`docker compose -p ${projectName} -f "${composePath}" up -d`);
          return { stdout: res.stdout, stderr: res.stderr };
        } catch (err) {
          if (err.message.includes('unknown shorthand flag') || err.message.includes('is not a docker command')) {
            logger.info('docker compose (V2) unavailable, trying docker-compose (V1)...');
            const res = await execAsync(`docker-compose -p ${projectName} -f "${composePath}" up -d`);
            return { stdout: res.stdout, stderr: res.stderr };
          }
          throw err;
        }
      };

      /** Auto-install docker-compose when it is completely missing */
      const autoInstall = async () => {
        logger.warn('Docker Compose not found — attempting automatic installation...');
        await packageManager.init();

        // Build install command based on distro
        let installCmd;
        switch (packageManager.pmType) {
          case 'pacman':
            installCmd = 'sudo pacman -S --noconfirm --needed docker-compose';
            break;
          case 'dnf':
            installCmd = 'sudo dnf install -y docker-compose-plugin || sudo dnf install -y docker-compose';
            break;
          case 'emerge':
            installCmd = 'sudo emerge -v app-containers/docker-compose';
            break;
          case 'apt':
          default:
            // Prefer V2 plugin; fall back to standalone V1 if plugin unavailable
            installCmd =
              'sudo apt-get update -qq && ' +
              '(sudo DEBIAN_FRONTEND=noninteractive apt-get install -y docker-compose-plugin 2>/dev/null || ' +
              ' sudo DEBIAN_FRONTEND=noninteractive apt-get install -y docker-compose)';
            break;
        }

        logger.info(`Running: ${installCmd}`);
        const { stdout, stderr } = await execAsync(installCmd, { timeout: 300000 });
        logger.info(`Install output: ${stdout || stderr}`);
      };

      // First attempt
      try {
        const { stdout, stderr } = await runCompose();
        return { success: true, log: stdout || stderr };
      } catch (firstErr) {
        // Check if the error indicates compose is simply not found
        const notFound =
          firstErr.message.includes('not found') ||
          firstErr.message.includes('No such file') ||
          firstErr.message.includes('command not found');

        if (!notFound) throw firstErr;

        // Auto-install then retry once
        await autoInstall();
        logger.info('Retrying Docker Compose deploy after installation...');
        const { stdout, stderr } = await runCompose();
        return { success: true, log: stdout || stderr };
      }
    } catch (error) {
      throw new Error(`Failed to deploy Docker Compose: ${error.message}`);
    }
  }

  // ── Docker Compose Stack Management & Studio ──────────────────

  async _runComposeCmd(projectName, args) {
    if (!validateProjectName(projectName)) {
      throw new Error('Invalid project name: use letters, digits, underscore or dash (max 64 chars)');
    }
    const path = (await import('path')).default;
    const { exec } = await import('child_process');
    const util = (await import('util')).default;
    const execAsync = util.promisify(exec);

    const composeDir = path.resolve('storage', 'docker-compose', projectName);
    const composePath = path.join(composeDir, 'docker-compose.yml');

    try {
      const res = await execAsync(`docker compose -p ${projectName} -f "${composePath}" ${args}`);
      return { stdout: res.stdout, stderr: res.stderr };
    } catch (err) {
      if (err.message.includes('unknown shorthand flag') || err.message.includes('is not a docker command')) {
        const res = await execAsync(`docker-compose -p ${projectName} -f "${composePath}" ${args}`);
        return { stdout: res.stdout, stderr: res.stderr };
      }
      throw err;
    }
  }

  async listComposeProjects() {
    const fs = (await import('fs/promises')).default;
    const path = (await import('path')).default;
    const baseDir = path.resolve('storage', 'docker-compose');

    let dirs = [];
    try {
      dirs = await fs.readdir(baseDir, { withFileTypes: true });
    } catch {
      return [];
    }

    let allContainers = [];
    try {
      allContainers = await this.listContainers(true);
    } catch {
      allContainers = [];
    }

    const projects = [];
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const projectName = d.name;
      const yamlPath = path.join(baseDir, projectName, 'docker-compose.yml');
      let yaml = '';
      try {
        yaml = await fs.readFile(yamlPath, 'utf8');
      } catch {
        continue;
      }

      const services = parseComposeServices(yaml);
      const pNameLower = projectName.toLowerCase();
      const matchedContainers = allContainers.filter(c => {
        return (c.names || []).some(n => {
          const nLower = String(n).toLowerCase();
          return nLower === pNameLower || nLower.startsWith(`${pNameLower}_`) || nLower.startsWith(`${pNameLower}-`);
        });
      });

      let status = 'stopped';
      if (matchedContainers.length > 0) {
        const runningCount = matchedContainers.filter(c => c.state === 'running').length;
        if (runningCount === matchedContainers.length) status = 'running';
        else if (runningCount > 0) status = 'partial';
        else status = 'stopped';
      }

      // Collect exposed ports from services and containers
      const exposedPorts = [];
      for (const s of services) {
        for (const p of s.ports || []) {
          const parts = String(p).split(':');
          if (parts.length >= 2) {
            const hostPort = parseInt(parts[0], 10);
            const containerPort = parseInt(parts[1], 10);
            if (hostPort && !exposedPorts.some(ep => ep.hostPort === hostPort)) {
              exposedPorts.push({ service: s.name, hostPort, containerPort });
            }
          }
        }
      }

      projects.push({
        name: projectName,
        status,
        servicesCount: services.length,
        services,
        containers: matchedContainers,
        exposedPorts,
        yaml,
      });
    }

    return projects;
  }

  async getComposeProject(projectName) {
    if (!validateProjectName(projectName)) {
      throw new Error('Invalid project name');
    }
    const fs = (await import('fs/promises')).default;
    const path = (await import('path')).default;
    const yamlPath = path.resolve('storage', 'docker-compose', projectName, 'docker-compose.yml');

    const yaml = await fs.readFile(yamlPath, 'utf8');
    const services = parseComposeServices(yaml);

    let allContainers = [];
    try {
      allContainers = await this.listContainers(true);
    } catch {
      allContainers = [];
    }

    const pNameLower = projectName.toLowerCase();
    const containers = allContainers.filter(c => {
      return (c.names || []).some(n => {
        const nLower = String(n).toLowerCase();
        return nLower === pNameLower || nLower.startsWith(`${pNameLower}_`) || nLower.startsWith(`${pNameLower}-`);
      });
    });

    let status = 'stopped';
    if (containers.length > 0) {
      const runningCount = containers.filter(c => c.state === 'running').length;
      if (runningCount === containers.length) status = 'running';
      else if (runningCount > 0) status = 'partial';
      else status = 'stopped';
    }

    return {
      name: projectName,
      status,
      services,
      containers,
      yaml,
    };
  }

  async startComposeProject(projectName) {
    return await this._runComposeCmd(projectName, 'up -d');
  }

  async stopComposeProject(projectName) {
    return await this._runComposeCmd(projectName, 'down');
  }

  async restartComposeProject(projectName) {
    return await this._runComposeCmd(projectName, 'restart');
  }

  async deleteComposeProject(projectName, { removeVolumes = false } = {}) {
    if (!validateProjectName(projectName)) {
      throw new Error('Invalid project name');
    }
    const fs = (await import('fs/promises')).default;
    const path = (await import('path')).default;
    const projectDir = path.resolve('storage', 'docker-compose', projectName);

    try {
      await this._runComposeCmd(projectName, `down ${removeVolumes ? '-v' : ''}`);
    } catch (e) {
      logger.warn(`Notice stopping compose on delete: ${e.message}`);
    }

    try {
      await fs.rm(projectDir, { recursive: true, force: true });
    } catch (e) {
      logger.warn(`Failed to delete compose directory: ${e.message}`);
    }

    return { success: true, message: `Stack ${projectName} deleted` };
  }

  async getComposeLogs(projectName, { lines = 200, service = '' } = {}) {
    const svcArg = service && /^[a-zA-Z0-9_-]+$/.test(service) ? service : '';
    const res = await this._runComposeCmd(projectName, `logs --tail=${Number(lines) || 200} --no-color ${svcArg}`);
    return res.stdout || res.stderr || '';
  }

  async createAutoProxy({ domain, port, userId }) {
    if (!domain || typeof domain !== 'string') {
      throw new Error('Domain name is required');
    }
    const cleanDomain = domain.trim().toLowerCase();
    if (!/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(cleanDomain)) {
      throw new Error('Invalid domain name format (e.g. app.domain.com)');
    }
    const targetPort = parseInt(port, 10);
    if (!targetPort || targetPort < 1 || targetPort > 65535) {
      throw new Error('Invalid port number (1-65535)');
    }

    const { default: websitesService } = await import('../websites/websites.service.js');
    const website = await websitesService.createWebsite({
      domain: cleanDomain,
      type: 'proxy',
      port: targetPort,
    }, userId);

    return website;
  }

  // ── 1-Click App Store Catalog ─────────────────────────────────

  getAppStoreCatalog() {
    return APP_STORE_CATALOG;
  }

  async installAppStoreTemplate(templateId, projectName, customValues = {}) {
    const template = APP_STORE_CATALOG.find(t => t.id === templateId);
    if (!template) {
      throw new Error(`App template '${templateId}' not found in catalog`);
    }

    const cleanProjectName = (projectName || templateId).toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    if (!validateProjectName(cleanProjectName)) {
      throw new Error('Invalid project name. Letters, numbers, hyphens and underscores only.');
    }

    // Substitute variables in compose template
    let composeContent = template.compose;
    for (const field of template.fields) {
      const val = customValues[field.key] !== undefined ? customValues[field.key] : field.default;
      const regex = new RegExp(`\\$\\{${field.key}\\}`, 'g');
      composeContent = composeContent.replace(regex, String(val));
    }

    return await this.deployComposeProject(cleanProjectName, composeContent);
  }

  // ── Live Container Resource Stats & Limits ────────────────────

  async getContainerStats(id) {
    try {
      const container = this.docker.getContainer(id);
      const stats = await container.stats({ stream: false });

      // CPU % calculation
      let cpuPercent = 0.0;
      if (stats.cpu_stats && stats.precpu_stats) {
        const cpuDelta = (stats.cpu_stats.cpu_usage?.total_usage || 0) - (stats.precpu_stats.cpu_usage?.total_usage || 0);
        const systemDelta = (stats.cpu_stats.system_cpu_usage || 0) - (stats.precpu_stats.system_cpu_usage || 0);
        const cpuCount = stats.cpu_stats.online_cpus || stats.cpu_stats.cpu_usage?.percpu_usage?.length || 1;
        if (systemDelta > 0 && cpuDelta > 0) {
          cpuPercent = (cpuDelta / systemDelta) * cpuCount * 100.0;
        }
      }

      // Memory calculation
      const memUsage = stats.memory_stats?.usage || 0;
      const memLimit = stats.memory_stats?.limit || 1;
      const memPercent = (memUsage / memLimit) * 100.0;

      // Network calculation
      let rxBytes = 0;
      let txBytes = 0;
      if (stats.networks) {
        for (const iface of Object.values(stats.networks)) {
          rxBytes += iface.rx_bytes || 0;
          txBytes += iface.tx_bytes || 0;
        }
      }

      return {
        id,
        cpuPercent: parseFloat(cpuPercent.toFixed(2)),
        memoryUsageMb: parseFloat((memUsage / (1024 * 1024)).toFixed(2)),
        memoryLimitMb: parseFloat((memLimit / (1024 * 1024)).toFixed(2)),
        memoryPercent: parseFloat(memPercent.toFixed(2)),
        networkRxMb: parseFloat((rxBytes / (1024 * 1024)).toFixed(2)),
        networkTxMb: parseFloat((txBytes / (1024 * 1024)).toFixed(2)),
        pids: stats.pids_stats?.current || 0,
      };
    } catch (error) {
      throw new Error(`Failed to get container stats: ${error.message}`);
    }
  }

  async updateContainerResources(id, { memoryLimitMb, cpuShares, nanoCpus, restartPolicy }) {
    try {
      const container = this.docker.getContainer(id);
      const updateOpts = {};
      if (memoryLimitMb) {
        updateOpts.Memory = parseInt(memoryLimitMb, 10) * 1024 * 1024;
      }
      if (cpuShares) {
        updateOpts.CpuShares = parseInt(cpuShares, 10);
      }
      if (nanoCpus) {
        updateOpts.NanoCPUs = parseInt(nanoCpus, 10) * 1e9;
      }
      if (restartPolicy) {
        updateOpts.RestartPolicy = { Name: restartPolicy };
      }
      const res = await container.update(updateOpts);
      return res;
    } catch (error) {
      throw new Error(`Failed to update container resources: ${error.message}`);
    }
  }
}

export default new DockerService();

