import { fileURLToPath } from 'url';
import { dirname, isAbsolute, join, resolve } from 'path';

/**
 * Central path resolution.
 *
 * [FIX] The panel must not depend on `process.cwd()`: starting the service from
 * another directory used to create a brand-new empty database, hide plugins and
 * point the updater at the wrong git repository.
 *
 * Resolution order:
 *   1. PANELKU_HOME / PANELKU_STORAGE / PANELKU_PLUGINS (explicit override)
 *   2. NODE_ENV=test  -> process.cwd() (tests chdir into a temp dir)
 *   3. module location (src/config/../.. = repository root)
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE_ROOT = resolve(HERE, '..', '..');

export const getAppRoot = () => {
  if (process.env.PANELKU_HOME) return resolve(process.env.PANELKU_HOME);
  if (process.env.NODE_ENV === 'test') return process.cwd();
  // Legacy/custom installs may set PANEL_DIR (the installer uses WorkingDirectory,
  // but some users export it explicitly).
  if (process.env.PANEL_DIR) return resolve(process.env.PANEL_DIR);
  return MODULE_ROOT;
};

export const getStorageDir = () => {
  if (process.env.PANELKU_STORAGE) return resolve(process.env.PANELKU_STORAGE);
  return join(getAppRoot(), 'storage');
};

export const getPluginsDir = () => {
  if (process.env.PANELKU_PLUGINS) return resolve(process.env.PANELKU_PLUGINS);
  return join(getAppRoot(), 'plugins');
};

export const resolveFromRoot = (p, fallback = '') => {
  const value = p || fallback;
  if (!value) return getAppRoot();
  return isAbsolute(value) ? value : resolve(getAppRoot(), value);
};

/**
 * SQLite database location.
 * `DB_PATH` from .env/docker-compose is honoured now (it was previously ignored).
 */
export const getDbPath = () => {
  if (process.env.PANELKU_DB_PATH) return resolve(process.env.PANELKU_DB_PATH);
  if (process.env.DB_PATH && process.env.DB_PATH.trim()) {
    return resolveFromRoot(process.env.DB_PATH.trim());
  }
  return join(getStorageDir(), 'panelku.db');
};

export default {
  getAppRoot,
  getStorageDir,
  getPluginsDir,
  getDbPath,
  resolveFromRoot,
};
