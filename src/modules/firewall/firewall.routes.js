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

// ── Modern nftables & Outbound Egress Filtering ──
router.get('/nftables', firewallController.getNftablesStatus.bind(firewallController));
router.post('/nftables/egress', firewallController.enableEgressFilter.bind(firewallController));
router.delete('/nftables/egress', firewallController.disableEgressFilter.bind(firewallController));
router.post('/nftables/ingress', firewallController.addNftIngressRule.bind(firewallController));

export default router;
