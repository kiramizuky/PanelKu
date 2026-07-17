import { Router } from 'express';
import caddyController from './caddy.controller.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { RESOURCES, ACTIONS } from '../../config/constants.js';

const router = Router();

router.use(requireAuth);
router.use(requirePermission(RESOURCES.WEBSITES, ACTIONS.EXECUTE));

// ── Status & Install ──
router.get('/status',              caddyController.getStatus.bind(caddyController));
router.post('/install',            caddyController.install.bind(caddyController));
router.post('/uninstall',          caddyController.uninstall.bind(caddyController));

// ── Service Control ──
router.post('/service',            caddyController.serviceAction.bind(caddyController));

// ── Caddyfile Management ──
router.get('/caddyfile',           caddyController.getCaddyfile.bind(caddyController));
router.put('/caddyfile',           caddyController.saveCaddyfile.bind(caddyController));
router.post('/caddyfile/validate', caddyController.validateCaddyfile.bind(caddyController));
router.post('/caddyfile/format',   caddyController.formatCaddyfile.bind(caddyController));

// ── Site Management ──
router.get('/sites',               caddyController.getSites.bind(caddyController));
router.get('/sites/:name',         caddyController.getSite.bind(caddyController));
router.post('/sites',              caddyController.createSite.bind(caddyController));
router.put('/sites/:name',         caddyController.updateSite.bind(caddyController));
router.delete('/sites/:name',      caddyController.deleteSite.bind(caddyController));
router.post('/sites/toggle',       caddyController.toggleSite.bind(caddyController));

// ── Certificates ──
router.get('/certificates',        caddyController.getCertificates.bind(caddyController));

// ── Admin API ──
router.get('/admin/config',        caddyController.getAdminConfig.bind(caddyController));
router.get('/admin/stats',         caddyController.getAdminStats.bind(caddyController));
router.get('/admin/upstreams',     caddyController.getAdminReverseProxy.bind(caddyController));

// ── Logs ──
router.get('/logs',                caddyController.getLogs.bind(caddyController));

// ── Validate ──
router.get('/validate',            caddyController.validateConfig.bind(caddyController));

export default router;
