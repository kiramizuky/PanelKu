import terminalService from '../modules/terminal/terminal.service.js';
import logger from '../config/logger.js';

/**
 * Terminal WebSocket namespace.
 * Handles bidirectional PTY communication.
 */
export const registerTerminalSocket = (namespace) => {
  namespace.on('connection', (socket) => {
    logger.debug(`Terminal WS: client connected ${socket.id} user=${socket.user?.username}`);

    let activeSessions = new Set();

    // Create terminal session
    socket.on('terminal:create', ({ shell = 'bash', cols = 80, rows = 24 }) => {
      try {
        const { sessionId, pid } = terminalService.create(socket.user._id, shell, cols, rows);
        activeSessions.add(sessionId);

        socket.emit('terminal:created', { sessionId, pid });

        // Stream PTY output to client
        terminalService.onData(sessionId, (data) => {
          socket.emit('terminal:data', { sessionId, data });
        });

        // Handle PTY exit
        terminalService.onExit(sessionId, ({ exitCode }) => {
          socket.emit('terminal:exit', { sessionId, exitCode });
          activeSessions.delete(sessionId);
        });
      } catch (err) {
        socket.emit('terminal:error', { message: err.message });
      }
    });

    // Send input to PTY
    socket.on('terminal:input', ({ sessionId, data }) => {
      try {
        if (!activeSessions.has(sessionId)) return;
        terminalService.write(sessionId, data);
      } catch (err) {
        socket.emit('terminal:error', { sessionId, message: err.message });
      }
    });

    // Resize PTY
    socket.on('terminal:resize', ({ sessionId, cols, rows }) => {
      if (!activeSessions.has(sessionId)) return;
      terminalService.resize(sessionId, cols, rows);
    });

    // Kill a specific session
    socket.on('terminal:kill', ({ sessionId }) => {
      if (!activeSessions.has(sessionId)) return;
      terminalService.kill(sessionId);
      activeSessions.delete(sessionId);
      socket.emit('terminal:killed', { sessionId });
    });

    // Cleanup on disconnect
    socket.on('disconnect', () => {
      for (const sessionId of activeSessions) {
        terminalService.kill(sessionId);
      }
      activeSessions.clear();
      logger.debug(`Terminal WS: client disconnected ${socket.id}`);
    });
  });
};
