import terminalService from '../modules/terminal/terminal.service.js';
import logger from '../config/logger.js';
import fs from 'fs';
import path from 'path';
import WebSocket from 'ws';
import { getDb } from '../core/db/sqlite.js';

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
 * Handles bidirectional PTY communication (local or remote cluster agent).
 */
export const registerTerminalSocket = (namespace) => {
  namespace.on('connection', (socket) => {
    logger.debug(`Terminal WS: client connected ${socket.id} user=${socket.user?.username}`);

    let activeSessions = new Set();
    let sessionBuffers = new Map();
    let remoteSockets = new Map(); // sessionId -> WebSocket client connecting to agent node

    // Create terminal session
    socket.on('terminal:create', ({ shell = 'bash', cols = 80, rows = 24, osUser = 'root', nodeId }) => {
      if (nodeId) {
        // REMOTE NODE MODE
        try {
          const db = getDb();
          const node = db.prepare('SELECT * FROM cluster_nodes WHERE id = ?').get(nodeId);
          if (!node) {
            throw new Error('Cluster node not found');
          }

          const isSsl = !node.port || node.port === 443;
          const protocol = isSsl ? 'wss' : 'ws';
          const portStr = node.port ? `:${node.port}` : '';
          const wsUrl = `${protocol}://${node.ip_address}${portStr}/api/agent/terminal/ws?apiKey=${node.api_key}&cols=${cols}&rows=${rows}&osUser=${osUser}&shell=${shell}`;

          logger.info(`Connecting terminal proxy to remote node: ${node.name} (${wsUrl})`);
          
          const agentWs = new WebSocket(wsUrl, {
            rejectUnauthorized: false // Allow self-signed certs for nodes
          });

          let remoteSessionId = null;

          agentWs.on('open', () => {
            logger.debug(`Terminal proxy connected to remote node ${node.name}`);
          });

          agentWs.on('message', (message) => {
            try {
              const msgStr = message.toString();
              // Check for control events from agent
              if (msgStr.startsWith('{') && msgStr.endsWith('}')) {
                const parsed = JSON.parse(msgStr);
                if (parsed.event === 'created') {
                  remoteSessionId = parsed.sessionId;
                  activeSessions.add(remoteSessionId);
                  remoteSockets.set(remoteSessionId, agentWs);
                  socket.emit('terminal:created', { sessionId: remoteSessionId, pid: 0 });
                  return;
                }
                if (parsed.event === 'exit') {
                  socket.emit('terminal:exit', { sessionId: remoteSessionId, exitCode: parsed.exitCode });
                  if (remoteSessionId) {
                    activeSessions.delete(remoteSessionId);
                    remoteSockets.delete(remoteSessionId);
                    sessionBuffers.delete(remoteSessionId);
                  }
                  return;
                }
              }
              // Normal terminal data
              socket.emit('terminal:data', { sessionId: remoteSessionId, data: msgStr });
            } catch (err) {
              logger.error(`Terminal proxy message error: ${err.message}`);
            }
          });

          agentWs.on('close', () => {
            if (remoteSessionId) {
              socket.emit('terminal:exit', { sessionId: remoteSessionId, exitCode: 0 });
              activeSessions.delete(remoteSessionId);
              remoteSockets.delete(remoteSessionId);
              sessionBuffers.delete(remoteSessionId);
            }
          });

          agentWs.on('error', (err) => {
            socket.emit('terminal:error', { message: `Remote connection error: ${err.message}` });
          });

        } catch (err) {
          logger.error(`Failed to create remote terminal session: ${err.message}`);
          socket.emit('terminal:error', { message: err.message });
        }
      } else {
        // LOCAL PTY MODE
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
      }
    });

    // Send input to PTY
    socket.on('terminal:input', ({ sessionId, data }) => {
      try {
        if (!activeSessions.has(sessionId)) return;

        // Check if remote node socket exists
        const agentWs = remoteSockets.get(sessionId);
        if (agentWs) {
          if (agentWs.readyState === WebSocket.OPEN) {
            agentWs.send(data);
          }
        } else {
          // Local PTY
          terminalService.write(sessionId, data);
        }

        // Buffering for audit log (clean ANSI escape sequences first)
        const logData = data.replace(/\x1b\[[0-9?]*[a-zA-Z~]/g, '');
        let buf = sessionBuffers.get(sessionId) || '';
        for (let i = 0; i < logData.length; i++) {
          const char = logData[i];
          if (char === '\r' || char === '\n') {
            const cleanBuf = buf.trim();
            if (cleanBuf) {
              logTerminalCommand(socket.user?.username || 'unknown', cleanBuf);
            }
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
      const agentWs = remoteSockets.get(sessionId);
      if (agentWs) {
        if (agentWs.readyState === WebSocket.OPEN) {
          agentWs.send(JSON.stringify({ action: 'resize', cols, rows }));
        }
      } else {
        terminalService.resize(sessionId, cols, rows);
      }
    });

    // Kill a specific session
    socket.on('terminal:kill', ({ sessionId }) => {
      if (!activeSessions.has(sessionId)) return;
      const agentWs = remoteSockets.get(sessionId);
      if (agentWs) {
        if (agentWs.readyState === WebSocket.OPEN) {
          agentWs.send(JSON.stringify({ action: 'kill' }));
        }
        activeSessions.delete(sessionId);
        remoteSockets.delete(sessionId);
      } else {
        terminalService.kill(sessionId);
        activeSessions.delete(sessionId);
      }
      socket.emit('terminal:killed', { sessionId });
    });

    // Cleanup on disconnect
    socket.on('disconnect', () => {
      for (const sessionId of activeSessions) {
        const agentWs = remoteSockets.get(sessionId);
        if (agentWs) {
          if (agentWs.readyState === WebSocket.OPEN) {
            agentWs.close();
          }
        } else {
          terminalService.kill(sessionId);
        }
      }
      activeSessions.clear();
      remoteSockets.clear();
      logger.debug(`Terminal WS: client disconnected ${socket.id}`);
    });
  });
};
