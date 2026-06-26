import jwt from 'jsonwebtoken';
import appConfig from '../config/app.js';
import userRepository from '../repositories/user.repository.js';
import { unauthorized } from '../helpers/response.js';
import logger from '../config/logger.js';

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
    // Check cookie
    else if (req.cookies?.access_token) {
      token = req.cookies.access_token;
    }
    // Check X-API-Key header
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
 */
const authenticateApiKey = async (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  const user = await userRepository.findByApiKey(apiKey);
  if (!user) return unauthorized(res, 'Invalid API key');
  req.user = user;
  req.isApiKey = true;
  next();
};

/**
 * Optional auth — attaches user if token present but doesn't block.
 */
export const optionalAuth = async (req, res, next) => {
  try {
    await authenticate(req, res, () => {});
  } catch {
    // ignore
  }
  next();
};

export const requireAuth = authenticate;
