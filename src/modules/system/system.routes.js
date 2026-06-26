import { Router } from 'express';
import systemController from './system.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { RESOURCES, ACTIONS } from '../../config/constants.js';

const router = Router();
router.use(authenticate);
// Ensure only super admin or roles with explicit EXECUTE permission on SYSTEM can manage OS
router.use(rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE));

router.get('/services', systemController.getServicesStatus.bind(systemController));
router.post('/services/manage', systemController.manageService.bind(systemController));

router.get('/check-install', systemController.getInstallStatus.bind(systemController));
router.post('/install', systemController.installPackage.bind(systemController));
router.post('/apt/update', systemController.runAptUpdate.bind(systemController));
router.post('/apt/upgrade', systemController.runAptUpgrade.bind(systemController));
router.post('/reboot', systemController.reboot.bind(systemController));
router.get('/auto-update', systemController.getAutoUpdate.bind(systemController));
router.post('/auto-update', systemController.setAutoUpdate.bind(systemController));

export default router;
