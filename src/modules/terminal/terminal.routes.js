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

// ── Terminal AI Copilot (Fase 3) ──
router.post('/copilot/generate', terminalController.generateCommand.bind(terminalController));
router.post('/copilot/explain', terminalController.explainCommand.bind(terminalController));

// ── Terminal Session Recordings (Asciinema v2 .cast) ──
router.get('/recordings', rbac(RESOURCES.TERMINAL, ACTIONS.READ), terminalController.listRecordings.bind(terminalController));
router.get('/recordings/:sessionId', rbac(RESOURCES.TERMINAL, ACTIONS.READ), terminalController.getRecording.bind(terminalController));

export default router;

