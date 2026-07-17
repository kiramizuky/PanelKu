/**
 * Setting model — SQLite adapter
 */
import { getDb, generateId, now, fromJson } from '../core/db/sqlite.js';

function rowToSetting(row) {
  if (!row) return null;
  let value = row.value;
  try {
    if (row.type === 'json' || row.type === 'boolean' || row.type === 'number') {
      value = JSON.parse(row.value);
    }
  } catch {}
  return {
    _id:         row.id,
    id:          row.id,
    key:         row.key,
    value,
    type:        row.type,
    group:       row.group_name,
    label:       row.label,
    description: row.description,
    isPublic:    Boolean(row.is_public),
    createdAt:   new Date(row.created_at),
    updatedAt:   new Date(row.updated_at),
  };
}

const Setting = {
  async findById(id) {
    const db = getDb();
    return rowToSetting(db.prepare('SELECT * FROM settings WHERE id = ?').get(id));
  },

  async findOne(filter) {
    const db = getDb();
    if (filter.key) return rowToSetting(db.prepare('SELECT * FROM settings WHERE key = ?').get(filter.key));
    if (filter._id) return this.findById(filter._id);
    return null;
  },

  async find(filter = {}) {
    const db = getDb();
    if (filter.group) {
      return db.prepare('SELECT * FROM settings WHERE group_name = ? ORDER BY key').all(filter.group).map(rowToSetting);
    }
    if (filter.isPublic !== undefined) {
      return db.prepare('SELECT * FROM settings WHERE is_public = ?').all(filter.isPublic ? 1 : 0).map(rowToSetting);
    }
    return db.prepare('SELECT * FROM settings ORDER BY key').all().map(rowToSetting);
  },

  async countDocuments() {
    const db = getDb();
    return db.prepare('SELECT COUNT(*) as c FROM settings').get().c;
  },

  // Static helper: Setting.get(key, defaultValue)
  async get(key, defaultValue = null) {
    const setting = await this.findOne({ key });
    return setting ? setting.value : defaultValue;
  },

  // Static helper: Setting.set(key, value, group)
  async set(key, value, group = 'general') {
    return this.findOneAndUpdate({ key }, { value, group }, { upsert: true, new: true });
  },

  async create(data) {
    const db = getDb();
    const id = generateId();
    const ts = now();
    let storedValue = data.value;
    if (typeof storedValue === 'object') storedValue = JSON.stringify(storedValue);
    else if (storedValue !== null && storedValue !== undefined) storedValue = String(storedValue);

    db.prepare(`
      INSERT INTO settings (id, key, value, type, group_name, label, description, is_public, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, data.key, storedValue,
      data.type || 'string',
      data.group || 'general',
      data.label || null,
      data.description || null,
      data.isPublic ? 1 : 0,
      ts, ts
    );
    return this.findById(id);
  },

  async findOneAndUpdate(filter, data, options = {}) {
    const db = getDb();
    const ts = now();
    let existing = await this.findOne(filter);

    if (!existing && options.upsert) {
      return this.create({ key: filter.key, ...data });
    }
    if (!existing) return null;

    let storedValue = data.value;
    if (typeof storedValue === 'object') storedValue = JSON.stringify(storedValue);
    else if (storedValue !== null && storedValue !== undefined) storedValue = String(storedValue);

    db.prepare(`
      UPDATE settings SET value = ?, group_name = ?, updated_at = ? WHERE key = ?
    `).run(storedValue, data.group || existing.group, ts, existing.key);

    return this.findOne({ key: existing.key });
  },

  async findByIdAndUpdate(id, data, options = {}) {
    return this.findOneAndUpdate({ _id: id }, data, options);
  },

  async findByIdAndDelete(id) {
    const db = getDb();
    const s = await this.findById(id);
    if (!s) return null;
    db.prepare('DELETE FROM settings WHERE id = ?').run(id);
    return s;
  },
};

export default Setting;
