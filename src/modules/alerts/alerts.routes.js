import { Router } from 'express';
import alertsController from './alerts.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { RESOURCES, ACTIONS } from '../../config/constants.js';

const router = Router();
router.use(authenticate);

// ── WebPush (All authenticated users can subscribe/unsubscribe) ──
router.get('/webpush/vapid-public-key', alertsController.getVapidPublicKey.bind(alertsController));
router.post('/webpush/subscribe', alertsController.subscribeWebPush.bind(alertsController));
router.post('/webpush/unsubscribe', alertsController.unsubscribeWebPush.bind(alertsController));

// ── System Alert Config (System EXECUTE permission) ──
router.get('/config', rbac(RESOURCES.SYSTEM, ACTIONS.READ), alertsController.getConfig.bind(alertsController));
router.post('/config', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), alertsController.updateConfig.bind(alertsController));
router.post('/test', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), alertsController.testAlert.bind(alertsController));
router.post('/test/:channel', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), alertsController.testAlert.bind(alertsController));

export default router;

