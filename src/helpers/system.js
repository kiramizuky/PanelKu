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

/**
 * Normalize and sort filesystem list so that:
 * 1. The primary OS root partition (mount: '/' or 'C:') is ALWAYS at index 0.
 * 2. Virtual/pseudo/snap loop mounts (/dev/loop*, squashfs, tmpfs) are filtered out.
 * 3. Remaining physical/logical volumes (such as LVM root volumes) are sorted by largest capacity first.
 */
export const normalizeDisks = (disks = []) => {
  if (!Array.isArray(disks) || disks.length === 0) return [];

  // Filter out dummy/virtual filesystem types and snap loop mounts if real disks exist
  const realDisks = disks.filter((d) => {
    if (!d || (!d.size && !d.total)) return false;
    const fs = String(d.fs || '');
    const type = String(d.type || '');
    if (fs.startsWith('/dev/loop') || fs === 'overlay' || fs === 'tmpfs' || fs === 'none' || fs === 'udev') return false;
    if (type === 'squashfs' || type === 'tmpfs' || type === 'devtmpfs' || type === 'overlay') return false;
    return true;
  });

  const list = realDisks.length > 0 ? [...realDisks] : [...disks];

  return list.sort((a, b) => {
    const aMount = String(a.mount || '');
    const bMount = String(b.mount || '');
    const aSize = a.size || a.total || 0;
    const bSize = b.size || b.total || 0;

    // Root mount '/' has highest priority
    if (aMount === '/' && bMount !== '/') return -1;
    if (bMount === '/' && aMount !== '/') return 1;

    // Windows root 'C:'
    if (aMount.toUpperCase().startsWith('C:') && !bMount.toUpperCase().startsWith('C:')) return -1;
    if (bMount.toUpperCase().startsWith('C:') && !aMount.toUpperCase().startsWith('C:')) return 1;

    // Avoid EFI or small boot mounts being first if larger drives exist
    if ((aMount === '/boot/efi' || aMount === '/boot') && (bMount !== '/boot/efi' && bMount !== '/boot')) return 1;
    if ((bMount === '/boot/efi' || bMount === '/boot') && (aMount !== '/boot/efi' && aMount !== '/boot')) return -1;

    // Sort by largest disk size
    return bSize - aSize;
  });
};

/**
 * Get primary OS disk object from a disk list.
 */
export const getPrimaryDisk = (disks = []) => {
  const sorted = normalizeDisks(disks);
  return sorted[0] || {};
};
