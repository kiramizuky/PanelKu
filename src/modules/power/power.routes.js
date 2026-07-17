import { Router } from 'express';
import powerController from './power.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { RESOURCES, ACTIONS } from '../../config/constants.js';

const router = Router();
router.use(authenticate);

// CPU
router.get('/cpu', rbac(RESOURCES.SYSTEM, ACTIONS.READ), powerController.getCpuInfo.bind(powerController));
router.post('/cpu/governor', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), powerController.setGovernor.bind(powerController));
router.post('/cpu/frequency', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), powerController.setFrequency.bind(powerController));

// Power profiles
router.get('/profiles', rbac(RESOURCES.SYSTEM, ACTIONS.READ), powerController.getPowerProfiles.bind(powerController));
router.post('/profiles', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), powerController.setPowerProfile.bind(powerController));

// Suspend / Hibernate
router.post('/suspend', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), powerController.suspend.bind(powerController));
router.post('/hibernate', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), powerController.hibernate.bind(powerController));
router.post('/hybrid-sleep', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), powerController.hybridSleep.bind(powerController));

// Thermal
router.get('/thermal', rbac(RESOURCES.SYSTEM, ACTIONS.READ), powerController.getThermalInfo.bind(powerController));

// Fans
router.get('/fans', rbac(RESOURCES.SYSTEM, ACTIONS.READ), powerController.getFanInfo.bind(powerController));
router.post('/fans', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), powerController.setFanSpeed.bind(powerController));

// Power stats
router.get('/stats', rbac(RESOURCES.SYSTEM, ACTIONS.READ), powerController.getPowerStats.bind(powerController));

export default router;
