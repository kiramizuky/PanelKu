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
    
    // Use originalUrl instead of path to avoid issues with router mounting prefixes
    const url = req.originalUrl.split('?')[0];
    
    // Exempt auth endpoints from general API limit (they are protected by authLimiter separately)
    if (url === '/api/auth/login' || url === '/api/auth/2fa/verify' || url === '/api/auth/profile' || url === '/api/auth/refresh') return true;
    
    // Skip high-frequency dashboard polling endpoints
    if (url.startsWith('/api/dashboard/metrics') || url.startsWith('/api/dashboard/info')) return true;
    
    // Exempt system power/restart endpoints to avoid 'too many requests' during reboot
    if (url === '/api/system/reboot' || url === '/api/system/panel/restart') return true;
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
