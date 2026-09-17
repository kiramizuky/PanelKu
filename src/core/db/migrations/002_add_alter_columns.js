/**
 * Migration 002: Add ALTER TABLE Columns
 * Adds columns that were previously added via inline ALTER TABLE in sqlite.js:
 * - alert_configs.whatsapp
 * - users.ai_settings, is_ldap_user, sso_links, must_change_password, password_changed_at
 * - websites.git_branch, target_host
 */

export const version = '002';
export const name = 'add_alter_columns';

export function up(db) {
  const migrations = [
    {
      sql: `ALTER TABLE alert_configs ADD COLUMN whatsapp TEXT NOT NULL DEFAULT '{"enabled":false,"phoneNumber":""}'`,
      label: 'alert_configs.whatsapp',
    },
    {
      sql: `ALTER TABLE users ADD COLUMN ai_settings TEXT NOT NULL DEFAULT '{"provider":"openai","apiKey":"","model":"gpt-4o-mini"}'`,
      label: 'users.ai_settings',
    },
    {
      sql: `ALTER TABLE users ADD COLUMN is_ldap_user INTEGER NOT NULL DEFAULT 0`,
      label: 'users.is_ldap_user',
    },
    {
      sql: `ALTER TABLE users ADD COLUMN sso_links TEXT NOT NULL DEFAULT '{}'`,
      label: 'users.sso_links',
    },
    {
      sql: `ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0`,
      label: 'users.must_change_password',
    },
    {
      sql: `ALTER TABLE users ADD COLUMN password_changed_at TEXT`,
      label: 'users.password_changed_at',
    },
    {
      sql: `ALTER TABLE websites ADD COLUMN git_branch TEXT NOT NULL DEFAULT ''`,
      label: 'websites.git_branch',
    },
    {
      sql: `ALTER TABLE websites ADD COLUMN target_host TEXT NOT NULL DEFAULT '127.0.0.1'`,
      label: 'websites.target_host',
    },
  ];

  for (const m of migrations) {
    try {
      db.exec(m.sql);
    } catch (e) {
      // SQLite doesn't have "IF NOT EXISTS" for ADD COLUMN — ignore duplicate column errors
      if (!e.message.includes('duplicate column')) {
        throw e;
      }
    }
  }
}

export function down(_db) {
  // SQLite does not support DROP COLUMN before 3.35.0
  // For older SQLite versions, we would need to recreate the table.
  // Since this is a Panelku-specific migration, we skip down() for ALTER TABLE ADD.
  // The down migration is a no-op for safety.
}
