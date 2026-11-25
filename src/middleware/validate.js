import { errorResponse } from '../helpers/response.js';
import { swaggerSpec } from '../config/swagger.js';

function validateSection(data, rules, location) {
  const errors = [];
  const sanitized = { ...(data || {}) };

  for (const [field, rule] of Object.entries(rules)) {
    let value = sanitized[field];

    if (value === undefined || value === null || value === '') {
      if (rule.default !== undefined) {
        sanitized[field] = rule.default;
        continue;
      }
      if (rule.required) {
        errors.push({ field, location, message: `${field} is required` });
      }
      continue;
    }

    if (rule.trim && typeof value === 'string') {
      value = value.trim();
      sanitized[field] = value;
    }

    if (rule.type === 'integer' || rule.type === 'number') {
      const num = typeof value === 'number' ? value : Number(value);
      if (Number.isNaN(num) || (rule.type === 'integer' && !Number.isInteger(num))) {
        errors.push({ field, location, message: `${field} must be a valid ${rule.type}` });
        continue;
      }
      value = num;
      sanitized[field] = num;
      if (rule.min !== undefined && num < rule.min) {
        errors.push({ field, location, message: `${field} must be >= ${rule.min}` });
      }
      if (rule.max !== undefined && num > rule.max) {
        errors.push({ field, location, message: `${field} must be <= ${rule.max}` });
      }
    } else if (rule.type === 'boolean') {
      if (typeof value === 'string') {
        if (value === 'true' || value === '1') value = true;
        else if (value === 'false' || value === '0') value = false;
      }
      if (typeof value !== 'boolean') {
        errors.push({ field, location, message: `${field} must be a boolean` });
        continue;
      }
      sanitized[field] = value;
    } else if (rule.type === 'string') {
      if (typeof value !== 'string') {
        errors.push({ field, location, message: `${field} must be a string` });
        continue;
      }
      if (rule.min !== undefined && value.length < rule.min) {
        errors.push({ field, location, message: `${field} must be at least ${rule.min} characters` });
      }
      if (rule.max !== undefined && value.length > rule.max) {
        errors.push({ field, location, message: `${field} must be at most ${rule.max} characters` });
      }
      if (rule.pattern && !rule.pattern.test(value)) {
        errors.push({ field, location, message: `${field} format is invalid` });
      }
    } else if (rule.type === 'array' && !Array.isArray(value)) {
      errors.push({ field, location, message: `${field} must be an array` });
      continue;
    } else if (rule.type === 'object' && (typeof value !== 'object' || Array.isArray(value))) {
      errors.push({ field, location, message: `${field} must be an object` });
      continue;
    }

    if (rule.enum && !rule.enum.includes(value)) {
      errors.push({ field, location, message: `${field} must be one of: ${rule.enum.join(', ')}` });
    }
  }

  return { errors, sanitized };
}

/**
 * Declarative schema validation middleware for Express routes.
 * Supports { body, query, params } field contracts and returns standardized 400 errors.
 */
export function validateSchema(schema = {}) {
  return (req, res, next) => {
    const allErrors = [];

    for (const location of ['params', 'query', 'body']) {
      if (!schema[location]) continue;
      const { errors, sanitized } = validateSection(req[location], schema[location], location);
      if (errors.length > 0) {
        allErrors.push(...errors);
      } else {
        req[location] = sanitized;
      }
    }

    if (allErrors.length > 0) {
      return errorResponse(res, 400, 'Validation failed', allErrors);
    }

    next();
  };
}

/**
 * Register a typed route contract into the live OpenAPI (Swagger) specification
 * so /api-docs stays synchronized with validated endpoints.
 */
export function registerOpenApiContract(routePath, method, meta = {}) {
  const m = String(method || 'get').toLowerCase();
  if (!swaggerSpec.paths) swaggerSpec.paths = {};
  if (!swaggerSpec.paths[routePath]) swaggerSpec.paths[routePath] = {};

  swaggerSpec.paths[routePath][m] = {
    tags: meta.tags || ['General'],
    summary: meta.summary || `${m.toUpperCase()} ${routePath}`,
    security: meta.public ? [] : [{ bearerAuth: [] }],
    ...(meta.parameters ? { parameters: meta.parameters } : {}),
    ...(meta.requestBody ? { requestBody: meta.requestBody } : {}),
    responses: meta.responses || {
      200: { description: 'Success' },
      400: { description: 'Validation failed' },
      401: { description: 'Unauthorized' },
    },
  };
}

export default validateSchema;
