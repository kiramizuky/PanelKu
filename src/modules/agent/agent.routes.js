import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { RESOURCES, ACTIONS } from '../../config/constants.js';
import dashboardService from '../dashboard/dashboard.service.js';
import { success, error } from '../../helpers/response.js';
import appConfig from '../../config/app.js';
import logger from '../../config/logger.js';

/**
 * Agent API — Endpoints specifically exposed for Cluster Node remote access.
 *
 * Authentication: X-API-Key header only.
 * Requires SYSTEM:READ permission (or super_admin bypass).
 * This ensures a read_only user with an API key cannot access agent endpoints.
 */
const router = Router();

// All agent routes require API key auth
router.use(authenticate);
router.use(rbac(RESOURCES.SYSTEM, ACTIONS.READ));

/**
 * GET /api/agent/health
 * Minimal health probe used by master panel to ping this node.
 * Returns version + status so master can display node info.
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'online',
    panel: appConfig.appName || 'Panelku',
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

/**
 * POST /api/agent/exec
 * Execute remote maintenance command from Master Panel
 */
router.post('/exec', async (req, res) => {
  const { command, timeout = 30000 } = req.body;
  if (!command || typeof command !== 'string') {
    return error(res, 'Command is required', 400);
  }

  const { exec } = await import('child_process');
  const safeTimeout = Math.min(Math.max(parseInt(timeout, 10) || 30000, 1000), 60000);

  exec(command, { timeout: safeTimeout, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
    const exitCode = err ? (err.code ?? 1) : 0;
    return success(res, {
      stdout: stdout ? stdout.toString() : '',
      stderr: stderr ? stderr.toString() : (err ? err.message : ''),
      exitCode,
      success: exitCode === 0,
      timestamp: new Date().toISOString(),
    }, 'Command executed');
  });
});

/**
 * GET /api/agent/processes
 * Inspect top running processes on this agent node
 */
router.get('/processes', async (req, res) => {
  const isWindows = process.platform === 'win32';
  const { exec } = await import('child_process');
  const cmd = isWindows
    ? 'tasklist /FO CSV /NH'
    : 'ps -eo pid,user,%cpu,%mem,comm --sort=-%cpu | head -n 25';

  exec(cmd, { timeout: 5000 }, (err, stdout) => {
    if (err) {
      return error(res, 'Failed to fetch processes', 500);
    }
    const lines = (stdout || '').trim().split('\n');
    const processes = lines.slice(0, 20).map(l => l.trim()).filter(Boolean);
    return success(res, { processes, count: processes.length }, 'Process list retrieved');
  });
});

export default router;
