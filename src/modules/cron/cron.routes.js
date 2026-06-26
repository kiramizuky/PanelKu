import { Router } from 'express';
import cronController from './cron.controller.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';

const router = Router();

router.use(requireAuth);

router.get('/', requirePermission('cron:read'), cronController.getTasks);
router.post('/', requirePermission('cron:write'), cronController.addTask);
router.delete('/:id', requirePermission('cron:delete'), cronController.deleteTask);
router.patch('/:id/toggle', requirePermission('cron:write'), cronController.toggleTask);

export default router;
