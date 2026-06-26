import { Router } from 'express';
import backupController from './backup.controller.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';

const router = Router();

router.use(requireAuth);

router.get('/', requirePermission('backups', 'read'), backupController.getBackups);
router.post('/', requirePermission('backups', 'create'), backupController.createBackup);
router.delete('/', requirePermission('backups', 'delete'), backupController.deleteBackup);
router.post('/restore', requirePermission('backups', 'execute'), backupController.restoreBackup);

export default router;
