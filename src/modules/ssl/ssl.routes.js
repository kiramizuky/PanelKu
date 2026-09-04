import { Router } from 'express';
import sslController from './ssl.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { RESOURCES, ACTIONS } from '../../config/constants.js';

const router = Router();
router.use(authenticate);
router.use(rbac(RESOURCES.WEBSITES, ACTIONS.UPDATE));

router.get('/certificates', sslController.listCertificates.bind(sslController));
router.get('/details/:websiteId', sslController.getCertificate.bind(sslController));
router.post('/issue', sslController.issueCertificate.bind(sslController));
router.post('/renew/:websiteId', sslController.renewCertificate.bind(sslController));
router.post('/disable/:websiteId', sslController.disableCertificate.bind(sslController));

export default router;
