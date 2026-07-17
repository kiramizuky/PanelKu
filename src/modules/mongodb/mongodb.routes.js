import { Router } from 'express';
import mongodbController from './mongodb.controller.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { RESOURCES, ACTIONS } from '../../config/constants.js';

const router = Router();

router.use(requireAuth);
router.use(requirePermission(RESOURCES.MONGODB, ACTIONS.EXECUTE));

// ---- Server ----
router.get('/status',      mongodbController.getStatus.bind(mongodbController));
router.get('/server-info', mongodbController.getServerInfo.bind(mongodbController));
router.post('/install',    mongodbController.install.bind(mongodbController));

// ---- Databases ----
router.get('/databases',               mongodbController.listDatabases.bind(mongodbController));
router.post('/databases',              mongodbController.createDatabase.bind(mongodbController));
router.delete('/databases/:name',      mongodbController.dropDatabase.bind(mongodbController));
router.get('/databases/:name/stats',   mongodbController.getDatabaseStats.bind(mongodbController));

// ---- Collections ----
router.get('/databases/:name/collections',               mongodbController.listCollections.bind(mongodbController));
router.delete('/databases/:db/collections/:collection',   mongodbController.dropCollection.bind(mongodbController));
router.get('/databases/:db/collections/:collection/documents', mongodbController.findDocuments.bind(mongodbController));

// ---- Users ----
router.get('/users',          mongodbController.listUsers.bind(mongodbController));
router.post('/users',         mongodbController.createUser.bind(mongodbController));
router.delete('/users/:username', mongodbController.dropUser.bind(mongodbController));

// ---- Query ----
router.post('/query', mongodbController.runQuery.bind(mongodbController));

// ---- Backup ----
router.post('/backup',  mongodbController.backup.bind(mongodbController));
router.post('/restore', mongodbController.restore.bind(mongodbController));

export default router;
