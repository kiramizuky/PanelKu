import { Router } from 'express';
import dnsController from './dns.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { RESOURCES, ACTIONS } from '../../config/constants.js';

const router = Router();
router.use(authenticate);
router.use(rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE));

// ── Provider Configuration ──
router.get('/providers', dnsController.getProviders.bind(dnsController));
router.post('/providers/:provider', dnsController.saveProviderConfig.bind(dnsController));
router.post('/providers/:provider/test', dnsController.testProvider.bind(dnsController));

// ── Zones ──
router.get('/:provider/zones', dnsController.getZones.bind(dnsController));

// ── Records ──
router.get('/:provider/zones/:zoneId/records', dnsController.getRecords.bind(dnsController));
router.post('/:provider/zones/:zoneId/records', dnsController.createRecord.bind(dnsController));
router.put('/:provider/zones/:zoneId/records/:recordId', dnsController.updateRecord.bind(dnsController));
router.delete('/:provider/zones/:zoneId/records/:recordId', dnsController.deleteRecord.bind(dnsController));
router.post('/:provider/zones/:zoneId/bulk', dnsController.bulkUpdateRecords.bind(dnsController));

// ── DNSSEC ──
router.get('/:provider/zones/:zoneId/dnssec', dnsController.getDNSSECStatus.bind(dnsController));
router.post('/:provider/zones/:zoneId/dnssec/enable', dnsController.enableDNSSEC.bind(dnsController));
router.post('/:provider/zones/:zoneId/dnssec/disable', dnsController.disableDNSSEC.bind(dnsController));

// ── Dynamic DNS (DuckDNS, No-IP) ──
router.post('/:provider/dynamic', dnsController.updateDynamicDNS.bind(dnsController));

// ── Record Types Info ──
router.get('/record-types', dnsController.getRecordTypes.bind(dnsController));

export default router;
