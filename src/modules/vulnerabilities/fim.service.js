import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import chokidar from 'chokidar';
import logger from '../../config/logger.js';
import { getStorageDir, resolveFromRoot } from '../../config/paths.js';
import alertsService from '../alerts/alerts.service.js';

const DEFAULT_WATCH_TARGETS = [
  '/etc/passwd',
  '/etc/group',
  '/etc/sudoers',
  '/etc/ssh/sshd_config',
  '/etc/nginx/nginx.conf',
  '/etc/nginx/conf.d',
];

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

class FimService {
  constructor() {
    this._watcher = null;
    this._baseline = new Map(); // filePath -> sha256
    this._drifts = [];
    this._MAX_DRIFTS = 100;
    this._watching = false;
    this._targets = [];
  }

  _getBaselinePath() {
    return path.join(getStorageDir(), 'fim-baseline.json');
  }

  getDefaultTargets() {
    const targets = [...DEFAULT_WATCH_TARGETS];
    const envPath = resolveFromRoot('.env');
    if (fs.existsSync(envPath)) targets.push(envPath);
    return targets;
  }

  _expandFiles(targets) {
    const files = [];
    for (const target of targets) {
      try {
        if (!fs.existsSync(target)) continue;
        const stat = fs.statSync(target);
        if (stat.isFile()) {
          files.push(target);
        } else if (stat.isDirectory()) {
          for (const entry of fs.readdirSync(target)) {
            const full = path.join(target, entry);
            try {
              if (fs.statSync(full).isFile()) files.push(full);
            } catch {}
          }
        }
      } catch {}
    }
    return [...new Set(files)];
  }

  /**
   * Compute and persist SHA-256 baseline hashes for all existing critical targets.
   */
  initBaseline(customTargets = null) {
    this._targets = Array.isArray(customTargets) && customTargets.length > 0
      ? customTargets
      : this.getDefaultTargets();

    const files = this._expandFiles(this._targets);
    this._baseline.clear();

    for (const f of files) {
      try {
        this._baseline.set(f, sha256File(f));
      } catch (err) {
        logger.debug(`FIM skipped unreadable file ${f}: ${err.message}`);
      }
    }

    try {
      const baselineObj = Object.fromEntries(this._baseline.entries());
      fs.mkdirSync(path.dirname(this._getBaselinePath()), { recursive: true });
      fs.writeFileSync(
        this._getBaselinePath(),
        JSON.stringify({ updatedAt: new Date().toISOString(), hashes: baselineObj }, null, 2),
        { mode: 0o600 }
      );
    } catch (err) {
      logger.warn(`FIM failed to persist baseline: ${err.message}`);
    }

    return {
      trackedCount: this._baseline.size,
      files: [...this._baseline.keys()],
    };
  }

  /**
   * Compare current SHA-256 hashes against the stored baseline.
   */
  async checkNow(options = {}) {
    const driftsFound = [];
    for (const [filePath, expectedHash] of this._baseline.entries()) {
      if (!fs.existsSync(filePath)) {
        const drift = await this._recordDrift(filePath, 'unlink', expectedHash, null, options.notify !== false);
        driftsFound.push(drift);
        continue;
      }
      try {
        const currentHash = sha256File(filePath);
        if (currentHash !== expectedHash) {
          const drift = await this._recordDrift(filePath, 'change', expectedHash, currentHash, options.notify !== false);
          driftsFound.push(drift);
        }
      } catch {}
    }
    return {
      checkedCount: this._baseline.size,
      driftCount: driftsFound.length,
      drifts: driftsFound,
    };
  }

  async _recordDrift(filePath, event, oldHash, newHash, notify = true) {
    const entry = {
      id: `fim-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      file: filePath,
      event,
      oldHash,
      newHash,
      detectedAt: new Date().toISOString(),
    };
    this._drifts.unshift(entry);
    if (this._drifts.length > this._MAX_DRIFTS) {
      this._drifts.length = this._MAX_DRIFTS;
    }

    logger.warn(`[FIM-Drift] ${event.toUpperCase()} detected on ${filePath} (old=${oldHash?.slice(0, 12)}, new=${newHash?.slice(0, 12) || 'DELETED'})`);

    if (notify) {
      try {
        await alertsService.dispatchMultiChannelAlert({
          title: `File Integrity Drift Detected (${event.toUpperCase()})`,
          message: `Critical file modified: ${filePath}\nEvent: ${event}\nPrevious SHA-256: ${oldHash || 'N/A'}\nCurrent SHA-256: ${newHash || 'DELETED'}`,
          level: 'critical',
          metadata: entry,
        });
      } catch (err) {
        logger.debug(`FIM alert dispatch error: ${err.message}`);
      }
    }

    return entry;
  }

  /**
   * Start real-time chokidar file integrity watcher.
   */
  startWatcher(customTargets = null) {
    if (this._watching) return { watching: true, trackedCount: this._baseline.size };

    this.initBaseline(customTargets);
    const existingTargets = this._targets.filter((t) => fs.existsSync(t));
    if (existingTargets.length === 0) {
      return { watching: false, trackedCount: 0 };
    }

    this._watcher = chokidar.watch(existingTargets, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    });

    const handleEvent = async (event, filePath) => {
      const prevHash = this._baseline.get(filePath) || null;
      if (event === 'unlink') {
        if (prevHash) await this._recordDrift(filePath, 'unlink', prevHash, null, true);
        return;
      }
      try {
        const nextHash = sha256File(filePath);
        if (prevHash !== nextHash) {
          await this._recordDrift(filePath, event, prevHash, nextHash, true);
        }
      } catch {}
    };

    this._watcher.on('change', (p) => handleEvent('change', p));
    this._watcher.on('add', (p) => handleEvent('add', p));
    this._watcher.on('unlink', (p) => handleEvent('unlink', p));
    this._watcher.on('error', (err) => logger.warn(`FIM watcher error: ${err.message}`));

    this._watching = true;
    logger.info(`FIM watcher active on ${this._baseline.size} critical file(s)`);
    return { watching: true, trackedCount: this._baseline.size };
  }

  async stopWatcher() {
    if (this._watcher) {
      await this._watcher.close();
      this._watcher = null;
    }
    this._watching = false;
  }

  /**
   * Accept an authorized file change and update its baseline SHA-256 hash.
   */
  acceptDrift(filePath) {
    if (!fs.existsSync(filePath)) {
      this._baseline.delete(filePath);
    } else {
      this._baseline.set(filePath, sha256File(filePath));
    }
    this._drifts = this._drifts.filter((d) => d.file !== filePath);
    return { accepted: true, file: filePath, hash: this._baseline.get(filePath) || null };
  }

  getStatus() {
    return {
      watching: this._watching,
      trackedCount: this._baseline.size,
      driftCount: this._drifts.length,
      recentDrifts: this._drifts.slice(0, 25),
      trackedFiles: [...this._baseline.keys()],
    };
  }
}

export default new FimService();
