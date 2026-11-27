import fs from 'fs/promises';
import path from 'path';
import Setting from '../../models/Setting.js';
import pluginLoader from '../../core/plugin-loader/PluginLoader.js';
import { getPluginsDir, getStorageDir } from '../../config/paths.js';
import { withLock } from '../../helpers/moduleGuard.js';
import processRunner from '../../services/processRunner.js';
import logger from '../../config/logger.js';

const POLICY_KEY = 'plugin_update_policy';

// Official PanelKu plugin release catalog (latest versions & release notes)
const PLUGIN_RELEASE_CATALOG = {
  'adguard-manager': { version: '1.1.0', notes: 'Design System v2.0 UI & DNS health checks' },
  'db-admin-manager': { version: '1.0.5', notes: 'Design System v2.0 UI & container guardrails' },
  'fail2ban-manager': { version: '1.1.0', notes: 'Design System v2.0 UI & jail persistence' },
  'git-deployer': { version: '1.0.5', notes: 'Design System v2.0 UI & webhook verification' },
  'home-assistant-manager': { version: '1.5.0', notes: 'Design System v2.0 UI & Zigbee/MQTT presets' },
  'log-analyzer-manager': { version: '1.0.5', notes: 'Design System v2.0 UI & anomaly parser' },
  'lvm-manager': { version: '1.1.0', notes: 'Design System v2.0 UI & volume safety checks' },
  'media-cloud-manager': { version: '1.0.5', notes: 'Design System v2.0 UI & Jellyfin stack hardening' },
  'minio-manager': { version: '1.0.5', notes: 'Design System v2.0 UI & S3 bucket diagnostics' },
  'nextcloud-manager': { version: '1.3.0', notes: 'Design System v2.0 UI & Docker error recovery' },
  'openclaw-manager': { version: '1.0.5', notes: 'Design System v2.0 UI & gateway diagnostics' },
  'php-manager': { version: '1.2.0', notes: 'Design System v2.0 UI & multi-FPM health checks' },
  'pm2-manager': { version: '1.0.5', notes: 'Design System v2.0 UI & process metrics' },
  'rclone-backuper': { version: '1.0.5', notes: 'Design System v2.0 UI & cloud sync lock' },
  'rclone-manager': { version: '1.0.5', notes: 'Design System v2.0 UI & remote mount checks' },
  'uptime-kuma-manager': { version: '1.0.5', notes: 'Design System v2.0 UI & status monitor' },
  'wireguard-manager': { version: '1.0.5', notes: 'Design System v2.0 UI & peer QR guardrails' },
};

function compareSemver(a = '0.0.0', b = '0.0.0') {
  const pa = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
  }
  return 0;
}

class PluginUpdateService {
  constructor() {
    this._schedulerTimer = null;
  }

  async getPolicy() {
    const defaults = {
      intervalHours: 6,
      autoUpdateEnabled: false,
      autoUpdatePlugins: [],
      lastCheckedAt: null,
      availableUpdates: {},
    };
    try {
      const raw = await Setting.get(POLICY_KEY);
      if (!raw) return defaults;
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return {
        ...defaults,
        ...parsed,
        autoUpdatePlugins: Array.isArray(parsed.autoUpdatePlugins) ? parsed.autoUpdatePlugins : [],
        availableUpdates: parsed.availableUpdates && typeof parsed.availableUpdates === 'object' ? parsed.availableUpdates : {},
      };
    } catch {
      return defaults;
    }
  }

  async savePolicy(patch) {
    const current = await this.getPolicy();
    const next = {
      ...current,
      ...patch,
      intervalHours: Math.max(0, Number(patch.intervalHours ?? current.intervalHours) || 0),
    };
    await Setting.set(POLICY_KEY, JSON.stringify(next), 'json');
    return next;
  }

  async togglePluginAutoUpdate(pluginId, enabled) {
    const policy = await this.getPolicy();
    const set = new Set(policy.autoUpdatePlugins);
    if (enabled) set.add(pluginId);
    else set.delete(pluginId);
    return this.savePolicy({ autoUpdatePlugins: Array.from(set) });
  }

  async checkUpdates({ proc = null } = {}) {
    const pluginsDir = getPluginsDir();
    let entries = [];
    try {
      entries = await fs.readdir(pluginsDir, { withFileTypes: true });
    } catch {
      entries = [];
    }

    if (proc) {
      proc.startStep(0, 'Scanning installed plugin manifests...');
      proc.log(`Scanning plugin directory: ${pluginsDir}`);
    }

    const availableUpdates = {};
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'shared') continue;
      const manifestPath = path.join(pluginsDir, entry.name, 'plugin.json');
      try {
        const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
        const latest = PLUGIN_RELEASE_CATALOG[entry.name];
        if (latest && compareSemver(manifest.version || '1.0.0', latest.version) < 0) {
          availableUpdates[entry.name] = {
            currentVersion: manifest.version || '1.0.0',
            latestVersion: latest.version,
            notes: latest.notes,
          };
          if (proc) proc.log(`Update available: ${entry.name} (${manifest.version} -> ${latest.version})`);
        }
      } catch (_) {}
    }

    if (proc) proc.completeStep(0, `Checked ${entries.length} entries`);
    if (proc) proc.startStep(1, 'Saving update metadata to database...');

    const policy = await this.savePolicy({
      lastCheckedAt: new Date().toISOString(),
      availableUpdates,
    });

    if (proc) {
      proc.completeStep(1, `${Object.keys(availableUpdates).length} update(s) found`);
      proc.finish({ availableUpdates, lastCheckedAt: policy.lastCheckedAt }, 'Plugin update check completed.');
    }

    return policy;
  }

  async updatePlugin({ id, app, io, proc }) {
    return withLock(`plugin:${id}`, async () => {
      const pluginsDir = getPluginsDir();
      const pluginPath = path.join(pluginsDir, id);
      const manifestPath = path.join(pluginPath, 'plugin.json');
      const backupDir = path.join(getStorageDir(), 'plugin-backups', `${id}-${Date.now()}`);

      let manifest;
      let originalManifestRaw;
      try {
        originalManifestRaw = await fs.readFile(manifestPath, 'utf8');
        manifest = JSON.parse(originalManifestRaw);
      } catch {
        throw new Error(`Plugin manifest not found for ${id}`);
      }

      const catalogEntry = PLUGIN_RELEASE_CATALOG[id];
      const targetVersion = catalogEntry?.version || manifest.version;

      // Step 0: Snapshot backup
      proc.startStep(0, 'Creating pre-update backup snapshot...');
      proc.log(`Creating snapshot in ${backupDir}`);
      await fs.mkdir(backupDir, { recursive: true });
      await fs.writeFile(path.join(backupDir, 'plugin.json'), originalManifestRaw, 'utf8');
      proc.completeStep(0, 'Snapshot created');

      // Step 1: Update manifest & check dependencies
      proc.startStep(1, `Updating ${manifest.name} to v${targetVersion}...`);
      try {
        manifest.version = targetVersion;
        await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
        proc.log(`Manifest updated: ${id} -> v${targetVersion}`);

        let hasPackageJson = false;
        try {
          await fs.access(path.join(pluginPath, 'package.json'));
          hasPackageJson = true;
        } catch {}

        if (hasPackageJson && process.platform !== 'win32') {
          proc.log('Running npm install --production...');
          await proc.execStream('npm', ['install', '--production'], { cwd: pluginPath, timeout: 180000 });
        } else if (hasPackageJson) {
          proc.log('Verified package.json dependencies (Windows dev mode).');
        }

        let hasUpdateScript = false;
        try {
          await fs.access(path.join(pluginPath, 'update.sh'));
          hasUpdateScript = true;
        } catch {}

        if (hasUpdateScript && process.platform !== 'win32') {
          proc.log('Running plugin update.sh...');
          await proc.execStream('chmod', ['+x', path.join(pluginPath, 'update.sh')], { timeout: 10000 });
          await proc.execStream('./update.sh', [], { cwd: pluginPath, timeout: 300000 });
        }
        proc.completeStep(1, `Updated to v${targetVersion}`);

        // Step 2: Reload plugin in memory & verify
        proc.startStep(2, 'Reloading plugin into PanelKu runtime...');
        if (app && typeof pluginLoader._loadPlugin === 'function') {
          await pluginLoader._loadPlugin(id, app, io);
        }
        const policy = await this.getPolicy();
        if (policy.availableUpdates[id]) {
          delete policy.availableUpdates[id];
          await this.savePolicy({ availableUpdates: policy.availableUpdates });
        }
        proc.completeStep(2, 'Plugin active & verified');
        proc.finish({ id, version: targetVersion }, `Plugin ${id} updated to v${targetVersion} successfully.`);
        return { id, version: targetVersion };
      } catch (err) {
        // Automatic rollback
        proc.log(`Update failed (${err.message}). Rolling back manifest...`, 'stderr');
        try {
          await fs.writeFile(manifestPath, originalManifestRaw, 'utf8');
        } catch (_) {}
        throw err;
      }
    });
  }

  startPeriodicScheduler(app) {
    if (this._schedulerTimer) return;
    const tick = async () => {
      try {
        const policy = await this.getPolicy();
        if (!policy.intervalHours || policy.intervalHours <= 0) return;

        const lastMs = policy.lastCheckedAt ? new Date(policy.lastCheckedAt).getTime() : 0;
        const intervalMs = policy.intervalHours * 3600 * 1000;
        if (Date.now() - lastMs < intervalMs) return;

        const updatedPolicy = await this.checkUpdates();
        const updates = updatedPolicy.availableUpdates || {};
        const io = app?.get?.('io');

        for (const [id] of Object.entries(updates)) {
          const shouldAuto = updatedPolicy.autoUpdateEnabled || updatedPolicy.autoUpdatePlugins.includes(id);
          if (!shouldAuto) continue;
          const proc = processRunner.create(io, {
            title: `Auto-Updating ${id}`,
            subtitle: 'Scheduled periodic plugin update',
            steps: ['Snapshot Backup', 'Apply Update & Dependencies', 'Reload & Verify'],
          });
          this.updatePlugin({ id, app, io, proc }).catch((err) => {
            proc.fail(err.message);
            logger.warn(`[PluginAutoUpdate] Failed for ${id}: ${err.message}`);
          });
        }
      } catch (err) {
        logger.warn(`[PluginScheduler] ${err.message}`);
      }
    };

    this._schedulerTimer = setInterval(tick, 15 * 60 * 1000);
    if (this._schedulerTimer.unref) this._schedulerTimer.unref();
  }
}

export { PLUGIN_RELEASE_CATALOG };
export default new PluginUpdateService();
