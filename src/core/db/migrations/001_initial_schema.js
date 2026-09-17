/**
 * Migration 001: Initial Schema
 * Creates all base tables for Panelku.
 */

export const version = '001';
export const name = 'initial_schema';

export function up(db) {
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

    -- Honeypot Hits & Traps
    CREATE TABLE IF NOT EXISTS honeypot_hits (
      id          TEXT PRIMARY KEY,
      ip          TEXT NOT NULL,
      path        TEXT NOT NULL,
      user_agent  TEXT,
      payload     TEXT,
      action      TEXT NOT NULL DEFAULT 'auto_ban',
      created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_honeypot_ip ON honeypot_hits(ip);
    CREATE INDEX IF NOT EXISTS idx_honeypot_created ON honeypot_hits(created_at);

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

    -- WebAuthn / Passkeys (FIDO2 credentials)
    CREATE TABLE IF NOT EXISTS passkeys (
      id             TEXT PRIMARY KEY,
      user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      credential_id  TEXT UNIQUE NOT NULL,
      public_key     TEXT NOT NULL,
      counter        INTEGER NOT NULL DEFAULT 0,
      device_name    TEXT,
      transports     TEXT NOT NULL DEFAULT '[]',
      aaguid         TEXT,
      created_at     TEXT NOT NULL,
      last_used_at   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_passkeys_user_id ON passkeys(user_id);
    CREATE INDEX IF NOT EXISTS idx_passkeys_cred_id ON passkeys(credential_id);

    -- WebPush Subscriptions
    CREATE TABLE IF NOT EXISTS webpush_subscriptions (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint    TEXT UNIQUE NOT NULL,
      keys_p256dh TEXT NOT NULL,
      keys_auth   TEXT NOT NULL,
      user_agent  TEXT,
      created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_webpush_user_id ON webpush_subscriptions(user_id);

    -- Automated Security & CVE Scans
    CREATE TABLE IF NOT EXISTS security_scans (
      id          TEXT PRIMARY KEY,
      score       INTEGER NOT NULL,
      summary     TEXT NOT NULL DEFAULT '{}',
      findings    TEXT NOT NULL DEFAULT '[]',
      created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_security_scans_created ON security_scans(created_at);

    -- Incident Post-Mortem & RCA Reports
    CREATE TABLE IF NOT EXISTS incident_reports (
      id                  TEXT PRIMARY KEY,
      title               TEXT NOT NULL,
      incident_type       TEXT NOT NULL,
      severity            TEXT NOT NULL DEFAULT 'warning',
      summary             TEXT NOT NULL,
      root_cause          TEXT NOT NULL,
      impact_timeline     TEXT NOT NULL DEFAULT '[]',
      remediation_action  TEXT,
      status              TEXT NOT NULL DEFAULT 'resolved',
      created_at          TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_incident_created ON incident_reports(created_at);

    -- Instant Volume Snapshots & Rollback Points
    CREATE TABLE IF NOT EXISTS backup_snapshots (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      target_path   TEXT NOT NULL,
      snapshot_path TEXT NOT NULL,
      size_bytes    INTEGER NOT NULL DEFAULT 0,
      type          TEXT NOT NULL DEFAULT 'directory',
      is_locked     INTEGER NOT NULL DEFAULT 0,
      description   TEXT,
      created_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_created ON backup_snapshots(created_at);
  `);
}

export function down(db) {
  const tables = [
    'backup_snapshots', 'incident_reports', 'security_scans',
    'webpush_subscriptions', 'passkeys', 'cluster_nodes',
    'whatsapp_sessions', 'notifications', 'honeypot_hits',
    'waf_rules', 'monitor_history', 'alert_configs',
    'audit_logs', 'settings', 'websites', 'sessions', 'users', 'roles',
  ];
  for (const table of tables) {
    db.exec(`DROP TABLE IF EXISTS ${table}`);
  }
}
