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
router.get('/s3', requirePermission('backups', 'read'), backupController.getS3Config.bind(backupController));
router.post('/s3', requirePermission('backups', 'create'), backupController.updateS3Config.bind(backupController));

export default router;
