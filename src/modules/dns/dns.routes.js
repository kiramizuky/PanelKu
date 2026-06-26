import { Router } from 'express';
import dnsController from './dns.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { RESOURCES, ACTIONS } from '../../config/constants.js';

const router = Router();
router.use(authenticate);
// Reusing SYSTEM resource for DNS management
router.use(rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE));

router.get('/zones', dnsController.getZones.bind(dnsController));
router.get('/zones/:zoneId/records', dnsController.getRecords.bind(dnsController));
router.post('/zones/:zoneId/records', dnsController.createRecord.bind(dnsController));
router.delete('/zones/:zoneId/records/:recordId', dnsController.deleteRecord.bind(dnsController));

export default router;
