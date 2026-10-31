/**
 * Panelku — Vulnerabilities Routes (v3.8.0)
 */

import { Router } from 'express';
import vulnerabilitiesController from './vulnerabilities.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { RESOURCES, ACTIONS } from '../../config/constants.js';

const router = Router();
router.use(authenticate);

// ── Overview & Statistics ──
router.get(
  '/summary',
  rbac(RESOURCES.VULNERABILITIES, ACTIONS.READ),
  vulnerabilitiesController.getSummary.bind(vulnerabilitiesController)
);

router.get(
  '/scans',
  rbac(RESOURCES.VULNERABILITIES, ACTIONS.READ),
  vulnerabilitiesController.getScans.bind(vulnerabilitiesController)
);

router.get(
  '/findings',
  rbac(RESOURCES.VULNERABILITIES, ACTIONS.READ),
  vulnerabilitiesController.getFindings.bind(vulnerabilitiesController)
);

// ── Scanning Execution ──
router.post(
  '/scan',
  rbac(RESOURCES.VULNERABILITIES, ACTIONS.EXECUTE),
  vulnerabilitiesController.startScan.bind(vulnerabilitiesController)
);

// ── Remediation Actions ──
router.post(
  '/remediate/:id',
  rbac(RESOURCES.VULNERABILITIES, ACTIONS.EXECUTE),
  vulnerabilitiesController.remediate.bind(vulnerabilitiesController)
);

router.post(
  '/ignore/:id',
  rbac(RESOURCES.VULNERABILITIES, ACTIONS.UPDATE),
  vulnerabilitiesController.ignoreFinding.bind(vulnerabilitiesController)
);

// ── AI Threat Intelligence ──
router.post(
  '/ask-ai',
  rbac(RESOURCES.VULNERABILITIES, ACTIONS.READ),
  vulnerabilitiesController.askAI.bind(vulnerabilitiesController)
);

// ── Export ──
router.get(
  '/export',
  rbac(RESOURCES.VULNERABILITIES, ACTIONS.READ),
  vulnerabilitiesController.exportReport.bind(vulnerabilitiesController)
);

export default router;

