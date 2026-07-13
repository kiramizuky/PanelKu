import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import dashboardService from '../dashboard/dashboard.service.js';
import { success, error } from '../../helpers/response.js';
import appConfig from '../../config/app.js';
import logger from '../../config/logger.js';

/**
 * Agent API — Endpoints specifically exposed for Cluster Node remote access.
 *
 * Authentication: X-API-Key header only.
 * Does NOT require RBAC — any valid user with an active API key can access.
 * This is intentional: the API key owner controls what master panels can see.
 */
const router = Router();

// All agent routes require API key auth
router.use(authenticate);

/**
 * GET /api/agent/health
 * Minimal health probe used by master panel to ping this node.
 * Returns version + status so master can display node info.
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'online',
    panel: appConfig.appName || 'LinuxPanel',
    version: process.env.npm_package_version || '1.0.0',
    timestamp: new Date().toISOString(),
    node: process.version,
  });
});

/**
 * GET /api/agent/metrics
 * Returns full system metrics (CPU, RAM, Disk, Network, System info).
 * Consumed by master panel cluster cards.
 */
router.get('/metrics', async (req, res) => {
  try {
    const data = await dashboardService.getMetrics();
    return success(res, data, 'Metrics retrieved');
  } catch (err) {
    logger.error('Agent metrics error:', err.message);
    return error(res, 'Failed to retrieve metrics', 500);
  }
});

/**
 * GET /api/agent/info
 * Returns server info: hostname, OS, uptime.
 */
router.get('/info', async (req, res) => {
  try {
    const data = await dashboardService.getServerInfo();
    return success(res, data, 'Server info retrieved');
  } catch (err) {
    logger.error('Agent info error:', err.message);
    return error(res, 'Failed to retrieve server info', 500);
  }
});

export default router;
