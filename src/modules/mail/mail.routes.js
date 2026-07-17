import { Router } from 'express';
import mailController from './mail.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { RESOURCES, ACTIONS } from '../../config/constants.js';

const router = Router();
router.use(authenticate);

router.get('/status', rbac(RESOURCES.SYSTEM, ACTIONS.READ), mailController.getStatus.bind(mailController));
router.post('/install', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), mailController.install.bind(mailController));
router.post('/uninstall', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), mailController.uninstall.bind(mailController));
router.post('/control', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), mailController.controlService.bind(mailController));

router.get('/domains', rbac(RESOURCES.SYSTEM, ACTIONS.READ), mailController.getDomains.bind(mailController));
router.post('/domains', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), mailController.addDomain.bind(mailController));
router.delete('/domains', rbac(RESOURCES.SYSTEM, ACTIONS.DELETE), mailController.removeDomain.bind(mailController));

router.get('/accounts', rbac(RESOURCES.SYSTEM, ACTIONS.READ), mailController.getAccounts.bind(mailController));
router.post('/accounts', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), mailController.addAccount.bind(mailController));
router.delete('/accounts', rbac(RESOURCES.SYSTEM, ACTIONS.DELETE), mailController.deleteAccount.bind(mailController));
router.post('/accounts/password', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), mailController.updatePassword.bind(mailController));

router.get('/queue', rbac(RESOURCES.SYSTEM, ACTIONS.READ), mailController.getQueue.bind(mailController));
router.post('/queue/flush', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), mailController.flushQueue.bind(mailController));
router.delete('/queue', rbac(RESOURCES.SYSTEM, ACTIONS.DELETE), mailController.deleteFromQueue.bind(mailController));

router.get('/spam', rbac(RESOURCES.SYSTEM, ACTIONS.READ), mailController.getSpamConfig.bind(mailController));
router.post('/spam', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), mailController.updateSpamConfig.bind(mailController));

router.get('/ssl', rbac(RESOURCES.SYSTEM, ACTIONS.READ), mailController.getSslInfo.bind(mailController));
router.get('/logs', rbac(RESOURCES.SYSTEM, ACTIONS.READ), mailController.getLogs.bind(mailController));

export default router;
