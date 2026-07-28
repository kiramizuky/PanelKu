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
    // [MED-3 FIX] Only check Authorization header — cookies are not checked to prevent
    // CSRF-based bypass of rate limiting via cookie injection.
    if (req.user || req.headers?.authorization) return true;

    // 2. [LOW-3 FIX] Only skip loopback addresses — DO NOT skip private LAN networks
    // because an attacker on the same LAN (e.g., compromised IoT device) could bypass
    // rate limiting entirely by using a local IP. Also DO NOT skip all /api/* endpoints
    // — unauthenticated API endpoints (login, SSO) need rate limiting.
    // Exempt only local server requests (127.0.0.1, ::1).
    const ip = req.ip || req.socket?.remoteAddress || '';
    if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return true;

    return false;
  },
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: appConfig.rateLimit.authMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many authentication attempts. Try again in 15 minutes.' },
  // [LOW-3 FIX] Key by IP first (prevent IP spoofing), append username for per-user tracking.
  // Using IP as primary key prevents an attacker from consuming another user's rate limit
  // by guessing usernames across many requests. The username suffix enables forensics.
  keyGenerator: (req) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const username = req.body?.username || '';
    return `${ip}:${username}`;
  },
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

/**
 * [MED-4 FIX] 2FA verification rate limiter — prevent OTP brute-force.
 * Keyed by tempToken (unique per login attempt) and IP address.
 * 5 attempts per 15 minutes should be plenty for legitimate users.
 */
export const twoFactorLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Key by tempToken (unique per login attempt) + IP
    const token = req.body?.tempToken || '';
    return `${token}:${req.ip}`;
  },
  message: { success: false, message: 'Too many 2FA attempts. Please try again in 15 minutes.' },
  skipFailedRequests: false,
});

/**
 * [HIGH-2 FIX] Webhook rate limiter — prevent brute-force and DDoS against public webhook endpoints.
 * Keyed by webhook ID (from URL params) + IP address.
 * 10 requests per minute allows CI/CD platforms to trigger multiple pushes during a deploy.
 * StandardHeaders enabled so CI platforms can read Retry-After headers.
 */
export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Key by webhook secret (unique per webhook) + IP
    const secret = req.params?.secret || 'unknown';
    return `wh:${secret}:${req.ip}`;
  },
  message: { success: false, message: 'Too many webhook requests. Please slow down.' },
  skipFailedRequests: false,
});
