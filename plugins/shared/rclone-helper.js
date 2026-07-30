/**
 * plugins/shared/rclone-helper.js
 *
 * Shared utility for rclone detection and remote listing.
 * Used by backup.service.js and all plugin modules that need rclone status.
 *
 * Exports:
 *   detectRclone()         → { installed, version, bin }
 *   getRcloneRemotes(bin, configPath?) → string[]
 *   getRcloneConfigPath(bin)          → string | null
 *   findRcloneConfigs()               → string[]
 *   getRcloneStatus(customConfigPath?)→ { installed, version, bin, remotes, configPath, configHint, customConfigPath }
 */

import { exec } from 'child_process';
import path from 'path';
import fs from 'fs/promises';

// ── Helpers ──────────────────────────────────────────────────────────

const EXTRA_PATH = '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/snap/bin';

function execAsync(cmd, opts = {}) {
  const env = {
    ...process.env,
    PATH: process.env.PATH ? `${process.env.PATH}:${EXTRA_PATH}` : EXTRA_PATH,
    ...(opts.env || {}),
  };
  return new Promise((resolve, reject) => {
    exec(cmd, { ...opts, env, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });
}

// ── Rclone binary detection ─────────────────────────────────────────

async function getRcloneBin() {
  const possiblePaths = [
    'rclone',
    '/usr/bin/rclone',
    '/usr/local/bin/rclone',
    '/usr/sbin/rclone',
    '/bin/rclone',
    '/snap/bin/rclone',
  ];
  for (const bin of possiblePaths) {
    try {
      const stdout = await execAsync(`${bin} --version 2>/dev/null`);
      if (stdout && stdout.toLowerCase().includes('rclone')) return bin;
    } catch (_) { /* try next */ }
  }
  try {
    const stdout = await execAsync('which rclone 2>/dev/null');
    if (stdout.trim()) return stdout.trim();
  } catch (_) { /* not found */ }

  return null;
}

async function detectRclone() {
  try {
    const bin = await getRcloneBin();
    if (!bin) return { installed: false, version: null, bin: null };

    const stdout = await execAsync(`${bin} --version 2>/dev/null`);
    const version = stdout.split('\n')[0]?.trim() || 'rclone (installed)';
    return { installed: true, version, bin };
  } catch {
    return { installed: false, version: null, bin: null };
  }
}

// ── List remotes (with optional custom config path) ─────────────────

async function getRcloneRemotes(bin, configPath) {
  const cmd = configPath
    ? `${bin} listremotes --config "${configPath}" 2>/dev/null || echo ""`
    : `${bin} listremotes 2>/dev/null || echo ""`;
  const out = await execAsync(cmd);
  return out.split('\n').map(r => r.replace(':', '').trim()).filter(Boolean);
}

// ── Get default config path from rclone itself ──────────────────────

async function getRcloneConfigPath(bin) {
  try {
    const out = await execAsync(`${bin} config file 2>/dev/null || echo ""`);
    const lines = out.split('\n').filter(Boolean);
    return lines[0]?.trim() || null;
  } catch {
    return null;
  }
}

// ── Search common rclone config file locations ──────────────────────

async function findRcloneConfigs() {
  const candidates = [];

  // Common paths
  const commonPaths = [
    process.env.SUDO_USER
      ? `/home/${process.env.SUDO_USER}/.config/rclone/rclone.conf`
      : null,
    '/root/.config/rclone/rclone.conf',
  ];

  for (const p of commonPaths.filter(Boolean)) {
    try {
      await fs.stat(p);
      if (!candidates.includes(p)) candidates.push(p);
    } catch { /* not found */ }
  }

  // Wildcard search in /home/*/
  try {
    await fs.stat('/home');
    const dirs = await fs.readdir('/home');
    for (const d of dirs) {
      const candidate = path.join('/home', d, '.config', 'rclone', 'rclone.conf');
      try {
        await fs.stat(candidate);
        if (!candidates.includes(candidate)) candidates.push(candidate);
      } catch { /* not found */ }
    }
  } catch { /* /home not accessible */ }

  return candidates;
}

// ── High-level: get full rclone status ──────────────────────────────
// Accepts optional customConfigPath (e.g. from panel Setting).
// When provided, tries that config path first before falling back.

async function getRcloneStatus(customConfigPath) {
  const info = await detectRclone();
  let remotes = [];
  let configPath = null;
  let configHint = null;

  if (info.installed) {
    const bin = info.bin || 'rclone';

    // Step 0: Try custom config path from settings
    if (customConfigPath) {
      try {
        remotes = await getRcloneRemotes(bin, customConfigPath);
        if (remotes.length > 0) {
          configPath = customConfigPath;
          configHint = 'Using custom config from panel settings';
        }
      } catch { /* custom config failed */ }
    }

    // Step 1: Try default config
    if (remotes.length === 0) {
      try {
        remotes = await getRcloneRemotes(bin);
      } catch { /* no remotes */ }
    }

    // Step 2: Get detected config path from rclone itself
    if (!configPath) {
      configPath = await getRcloneConfigPath(bin);
    }

    // Step 3: Search common locations (other users)
    if (remotes.length === 0) {
      const configs = await findRcloneConfigs();
      for (const cfgPath of configs) {
        try {
          const found = await getRcloneRemotes(bin, cfgPath);
          if (found.length > 0) {
            remotes = found;
            configPath = cfgPath;
            configHint = `Using config from: ${cfgPath} (configured as user other than panel process)`;
            break;
          }
        } catch { /* try next */ }
      }
    }
  }

  return { ...info, remotes, configPath, configHint, customConfigPath: customConfigPath || null };
}

export {
  getRcloneBin,
  detectRclone,
  getRcloneRemotes,
  getRcloneConfigPath,
  findRcloneConfigs,
  getRcloneStatus,
};
