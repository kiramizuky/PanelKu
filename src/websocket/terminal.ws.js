import terminalService from '../modules/terminal/terminal.service.js';
import logger from '../config/logger.js';
import fs from 'fs';
import path from 'path';

const AUDIT_LOG_PATH = path.resolve(process.cwd(), 'storage', 'logs', 'terminal_audit.log');

function logTerminalCommand(username, command) {
  const cleanCommand = command.trim();
  if (!cleanCommand) return;
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] User: ${username} | Command: ${cleanCommand}\n`;
  fs.appendFile(AUDIT_LOG_PATH, logLine, 'utf8', (err) => {
    if (err) console.error('Failed to write terminal audit log:', err);
  });
}

/**
 * Terminal WebSocket namespace.
 * Handles bidirectional PTY communication.
 */
export const registerTerminalSocket = (namespace) => {
  namespace.on('connection', (socket) => {
    logger.debug(`Terminal WS: client connected ${socket.id} user=${socket.user?.username}`);

    let activeSessions = new Set();
    let sessionBuffers = new Map();

    // Create terminal session
    socket.on('terminal:create', ({ shell = 'bash', cols = 80, rows = 24, osUser = 'root' }) => {
      try {
        const { sessionId, pid } = terminalService.create(socket.user._id, shell, cols, rows, osUser);
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
          sessionBuffers.delete(sessionId);
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

        // Buffering for audit log
        let buf = sessionBuffers.get(sessionId) || '';
        for (let i = 0; i < data.length; i++) {
          const char = data[i];
          if (char === '\r' || char === '\n') {
            logTerminalCommand(socket.user?.username || 'unknown', buf);
            buf = '';
          } else if (char === '\x7f' || char === '\b') {
            if (buf.length > 0) buf = buf.slice(0, -1);
          } else {
            const code = char.charCodeAt(0);
            if (code >= 32 && code <= 126) {
              buf += char;
            }
          }
        }
        sessionBuffers.set(sessionId, buf);
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
