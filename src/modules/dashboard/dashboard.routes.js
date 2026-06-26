import { Router } from 'express';
import dashboardController from './dashboard.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { RESOURCES, ACTIONS } from '../../config/constants.js';

const router = Router();
router.use(authenticate);
router.use(rbac(RESOURCES.DASHBOARD, ACTIONS.READ));

router.get('/metrics', dashboardController.getMetrics.bind(dashboardController));
router.get('/info', dashboardController.getServerInfo.bind(dashboardController));

export default router;
