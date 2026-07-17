/**
 * AlertConfig model — SQLite adapter (singleton pattern)
 */
import { getDb, generateId, now, toJson, fromJson } from '../core/db/sqlite.js';

const DEFAULTS = {
  telegram:   { enabled: false, botToken: '', chatId: '' },
  email:      { enabled: false, smtpHost: '', smtpPort: 587, smtpUser: '', smtpPass: '', fromAddress: '', toAddress: '' },
  discord:    { enabled: false, webhookUrl: '' },
  slack:      { enabled: false, webhookUrl: '' },
  webhook:    { enabled: false, url: '' },
  whatsapp:   { enabled: false, phoneNumber: '' },
  thresholds: { cpuPercent: 90, ramPercent: 90, diskPercent: 90 },
};

function rowToConfig(row) {
  if (!row) return null;
  return {
    _id:        row.id,
    id:         row.id,
    singleton:  row.singleton,
    telegram:   fromJson(row.telegram, DEFAULTS.telegram),
    email:      fromJson(row.email, DEFAULTS.email),
    discord:    fromJson(row.discord, DEFAULTS.discord),
    slack:      fromJson(row.slack, DEFAULTS.slack),
    webhook:    fromJson(row.webhook, DEFAULTS.webhook),
    whatsapp:   fromJson(row.whatsapp, DEFAULTS.whatsapp),
    thresholds: fromJson(row.thresholds, DEFAULTS.thresholds),
    createdAt:  new Date(row.created_at),
    updatedAt:  new Date(row.updated_at),
    toJSON()   { return { ...this }; },
    toObject() { return { ...this }; },
  };
}

const AlertConfig = {
  async findById(id) {
    const db = getDb();
    return rowToConfig(db.prepare('SELECT * FROM alert_configs WHERE id = ?').get(id));
  },

  async findOne(_filter = {}) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM alert_configs WHERE singleton = ?').get('global');
    if (row) return rowToConfig(row);

    // Auto-create singleton if missing
    const id = generateId();
    const ts = now();
    db.prepare(`
      INSERT INTO alert_configs (id, singleton, telegram, email, discord, slack, webhook, whatsapp, thresholds, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, 'global',
      toJson(DEFAULTS.telegram), toJson(DEFAULTS.email),
      toJson(DEFAULTS.discord), toJson(DEFAULTS.slack),
      toJson(DEFAULTS.webhook), toJson(DEFAULTS.whatsapp), toJson(DEFAULTS.thresholds),
      ts, ts
    );
    return rowToConfig(db.prepare('SELECT * FROM alert_configs WHERE id = ?').get(id));
  },

  async findOneAndUpdate(filter, data, _options = {}) {
    const db = getDb();
    const ts = now();
    let existing = await this.findOne(filter);
    if (!existing) return null;

    db.prepare(`
      UPDATE alert_configs SET telegram=?, email=?, discord=?, slack=?, webhook=?, whatsapp=?, thresholds=?, updated_at=?
      WHERE id=?
    `).run(
      toJson(data.telegram   ?? existing.telegram),
      toJson(data.email      ?? existing.email),
      toJson(data.discord    ?? existing.discord),
      toJson(data.slack      ?? existing.slack),
      toJson(data.webhook    ?? existing.webhook),
      toJson(data.whatsapp   ?? existing.whatsapp),
      toJson(data.thresholds ?? existing.thresholds),
      ts, existing.id
    );
    return this.findById(existing.id);
  },
};

export default AlertConfig;
