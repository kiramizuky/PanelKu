import scheduler from '../core/scheduler/Scheduler.js';
import logger from '../config/logger.js';
import alertsService from '../modules/alerts/alerts.service.js';
import { getDb, fromJson } from '../core/db/sqlite.js';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

let dockerDownCount = 0;
let websiteDownCounts = {};

export const startHealthJob = () => {
  scheduler.register(
    'health:check',
    async () => {
      // 1. Check Docker Daemon
      try {
        await execPromise('docker info');
        dockerDownCount = 0;
      } catch (err) {
        dockerDownCount++;
        if (dockerDownCount === 2) {
          logger.warn('Docker daemon is down');
          alertsService.triggerAlert('Docker Down Alert', 'Docker daemon is unresponsive or not running on the server.');
        }
      }

      // 2. Check Websites and SSL
      try {
        const db = getDb();
        const websites = db.prepare("SELECT * FROM websites WHERE status = 'active'").all().map(row => ({
          id:            row.id,
          domain:       row.domain,
          ssl:          fromJson(row.ssl, {}),
          rootDirectory: row.root_directory,
        }));
        for (const site of websites) {
          // Website Health
          try {
            const proto = site.ssl && site.ssl.enabled ? 'https' : 'http';
            const url = `${proto}://${site.domain}`;
            const res = await fetch(url, { method: 'HEAD', timeout: 5000 });
            if (!res.ok && res.status >= 500) throw new Error(`HTTP ${res.status}`);
            websiteDownCounts[site.domain] = 0;
          } catch (err) {
            websiteDownCounts[site.domain] = (websiteDownCounts[site.domain] || 0) + 1;
            if (websiteDownCounts[site.domain] === 3) { // 15 mins down
              logger.warn(`Website ${site.domain} is down`);
              alertsService.triggerAlert('Website Down Alert', `Website ${site.domain} is unreachable or returning server errors.`);
            }
          }

          // SSL Expiration & Auto-Renewal
          if (site.ssl && site.ssl.enabled && site.ssl.expiresAt) {
            const now = new Date();
            const expires = new Date(site.ssl.expiresAt);
            const daysLeft = Math.floor((expires - now) / (1000 * 60 * 60 * 24));
            
            if (site.ssl.provider === 'letsencrypt' && daysLeft <= 30) {
              logger.info(`SSL for ${site.domain} is expiring in ${daysLeft} days. Triggering auto-renewal...`);
              try {
                const sslService = (await import('../modules/ssl/ssl.service.js')).default;
                await sslService.configureWebsiteSSL(site.id);
                logger.info(`SSL for ${site.domain} renewed successfully`);
              } catch (e) {
                logger.error(`SSL renewal failed for ${site.domain}: ${e.message}`);
              }
            } else if (daysLeft === 7 || daysLeft === 3 || daysLeft === 1) {
              logger.warn(`SSL for ${site.domain} expiring in ${daysLeft} days`);
              alertsService.triggerAlert('SSL Expiry Alert', `The SSL certificate for ${site.domain} will expire in ${daysLeft} days.`);
            }
          }
        }
      } catch (err) {
        logger.error('Failed to run website health checks', err);
      }
    },
    300000, // every 5 minutes
    false
  );

  logger.info('Health checking job started');
};
