/**
 * Plugins Controller Unit Tests
 *
 * @jest-environment node
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';
import pluginsController from '../src/modules/plugins/plugins.controller.js';
import Setting from '../src/models/Setting.js';
import pluginLoader from '../src/core/plugin-loader/PluginLoader.js';

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(d) {
      this.body = d;
      return this;
    },
  };
}

const mockApp = {
  get: () => ({ emit: () => {} }),
  use: () => {},
};

const tempPluginId = '_test_mock_plugin';
const tempPluginDir = path.resolve('./plugins', tempPluginId);

beforeAll(async () => {
  // Create a temporary mock plugin folder
  await fs.mkdir(tempPluginDir, { recursive: true });
  await fs.writeFile(
    path.join(tempPluginDir, 'plugin.json'),
    JSON.stringify({
      name: 'Test Mock Plugin',
      version: '1.0.0',
      description: 'Temporary plugin for testing',
      icon: 'bi-gear',
      color: '#123456',
      entry: 'index.js',
    }),
    'utf8'
  );
  await fs.writeFile(
    path.join(tempPluginDir, 'index.js'),
    `export default {
      name: 'Test Mock Plugin',
      version: '1.0.0',
      async register(app, io) {
        if (app && app.get) {
          app.get('/plugins/_test_mock_plugin/hello', (req, res) => res.json({ ok: true }));
        }
      }
    };`,
    'utf8'
  );
});

afterAll(async () => {
  try {
    await fs.rm(tempPluginDir, { recursive: true, force: true });
  } catch {}
});

describe('PluginsController - ID Validation & Security', () => {
  test('rejects missing or non-string plugin ID on install', async () => {
    const res = mockRes();
    await pluginsController.installPlugin({ body: {} }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('rejects path traversal in plugin ID on install', async () => {
    const res = mockRes();
    await pluginsController.installPlugin({ body: { id: '../../etc/passwd' } }, res);
    expect(res.statusCode).toBe(500);
    expect(res.body.message).toMatch(/traversal|Invalid plugin ID/);
  });

  test('rejects illegal characters in plugin ID', async () => {
    const res = mockRes();
    await pluginsController.installPlugin({ body: { id: 'plugin;rm -rf /' } }, res);
    expect(res.statusCode).toBe(500);
    expect(res.body.message).toMatch(/Invalid plugin ID/);
  });

  test('returns 404 if plugin directory does not exist', async () => {
    const res = mockRes();
    await pluginsController.installPlugin({ body: { id: 'nonexistent-plugin-123' } }, res);
    expect(res.statusCode).toBe(404);
    expect(res.body.message).toContain('not found');
  });
});

describe('PluginsController - Plugin Lifecycle', () => {
  test('getPlugins lists available plugins from disk', async () => {
    const res = mockRes();
    await pluginsController.getPlugins({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);

    const testItem = res.body.data.find(p => p.id === tempPluginId);
    expect(testItem).toBeDefined();
    expect(testItem.name).toBe('Test Mock Plugin');
    expect(testItem.version).toBe('1.0.0');
    expect(testItem.installed).toBe(false);
  });

  test('installPlugin registers plugin and handles proxy', async () => {
    const req = {
      body: {
        id: tempPluginId,
        proxyUrl: 'https://example.com/proxy',
      },
      app: mockApp,
    };
    const res = mockRes();
    await pluginsController.installPlugin(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify stored in Setting
    const installed = JSON.parse(await Setting.get('installed_plugins') || '[]');
    expect(installed).toContain(tempPluginId);

    const proxies = JSON.parse(await Setting.get('plugin_proxies') || '{}');
    expect(proxies[tempPluginId]).toBe('https://example.com/proxy');
  });

  test('getPlugins reflects installed status and proxy URL', async () => {
    const res = mockRes();
    await pluginsController.getPlugins({}, res);
    const testItem = res.body.data.find(p => p.id === tempPluginId);
    expect(testItem.installed).toBe(true);
    expect(testItem.proxyUrl).toBe('https://example.com/proxy');
    expect(testItem.path).toBe('https://example.com/proxy');
  });

  test('updateProxy updates or removes proxy URL', async () => {
    const reqUpdate = {
      body: { id: tempPluginId, proxyUrl: 'https://example.org/updated-proxy' },
    };
    const resUpdate = mockRes();
    await pluginsController.updateProxy(reqUpdate, resUpdate);
    expect(resUpdate.statusCode).toBe(200);

    let proxies = JSON.parse(await Setting.get('plugin_proxies') || '{}');
    expect(proxies[tempPluginId]).toBe('https://example.org/updated-proxy');

    // Remove proxy
    const reqRemove = {
      body: { id: tempPluginId, proxyUrl: '' },
    };
    const resRemove = mockRes();
    await pluginsController.updateProxy(reqRemove, resRemove);
    expect(resRemove.statusCode).toBe(200);

    proxies = JSON.parse(await Setting.get('plugin_proxies') || '{}');
    expect(proxies[tempPluginId]).toBeUndefined();
  });

  test('updateProxy rejects missing ID', async () => {
    const res = mockRes();
    await pluginsController.updateProxy({ body: {} }, res);
    expect(res.statusCode).toBe(400);
  });

  test('uninstallPlugin removes plugin from settings and memory', async () => {
    // Re-install with proxy first
    const reqInstall = {
      body: { id: tempPluginId, proxyUrl: 'https://example.com/proxy' },
      app: mockApp,
    };
    await pluginsController.installPlugin(reqInstall, mockRes());

    const req = { body: { id: tempPluginId } };
    const res = mockRes();
    await pluginsController.uninstallPlugin(req, res);
    expect(res.statusCode).toBe(200);

    const installed = JSON.parse(await Setting.get('installed_plugins') || '[]');
    expect(installed).not.toContain(tempPluginId);
    const proxies = JSON.parse(await Setting.get('plugin_proxies') || '{}');
    expect(proxies[tempPluginId]).toBeUndefined();
  });

  test('uninstallPlugin rejects missing ID', async () => {
    const res = mockRes();
    await pluginsController.uninstallPlugin({ body: {} }, res);
    expect(res.statusCode).toBe(400);
  });
});

describe('PluginsController - Marketplace & Upload', () => {
  test('getMarketplace returns curated list of plugins', async () => {
    const res = mockRes();
    await pluginsController.getMarketplace({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(10);
    expect(res.body.data.some(p => p.id === 'php-manager')).toBe(true);
  });

  test('uploadPlugin returns guidance instructions', async () => {
    const res = mockRes();
    await pluginsController.uploadPlugin({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.message).toContain('plugin zip file');
  });
});

describe('PluginsController - Update Plugin', () => {
  test('updatePlugin rejects missing ID', async () => {
    const res = mockRes();
    await pluginsController.updatePlugin({ body: {} }, res);
    expect(res.statusCode).toBe(400);
  });

  test('updatePlugin returns 404 for plugin without server update version', async () => {
    const res = mockRes();
    await pluginsController.updatePlugin({ body: { id: 'unknown-random-plugin' } }, res);
    expect(res.statusCode).toBe(404);
  });

  test('updatePlugin successfully updates php-manager manifest and restores it', async () => {
    const phpManifestPath = path.resolve('./plugins/php-manager/plugin.json');
    const originalContent = await fs.readFile(phpManifestPath, 'utf8');
    try {
      const res = mockRes();
      await pluginsController.updatePlugin({ body: { id: 'php-manager' }, app: mockApp }, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.log).toBeDefined();
    } finally {
      await fs.writeFile(phpManifestPath, originalContent, 'utf8');
    }
  });
});
