import { Router } from 'express';
import apiDocsController from './api-docs.controller.js';

const router = Router();

// API Documentation is publicly served (read-only docs, no sensitive data).
// Auth is handled by the parent page — the iframe cannot pass Bearer token headers,
// and the spec is just endpoint descriptions without credentials.

// Swagger UI page
router.use('/docs', apiDocsController.serve, apiDocsController.setup);

// Raw JSON specification endpoint
router.get('/spec.json', apiDocsController.serveJson);

export default router;
