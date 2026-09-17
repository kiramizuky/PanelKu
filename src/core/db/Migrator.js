/**
 * SQLite Migration Runner
 *
 * Manages schema versioning via a `schema_migrations` table.
 * Each migration file exports { version, name, up(db), down(db) }.
 *
 * Usage:
 *   import { runMigrations } from './Migrator.js';
 *   runMigrations(db);  // applies all pending migrations
 */

import { readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import logger from '../../config/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

/**
 * Ensure the schema_migrations tracking table exists.
 */
function ensureMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      checksum    TEXT NOT NULL,
      applied_at  TEXT NOT NULL
    );
  `);
}

/**
 * Get all applied migration versions from the tracking table.
 */
function getAppliedMigrations(db) {
  const rows = db.prepare('SELECT version FROM schema_migrations ORDER BY version ASC').all();
  return new Set(rows.map(r => r.version));
}

/**
 * Load all migration files from the migrations directory.
 * Files are sorted by version number (filename prefix).
 */
async function loadMigrationFiles() {
  let files;
  try {
    files = await readdir(MIGRATIONS_DIR);
  } catch {
    return [];
  }

  const migrationFiles = files
    .filter(f => f.endsWith('.js'))
    .sort();

  const migrations = [];
  for (const file of migrationFiles) {
    try {
      const fileUrl = pathToFileURL(join(MIGRATIONS_DIR, file)).href;
      const mod = await import(fileUrl);
      migrations.push({
        version: mod.version,
        name: mod.name,
        up: mod.up,
        down: mod.down,
        file,
      });
    } catch (err) {
      logger.error(`Failed to load migration ${file}: ${err.message}`);
    }
  }

  return migrations;
}

/**
 * Compute a simple checksum for a migration file (content hash).
 * Used to detect if a migration was modified after being applied.
 */
function computeChecksum(migration) {
  const content = `${migration.version}:${migration.name}:${migration.up.toString()}`;
  // Simple hash — not cryptographic, just for change detection
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return hash.toString(16);
}

/**
 * Run all pending migrations in order.
 * @param {import('better-sqlite3').Database} db - SQLite database instance
 * @returns {{ applied: string[], skipped: string[] }} - Lists of applied and skipped versions
 */
export async function runMigrations(db) {
  ensureMigrationsTable(db);

  const applied = getAppliedMigrations(db);
  const migrations = await loadMigrationFiles();

  const appliedList = [];
  const skippedList = [];

  for (const migration of migrations) {
    if (applied.has(migration.version)) {
      skippedList.push(migration.version);
      continue;
    }

    logger.info(`Migration: Applying ${migration.version} — ${migration.name}`);

    const checksum = computeChecksum(migration);

    try {
      // Run migration inside a transaction
      db.transaction(() => {
        migration.up(db);

        db.prepare(
          'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)'
        ).run(migration.version, migration.name, checksum, new Date().toISOString());
      })();

      appliedList.push(migration.version);
      logger.info(`Migration: ${migration.version} applied successfully`);
    } catch (err) {
      logger.error(`Migration: ${migration.version} failed: ${err.message}`);
      throw err;
    }
  }

  return { applied: appliedList, skipped: skippedList };
}

/**
 * Rollback the last applied migration.
 * @param {import('better-sqlite3').Database} db - SQLite database instance
 * @returns {{ rolledBack: string | null }}
 */
export async function rollbackMigration(db) {
  ensureMigrationsTable(db);

  const last = db.prepare(
    'SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1'
  ).get();

  if (!last) {
    logger.info('No migrations to rollback');
    return { rolledBack: null };
  }

  const migrations = await loadMigrationFiles();
  const migration = migrations.find(m => m.version === last.version);

  if (!migration) {
    logger.warn(`Migration file for version ${last.version} not found — cannot rollback`);
    return { rolledBack: null };
  }

  if (!migration.down) {
    logger.warn(`Migration ${last.version} has no down() function — cannot rollback`);
    return { rolledBack: null };
  }

  try {
    db.transaction(() => {
      migration.down(db);
      db.prepare('DELETE FROM schema_migrations WHERE version = ?').run(last.version);
    })();

    logger.info(`Migration: ${last.version} rolled back`);
    return { rolledBack: last.version };
  } catch (err) {
    logger.error(`Migration rollback ${last.version} failed: ${err.message}`);
    throw err;
  }
}

/**
 * Get migration status (applied and pending).
 * @param {import('better-sqlite3').Database} db
 * @returns {Promise<{ applied: object[], pending: object[] }>}
 */
export async function getMigrationStatus(db) {
  ensureMigrationsTable(db);

  const applied = getAppliedMigrations(db);
  const migrations = await loadMigrationFiles();

  const appliedList = [];
  const pendingList = [];

  for (const migration of migrations) {
    if (applied.has(migration.version)) {
      appliedList.push({ version: migration.version, name: migration.name });
    } else {
      pendingList.push({ version: migration.version, name: migration.name });
    }
  }

  return { applied: appliedList, pending: pendingList };
}
