import { Router } from 'express';
import rolesController from './roles.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { RESOURCES, ACTIONS } from '../../config/constants.js';

const router = Router();
router.use(authenticate);

router.get('/resources', rolesController.getAvailableResources.bind(rolesController));
router.get('/', rbac(RESOURCES.ROLES, ACTIONS.READ), rolesController.list.bind(rolesController));
router.get('/:id', rbac(RESOURCES.ROLES, ACTIONS.READ), rolesController.getById.bind(rolesController));
router.post('/', rbac(RESOURCES.ROLES, ACTIONS.CREATE), rolesController.create.bind(rolesController));
router.put('/:id', rbac(RESOURCES.ROLES, ACTIONS.UPDATE), rolesController.update.bind(rolesController));
router.put('/:id/permissions', rbac(RESOURCES.ROLES, ACTIONS.UPDATE), rolesController.updatePermissions.bind(rolesController));
router.delete('/:id', rbac(RESOURCES.ROLES, ACTIONS.DELETE), rolesController.delete.bind(rolesController));

export default router;
