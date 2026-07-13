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

const router = Router();


// Health check
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
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

export default router;
