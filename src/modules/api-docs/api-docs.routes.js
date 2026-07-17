import { Router } from 'express';
import apiDocsController from './api-docs.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { RESOURCES, ACTIONS } from '../../config/constants.js';

const router = Router();

// Protected routes
router.use(authenticate);

// Swagger UI page (DASHBOARD:READ permission since all admins should see API docs)
router.use('/docs', rbac(RESOURCES.DASHBOARD, ACTIONS.READ), apiDocsController.serve, apiDocsController.setup);

// Raw JSON specification endpoint
router.get('/spec.json', rbac(RESOURCES.DASHBOARD, ACTIONS.READ), apiDocsController.serveJson);

export default router;
