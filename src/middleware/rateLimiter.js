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
    // 1. Exempt all authenticated requests (logged in panel users should never be rate limited)
    if (req.user || req.cookies?.token || req.cookies?.refresh_token || req.headers?.authorization) return true;

    // 2. Skip loopback & private LAN networks (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
    const ip = req.ip || req.socket?.remoteAddress || '';
    if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return true;
    if (/^(::ffff:)?(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(ip)) return true;

    // 3. Exempt internal API endpoints
    const url = (req.originalUrl || req.url || '').split('?')[0];
    if (url.startsWith('/api/')) return true;

    return false;
  },
});

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

/**
 * Download token rate limiter — prevent brute-force on generate-download-token endpoint.
 * Limits per-user (via req.user.id) to avoid IP-based bypass across shared networks.
 * 20 requests/minute gives headroom for legitimate multi-file downloads while stopping brute force.
 */
export const downloadTokenLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { success: false, message: 'Too many download token requests. Please slow down.' },
});
