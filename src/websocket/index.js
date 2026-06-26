import jwt from 'jsonwebtoken';
import appConfig from '../config/app.js';
import userRepository from '../repositories/user.repository.js';
import { registerMonitorSocket } from './monitor.ws.js';
import { registerTerminalSocket } from './terminal.ws.js';
import { registerNotificationSocket } from './notifications.ws.js';
import { registerDockerSocket } from './docker.ws.js';
import logger from '../config/logger.js';

/**
 * Initialize all Socket.IO namespaces and authenticate connections.
 */
export const initWebSocket = (io) => {
  const authMiddleware = async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) return next(new Error('No token'));

      const decoded = jwt.verify(token, appConfig.jwt.secret);
      const user = await userRepository.findById(decoded.sub, { populate: 'role' });

      if (!user || !user.isActive) return next(new Error('Unauthorized'));

      socket.user = user;
      socket.userId = String(user._id);
      next();
    } catch (err) {
      logger.warn(`Socket auth failed: ${err.message}`);
      next(new Error('Authentication failed'));
    }
  };

  // Global JWT auth middleware for Socket.IO root namespace
  io.use(authMiddleware);

  // Register namespaces
  const monitorNs = io.of('/monitor');
  const terminalNs = io.of('/terminal');
  const notifNs = io.of('/notifications');
  const dockerNs = io.of('/docker');

  // Apply auth to namespaces
  [monitorNs, terminalNs, notifNs, dockerNs].forEach((ns) => {
    ns.use(authMiddleware);
  });

  registerMonitorSocket(monitorNs);
  registerTerminalSocket(terminalNs);
  registerNotificationSocket(notifNs);
  registerDockerSocket(dockerNs);

  io.on('connection', (socket) => {
    logger.debug(`Socket connected: ${socket.id} user=${socket.user?.username}`);
    socket.join(`user:${socket.userId}`);
  });

  logger.info('WebSocket: namespaces initialized (/monitor, /terminal, /notifications)');
};
