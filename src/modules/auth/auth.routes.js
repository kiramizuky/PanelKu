import { Router } from 'express';
import authController from './auth.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { authLimiter } from '../../middleware/rateLimiter.js';

const router = Router();

// Public routes
router.post('/login', authLimiter, authController.login.bind(authController));
router.post('/2fa/verify', authLimiter, authController.verifyTwoFactor.bind(authController));
router.post('/refresh', authController.refresh.bind(authController));

// Protected routes
router.use(authenticate);
router.post('/logout', authController.logout.bind(authController));
router.post('/logout/all', authController.logoutAll.bind(authController));
router.delete('/sessions/:sessionId', authController.logoutSession.bind(authController));
router.get('/sessions', authController.getSessions.bind(authController));
router.get('/profile', authController.getProfile.bind(authController));
router.post('/2fa/setup', authController.setup2FA.bind(authController));
router.post('/2fa/enable', authController.enable2FA.bind(authController));
router.post('/2fa/disable', authController.disable2FA.bind(authController));

export default router;
