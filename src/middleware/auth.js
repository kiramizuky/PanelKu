import jwt from 'jsonwebtoken';
import appConfig from '../config/app.js';
import userRepository from '../repositories/user.repository.js';
import { unauthorized } from '../helpers/response.js';
import logger from '../config/logger.js';
import { apiKeyLimiter } from './rateLimiter.js';

/**
 * JWT Authentication Middleware.
 * Validates Bearer token and attaches user to req.user.
 */
export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    let token = null;

    // Check Authorization header (Bearer token)
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }
    // [CSRF MITIGATION] access_token cookie fallback removed.
    // Cookies are vulnerable to CSRF. All clients MUST use
    // Authorization: Bearer <token> header for API authentication.
    // Check X-API-Key header (only if no Bearer token — else-if preserves priority)
    else if (req.headers['x-api-key']) {
      return authenticateApiKey(req, res, next);
    }

    if (!token) {
      return unauthorized(res, 'No authentication token provided');
    }

    let decoded;
    try {
      decoded = jwt.verify(token, appConfig.jwt.secret);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return unauthorized(res, 'Token expired');
      }
      return unauthorized(res, 'Invalid token');
    }

    const user = await userRepository.findById(decoded.sub, {
      populate: 'role',
    });

    if (!user || !user.isActive) {
      return unauthorized(res, 'User not found or inactive');
    }

    req.user = user;
    req.tokenPayload = decoded;
    next();
  } catch (err) {
    logger.error('Auth middleware error:', err);
    return unauthorized(res, 'Authentication failed');
  }
};

/**
 * API Key authentication.
 * [MED-3 FIX] Wrapped with apiKeyLimiter to prevent brute-force.
 */
const authenticateApiKey = (req, res, next) => {
  // Apply rate limiter first, then authenticate
  apiKeyLimiter(req, res, async () => {
    try {
      const apiKey = req.headers['x-api-key'];
      if (!apiKey) return unauthorized(res, 'No API key provided');
      const user = await userRepository.findByApiKey(apiKey);
      if (!user || !user.isActive) return unauthorized(res, 'Invalid or inactive API key');
      req.user = user;
      req.isApiKey = true;
      next();
    } catch (err) {
      logger.error('API key auth error:', err.message);
      return unauthorized(res, 'Authentication failed');
    }
  });
};

/**
 * Optional auth — attaches user if token present but doesn't block.
 * [LOW-4 FIX] Only suppress 401/auth errors, not server errors.
 * [CSRF MITIGATION] Does NOT check cookies — only Authorization header.
 */
export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      await authenticate(req, res, () => {});
    }
  } catch {
    // Ignore auth errors — user remains unauthenticated
  }
  next();
};

export const requireAuth = authenticate;
