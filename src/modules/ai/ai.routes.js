import { Router } from 'express';
import aiController from './ai.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { RESOURCES, ACTIONS } from '../../config/constants.js';

const router = Router();

router.use(authenticate);
router.use(rbac(RESOURCES.AI, ACTIONS.EXECUTE));

router.post('/chat', aiController.chat.bind(aiController));

export default router;
