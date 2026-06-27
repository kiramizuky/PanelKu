import { Router } from 'express';
import systemController from './system.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { RESOURCES, ACTIONS } from '../../config/constants.js';

const router = Router();
router.use(authenticate);

// Read endpoints - only require READ permission
router.get('/services', rbac(RESOURCES.SYSTEM, ACTIONS.READ), systemController.getServicesStatus.bind(systemController));
router.get('/services/status', rbac(RESOURCES.SYSTEM, ACTIONS.READ), systemController.getServicesStatus.bind(systemController));
router.get('/check-install', rbac(RESOURCES.SYSTEM, ACTIONS.READ), systemController.getInstallStatus.bind(systemController));
router.get('/auto-update', rbac(RESOURCES.SYSTEM, ACTIONS.READ), systemController.getAutoUpdate.bind(systemController));

// Write/execute endpoints - require EXECUTE permission
router.post('/services/manage', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), systemController.manageService.bind(systemController));
router.post('/install', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), systemController.installPackage.bind(systemController));
router.post('/apt/update', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), systemController.runAptUpdate.bind(systemController));
router.post('/apt/upgrade', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), systemController.runAptUpgrade.bind(systemController));
router.post('/reboot', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), systemController.reboot.bind(systemController));
router.post('/auto-update', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), systemController.setAutoUpdate.bind(systemController));

export default router;

