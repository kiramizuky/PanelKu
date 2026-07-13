import rateLimit from 'express-rate-limit';
import appConfig from '../config/app.js';

/**
 * General API rate limiter.
 */
export const apiLimiter = rateLimit({
  windowMs: appConfig.rateLimit.windowMs,
  max: appConfig.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please slow down.' },
  skip: (req) => {
    // [HIGH-1 FIX] Only bypass loopback (true local). Do NOT bypass private networks
    // — private IP bypass can be spoofed via X-Forwarded-For if trust proxy is set.
    const ip = req.ip || req.socket?.remoteAddress || '';
    if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return true;
    // Skip high-frequency dashboard polling endpoints
    if (req.path.startsWith('/dashboard/metrics') || req.path.startsWith('/dashboard/info')) return true;
    return false;
  },
});

/**
 * Strict auth rate limiter to prevent brute force.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: appConfig.rateLimit.authMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many authentication attempts. Try again in 15 minutes.' },
  keyGenerator: (req) => req.body?.username || req.ip,
});

/**
 * Upload rate limiter.
 */
export const uploadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 20,
  message: { success: false, message: 'Too many uploads. Please wait a moment.' },
});

/**
 * [MED-3 FIX] API key rate limiter — prevent brute-force against X-API-Key.
 */
export const apiKeyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 200, // reasonable for programmatic API usage
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.headers['x-api-key'] || req.ip,
  message: { success: false, message: 'Too many API key requests. Please slow down.' },
});
