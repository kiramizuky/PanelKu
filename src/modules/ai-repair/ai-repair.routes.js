import { Router } from 'express';
import aiRepairController from './ai-repair.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { RESOURCES, ACTIONS } from '../../config/constants.js';

const router = Router();
router.use(authenticate);
router.use(rbac(RESOURCES.AI, ACTIONS.EXECUTE));

// ── Configuration ──
router.get('/config', aiRepairController.getConfig.bind(aiRepairController));
router.post('/config', aiRepairController.saveConfig.bind(aiRepairController));

// ── Log Analysis ──
router.post('/analyze', aiRepairController.analyzeLog.bind(aiRepairController));
router.post('/suggest-fix', aiRepairController.suggestFix.bind(aiRepairController));

// ── Auto Diagnostic & Health ──
router.get('/diagnostic', aiRepairController.runDiagnostic.bind(aiRepairController));
router.get('/health-score', aiRepairController.getHealthScore.bind(aiRepairController));

// ── Auto-Fix ──
router.get('/fix-patterns', aiRepairController.getFixPatterns.bind(aiRepairController));
router.get('/fix-suggestions', aiRepairController.getFixSuggestions.bind(aiRepairController));
router.post('/apply-fix', aiRepairController.applyFix.bind(aiRepairController));

// ── Predictive Alerts ──
router.get('/trends', aiRepairController.analyzeTrends.bind(aiRepairController));

export default router;
