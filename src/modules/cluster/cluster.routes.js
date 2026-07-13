import { Router } from 'express';
import clusterController from './cluster.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { RESOURCES, ACTIONS } from '../../config/constants.js';

const router = Router();

router.use(authenticate);
router.use(rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE));

router.get('/nodes',                   clusterController.getNodes.bind(clusterController));
router.post('/nodes',                  clusterController.addNode.bind(clusterController));
router.delete('/nodes/:id',            clusterController.deleteNode.bind(clusterController));
router.post('/nodes/:id/ping',         clusterController.pingNode.bind(clusterController));
router.get('/nodes/:id/metrics',       clusterController.getNodeMetrics.bind(clusterController));

export default router;
