import { execFile } from 'child_process';
import util from 'util';
import logger from '../config/logger.js';

const execFileAsync = util.promisify(execFile);
const activeLocks = new Map();

/**
 * Acquire a per-resource async lock to prevent concurrent mutations
 * (e.g., simultaneous plugin updates, service restarts, or stack deploys).
 */
export async function withLock(resourceKey, fn) {
  if (activeLocks.has(resourceKey)) {
    throw new Error(`Operation already in progress for ${resourceKey}`);
  }
  activeLocks.set(resourceKey, Date.now());
  try {
    return await fn();
  } finally {
    activeLocks.delete(resourceKey);
  }
}

export function isLocked(resourceKey) {
  return activeLocks.has(resourceKey);
}

/**
 * Execute an async module operation with timeout protection and graceful fallback.
 */
export async function guardAsync(fn, { timeoutMs = 15000, fallback = null, moduleName = 'module' } = {}) {
  let timer = null;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${moduleName} operation timed out after ${timeoutMs}ms`)), timeoutMs);
      if (timer.unref) timer.unref();
    });
    const data = await Promise.race([fn(), timeoutPromise]);
    return { ok: true, status: 'ok', data };
  } catch (err) {
    logger.warn(`[ModuleGuard:${moduleName}] ${err.message}`);
    return {
      ok: false,
      status: err.code === 'ENOENT' ? 'unavailable' : 'degraded',
      error: err.message,
      missingBinary: err.code === 'ENOENT' ? (err.path || null) : null,
      data: fallback,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Run a system binary safely with execFile (no shell interpolation).
 */
export async function runSafeCommand(cmd, args = [], opts = {}) {
  const timeout = opts.timeout ?? 30000;
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      timeout,
      maxBuffer: opts.maxBuffer ?? 1024 * 1024 * 4,
      cwd: opts.cwd,
      env: opts.env,
    });
    return { ok: true, stdout: stdout || '', stderr: stderr || '', exitCode: 0 };
  } catch (err) {
    return {
      ok: false,
      stdout: err.stdout || '',
      stderr: err.stderr || err.message,
      exitCode: typeof err.code === 'number' ? err.code : 1,
      missingBinary: err.code === 'ENOENT' ? cmd : null,
      error: err.message,
    };
  }
}
