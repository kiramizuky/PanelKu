/**
 * WafRule model — SQLite adapter
 */
import { getDb, generateId, now } from '../core/db/sqlite.js';

function rowToRule(row) {
  if (!row) return null;
  return {
    _id:         row.id,
    id:          row.id,
    type:        row.type,
    value:       row.value,
    action:      row.action,
    description: row.description,
    createdAt:   new Date(row.created_at),
    updatedAt:   new Date(row.updated_at),
    toJSON()   { return { ...this }; },
    toObject() { return { ...this }; },
  };
}

const WafRule = {
  async findById(id) {
    const db = getDb();
    return rowToRule(db.prepare('SELECT * FROM waf_rules WHERE id = ?').get(id));
  },

  async findOne(filter) {
    const db = getDb();
    if (filter._id) return this.findById(filter._id);
    if (filter.value && filter.type) {
      return rowToRule(db.prepare('SELECT * FROM waf_rules WHERE value = ? AND type = ?').get(filter.value, filter.type));
    }
    return null;
  },

  async find(filter = {}) {
    const db = getDb();
    if (filter.type) {
      return db.prepare('SELECT * FROM waf_rules WHERE type = ? ORDER BY created_at DESC').all(filter.type).map(rowToRule);
    }
    return db.prepare('SELECT * FROM waf_rules ORDER BY created_at DESC').all().map(rowToRule);
  },

  async countDocuments() {
    const db = getDb();
    return db.prepare('SELECT COUNT(*) as c FROM waf_rules').get().c;
  },

  async create(data) {
    const db = getDb();
    const id = generateId();
    const ts = now();
    db.prepare(`
      INSERT INTO waf_rules (id, type, value, action, description, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?)
    `).run(id, data.type, data.value, data.action, data.description || null, ts, ts);
    return this.findById(id);
  },

  async findByIdAndUpdate(id, data, _options = {}) {
    const db = getDb();
    const ts = now();
    const existing = await this.findById(id);
    if (!existing) return null;
    const upd = data.$set || data;
    db.prepare(`
      UPDATE waf_rules SET type=?, value=?, action=?, description=?, updated_at=? WHERE id=?
    `).run(
      upd.type ?? existing.type,
      upd.value ?? existing.value,
      upd.action ?? existing.action,
      upd.description ?? existing.description,
      ts, id
    );
    return this.findById(id);
  },

  async findByIdAndDelete(id) {
    const db = getDb();
    const r = await this.findById(id);
    if (!r) return null;
    db.prepare('DELETE FROM waf_rules WHERE id = ?').run(id);
    return r;
  },

  async deleteMany(_filter = {}) {
    const db = getDb();
    db.prepare('DELETE FROM waf_rules').run();
  },
};

export default WafRule;
