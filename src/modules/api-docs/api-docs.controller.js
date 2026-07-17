import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from '../../config/swagger.js';

/**
 * API Documentation Controller
 * Serves Swagger UI with the OpenAPI specification.
 */
class ApiDocsController {
  constructor() {
    // Swagger UI middleware
    this.serve = swaggerUi.serve;
    this.setup = swaggerUi.setup(swaggerSpec, {
      customCss: `
        .swagger-ui .topbar { display: none; }
        .swagger-ui { background: transparent; }
        .swagger-ui .info .title { font-size: 28px; }
        .swagger-ui .opblock-tag { font-size: 16px; }
        .swagger-ui .opblock .opblock-summary-operation-id, 
        .swagger-ui .opblock .opblock-summary-path,
        .swagger-ui .opblock .opblock-summary-description { font-size: 13px; }
        .swagger-ui .scheme-container { background: rgba(0,0,0,0.2); border-radius: 8px; padding: 8px 12px; }
        .swagger-ui .auth-wrapper .authorize { border-color: #3b82f6; color: #3b82f6; }
        .swagger-ui .auth-wrapper .authorize svg { fill: #3b82f6; }
      `,
      customSiteTitle: 'API Documentation — Linux Panel',
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        filter: true,
        tryItOutEnabled: false,
      },
    });

    // JSON endpoint to serve raw OpenAPI spec
    this.serveJson = (req, res) => {
      res.json(swaggerSpec);
    };
  }
}

const apiDocsController = new ApiDocsController();
export default apiDocsController;
