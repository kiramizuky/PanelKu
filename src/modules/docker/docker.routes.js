import { Router } from 'express';
import dockerController from './docker.controller.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';

const router = Router();

// All docker endpoints require auth and 'docker_manage' permission
router.use(requireAuth);
router.use(requirePermission('docker_manage', 'read'));

router.get('/summary', dockerController.getSummary);
router.get('/containers', dockerController.listContainers);
router.get('/containers/:id', dockerController.getContainer);
router.post('/containers/:id/start', requirePermission('docker_manage', 'execute'), dockerController.startContainer);
router.post('/containers/:id/stop', requirePermission('docker_manage', 'execute'), dockerController.stopContainer);
router.post('/containers/:id/restart', requirePermission('docker_manage', 'execute'), dockerController.restartContainer);
router.post('/containers/:id/kill', requirePermission('docker_manage', 'execute'), dockerController.killContainer);
router.delete('/containers/:id', requirePermission('docker_manage', 'delete'), dockerController.removeContainer);

router.get('/images', dockerController.listImages);
router.delete('/images/:id', requirePermission('docker_manage', 'delete'), dockerController.removeImage);

export default router;
