import { WebSocketServer } from 'ws';
import url from 'url';
import { getDb } from '../core/db/sqlite.js';
import terminalService from '../modules/terminal/terminal.service.js';
import logger from '../config/logger.js';

const agentTerminalWss = new WebSocketServer({ noServer: true });

agentTerminalWss.on('connection', (ws, request) => {
  const parsedUrl = url.parse(request.url, true);
  const { apiKey, cols = 80, rows = 24, osUser = 'root', shell = 'bash' } = parsedUrl.query;

  if (!apiKey) {
    ws.close(4001, 'API key required');
    return;
  }

  // Auth check
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE api_key = ? AND api_key_enabled = 1 AND is_active = 1').get(apiKey);
  if (!user) {
    ws.close(4003, 'Unauthorized');
    return;
  }

  let sessionId;
  try {
    const result = terminalService.create(user.id, shell, parseInt(cols), parseInt(rows), osUser);
    sessionId = result.sessionId;

    // Send created notification
    ws.send(JSON.stringify({ event: 'created', sessionId }));

    // Stream PTY data to client
    terminalService.onData(sessionId, (data) => {
      if (ws.readyState === 1) { // 1 = OPEN
        ws.send(data);
      }
    });

    // Handle PTY exit
    terminalService.onExit(sessionId, ({ exitCode }) => {
      if (ws.readyState === 1) { // 1 = OPEN
        ws.send(JSON.stringify({ event: 'exit', exitCode }));
        ws.close();
      }
    });

    ws.on('message', (message) => {
      try {
        const msgStr = message.toString();
        // Check if message is a JSON command
        if (msgStr.startsWith('{') && msgStr.endsWith('}')) {
          const parsed = JSON.parse(msgStr);
          if (parsed.action === 'resize') {
            terminalService.resize(sessionId, parseInt(parsed.cols), parseInt(parsed.rows));
            return;
          }
          if (parsed.action === 'kill') {
            terminalService.kill(sessionId);
            ws.close();
            return;
          }
        }
        // Write raw terminal input to PTY
        terminalService.write(sessionId, msgStr);
      } catch (err) {
        logger.error(`Agent WS Terminal message error: ${err.message}`);
      }
    });

    ws.on('close', () => {
      terminalService.kill(sessionId);
    });

    ws.on('error', (err) => {
      logger.error(`Agent WS Terminal socket error: ${err.message}`);
      terminalService.kill(sessionId);
    });

  } catch (err) {
    logger.error(`Agent WS Terminal setup failed: ${err.message}`);
    ws.close(4500, err.message);
  }
});

export const handleAgentTerminalUpgrade = (request, socket, head) => {
  agentTerminalWss.handleUpgrade(request, socket, head, (ws) => {
    agentTerminalWss.emit('connection', ws, request);
  });
};
