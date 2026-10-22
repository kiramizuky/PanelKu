import fs from 'fs/promises';
import path from 'path';
import { getDb } from '../core/db/sqlite.js';
import { getStorageDir } from '../config/paths.js';
import scheduler from '../core/scheduler/Scheduler.js';
import logger from '../config/logger.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export const RETENTION_DEFAULTS = Object.freeze({
  auditDays: 90,
  auditMaxRows: 200000,
  monitorDays: 7,
  updateHistoryEntries: 50,
  backupEntries: 10,
  logDays: 14,
});

/**
 * Delete old audit rows, then cap the table at `auditMaxRows` newest rows.
 * Uses the `created_at` index so it stays cheap even on large installs.
 */
export function pruneAuditLogs(db, { auditDays, auditMaxRows } = RETENTION_DEFAULTS) {
  const cutoff = new Date(Date.now() - auditDays * DAY_MS).toISOString();
  const byAge = db.prepare('DELETE FROM audit_logs WHERE created_at < ?').run(cutoff).changes;

  const count = db.prepare('SELECT COUNT(*) AS c FROM audit_logs').get().c;
  let byCount = 0;
  if (count > auditMaxRows) {
    byCount = db.prepare(`
      DELETE FROM audit_logs WHERE id IN (
        SELECT id FROM audit_logs ORDER BY created_at DESC LIMIT -1 OFFSET ?
      )
    `).run(auditMaxRows).changes;
  }

  return { deletedByAge: byAge, deletedByCount: byCount, remaining: Math.min(count, auditMaxRows) };
}

export function pruneMonitorHistory(db, { monitorDays } = RETENTION_DEFAULTS) {
  const cutoff = new Date(Date.now() - monitorDays * DAY_MS).toISOString();
  const deleted = db.prepare('DELETE FROM monitor_history WHERE timestamp < ?').run(cutoff).changes;
  const remaining = db.prepare('SELECT COUNT(*) AS c FROM monitor_history').get().c;
  return { deleted, remaining };
}

/**
 * Keep the update history JSON bounded. The updater used to keep 100 entries
 * forever; Sprint 1 caps it at 50 (and backups at 10).
 */
export async function pruneUpdateHistory({
  storageDir = getStorageDir(),
  updateHistoryEntries = RETENTION_DEFAULTS.updateHistoryEntries,
  backupEntries = RETENTION_DEFAULTS.backupEntries,
} = {}) {
  const file = path.join(storageDir, 'update_history.json');
  let history;
  try {
    history = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return { trimmedUpdates: 0, trimmedBackups: 0, skipped: true };
  }

  const beforeUpdates = Array.isArray(history.updates) ? history.updates.length : 0;
  const beforeBackups = Array.isArray(history.backups) ? history.backups.length : 0;

  history.updates = (history.updates || []).slice(0, updateHistoryEntries);
  history.backups = (history.backups || []).slice(0, backupEntries);

  const trimmedUpdates = beforeUpdates - history.updates.length;
  const trimmedBackups = beforeBackups - history.backups.length;

  if (trimmedUpdates > 0 || trimmedBackups > 0) {
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(history, null, 2), 'utf8');
    await fs.rename(tmp, file);
  }

  return { trimmedUpdates, trimmedBackups, skipped: false };
}

/**
 * Remove rotated winston files older than `logDays`. The active
 * `error.log` / `combined.log` are always kept.
 */
export async function pruneLogFiles({
  logsDir = path.join(getStorageDir(), 'logs'),
  logDays = RETENTION_DEFAULTS.logDays,
} = {}) {
  const keep = new Set(['error.log', 'combined.log']);
  const cutoff = Date.now() - logDays * DAY_MS;
  let deleted = 0;

  let entries;
  try {
    entries = await fs.readdir(logsDir, { withFileTypes: true });
  } catch {
    return { deleted: 0, skipped: true };
  }

  for (const entry of entries) {
    if (!entry.isFile() || keep.has(entry.name)) continue;
    const full = path.join(logsDir, entry.name);
    try {
      const stat = await fs.stat(full);
      if (stat.mtimeMs < cutoff) {
        await fs.unlink(full);
        deleted += 1;
      }
    } catch {
      // Another process may rotate/delete the file concurrently.
    }
  }

  return { deleted, skipped: false };
}

/**
 * Run all retention policies. Exported so tests and a future `panelku doctor`
 * command can invoke it without waiting for the scheduler.
 */
export async function runRetention(options = {}) {
  const config = { ...RETENTION_DEFAULTS, ...options };
  const db = getDb();

  const started = Date.now();
  const result = {
    audit: pruneAuditLogs(db, config),
    monitor: pruneMonitorHistory(db, config),
    updates: await pruneUpdateHistory({
      storageDir: config.storageDir || getStorageDir(),
      updateHistoryEntries: config.updateHistoryEntries,
      backupEntries: config.backupEntries,
    }),
    logs: await pruneLogFiles({ logsDir: config.logsDir, logDays: config.logDays }),
    durationMs: 0,
  };
  result.durationMs = Date.now() - started;

  logger.info(
    `Retention: audit -${result.audit.deletedByAge} by age / ` +
    `-${result.audit.deletedByCount} by count, monitor -${result.monitor.deleted}, ` +
    `updates -${result.updates.trimmedUpdates}, logs -${result.logs.deleted} (${result.durationMs}ms)`
  );

  return result;
}

export const startRetentionJob = () => {
  scheduler.register('retention:cleanup', async () => {
    await runRetention();
  }, 6 * 60 * 60 * 1000, false); // every 6 hours

  // Run once shortly after boot. `unref` keeps tests and CLI scripts from hanging.
  const timer = setTimeout(() => {
    runRetention().catch((err) => logger.warn(`Retention failed: ${err.message}`));
  }, 60000);
  if (typeof timer.unref === 'function') timer.unref();

  logger.info('Retention job initialized (audit 90d/200k, monitor 7d, update history 50, rotated logs)');
};
