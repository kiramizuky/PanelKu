import { Router } from 'express';
import nodejsController from './nodejs.controller.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { RESOURCES, ACTIONS } from '../../config/constants.js';

const router = Router();

router.use(requireAuth);
// Use EXECUTE permission for node management actions
router.use(requirePermission(RESOURCES.NODE, ACTIONS.EXECUTE));

// ---- Node.js Environment ----
router.get('/status',        nodejsController.getStatus.bind(nodejsController));
router.get('/info',          nodejsController.getNodeInfo.bind(nodejsController));

// ---- NVM Management ----
router.post('/nvm/install',  nodejsController.installNvm.bind(nodejsController));

// ---- Version Management ----
router.get('/versions/local',    nodejsController.getLocalVersions.bind(nodejsController));
router.get('/versions/remote',   nodejsController.getRemoteVersions.bind(nodejsController));
router.post('/versions/install',  nodejsController.installVersion.bind(nodejsController));
router.post('/versions/uninstall', nodejsController.uninstallVersion.bind(nodejsController));
router.post('/versions/default', nodejsController.setDefaultVersion.bind(nodejsController));
router.post('/versions/use',     nodejsController.useVersion.bind(nodejsController));

// ---- NPM Global Packages ----
router.get('/packages',              nodejsController.listGlobalPackages.bind(nodejsController));
router.post('/packages/install',     nodejsController.installGlobalPackage.bind(nodejsController));
router.post('/packages/uninstall',   nodejsController.uninstallGlobalPackage.bind(nodejsController));

// ---- PM2 Process Manager ----
router.get('/pm2',          nodejsController.getPm2List.bind(nodejsController));
router.post('/pm2/action',  nodejsController.pm2Action.bind(nodejsController));
router.get('/pm2/logs',     nodejsController.getPm2Logs.bind(nodejsController));
router.post('/pm2/start',   nodejsController.pm2Start.bind(nodejsController));

export default router;
