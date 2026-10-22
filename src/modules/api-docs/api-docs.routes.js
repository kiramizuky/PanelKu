import { Router } from 'express';
import apiDocsController from './api-docs.controller.js';

const router = Router();

// [SEC] API documentation reveals the whole attack surface. Off by default in
// production; enable explicitly with ENABLE_API_DOCS=true (e.g. behind a VPN).
const docsEnabled =
  process.env.ENABLE_API_DOCS === 'true' || process.env.NODE_ENV !== 'production';

router.use((req, res, next) => {
  if (docsEnabled) return next();
  return res.status(404).json({ success: false, message: 'Not found' });
});

// API Documentation is publicly served (read-only docs, no sensitive data).
// Auth is handled by the parent page — the iframe cannot pass Bearer token headers,
// and the spec is just endpoint descriptions without credentials.

// Swagger UI page
router.use('/docs', apiDocsController.serve, apiDocsController.setup);

// Raw JSON specification endpoint
router.get('/spec.json', apiDocsController.serveJson);

export default router;
