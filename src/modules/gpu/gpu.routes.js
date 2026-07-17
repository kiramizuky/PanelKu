import { Router } from 'express';
import gpuController from './gpu.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { RESOURCES, ACTIONS } from '../../config/constants.js';

const router = Router();
router.use(authenticate);

router.get('/status', rbac(RESOURCES.SYSTEM, ACTIONS.READ), gpuController.getStatus.bind(gpuController));
router.get('/processes', rbac(RESOURCES.SYSTEM, ACTIONS.READ), gpuController.getProcesses.bind(gpuController));
router.post('/kill', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), gpuController.killProcess.bind(gpuController));
router.post('/reset', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), gpuController.resetGpu.bind(gpuController));
router.post('/power-limit', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), gpuController.setPowerLimit.bind(gpuController));

export default router;
