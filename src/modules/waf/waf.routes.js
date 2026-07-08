import { Router } from 'express';
import wafController from './waf.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { RESOURCES, ACTIONS } from '../../config/constants.js';

const router = Router();
router.use(authenticate);
// Ensure only super admin or roles with explicit EXECUTE permission on SYSTEM can manage WAF
router.use(rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE));

router.get('/rules', wafController.getRules.bind(wafController));
router.post('/rules', wafController.addRule.bind(wafController));
router.delete('/rules/:id', wafController.deleteRule.bind(wafController));
router.get('/fail2ban/logs', wafController.getFail2BanLogs.bind(wafController));

export default router;
