import { Router } from 'express';
import alertsController from './alerts.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { RESOURCES, ACTIONS } from '../../config/constants.js';

const router = Router();
router.use(authenticate);
// Ensure only super admin or roles with explicit EXECUTE permission on SYSTEM can manage alerts
router.use(rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE));

router.get('/config', alertsController.getConfig.bind(alertsController));
router.post('/config', alertsController.updateConfig.bind(alertsController));
router.post('/test', alertsController.testAlert.bind(alertsController));

export default router;
