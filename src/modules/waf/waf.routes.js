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

// ── Security Health & Vulnerability Scanner ──
router.get('/security/scan', wafController.getSecurityScan.bind(wafController));
router.post('/security/scan', wafController.runSecurityScan.bind(wafController));
router.post('/security/fix', wafController.fixSecurityIssue.bind(wafController));

// ── Real-time GeoIP Threat Map & Geo-Blocking ──
router.get('/threat-map', wafController.getThreatMap.bind(wafController));
router.post('/geo-block', wafController.blockCountry.bind(wafController));
router.delete('/geo-block/:code', wafController.unblockCountry.bind(wafController));

export default router;


