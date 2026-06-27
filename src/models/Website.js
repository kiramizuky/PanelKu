/**
 * Website model — SQLite adapter
 */
import { getDb, generateId, now, toJson, fromJson } from '../core/db/sqlite.js';

function rowToWebsite(row) {
  if (!row) return null;
  return {
    _id:           row.id,
    id:            row.id,
    domain:        row.domain,
    aliases:       fromJson(row.aliases, []),
    type:          row.type,
    rootDirectory: row.root_directory,
    gitRepo:       row.git_repo,
    webhookToken:  row.webhook_token,
    autoDeploy:    Boolean(row.auto_deploy),
    phpVersion:    row.php_version,
    port:          row.port,
    status:        row.status,
    ssl:           fromJson(row.ssl, {}),
    settings:      fromJson(row.settings, {}),
    owner:         row.owner_id,
    createdAt:     new Date(row.created_at),
    updatedAt:     new Date(row.updated_at),
    toJSON()   { return { ...this }; },
    toObject() { return { ...this }; },
  };
}

const Website = {
  async findById(id) {
    const db = getDb();
    return rowToWebsite(db.prepare('SELECT * FROM websites WHERE id = ?').get(id));
  },

  async findOne(filter) {
    const db = getDb();
    if (filter.domain) return rowToWebsite(db.prepare('SELECT * FROM websites WHERE domain = ?').get(filter.domain));
    if (filter._id)    return this.findById(filter._id);
    return null;
  },

  async find(filter = {}) {
    const db = getDb();
    let rows;
    if (filter.owner && filter.status) {
      rows = db.prepare('SELECT * FROM websites WHERE owner_id = ? AND status = ? ORDER BY created_at DESC').all(filter.owner, filter.status);
    } else if (filter.owner) {
      rows = db.prepare('SELECT * FROM websites WHERE owner_id = ? ORDER BY created_at DESC').all(filter.owner);
    } else if (filter.status) {
      rows = db.prepare('SELECT * FROM websites WHERE status = ? ORDER BY created_at DESC').all(filter.status);
    } else {
      rows = db.prepare('SELECT * FROM websites ORDER BY created_at DESC').all();
    }
    return rows.map(rowToWebsite);
  },

  async countDocuments(filter = {}) {
    const db = getDb();
    return db.prepare('SELECT COUNT(*) as c FROM websites').get().c;
  },

  async create(data) {
    const db = getDb();
    const id = generateId();
    const ts = now();
    db.prepare(`
      INSERT INTO websites (id, domain, aliases, type, root_directory, git_repo, webhook_token,
        auto_deploy, php_version, port, status, ssl, settings, owner_id, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, data.domain.toLowerCase(),
      toJson(data.aliases || []),
      data.type || 'static',
      data.rootDirectory,
      data.gitRepo || '',
      data.webhookToken || '',
      data.autoDeploy ? 1 : 0,
      data.phpVersion || '8.2',
      data.port || null,
      data.status || 'active',
      toJson(data.ssl || {}),
      toJson(data.settings || {}),
      data.owner || data.owner_id,
      ts, ts
    );
    return this.findById(id);
  },

  async findByIdAndUpdate(id, update, options = {}) {
    const db = getDb();
    const ts = now();
    const existing = await this.findById(id);
    if (!existing) return null;

    const data = update.$set || update;
    db.prepare(`
      UPDATE websites SET
        domain = ?, aliases = ?, type = ?, root_directory = ?, git_repo = ?,
        webhook_token = ?, auto_deploy = ?, php_version = ?, port = ?,
        status = ?, ssl = ?, settings = ?, owner_id = ?, updated_at = ?
      WHERE id = ?
    `).run(
      data.domain ?? existing.domain,
      toJson(data.aliases ?? existing.aliases),
      data.type ?? existing.type,
      data.rootDirectory ?? existing.rootDirectory,
      data.gitRepo ?? existing.gitRepo,
      data.webhookToken ?? existing.webhookToken,
      data.autoDeploy !== undefined ? (data.autoDeploy ? 1 : 0) : (existing.autoDeploy ? 1 : 0),
      data.phpVersion ?? existing.phpVersion,
      data.port ?? existing.port,
      data.status ?? existing.status,
      toJson(data.ssl ?? existing.ssl),
      toJson(data.settings ?? existing.settings),
      data.owner ?? existing.owner,
      ts, id
    );
    return this.findById(id);
  },

  async findByIdAndDelete(id) {
    const db = getDb();
    const w = await this.findById(id);
    if (!w) return null;
    db.prepare('DELETE FROM websites WHERE id = ?').run(id);
    return w;
  },
};

export default Website;
