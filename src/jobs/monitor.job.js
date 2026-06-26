import monitorService from '../modules/monitor/monitor.service.js';
import eventBus, { EVENTS } from '../core/events/EventBus.js';
import scheduler from '../core/scheduler/Scheduler.js';
import logger from '../config/logger.js';

import alertsService from '../modules/alerts/alerts.service.js';

let alertConsecutiveTicks = { cpu: 0, ram: 0, disk: 0 };

export const startMonitorJob = () => {
  scheduler.register(
    'monitor:collect',
    async () => {
      const metrics = await monitorService.getCurrent();
      const config = await alertsService.getConfig();
      const thresholds = config.thresholds || { cpuPercent: 90, ramPercent: 90, diskPercent: 95 };

      // Save to DB history
      await monitorService.saveHistory({
        cpu: metrics.cpu,
        cpuTemp: metrics.cpuTemp,
        ramUsed: metrics.ramUsed,
        ramTotal: metrics.ramTotal,
        swapUsed: metrics.swapUsed,
        swapTotal: metrics.swapTotal,
        diskUsed: metrics.diskUsed,
        diskTotal: metrics.diskTotal,
        networkRx: metrics.networkRx,
        networkTx: metrics.networkTx,
        diskRead: metrics.diskRead,
        diskWrite: metrics.diskWrite,
        loadAvg: metrics.loadAvg,
      });

      // Check alerts
      const checkThreshold = (type, current, threshold) => {
        if (current >= threshold) {
          alertConsecutiveTicks[type]++;
          if (alertConsecutiveTicks[type] === 2) { // Fire on 2 consecutive ticks
            const msg = `High ${type.toUpperCase()} Usage Detected: ${current.toFixed(1)}% (Threshold: ${threshold}%)`;
            logger.warn(`Monitor alert: ${msg}`);
            eventBus.publish(EVENTS.SYSTEM_ALERT, { type, value: current, threshold });
            alertsService.triggerAlert(`High ${type.toUpperCase()} Alert`, msg);
          }
        } else {
          alertConsecutiveTicks[type] = 0;
        }
      };

      checkThreshold('cpu', metrics.cpu, thresholds.cpuPercent);
      checkThreshold('ram', (metrics.ramUsed / metrics.ramTotal) * 100 || 0, thresholds.ramPercent);
      checkThreshold('disk', (metrics.diskUsed / metrics.diskTotal) * 100 || 0, thresholds.diskPercent);
    },
    60000, // every 60 seconds
    false
  );

  logger.info('Monitor job started');
};
