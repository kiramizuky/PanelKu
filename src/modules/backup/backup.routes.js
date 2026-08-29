import { Router } from 'express';
import backupController from './backup.controller.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';

const router = Router();

router.use(requireAuth);

// ── Rclone Management ──
router.get('/rclone',         requirePermission('backup', 'read'),    backupController.getRcloneStatus.bind(backupController));
router.post('/rclone/install', requirePermission('backup', 'execute'), backupController.installRclone.bind(backupController));
router.post('/rclone/test',   requirePermission('backup', 'execute'), backupController.testRemote.bind(backupController));
router.get('/rclone/files',   requirePermission('backup', 'read'),    backupController.listRemoteFiles.bind(backupController));

// ── Rclone Custom Config Path ──
router.get('/rclone/config-path',  requirePermission('backup', 'read'),    backupController.getRcloneConfigPath.bind(backupController));
router.post('/rclone/config-path',  requirePermission('backup', 'update'),  backupController.setRcloneConfigPath.bind(backupController));
router.post('/rclone/config-path/test', requirePermission('backup', 'execute'), backupController.testRcloneConfigPath.bind(backupController));

// ── Backup Jobs ──
router.get('/jobs',           requirePermission('backup', 'read'),    backupController.getBackupJobs.bind(backupController));
router.post('/jobs',          requirePermission('backup', 'create'),  backupController.createBackupJob.bind(backupController));
router.put('/jobs/:id',       requirePermission('backup', 'update'),  backupController.updateBackupJob.bind(backupController));
router.delete('/jobs/:id',    requirePermission('backup', 'delete'),  backupController.deleteBackupJob.bind(backupController));
router.post('/jobs/:id/run',  requirePermission('backup', 'execute'), backupController.runBackupJob.bind(backupController));

// ── Local Backups ──
router.get('/',               requirePermission('backup', 'read'),    backupController.getBackups.bind(backupController));
router.post('/',              requirePermission('backup', 'create'),  backupController.createBackup.bind(backupController));
router.delete('/',            requirePermission('backup', 'delete'),  backupController.deleteBackup.bind(backupController));
router.post('/restore',       requirePermission('backup', 'execute'), backupController.restoreBackup.bind(backupController));

// ── S3 Configuration ──
router.get('/s3',             requirePermission('backup', 'read'),    backupController.getS3Config.bind(backupController));
router.post('/s3',            requirePermission('backup', 'create'),  backupController.updateS3Config.bind(backupController));
router.post('/s3/test',       requirePermission('backup', 'execute'), backupController.testS3Connection.bind(backupController));
router.get('/s3/backups',     requirePermission('backup', 'read'),    backupController.listS3Backups.bind(backupController));
router.post('/s3/download',   requirePermission('backup', 'execute'), backupController.downloadFromS3.bind(backupController));

// ── Disaster Recovery: Remote Restore ──
router.get('/remote-backups', requirePermission('backup', 'read'),    backupController.listRemoteBackups.bind(backupController));
router.post('/remote-restore',requirePermission('backup', 'execute'), backupController.restoreFromRemote.bind(backupController));

// ── Instant Volume Snapshots & Rollback (Fase 4) ──
router.get('/snapshots',              requirePermission('backup', 'read'),    backupController.listSnapshots.bind(backupController));
router.post('/snapshots',             requirePermission('backup', 'create'),  backupController.createSnapshot.bind(backupController));
router.post('/snapshots/:id/rollback',requirePermission('backup', 'execute'), backupController.rollbackSnapshot.bind(backupController));
router.post('/snapshots/:id/verify',  requirePermission('backup', 'read'),    backupController.verifySnapshot.bind(backupController));
router.delete('/snapshots/:id',       requirePermission('backup', 'delete'),  backupController.deleteSnapshot.bind(backupController));

export default router;

