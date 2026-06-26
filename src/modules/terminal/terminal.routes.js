import { Router } from 'express';
import terminalController from './terminal.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { RESOURCES, ACTIONS } from '../../config/constants.js';

const router = Router();
router.use(authenticate);
router.use(rbac(RESOURCES.TERMINAL, ACTIONS.EXECUTE));

router.post('/sessions', terminalController.create.bind(terminalController));
router.delete('/sessions/:sessionId', terminalController.kill.bind(terminalController));
router.get('/stats', terminalController.getStats.bind(terminalController));

export default router;
