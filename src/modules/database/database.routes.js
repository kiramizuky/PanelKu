import { Router } from 'express';
import databaseController from './database.controller.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';

const router = Router();

router.use(requireAuth);

router.get('/', requirePermission('database:read'), databaseController.getDatabases);
router.post('/', requirePermission('database:write'), databaseController.createDatabase);
router.delete('/', requirePermission('database:delete'), databaseController.deleteDatabase);

export default router;
