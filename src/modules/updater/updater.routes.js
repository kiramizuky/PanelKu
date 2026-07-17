import { Router } from 'express';
import updaterController from './updater.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { RESOURCES, ACTIONS } from '../../config/constants.js';

const router = Router();
router.use(authenticate);

// ── Version & Update Check ──
router.get('/version', rbac(RESOURCES.SYSTEM, ACTIONS.READ), updaterController.getVersionInfo.bind(updaterController));
router.get('/check', rbac(RESOURCES.SYSTEM, ACTIONS.READ), updaterController.checkForUpdates.bind(updaterController));
router.get('/changelog', rbac(RESOURCES.SYSTEM, ACTIONS.READ), updaterController.getChangelog.bind(updaterController));
router.get('/diff', rbac(RESOURCES.SYSTEM, ACTIONS.READ), updaterController.getDiffPreview.bind(updaterController));

// ── Update Actions ──
router.post('/update', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), updaterController.performUpdate.bind(updaterController));
router.post('/dry-run', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), updaterController.dryRunUpdate.bind(updaterController));

// ── Rollback ──
router.post('/rollback', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), updaterController.performRollback.bind(updaterController));

// ── Restart ──
router.post('/restart', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), updaterController.restartPanel.bind(updaterController));

// ── Health Check ──
router.get('/health', rbac(RESOURCES.SYSTEM, ACTIONS.READ), updaterController.runHealthCheck.bind(updaterController));

// ── History ──
router.get('/history', rbac(RESOURCES.SYSTEM, ACTIONS.READ), updaterController.getUpdateHistory.bind(updaterController));
router.delete('/history', rbac(RESOURCES.SYSTEM, ACTIONS.DELETE), updaterController.clearUpdateHistory.bind(updaterController));

// ── Backups ──
router.get('/backups', rbac(RESOURCES.SYSTEM, ACTIONS.READ), updaterController.listBackups.bind(updaterController));
router.post('/backups', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), updaterController.createBackup.bind(updaterController));

// ── Schedule ──
router.get('/schedule', rbac(RESOURCES.SYSTEM, ACTIONS.READ), updaterController.getScheduleConfig.bind(updaterController));
router.post('/schedule', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), updaterController.setScheduleConfig.bind(updaterController));

export default router;
