import { Router } from 'express';
import clusterController from './cluster.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { RESOURCES, ACTIONS } from '../../config/constants.js';

const router = Router();

// ── Public / Token-Authenticated Agent Pairing Endpoints ─────
router.get('/install-script', clusterController.getInstallScript.bind(clusterController));
router.post('/register-token', clusterController.registerNodeByToken.bind(clusterController));

// ── Protected Cluster & Fleet Management Routes ──────────────
router.use(authenticate);
router.use(rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE));

router.get('/fleet-summary',            clusterController.getFleetSummary.bind(clusterController));
router.post('/pairing-token',           clusterController.generatePairingToken.bind(clusterController));
router.post('/exec',                    clusterController.executeCommand.bind(clusterController));

router.get('/nodes',                   clusterController.getNodes.bind(clusterController));
router.post('/nodes',                  clusterController.addNode.bind(clusterController));
router.delete('/nodes/:id',            clusterController.deleteNode.bind(clusterController));
router.post('/nodes/:id/ping',         clusterController.pingNode.bind(clusterController));
router.get('/nodes/:id/metrics',       clusterController.getNodeMetrics.bind(clusterController));

// ── K3s / MicroK8s Cluster Support (Fase 5) ──
router.get('/k8s/summary',             clusterController.getK8sSummary.bind(clusterController));

export default router;

