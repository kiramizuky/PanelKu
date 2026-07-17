import { Router } from 'express';
import redisController from './redis.controller.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { RESOURCES, ACTIONS } from '../../config/constants.js';

const router = Router();

router.use(requireAuth);
router.use(requirePermission(RESOURCES.REDIS, ACTIONS.EXECUTE));

// ---- Server ----
router.get('/info',    redisController.getInfo.bind(redisController));
router.get('/stats',   redisController.getStats.bind(redisController));

// ---- Config ----
router.get('/config',        redisController.getConfig.bind(redisController));
router.post('/config',       redisController.setConfig.bind(redisController));

// ---- Keys ----
router.get('/keys',          redisController.scanKeys.bind(redisController));
router.get('/keys/:key',     redisController.getKeyValue.bind(redisController));
router.delete('/keys/:key',  redisController.deleteKey.bind(redisController));
router.post('/keys/:key/ttl', redisController.setKeyTtl.bind(redisController));

// ---- Operations ----
router.post('/flushdb',  redisController.flushDb.bind(redisController));
router.post('/flushall', redisController.flushAll.bind(redisController));
router.post('/save',     redisController.save.bind(redisController));
router.post('/bgsave',   redisController.bgsave.bind(redisController));

// ---- Clients ----
router.get('/clients',       redisController.getClients.bind(redisController));
router.post('/clients/kill', redisController.killClient.bind(redisController));

// ---- Slow Log ----
router.get('/slowlog', redisController.getSlowLog.bind(redisController));

export default router;
