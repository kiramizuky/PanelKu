import { Router } from 'express';
import dockerController from './docker.controller.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';

const router = Router();

// All docker endpoints require auth and 'docker_manage' permission
router.use(requireAuth);
router.use(requirePermission('docker_manage', 'read'));

router.get('/summary', dockerController.getSummary);
router.get('/appstore', dockerController.getAppStore);
router.post('/appstore/install', requirePermission('docker_manage', 'execute'), dockerController.installAppTemplate);

router.get('/containers', dockerController.listContainers);
router.post('/containers', requirePermission('docker_manage', 'execute'), dockerController.createContainer);
router.get('/containers/:id', dockerController.getContainer);
router.get('/containers/:id/stats', dockerController.getContainerStats);
router.post('/containers/:id/resources', requirePermission('docker_manage', 'execute'), dockerController.updateContainerResources);
router.post('/containers/:id/start', requirePermission('docker_manage', 'execute'), dockerController.startContainer);
router.post('/containers/:id/stop', requirePermission('docker_manage', 'execute'), dockerController.stopContainer);
router.post('/containers/:id/restart', requirePermission('docker_manage', 'execute'), dockerController.restartContainer);
router.post('/containers/:id/kill', requirePermission('docker_manage', 'execute'), dockerController.killContainer);
router.delete('/containers/:id', requirePermission('docker_manage', 'delete'), dockerController.removeContainer);

router.get('/images/search', dockerController.searchImages);
router.get('/images', dockerController.listImages);
router.post('/images/prune', requirePermission('docker_manage', 'delete'), dockerController.pruneImages);
router.delete('/images/:id', requirePermission('docker_manage', 'delete'), dockerController.removeImage);

router.post('/compose', requirePermission('docker_manage', 'execute'), dockerController.deployCompose);

export default router;
