/**
 * SQLite Database Singleton
 * Replaces MongoDB/Mongoose as the primary data store.
 * Uses better-sqlite3 (synchronous, zero-config).
 *
 * All table definitions live here so the DB is fully self-initializing
 * on first run — no manual migration steps required.
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import logger from '../../config/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(process.cwd(), 'storage', 'panelku.db');

// Ensure storage directory exists
mkdirSync(resolve(process.cwd(), 'storage'), { recursive: true });

let _db = null;

export function getDb() {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    _db.pragma('synchronous = NORMAL');
    initSchema(_db);
    logger.info(`SQLite database initialized at ${DB_PATH}`);
  }
  return _db;
}

/** Create all tables on first open */
function initSchema(db) {
  db.exec(`
    -- Roles
    CREATE TABLE IF NOT EXISTS roles (
      id            TEXT PRIMARY KEY,
      name          TEXT UNIQUE NOT NULL,
      slug          TEXT UNIQUE NOT NULL,
      description   TEXT,
      permissions   TEXT NOT NULL DEFAULT '[]',
      is_system     INTEGER NOT NULL DEFAULT 0,
      is_active     INTEGER NOT NULL DEFAULT 1,
      color         TEXT NOT NULL DEFAULT '#6c757d',
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );

    -- Users
    CREATE TABLE IF NOT EXISTS users (
      id                  TEXT PRIMARY KEY,
      username            TEXT UNIQUE NOT NULL,
      email               TEXT UNIQUE NOT NULL,
      password            TEXT NOT NULL,
      role_id             TEXT NOT NULL REFERENCES roles(id),
      first_name          TEXT,
      last_name           TEXT,
      avatar              TEXT,
      two_factor_enabled  INTEGER NOT NULL DEFAULT 0,
      two_factor_secret   TEXT,
      api_key             TEXT,
      api_key_enabled     INTEGER NOT NULL DEFAULT 0,
      is_active           INTEGER NOT NULL DEFAULT 1,
      is_super_admin      INTEGER NOT NULL DEFAULT 0,
      sessions            TEXT NOT NULL DEFAULT '[]',
      last_login          TEXT,
      last_login_ip       TEXT,
      login_count         INTEGER NOT NULL DEFAULT 0,
      reset_token         TEXT,
      reset_token_expiry  TEXT,
      created_at          TEXT NOT NULL,
      updated_at          TEXT NOT NULL
    );

    -- Sessions (refresh tokens)
    CREATE TABLE IF NOT EXISTS sessions (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES users(id),
      refresh_token TEXT UNIQUE NOT NULL,
      device_info   TEXT,
      user_agent    TEXT,
      ip            TEXT,
      is_active     INTEGER NOT NULL DEFAULT 1,
      last_active   TEXT,
      expires_at    TEXT NOT NULL,
      created_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id   ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_token     ON sessions(refresh_token);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires   ON sessions(expires_at);

    -- Websites
    CREATE TABLE IF NOT EXISTS websites (
      id              TEXT PRIMARY KEY,
      domain          TEXT UNIQUE NOT NULL,
      aliases         TEXT NOT NULL DEFAULT '[]',
      type            TEXT NOT NULL DEFAULT 'static',
      root_directory  TEXT NOT NULL,
      git_repo        TEXT NOT NULL DEFAULT '',
      webhook_token   TEXT NOT NULL DEFAULT '',
      auto_deploy     INTEGER NOT NULL DEFAULT 0,
      php_version     TEXT NOT NULL DEFAULT '8.2',
      port            INTEGER,
      status          TEXT NOT NULL DEFAULT 'active',
      ssl             TEXT NOT NULL DEFAULT '{}',
      settings        TEXT NOT NULL DEFAULT '{}',
      owner_id        TEXT NOT NULL REFERENCES users(id),
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );

    -- Settings
    CREATE TABLE IF NOT EXISTS settings (
      id          TEXT PRIMARY KEY,
      key         TEXT UNIQUE NOT NULL,
      value       TEXT,
      type        TEXT NOT NULL DEFAULT 'string',
      group_name  TEXT NOT NULL DEFAULT 'general',
      label       TEXT,
      description TEXT,
      is_public   INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    -- Audit Logs
    CREATE TABLE IF NOT EXISTS audit_logs (
      id          TEXT PRIMARY KEY,
      user_id     TEXT,
      username    TEXT,
      action      TEXT NOT NULL,
      resource    TEXT,
      resource_id TEXT,
      details     TEXT,
      ip          TEXT,
      user_agent  TEXT,
      status      TEXT NOT NULL DEFAULT 'success',
      duration    INTEGER,
      created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_user_id   ON audit_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_action    ON audit_logs(action);
    CREATE INDEX IF NOT EXISTS idx_audit_created   ON audit_logs(created_at);

    -- Alert Configurations (singleton)
    CREATE TABLE IF NOT EXISTS alert_configs (
      id          TEXT PRIMARY KEY,
      singleton   TEXT UNIQUE NOT NULL DEFAULT 'global',
      telegram    TEXT NOT NULL DEFAULT '{"enabled":false,"botToken":"","chatId":""}',
      email       TEXT NOT NULL DEFAULT '{"enabled":false,"smtpHost":"","smtpPort":587,"smtpUser":"","smtpPass":"","fromAddress":"","toAddress":""}',
      discord     TEXT NOT NULL DEFAULT '{"enabled":false,"webhookUrl":""}',
      slack       TEXT NOT NULL DEFAULT '{"enabled":false,"webhookUrl":""}',
      webhook     TEXT NOT NULL DEFAULT '{"enabled":false,"url":""}',
      thresholds  TEXT NOT NULL DEFAULT '{"cpuPercent":90,"ramPercent":90,"diskPercent":90}',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    -- Monitor History (capped at 10,000 rows via cleanup job)
    CREATE TABLE IF NOT EXISTS monitor_history (
      id        TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      metrics   TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_monitor_ts ON monitor_history(timestamp);

    -- WAF Rules
    CREATE TABLE IF NOT EXISTS waf_rules (
      id          TEXT PRIMARY KEY,
      type        TEXT NOT NULL,
      value       TEXT NOT NULL,
      action      TEXT NOT NULL,
      description TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    -- Notifications
    CREATE TABLE IF NOT EXISTS notifications (
      id         TEXT PRIMARY KEY,
      user_id    TEXT,
      title      TEXT NOT NULL,
      message    TEXT NOT NULL,
      type       TEXT NOT NULL DEFAULT 'info',
      icon       TEXT,
      link       TEXT,
      is_read    INTEGER NOT NULL DEFAULT 0,
      is_global  INTEGER NOT NULL DEFAULT 0,
      metadata   TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notif_user_id ON notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_notif_read    ON notifications(is_read);

    -- WhatsApp Sessions
    CREATE TABLE IF NOT EXISTS whatsapp_sessions (
      id            TEXT PRIMARY KEY,
      session_name  TEXT UNIQUE NOT NULL,
      status        TEXT NOT NULL DEFAULT 'disconnected',
      webhook_url   TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );

    -- Cluster Nodes (Agent Nodes)
    CREATE TABLE IF NOT EXISTS cluster_nodes (
      id            TEXT PRIMARY KEY,
      name          TEXT UNIQUE NOT NULL,
      ip_address    TEXT NOT NULL,
      port          INTEGER NOT NULL DEFAULT 23456,
      api_key       TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'offline',
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );
  `);
}

// ── Convenience helpers ────────────────────────────────────────────────────

/** Generate a new UUID */
export function generateId() {
  return uuidv4();
}

/** Current ISO timestamp */
export function now() {
  return new Date().toISOString();
}

/** Serialize a JS value to JSON string for storage */
export function toJson(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/** Deserialize a JSON string from storage */
export function fromJson(str, fallback = null) {
  if (str === null || str === undefined) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

export default getDb;
