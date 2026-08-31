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

// ── CrowdSec Community Threat Intel & Bouncers ──
router.get('/crowdsec/status', wafController.getCrowdSecStatus.bind(wafController));
router.get('/crowdsec/decisions', wafController.getCrowdSecDecisions.bind(wafController));
router.post('/crowdsec/decisions', wafController.addCrowdSecDecision.bind(wafController));
router.delete('/crowdsec/decisions/:ip', wafController.deleteCrowdSecDecision.bind(wafController));
router.post('/crowdsec/sync', wafController.syncCrowdSecHub.bind(wafController));

// ── Honeypot Bot Traps & Hits ──
router.get('/honeypot/hits', wafController.getHoneypotHits.bind(wafController));
router.post('/honeypot/clear', wafController.clearHoneypotHits.bind(wafController));

// ── 1-Click System Hardening ──
router.post('/harden', wafController.applySystemHardening.bind(wafController));

export default router;


