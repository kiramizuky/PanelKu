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
 * [LOW-1 FIX] Validate password strength.
 * Requires: min 12 chars, uppercase, lowercase, number, and special character.
 * OWASP 2023 recommends at least 12 characters with complexity.
 */
export const isStrongPassword = (password) => {
  if (!password || typeof password !== 'string') return false;
  if (password.length < 12) return false;
  if (!/[A-Z]/.test(password)) return false;
  if (!/[a-z]/.test(password)) return false;
  if (!/[0-9]/.test(password)) return false;
  if (!/[^A-Za-z0-9]/.test(password)) return false;
  return true;
};

/**
 * [LOW-1 FIX] Get human-readable password requirements message.
 */
export const passwordRequirements = () => {
  return 'Password must be at least 12 characters with uppercase, lowercase, number, and special character.';
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
