import express from 'express';
import pluginsController from './plugins.controller.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';

const router = express.Router();

router.use(requireAuth);

router.get('/', requirePermission('system', 'read'), pluginsController.getPlugins);
router.get('/marketplace', requirePermission('system', 'read'), pluginsController.getMarketplace);
router.post('/upload', requirePermission('system', 'execute'), pluginsController.uploadPlugin);
router.post('/install', requirePermission('system', 'execute'), pluginsController.installPlugin);
router.post('/uninstall', requirePermission('system', 'execute'), pluginsController.uninstallPlugin);
router.post('/proxy', requirePermission('system', 'execute'), pluginsController.updateProxy);
router.post('/update', requirePermission('system', 'execute'), pluginsController.updatePlugin);
router.post('/update-all', requirePermission('system', 'execute'), pluginsController.updateAllPlugins);
router.post('/check-updates', requirePermission('system', 'execute'), pluginsController.checkUpdates);
router.post('/policy', requirePermission('system', 'execute'), pluginsController.updatePolicy);
router.get('/process/:processId', requirePermission('system', 'read'), pluginsController.getProcessStatus);

export default router;
