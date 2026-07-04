import express from 'express';
import pluginsController from './plugins.controller.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';

const router = express.Router();

router.use(requireAuth);

router.get('/', requirePermission('system', 'read'), pluginsController.getPlugins);
router.post('/install', requirePermission('system', 'execute'), pluginsController.installPlugin);
router.post('/uninstall', requirePermission('system', 'execute'), pluginsController.uninstallPlugin);
router.post('/proxy', requirePermission('system', 'execute'), pluginsController.updateProxy);

export default router;
