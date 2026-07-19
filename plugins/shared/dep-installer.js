/**
 * plugins/shared/dep-installer.js
 *
 * Shared dependency auto-installer for all plugins.
 * Provides:
 *   - ensureCommand(cmd, pkgKey)   — check + install a CLI binary
 *   - ensureDockerCompose()        — check + install docker-compose (V2 plugin or V1)
 *   - withDeployTimeout(ms)        — Express middleware to extend request timeout
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import logger from '../../src/config/logger.js';

const execAsync = promisify(exec);

/** Load the package manager singleton (lazy so startup is not slowed down) */
async function getPM() {
  const pm = (await import('../../src/modules/system/package-manager.js')).default;
  await pm.init();
  return pm;
}

/**
 * Check whether a CLI command is available on PATH.
 * Returns true if found, false if not.
 */
async function commandExists(cmd) {
  try {
    await execAsync(`command -v ${cmd} 2>/dev/null || which ${cmd} 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure a required CLI command is installed.
 * If it is missing, install it automatically using the system package manager.
 *
 * @param {string} cmd     - The CLI binary to check (e.g. 'wg', 'rclone', 'pm2')
 * @param {string} pkgKey  - The package-manager map key (e.g. 'wireguard', 'rclone')
 *                           OR an object { apt, dnf, pacman, emerge, npm } for custom overrides.
 * @param {Object} [opts]
 * @param {number} [opts.timeout=300000]  - exec timeout in ms for the install command
 */
async function ensureCommand(cmd, pkgKey, opts = {}) {
  const { timeout = 300000 } = opts;

  if (await commandExists(cmd)) {
    logger.info(`[dep-installer] ✔ ${cmd} is already installed.`);
    return;
  }

  logger.warn(`[dep-installer] ${cmd} not found — auto-installing...`);
  const pm = await getPM();

  let installCmd;

  // Allow callers to pass a per-pm-type override object
  if (typeof pkgKey === 'object') {
    const override = pkgKey[pm.pmType] || pkgKey['apt'] || null;
    if (override) {
      installCmd = override;
    }
  }

  // Fall back to packageManager.getInstallCommand() lookup
  if (!installCmd) {
    installCmd = pm.getInstallCommand(typeof pkgKey === 'string' ? pkgKey : cmd);
  }

  logger.info(`[dep-installer] Running: ${installCmd}`);
  const { stdout, stderr } = await execAsync(installCmd, { timeout });
  logger.info(`[dep-installer] Install output: ${stdout || stderr}`);
}

/**
 * Ensure docker-compose (V2 plugin preferred, V1 fallback) is installed.
 * Tries `docker compose` first, then `docker-compose`, then auto-installs.
 */
async function ensureDockerCompose(opts = {}) {
  const { timeout = 300000 } = opts;

  // V2 built-in via docker CLI plugin
  const v2ok = await commandExists('docker');
  if (v2ok) {
    try {
      await execAsync('docker compose version 2>/dev/null');
      logger.info('[dep-installer] ✔ docker compose (V2) is available.');
      return;
    } catch { /* V2 not available, try V1 */ }
  }

  // V1 standalone binary
  if (await commandExists('docker-compose')) {
    logger.info('[dep-installer] ✔ docker-compose (V1) is available.');
    return;
  }

  // Neither found — install
  logger.warn('[dep-installer] docker-compose not found — auto-installing...');
  const pm = await getPM();

  let installCmd;
  switch (pm.pmType) {
    case 'pacman':
      installCmd = 'sudo pacman -S --noconfirm --needed docker-compose';
      break;
    case 'dnf':
      installCmd = 'sudo dnf install -y docker-compose-plugin 2>/dev/null || sudo dnf install -y docker-compose';
      break;
    case 'emerge':
      installCmd = 'sudo emerge -v app-containers/docker-compose';
      break;
    case 'apt':
    default:
      installCmd =
        'sudo apt-get update -qq && ' +
        '(sudo DEBIAN_FRONTEND=noninteractive apt-get install -y docker-compose-plugin 2>/dev/null || ' +
        ' sudo DEBIAN_FRONTEND=noninteractive apt-get install -y docker-compose)';
      break;
  }

  logger.info(`[dep-installer] Running: ${installCmd}`);
  const { stdout, stderr } = await execAsync(installCmd, { timeout });
  logger.info(`[dep-installer] Install output: ${stdout || stderr}`);
}

/**
 * Express middleware factory — extends the request + response timeout for
 * long-running deploy/install routes.
 *
 * Usage:
 *   app.post('/plugins/foo/deploy', withDeployTimeout(600000), async (req, res) => { ... });
 *
 * @param {number} [ms=600000]  timeout in milliseconds (default 10 min)
 */
function withDeployTimeout(ms = 600000) {
  return (req, res, next) => {
    req.setTimeout(ms);
    res.setTimeout(ms);
    next();
  };
}

export { ensureCommand, ensureDockerCompose, withDeployTimeout };
