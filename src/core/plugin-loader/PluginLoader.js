import { readdir, readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { Router } from 'express';
import logger from '../../config/logger.js';

/**
 * Plugin Loader SDK.
 * Discovers and loads plugins from the /plugins directory.
 * Each plugin must export a default object: { name, version, register(app, io) }
 */
class PluginLoader {
  constructor() {
    this._plugins = new Map();
    this._pluginsDir = resolve('./plugins');
    this.router = Router();
  }

  /**
   * Discover and load all plugins.
   * @param {Express} app
   * @param {SocketIO.Server} io
   */
  async loadAll(app, io) {
    let dirs;
    try {
      dirs = await readdir(this._pluginsDir, { withFileTypes: true });
    } catch {
      logger.info('PluginLoader: no plugins directory found, skipping.');
      return;
    }

    // Load list of installed plugins from DB
    let installedIds = [];
    try {
      const Setting = (await import('../../models/Setting.js')).default;
      const installedStr = await Setting.get('installed_plugins') || '[]';
      installedIds = JSON.parse(typeof installedStr === 'string' ? installedStr : JSON.stringify(installedStr));
    } catch (e) {
      logger.warn('PluginLoader: failed to query installed plugins from database:', e.message);
    }

    for (const entry of dirs) {
      if (!entry.isDirectory()) continue;
      // Only load if it's explicitly installed
      if (installedIds.includes(entry.name)) {
        await this._loadPlugin(entry.name, app, io);
      }
    }

    logger.info(`PluginLoader: loaded ${this._plugins.size} plugin(s).`);
  }

  async _loadPlugin(name, app, io) {
    try {
      const manifestPath = join(this._pluginsDir, name, 'plugin.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

      const entryPath = join(this._pluginsDir, name, manifest.entry || 'index.js');
      const wrappedApp = new Proxy(app, {
        get: (target, prop) => {
          if (['get', 'post', 'put', 'delete', 'patch'].includes(prop)) {
            return (...args) => this.router[prop](...args);
          }
          const val = target[prop];
          if (typeof val === 'function') {
            return val.bind(target);
          }
          return val;
        }
      });

      const { default: plugin } = await import(pathToFileURL(entryPath).href);

      if (typeof plugin.register !== 'function') {
        logger.warn(`PluginLoader: plugin [${name}] has no register() function, skipping.`);
        return;
      }

      await plugin.register(wrappedApp, io);
      this._plugins.set(name, { ...manifest, status: 'active' });
      logger.info(`PluginLoader: plugin [${name}] v${manifest.version} loaded.`);
    } catch (err) {
      logger.error(`PluginLoader: failed to load plugin [${name}]: ${err.message}`);
    }
  }

  getAll() {
    return [...this._plugins.entries()].map(([name, info]) => ({ name, ...info }));
  }

  isLoaded(name) {
    return this._plugins.has(name);
  }
}

const pluginLoader = new PluginLoader();
export default pluginLoader;
