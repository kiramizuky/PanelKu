import { Router } from 'express';
import tasksController from './tasks.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { RESOURCES, ACTIONS } from '../../config/constants.js';

const router = Router();
router.use(authenticate);

router.get('/', rbac(RESOURCES.SYSTEM, ACTIONS.READ), tasksController.getAllTasks.bind(tasksController));
router.get('/metrics', rbac(RESOURCES.SYSTEM, ACTIONS.READ), tasksController.getQueueMetrics.bind(tasksController));
router.get('/:queueName/:jobId', rbac(RESOURCES.SYSTEM, ACTIONS.READ), tasksController.getTask.bind(tasksController));
router.post('/:queueName/:jobId/cancel', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), tasksController.cancelTask.bind(tasksController));
router.delete('/:queueName/:jobId', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), tasksController.cancelTask.bind(tasksController));

export default router;
