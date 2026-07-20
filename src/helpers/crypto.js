import crypto from 'crypto';
import { randomBytes } from 'crypto';

/**
 * Generate a cryptographically secure random token.
 */
export const generateToken = (bytes = 32) => randomBytes(bytes).toString('hex');

/**
 * Generate a simple API key with prefix.
 */
export const generateApiKey = (prefix = 'lp') => {
  return `${prefix}_${randomBytes(24).toString('base64url')}`;
};

/**
 * Hash a string with SHA256.
 */
export const sha256 = (value) => {
  return crypto.createHash('sha256').update(value).digest('hex');
};

/**
 * Constant-time comparison to prevent timing attacks.
 */
export const safeCompare = (a, b) => {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
};

/**
 * Encrypt a value using AES-256-GCM.
 */
export const encrypt = (text, key) => {
  const iv = randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
};

/**
 * Decrypt a value using AES-256-GCM.
 */
export const decrypt = (encryptedText, key) => {
  const [ivHex, tagHex, dataHex] = encryptedText.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const encrypted = Buffer.from(dataHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
};

/**
 * Generate a short-lived, signed download token (HMAC-SHA256).
 * Token expires after `ttlMs` (default 60 seconds).
 */
export const createDownloadToken = (path, secret, ttlMs = 60000) => {
  const payload = JSON.stringify({ path, exp: Date.now() + ttlMs });
  const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return Buffer.from(JSON.stringify({ payload, hmac })).toString('base64url');
};

/**
 * Verify and decode a download token. Returns the path if valid, or null.
 */
export const verifyDownloadToken = (tokenStr, secret) => {
  try {
    const { payload, hmac } = JSON.parse(Buffer.from(tokenStr, 'base64url').toString('utf8'));
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expected))) return null;
    const { path, exp } = JSON.parse(payload);
    if (Date.now() > exp) return null;
    return path;
  } catch {
    return null;
  }
};
