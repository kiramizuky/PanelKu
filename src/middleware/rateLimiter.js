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
    // Bypass localhost/loopbacks and private local IPs
    const ip = req.ip || req.connection.remoteAddress;
    if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return true;
    if (ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) return true;
    
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
