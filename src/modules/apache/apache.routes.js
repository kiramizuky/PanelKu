import { Router } from 'express';
import apacheController from './apache.controller.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { RESOURCES, ACTIONS } from '../../config/constants.js';

const router = Router();

router.use(requireAuth);
router.use(requirePermission(RESOURCES.APACHE, ACTIONS.EXECUTE));

// ── Status & Install ──
router.get('/status',              apacheController.getStatus.bind(apacheController));
router.post('/install',            apacheController.install.bind(apacheController));
router.post('/uninstall',          apacheController.uninstall.bind(apacheController));

// ── Service Control ──
router.post('/service',            apacheController.serviceAction.bind(apacheController));
router.get('/configtest',          apacheController.testConfig.bind(apacheController));

// ── Modules ──
router.get('/modules',             apacheController.getModules.bind(apacheController));
router.post('/modules/enable',     apacheController.enableModule.bind(apacheController));
router.post('/modules/disable',    apacheController.disableModule.bind(apacheController));

// ── Virtual Hosts ──
router.get('/vhosts',              apacheController.getVhosts.bind(apacheController));
router.get('/vhosts/:name',        apacheController.getVhost.bind(apacheController));
router.post('/vhosts',             apacheController.createVhost.bind(apacheController));
router.put('/vhosts/:name',        apacheController.updateVhost.bind(apacheController));
router.delete('/vhosts/:name',     apacheController.deleteVhost.bind(apacheController));
router.post('/vhosts/toggle',      apacheController.toggleVhost.bind(apacheController));

// ── Config ──
router.get('/config',              apacheController.getConfig.bind(apacheController));
router.put('/config',              apacheController.saveConfig.bind(apacheController));

// ── Logs ──
router.get('/logs',                apacheController.getLogs.bind(apacheController));

export default router;
