// Minimal reproduction of swagger.js structure
const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Test',
      version: '1.0.0',
      description: 'Test'
    },
    components: {
      schemas: {
        Test: {
          type: 'object',
          properties: {
            id: { type: 'string' }
          }
        }
      }
    },
    tags: [
      { name: 'Test', description: 'test' }
    ],
    paths: {
      '/test': {
        get: {
          tags: ['Test'],
          summary: 'Test',
          responses: {
            200: { description: 'OK' }
          }
        }
      },
      '/agent/terminal/ws': {
        get: { tags: ['Agent'], summary: 'test' }
      }
    }
  },
  apis: []
};

export const swaggerSpec = swaggerJsdoc(options);
export default swaggerSpec;
