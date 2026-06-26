import { Router } from 'express';
import monitorController from './monitor.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { RESOURCES, ACTIONS } from '../../config/constants.js';

const router = Router();
router.use(authenticate);
router.use(rbac(RESOURCES.MONITOR, ACTIONS.READ));

router.get('/current', monitorController.getCurrent.bind(monitorController));
router.get('/metrics', monitorController.getMetrics.bind(monitorController));
router.get('/sysinfo', monitorController.getSysInfo.bind(monitorController));
router.get('/history', monitorController.getHistory.bind(monitorController));
router.get('/disk', monitorController.getDiskHealth.bind(monitorController));
router.get('/network', monitorController.getNetworkStats.bind(monitorController));

export default router;
