import { Router } from 'express';
import firewallController from './firewall.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { RESOURCES, ACTIONS } from '../../config/constants.js';

const router = Router();
router.use(authenticate);
// Ensure only super admin or roles with explicit EXECUTE permission on SYSTEM can manage firewall
router.use(rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE));

router.get('/status', firewallController.getStatus.bind(firewallController));
router.post('/toggle', firewallController.toggleStatus.bind(firewallController));
router.post('/rules', firewallController.addRule.bind(firewallController));
router.delete('/rules/:id', firewallController.deleteRule.bind(firewallController));

export default router;
