import { Router } from 'express';
import databaseController from './database.controller.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';

const router = Router();

router.use(requireAuth);

router.get('/', requirePermission('database:read'), databaseController.getDatabases);
router.post('/', requirePermission('database:write'), databaseController.createDatabase);
router.delete('/', requirePermission('database:delete'), databaseController.deleteDatabase);

router.get('/explore', requirePermission('database:read'), databaseController.getTables.bind(databaseController));
router.post('/explore', requirePermission('database:write'), databaseController.runQuery.bind(databaseController));

export default router;
