import { Router } from 'express';
import autohealController from './autoheal.controller.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { RESOURCES, ACTIONS } from '../../config/constants.js';

const router = Router();

router.use(requireAuth);
router.use(requirePermission(RESOURCES.SYSTEM, ACTIONS.EXECUTE));

router.get('/config',   autohealController.getConfig.bind(autohealController));
router.post('/config',  autohealController.saveConfig.bind(autohealController));
router.get('/status',   autohealController.getStatus.bind(autohealController));
router.post('/check',   autohealController.runCheck.bind(autohealController));
router.post('/heal',    autohealController.healService.bind(autohealController));
router.get('/incidents', autohealController.getIncidents.bind(autohealController));

export default router;
