import { Router } from 'express';
import aiController from './ai.controller.js';
import { authenticate } from '../../middleware/auth.js';

const router = Router();

router.use(authenticate);

router.post('/chat', aiController.chat.bind(aiController));

export default router;
