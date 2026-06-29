import dockerService from '../modules/docker/docker.service.js';
import PermissionManager from '../core/permissions/PermissionManager.js';
import logger from '../config/logger.js';

export const registerDockerSocket = (namespace) => {
  namespace.on('connection', async (socket) => {
    logger.debug(`Docker WS connected: ${socket.id}`);
    
    // Check permission
    const hasPerm = await PermissionManager.checkPermission(socket.user.role, 'docker_manage', 'read');
    if (!hasPerm) {
      return socket.disconnect(true);
    }

    let logsStream = null;
    let statsStream = null;

    // Attach to a container's logs
    socket.on('logs:attach', async (payload) => {
      try {
        if (logsStream) {
          logsStream.destroy();
        }
        
        const containerId = typeof payload === 'string' ? payload : payload?.containerId;
        if (!containerId) {
          return socket.emit('logs:error', 'Container ID is required');
        }
        
        const container = dockerService.docker.getContainer(containerId);
        logsStream = await container.logs({
          follow: true,
          stdout: true,
          stderr: true,
          tail: 100
        });

        // Parse docker log format (header + payload)
        logsStream.on('data', (chunk) => {
          let logStr = chunk.toString('utf8');
          if (logStr.charCodeAt(0) === 1 || logStr.charCodeAt(0) === 2) {
             logStr = chunk.slice(8).toString('utf8');
          }
          socket.emit('logs:data', logStr);
        });

        logsStream.on('error', (err) => {
          socket.emit('logs:error', err.message);
        });

      } catch (err) {
        socket.emit('logs:error', err.message);
      }
    });

    // Attach to container stats
    socket.on('stats:attach', async ({ containerId }) => {
      try {
        if (statsStream) {
          statsStream.destroy();
        }

        const container = dockerService.docker.getContainer(containerId);
        statsStream = await container.stats();
        
        statsStream.on('data', (chunk) => {
          try {
            const stat = JSON.parse(chunk.toString('utf8'));
            socket.emit('stats:data', stat);
          } catch (e) {
             // Ignore partial chunks
          }
        });
      } catch (err) {
        socket.emit('stats:error', err.message);
      }
    });

    socket.on('detach', () => {
      if (logsStream) logsStream.destroy();
      if (statsStream) statsStream.destroy();
      logsStream = null;
      statsStream = null;
    });

    socket.on('disconnect', () => {
      if (logsStream) logsStream.destroy();
      if (statsStream) statsStream.destroy();
    });
  });
}
