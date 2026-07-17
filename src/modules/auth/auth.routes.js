import { Router } from 'express';
import authController from './auth.controller.js';
import ssoController from './sso.controller.js';
import ldapController from './ldap.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { authLimiter } from '../../middleware/rateLimiter.js';

const router = Router();

// ── Existing auth routes ──
router.post('/login', authLimiter, authController.login.bind(authController));
router.post('/2fa/verify', authLimiter, authController.verifyTwoFactor.bind(authController));
router.post('/refresh', authLimiter, authController.refresh.bind(authController));

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

// ── SSO Routes ──
// SSO config (authenticated)
router.get('/sso/config', ssoController.getConfig.bind(ssoController));
router.post('/sso/config', ssoController.saveConfig.bind(ssoController));

// SSO authorize & callback (public)
router.get('/sso/:provider/authorize', authLimiter, ssoController.authorize.bind(ssoController));
router.get('/sso/:provider/callback', authLimiter, ssoController.callback.bind(ssoController));

// ── LDAP Routes ──
router.get('/ldap/config', ldapController.getConfig.bind(ldapController));
router.post('/ldap/config', ldapController.saveConfig.bind(ldapController));
router.post('/ldap/test', ldapController.testConnection.bind(ldapController));
router.post('/ldap/login', authLimiter, ldapController.login.bind(ldapController));

export default router;
