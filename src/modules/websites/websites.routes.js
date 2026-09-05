import { Router } from 'express';
import websitesController from './websites.controller.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';

const router = Router();

// Webhook deploy (public, uses token)
router.post('/:id/deploy/:token', websitesController.webhookDeploy);

// All websites endpoints require auth
router.use(requireAuth);

router.get('/', requirePermission('websites_manage', 'read'), websitesController.listWebsites);
router.post('/', requirePermission('websites_manage', 'create'), websitesController.createWebsite);
router.get('/:id', requirePermission('websites_manage', 'read'), websitesController.getWebsite);
router.put('/:id', requirePermission('websites_manage', 'update'), websitesController.updateWebsite);
router.delete('/:id', requirePermission('websites_manage', 'delete'), websitesController.deleteWebsite);
router.post('/:id/deploy', requirePermission('websites_manage', 'execute'), websitesController.deployGit);
router.get('/:id/nginx-config', requirePermission('websites_manage', 'read'), websitesController.getNginxConfig);
router.put('/:id/nginx-config', requirePermission('websites_manage', 'update'), websitesController.saveNginxConfig);
router.post('/:id/nginx-config/reset', requirePermission('websites_manage', 'update'), websitesController.resetNginxConfig);

export default router;
