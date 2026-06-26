import monitorService from '../modules/monitor/monitor.service.js';
import eventBus, { EVENTS } from '../core/events/EventBus.js';
import { MONITOR_INTERVALS } from '../config/constants.js';
import logger from '../config/logger.js';

let monitorInterval = null;
let clientCount = 0;

/**
 * Monitor WebSocket namespace — broadcasts system metrics every 3 seconds.
 */
export const registerMonitorSocket = (namespace) => {
  namespace.on('connection', (socket) => {
    clientCount++;
    logger.debug(`Monitor WS: client connected (${clientCount} total)`);

    // Start broadcasting if first client
    if (clientCount === 1) {
      startBroadcast(namespace);
    }

    // Client can request immediate update
    socket.on('request:metrics', async () => {
      try {
        const metrics = await monitorService.getCurrent();
        socket.emit('metrics', metrics);
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    socket.on('disconnect', () => {
      clientCount--;
      logger.debug(`Monitor WS: client disconnected (${clientCount} remaining)`);
      if (clientCount === 0) stopBroadcast();
    });
  });

  // Forward system alerts via WS
  eventBus.subscribe(EVENTS.SYSTEM_ALERT, (alert) => {
    namespace.emit('system:alert', alert);
  }, 'monitor-ws');
};

const startBroadcast = (namespace) => {
  if (monitorInterval) return;

  monitorInterval = setInterval(async () => {
    if (namespace.sockets.size === 0) return stopBroadcast();
    try {
      const metrics = await monitorService.getCurrent();
      namespace.emit('metrics', metrics);
    } catch (err) {
      logger.warn('Monitor broadcast error:', err.message);
    }
  }, MONITOR_INTERVALS.METRICS);

  logger.info('Monitor WS: broadcast started');
};

const stopBroadcast = () => {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    logger.info('Monitor WS: broadcast stopped (no clients)');
  }
};
