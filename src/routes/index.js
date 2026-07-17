import { Router } from 'express';
import authRoutes from '../modules/auth/auth.routes.js';
import usersRoutes from '../modules/users/users.routes.js';
import rolesRoutes from '../modules/roles/roles.routes.js';
import dashboardRoutes from '../modules/dashboard/dashboard.routes.js';
import monitorRoutes from '../modules/monitor/monitor.routes.js';
import terminalRoutes from '../modules/terminal/terminal.routes.js';
import fileManagerRoutes from '../modules/filemanager/filemanager.routes.js';
import dockerRoutes from '../modules/docker/docker.routes.js';
import websitesRoutes from '../modules/websites/websites.routes.js';
import sslRoutes from '../modules/ssl/ssl.routes.js';
import databaseRoutes from '../modules/database/database.routes.js';
import backupRoutes from '../modules/backup/backup.routes.js';
import cronRoutes from '../modules/cron/cron.routes.js';
import firewallRoutes from '../modules/firewall/firewall.routes.js';
import systemRoutes from '../modules/system/system.routes.js';
import wafRoutes from '../modules/waf/waf.routes.js';
import alertsRoutes from '../modules/alerts/alerts.routes.js';
import dnsRoutes from '../modules/dns/dns.routes.js';
import pluginsRoutes from '../modules/plugins/plugins.routes.js';
import whatsappRoutes from '../modules/whatsapp/whatsapp.routes.js';
import clusterRoutes from '../modules/cluster/cluster.routes.js';
import aiRoutes from '../modules/ai/ai.routes.js';
import agentRoutes from '../modules/agent/agent.routes.js';
import apiDocsRoutes from '../modules/api-docs/api-docs.routes.js';
import nodejsRoutes from '../modules/nodejs/nodejs.routes.js';
import pythonRoutes from '../modules/python/python.routes.js';
import mongodbRoutes from '../modules/mongodb/mongodb.routes.js';
import redisRoutes from '../modules/redis/redis.routes.js';
import apacheRoutes from '../modules/apache/apache.routes.js';
import analyticsRoutes from '../modules/analytics/analytics.routes.js';
import autohealRoutes from '../modules/autoheal/autoheal.routes.js';
import updaterRoutes from '../modules/updater/updater.routes.js';
import caddyRoutes from '../modules/caddy/caddy.routes.js';
import aiRepairRoutes from '../modules/ai-repair/ai-repair.routes.js';
import gpuRoutes from '../modules/gpu/gpu.routes.js';
import powerRoutes from '../modules/power/power.routes.js';
import mailRoutes from '../modules/mail/mail.routes.js';
import cdnRoutes from '../modules/cdn/cdn.routes.js';
import iotRoutes from '../modules/iot/iot.routes.js';

const router = Router();


// Health check — public endpoint, no auth required
// Used by monitoring tools and cluster master panels for basic ping
router.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'ok',
    panel: 'Panelku',
    version: process.env.npm_package_version || '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// API routes
router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/roles', rolesRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/monitor', monitorRoutes);
router.use('/terminal', terminalRoutes);
router.use('/filemanager', fileManagerRoutes);
router.use('/docker', dockerRoutes);
router.use('/websites', websitesRoutes);
router.use('/ssl', sslRoutes);
router.use('/database', databaseRoutes);
router.use('/backup', backupRoutes);
router.use('/cron', cronRoutes);
router.use('/firewall', firewallRoutes);
router.use('/system', systemRoutes);
router.use('/waf', wafRoutes);
router.use('/alerts', alertsRoutes);
router.use('/dns', dnsRoutes);
router.use('/plugins', pluginsRoutes);
router.use('/whatsapp', whatsappRoutes);
router.use('/cluster', clusterRoutes);
router.use('/ai', aiRoutes);
router.use('/agent', agentRoutes);  // Cluster agent API — accessible via X-API-Key
router.use('/nodejs', nodejsRoutes);
router.use('/python', pythonRoutes);
router.use('/mongodb', mongodbRoutes);
router.use('/redis', redisRoutes);
router.use('/apache', apacheRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/autoheal', autohealRoutes);
router.use('/updater', updaterRoutes);
router.use('/caddy', caddyRoutes);
router.use('/ai-repair', aiRepairRoutes);
router.use('/gpu', gpuRoutes);
router.use('/power', powerRoutes);
router.use('/mail', mailRoutes);
router.use('/cdn', cdnRoutes);
router.use('/iot', iotRoutes);

// API Documentation (mounted under /api prefix)
router.use('/api-docs', apiDocsRoutes);

export default router;
