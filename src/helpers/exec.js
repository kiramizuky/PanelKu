/**
 * Safe Command Execution Helpers
 *
 * Provides two functions for executing system commands:
 * - execCmd(bin, args, opts): Uses execFile (NO shell) — safe for user input
 * - execShell(cmd, opts): Uses exec (WITH shell) — ONLY for hardcoded strings
 *
 * Usage:
 *   import { execCmd, execShell } from '../../helpers/exec.js';
 *
 *   // Safe for user-controlled values (port, service name, etc.)
 *   const stdout = await execCmd('systemctl', ['is-active', serviceName]);
 *
 *   // Only for hardcoded commands with pipes/redirects
 *   const stdout = await execShell('ss -tlnp 2>/dev/null | head -20');
 */

import { exec, execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

/**
 * Execute a command safely using execFile with args array — NO shell interpreter.
 * This prevents command injection entirely. Preferred for ALL operations with
 * user-controlled input.
 *
 * @param {string} bin - Binary to execute (e.g. 'systemctl', 'ss', 'kill')
 * @param {string[]} args - Array of arguments
 * @param {object} [opts] - Options: timeout, cwd, env
 * @returns {Promise<string>} stdout output
 */
export async function execCmd(bin, args = [], opts = {}) {
  const options = { timeout: 30000, ...opts };
  try {
    const { stdout } = await execFileAsync(bin, args, options);
    return stdout;
  } catch (err) {
    // Some commands exit non-zero on "not found" — that's OK
    if (err.message?.includes('ENOENT') || err.message?.includes('not found')) {
      return '';
    }
    throw err;
  }
}

/**
 * Execute a command through the shell — ONLY for hardcoded strings with no user input.
 * Used for commands that require pipes (|), chaining (&&), or redirects (>, >>).
 *
 * ⚠️ WARNING: NEVER pass user input through this method.
 * If you need to include dynamic values, use execCmd() instead.
 *
 * @param {string} cmd - Complete shell command string
 * @param {object} [opts] - Options: timeout, cwd, env
 * @returns {Promise<string>} stdout output
 */
export async function execShell(cmd, opts = {}) {
  const options = { timeout: 30000, ...opts };
  try {
    const { stdout } = await execAsync(cmd, options);
    return stdout;
  } catch (err) {
    if (err.message?.includes('ENOENT') || err.message?.includes('not found')) {
      return '';
    }
    throw err;
  }
}
