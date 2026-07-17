import { readdir, readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { pathToFileURL, parse as parseUrl } from 'url';
import { Router } from 'express';
import http from 'http';
import https from 'https';
import { isIP } from 'net';
import logger from '../../config/logger.js';

/**
 * Plugin Loader SDK.
 * Discovers and loads plugins from the /plugins directory.
 * Each plugin must export a default object: { name, version, register(app, io) }
 */
class PluginLoader {
  constructor() {
    this._plugins = new Map();
    this._proxies = new Map();
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

    // Load plugin proxies from DB
    try {
      const Setting = (await import('../../models/Setting.js')).default;
      const proxiesStr = await Setting.get('plugin_proxies') || '{}';
      const proxies = JSON.parse(typeof proxiesStr === 'string' ? proxiesStr : JSON.stringify(proxiesStr));
      for (const [id, url] of Object.entries(proxies)) {
        if (url) {
          // [SECURITY FIX] Use setProxy() instead of direct _proxies.set() — ensures URL validation
          try {
            this.setProxy(id, url);
          } catch (validationErr) {
            logger.warn(`PluginLoader: skipping invalid proxy for plugin ${id}: ${validationErr.message}`);
          }
        }
      }
    } catch (e) {
      logger.warn('PluginLoader: failed to query plugin proxies from database:', e.message);
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

  validateManifest(manifest, name) {
    if (!manifest) throw new Error('Manifest is empty');
    if (typeof manifest.name !== 'string' || !manifest.name.trim()) {
      throw new Error(`Plugin [${name}] manifest missing a valid "name" property`);
    }
    if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+/.test(manifest.version)) {
      throw new Error(`Plugin [${name}] manifest missing a valid "version" property (should be semver)`);
    }
    return true;
  }

  async _loadPlugin(name, app, io) {
    try {
      const manifestPath = join(this._pluginsDir, name, 'plugin.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      this.validateManifest(manifest, name);

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
    return [...this._plugins.entries()].map(([name, info]) => {
      const proxyUrl = this._proxies.get(name) || '';
      const isInstalled = this.isLoaded(name);
      return {
        name,
        ...info,
        proxyUrl,
        // Override path with proxy URL ONLY if the plugin is fully installed/loaded.
        // Otherwise, route to local path /plugins/:name.
        path: (isInstalled && proxyUrl) ? proxyUrl : `/plugins/${name}`
      };
    });
  }

  isLoaded(name) {
    return this._plugins.has(name);
  }

  /**
   * Validate a proxy URL — only http/https, no private/internal IPs.
   * Prevents SSRF attacks.
   */
  _validateProxyUrl(url) {
    if (!url || typeof url !== 'string') throw new Error('Proxy URL is required');

    let parsed;
    try {
      parsed = new URL(url.trim());
    } catch {
      throw new Error('Invalid proxy URL format');
    }

    // Only allow http and https protocols
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Proxy URL must use http or https protocol');
    }

    const hostname = parsed.hostname.toLowerCase();

    // Block private/internal IPs (SSRF protection)
    const blockedPatterns = [
      // Loopback
      'localhost', '127.0.0.1', '::1', '0.0.0.0',
      // Cloud metadata endpoints
      '169.254.169.254',
      // Docker internal
      'host.docker.internal',
    ];

    if (blockedPatterns.includes(hostname)) {
      throw new Error('Proxy URL cannot point to localhost or internal services');
    }

    // Block private IP ranges
    if (isIP(hostname)) {
      const parts = hostname.split('.').map(Number);
      if (parts.length === 4) {
        // 10.0.0.0/8
        if (parts[0] === 10) throw new Error('Proxy URL cannot point to private IP range');
        // 172.16.0.0/12
        if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) throw new Error('Proxy URL cannot point to private IP range');
        // 192.168.0.0/16
        if (parts[0] === 192 && parts[1] === 168) throw new Error('Proxy URL cannot point to private IP range');
        // 100.64.0.0/10 (CGNAT)
        if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) throw new Error('Proxy URL cannot point to CGNAT range');
      }
    }

    return url.trim();
  }

  setProxy(id, proxyUrl) {
    if (proxyUrl) {
      try {
        const validated = this._validateProxyUrl(proxyUrl);
        this._proxies.set(id, validated);
      } catch (err) {
        logger.warn(`PluginLoader: invalid proxy URL for plugin ${id}: ${err.message}`);
        throw err;
      }
    } else {
      this._proxies.delete(id);
    }
  }

  getProxy(id) {
    return this._proxies.get(id);
  }

  /**
   * Middleware to check and reverse-proxy requests targeting a proxied plugin.
   * [SECURITY] Target URL is validated on setProxy() — only http/https, no private IPs.
   */
  handleProxy(req, res, next) {
    const match = req.originalUrl.match(/^\/(api\/)?plugins\/([^\/?#]+)/);
    if (!match) return next();

    const pluginId = match[2];
    const targetUrl = this.getProxy(pluginId);
    if (!targetUrl) return next();

    // Perform reverse proxying to targetUrl
    try {
      const parsedTarget = parseUrl(targetUrl);
      let strippedPath = req.originalUrl;
      if (match) {
        strippedPath = req.originalUrl.slice(match[0].length);
      }
      if (!strippedPath.startsWith('/')) {
        strippedPath = '/' + strippedPath;
      }

      let targetPath = parsedTarget.pathname || '';
      if (targetPath.endsWith('/')) {
        targetPath = targetPath.slice(0, -1);
      }
      const finalPath = targetPath + strippedPath;

      const options = {
        protocol: parsedTarget.protocol,
        hostname: parsedTarget.hostname,
        port: parsedTarget.port || (parsedTarget.protocol === 'https:' ? 443 : 80),
        method: req.method,
        path: finalPath,
        headers: {
          ...req.headers,
        },
        // [SECURITY FIX] Set a timeout to prevent hanging connections
        timeout: 30000,
      };

      // Set/override standard headers
      delete options.headers['connection'];
      delete options.headers['host'];
      options.headers['Host'] = parsedTarget.host;

      const transport = parsedTarget.protocol === 'https:' ? https : http;
      const proxyReq = transport.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      });

      proxyReq.on('error', (err) => {
        logger.error(`PluginLoader Proxy error for ${targetUrl}: ${err.message}`);
        if (!res.headersSent) {
          res.status(502).send(`Bad Gateway: Failed to proxy request to plugin ${pluginId}.`);
        }
      });

      // Handle body if already parsed by global middleware
      if (req.body && Object.keys(req.body).length > 0) {
        const contentType = req.headers['content-type'] || '';
        let bodyData;
        if (contentType.includes('application/json')) {
          bodyData = JSON.stringify(req.body);
        } else if (contentType.includes('application/x-www-form-urlencoded')) {
          bodyData = new URLSearchParams(req.body).toString();
        }

        if (bodyData) {
          proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
          proxyReq.write(bodyData);
          proxyReq.end();
          return;
        }
      }

      req.pipe(proxyReq);
    } catch (err) {
      logger.error(`PluginLoader Proxy initialization error: ${err.message}`);
      res.status(500).send(`Internal Server Error: Proxy failed.`);
    }
  }
}

const pluginLoader = new PluginLoader();
export default pluginLoader;
