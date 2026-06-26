import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Execute a shell command safely and return stdout.
 */
export const runCommand = async (cmd, options = {}) => {
  const { stdout, stderr } = await execAsync(cmd, { timeout: 30000, ...options });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
};

/**
 * Parse device name from IP address.
 */
export const getDeviceInfo = (req) => {
  return {
    ip: req.ip || req.connection?.remoteAddress || 'unknown',
    userAgent: req.get('User-Agent') || 'unknown',
    deviceInfo: parseUA(req.get('User-Agent') || ''),
  };
};

const parseUA = (ua) => {
  if (!ua) return 'Unknown Device';
  if (ua.includes('Windows')) return 'Windows';
  if (ua.includes('Mac')) return 'macOS';
  if (ua.includes('Linux')) return 'Linux';
  if (ua.includes('Android')) return 'Android';
  if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
  return 'Unknown';
};

/**
 * Format bytes to human-readable size.
 */
export const formatBytes = (bytes, decimals = 2) => {
  if (!bytes || bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
};

/**
 * Format uptime seconds to human readable string.
 */
export const formatUptime = (seconds) => {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (!d) parts.push(`${s}s`);
  return parts.join(' ') || '0s';
};

/**
 * Sleep helper.
 */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

import { resolve, join } from 'path';

/**
 * Sanitize a filesystem path to prevent directory traversal.
 */
export const sanitizePath = (base, userPath) => {
  const resolved = resolve(join(base, userPath));
  if (!resolved.startsWith(resolve(base))) {
    throw new Error('Path traversal detected');
  }
  return resolved;
};
