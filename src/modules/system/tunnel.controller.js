import Docker from 'dockerode';
import { successResponse, errorResponse } from '../../helpers/response.js';

const isWindows = process.platform === 'win32';
const docker = new Docker(isWindows ? { socketPath: '//./pipe/docker_engine' } : { socketPath: '/var/run/docker.sock' });

class TunnelAndAppsController {
  // --- Cloudflare Tunnel ---
  async getCloudflareStatus(req, res) {
    try {
      const containers = await docker.listContainers({ all: true });
      const cfContainer = containers.find(c => c.Names.includes('/cloudflare-tunnel'));
      
      if (!cfContainer) {
        return successResponse(res, { status: 'not_installed', info: null });
      }

      return successResponse(res, {
        status: cfContainer.State, // 'running', 'exited', etc.
        info: {
          id: cfContainer.Id.substring(0, 12),
          status: cfContainer.Status,
          image: cfContainer.Image
        }
      });
    } catch (error) {
      console.warn('Docker daemon not reachable in getCloudflareStatus:', error.message);
      return successResponse(res, { status: 'docker_not_running', info: null });
    }
  }

  async startCloudflare(req, res) {
    try {
      const { token } = req.body;
      if (!token) return errorResponse(res, 'Cloudflare Tunnel token is required', 400);

      // Ensure cloudflared image is present locally
      const imageName = 'cloudflare/cloudflared:latest';
      let imageExists = false;
      try {
        await docker.getImage(imageName).inspect();
        imageExists = true;
      } catch (err) {}

      if (!imageExists) {
        await new Promise((resolve, reject) => {
          docker.pull(imageName, (err, stream) => {
            if (err) return reject(err);
            docker.modem.followProgress(stream, (progressErr, output) => {
              if (progressErr) return reject(progressErr);
              resolve(output);
            });
          });
        });
      }

      // Stop & remove existing tunnel container first
      const containers = await docker.listContainers({ all: true });
      const existing = containers.find(c => c.Names.includes('/cloudflare-tunnel'));
      if (existing) {
        const container = docker.getContainer(existing.Id);
        try { await container.stop(); } catch (e) {}
        try { await container.remove(); } catch (e) {}
      }

      // Create & start cloudflared container
      const container = await docker.createContainer({
        Image: imageName,
        name: 'cloudflare-tunnel',
        Cmd: ['tunnel', '--no-autoupdate', 'run', '--token', token],
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' }
        }
      });
      await container.start();

      return successResponse(res, null, 'Cloudflare Tunnel started successfully');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async stopCloudflare(req, res) {
    try {
      const containers = await docker.listContainers({ all: true });
      const cfContainer = containers.find(c => c.Names.includes('/cloudflare-tunnel'));
      if (!cfContainer) return errorResponse(res, 'Tunnel container not found', 404);

      const container = docker.getContainer(cfContainer.Id);
      try { await container.stop(); } catch (e) {}
      try { await container.remove(); } catch (e) {}

      return successResponse(res, null, 'Cloudflare Tunnel stopped & removed successfully');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // --- n8n ---
  async getN8nStatus(req, res) {
    try {
      const containers = await docker.listContainers({ all: true });
      const n8nContainer = containers.find(c => c.Names.includes('/n8n-container'));

      if (!n8nContainer) {
        return successResponse(res, { status: 'not_installed', info: null });
      }

      return successResponse(res, {
        status: n8nContainer.State,
        info: {
          id: n8nContainer.Id.substring(0, 12),
          status: n8nContainer.Status,
          ports: n8nContainer.Ports
        }
      });
    } catch (error) {
      console.warn('Docker daemon not reachable in getN8nStatus:', error.message);
      return successResponse(res, { status: 'docker_not_running', info: null });
    }
  }

  async startN8n(req, res) {
    try {
      const containers = await docker.listContainers({ all: true });
      const existing = containers.find(c => c.Names.includes('/n8n-container'));

      if (existing) {
        const container = docker.getContainer(existing.Id);
        if (existing.State !== 'running') {
          await container.start();
        }
        return successResponse(res, null, 'n8n started successfully');
      }

      // Ensure n8n image is present locally
      const imageName = 'docker.n8n.io/n8nio/n8n:latest';
      let imageExists = false;
      try {
        await docker.getImage(imageName).inspect();
        imageExists = true;
      } catch (err) {}

      if (!imageExists) {
        await new Promise((resolve, reject) => {
          docker.pull(imageName, (err, stream) => {
            if (err) return reject(err);
            docker.modem.followProgress(stream, (progressErr, output) => {
              if (progressErr) return reject(progressErr);
              resolve(output);
            });
          });
        });
      }

      // Pull & Run n8n with memory limits (optimized for STB)
      const container = await docker.createContainer({
        Image: imageName,
        name: 'n8n-container',
        ExposedPorts: { '5678/tcp': {} },
        HostConfig: {
          PortBindings: { '5678/tcp': [{ HostPort: '5678' }] },
          Binds: ['n8n-data:/home/node/.local/share/n8n'],
          RestartPolicy: { Name: 'unless-stopped' },
          Memory: 256 * 1024 * 1024 // Limit to 256MB RAM for STB efficiency
        }
      });
      await container.start();

      return successResponse(res, null, 'n8n deployed successfully');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async stopN8n(req, res) {
    try {
      const containers = await docker.listContainers({ all: true });
      const existing = containers.find(c => c.Names.includes('/n8n-container'));
      if (!existing) return errorResponse(res, 'n8n container not found', 404);

      const container = docker.getContainer(existing.Id);
      await container.stop();
      return successResponse(res, null, 'n8n stopped successfully');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async uninstallN8n(req, res) {
    try {
      const containers = await docker.listContainers({ all: true });
      const existing = containers.find(c => c.Names.includes('/n8n-container'));
      if (!existing) return errorResponse(res, 'n8n container not found', 404);

      const container = docker.getContainer(existing.Id);
      try { await container.stop(); } catch (e) {}
      await container.remove();
      return successResponse(res, null, 'n8n uninstalled successfully');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }
}

export default new TunnelAndAppsController();
