import { validationResult } from 'express-validator';
import { badRequest } from './response.js';

/**
 * Middleware to check express-validator results.
 * Call after your validation chain in route definitions.
 */
export const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return badRequest(res, 'Validation failed', errors.array());
  }
  next();
};

/**
 * Validate an email string.
 */
export const isEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

/**
 * Validate password strength.
 */
export const isStrongPassword = (password) => {
  return password && password.length >= 8;
};

/**
 * Sanitize string to safe identifier.
 */
export const toSlug = (str) => {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9_\-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
};
