import { Router } from 'express';
import analyticsController from './analytics.controller.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { RESOURCES, ACTIONS } from '../../config/constants.js';

const router = Router();

router.use(requireAuth);
router.use(requirePermission(RESOURCES.DASHBOARD, ACTIONS.READ));

// ── Metrics History ──
router.get('/metrics/history', analyticsController.getMetricsHistory.bind(analyticsController));
router.get('/metrics/realtime', analyticsController.getRealtimeMetrics.bind(analyticsController));

// ── Logs ──
router.get('/logs/system', analyticsController.getSystemLogs.bind(analyticsController));
router.get('/logs/web', analyticsController.getWebLogs.bind(analyticsController));

// ── Services ──
router.get('/services', analyticsController.getServiceHealth.bind(analyticsController));

// ── Processes ──
router.get('/processes', analyticsController.getTopProcesses.bind(analyticsController));

// ── Network ──
router.get('/network', analyticsController.getNetworkAnalytics.bind(analyticsController));

// ── Docker ──
router.get('/docker', analyticsController.getDockerAnalytics.bind(analyticsController));

export default router;
