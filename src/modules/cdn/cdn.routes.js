import { Router } from 'express';
import cdnController from './cdn.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { RESOURCES, ACTIONS } from '../../config/constants.js';

const router = Router();
router.use(authenticate);

// Cloudflare
router.post('/cloudflare/zones', rbac(RESOURCES.SYSTEM, ACTIONS.READ), cdnController.cfGetZones.bind(cdnController));
router.post('/cloudflare/purge', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), cdnController.cfPurgeAll.bind(cdnController));
router.post('/cloudflare/purge-urls', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), cdnController.cfPurgeUrls.bind(cdnController));
router.post('/cloudflare/analytics', rbac(RESOURCES.SYSTEM, ACTIONS.READ), cdnController.cfAnalytics.bind(cdnController));

// Varnish
router.get('/varnish/status', rbac(RESOURCES.SYSTEM, ACTIONS.READ), cdnController.varnishStatus.bind(cdnController));
router.post('/varnish/control', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), cdnController.varnishControl.bind(cdnController));
router.get('/varnish/config', rbac(RESOURCES.SYSTEM, ACTIONS.READ), cdnController.varnishConfig.bind(cdnController));
router.post('/varnish/config', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), cdnController.varnishSaveConfig.bind(cdnController));
router.post('/varnish/purge', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), cdnController.varnishPurge.bind(cdnController));

// Redis Cache
router.get('/redis', rbac(RESOURCES.SYSTEM, ACTIONS.READ), cdnController.redisCacheInfo.bind(cdnController));
router.post('/redis/flush', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), cdnController.redisFlush.bind(cdnController));

// Full Page Cache
router.get('/fpc', rbac(RESOURCES.SYSTEM, ACTIONS.READ), cdnController.fpcStatus.bind(cdnController));
router.post('/fpc/flush', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), cdnController.fpcFlush.bind(cdnController));

export default router;
