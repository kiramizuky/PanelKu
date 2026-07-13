import { Router } from 'express';
import usersController from './users.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { RESOURCES, ACTIONS } from '../../config/constants.js';

const router = Router();

router.use(authenticate);

router.get('/', rbac(RESOURCES.USERS, ACTIONS.READ), usersController.list.bind(usersController));
router.get('/:id', rbac(RESOURCES.USERS, ACTIONS.READ), usersController.getById.bind(usersController));
router.post('/', rbac(RESOURCES.USERS, ACTIONS.CREATE), usersController.create.bind(usersController));
router.put('/:id', rbac(RESOURCES.USERS, ACTIONS.UPDATE), usersController.update.bind(usersController));
router.delete('/:id', rbac(RESOURCES.USERS, ACTIONS.DELETE), usersController.delete.bind(usersController));
router.patch('/:id/toggle', rbac(RESOURCES.USERS, ACTIONS.UPDATE), usersController.toggleStatus.bind(usersController));

// Self-service (no admin required)
router.post('/me/password', usersController.changePassword.bind(usersController));
router.post('/me/api-key', usersController.regenerateApiKey.bind(usersController));
router.delete('/me/api-key', usersController.revokeApiKey.bind(usersController));
router.get('/me/ai', usersController.getAiSettings.bind(usersController));
router.put('/me/ai', usersController.updateAiSettings.bind(usersController));

export default router;
