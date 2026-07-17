/**
 * Session model — SQLite adapter
 */
import { getDb, generateId, now } from '../core/db/sqlite.js';

function rowToSession(row) {
  if (!row) return null;
  return {
    _id:          row.id,
    id:           row.id,
    userId:       row.user_id,
    refreshToken: row.refresh_token,
    deviceInfo:   row.device_info,
    userAgent:    row.user_agent,
    ip:           row.ip,
    isActive:     Boolean(row.is_active),
    lastActive:   row.last_active ? new Date(row.last_active) : null,
    expiresAt:    row.expires_at ? new Date(row.expires_at) : null,
    createdAt:    new Date(row.created_at),
  };
}

const Session = {
  async findById(id) {
    const db = getDb();
    return rowToSession(db.prepare('SELECT * FROM sessions WHERE id = ?').get(id));
  },

  async findOne(filter) {
    const db = getDb();
    if (filter.refreshToken) {
      const row = db.prepare('SELECT * FROM sessions WHERE refresh_token = ? AND is_active = 1').get(filter.refreshToken);
      return rowToSession(row);
    }
    if (filter._id) return this.findById(filter._id);
    return null;
  },

  async find(filter = {}) {
    const db = getDb();
    if (filter.userId) {
      const rows = db.prepare(
        'SELECT * FROM sessions WHERE user_id = ? AND is_active = ? ORDER BY last_active DESC'
      ).all(filter.userId, filter.isActive !== false ? 1 : 0);
      return rows.map(rowToSession);
    }
    const rows = db.prepare('SELECT * FROM sessions ORDER BY created_at DESC').all();
    return rows.map(rowToSession);
  },

  async create(data) {
    const db = getDb();
    const id = generateId();
    const ts = now();
    db.prepare(`
      INSERT INTO sessions (id, user_id, refresh_token, device_info, user_agent, ip, is_active, last_active, expires_at, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, data.userId, data.refreshToken,
      data.deviceInfo || null, data.userAgent || null, data.ip || null,
      1,
      ts, data.expiresAt instanceof Date ? data.expiresAt.toISOString() : data.expiresAt,
      ts
    );
    return this.findById(id);
  },

  async findByIdAndUpdate(id, data, _options = {}) {
    const db = getDb();
    const ts = now();
    const sets = [];
    const vals = [];
    if (data.isActive !== undefined) { sets.push('is_active = ?'); vals.push(data.isActive ? 1 : 0); }
    if (data.lastActive !== undefined) { sets.push('last_active = ?'); vals.push(data.lastActive instanceof Date ? data.lastActive.toISOString() : ts); }
    if (!sets.length) return this.findById(id);
    vals.push(id);
    db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    return this.findById(id);
  },

  async updateMany(filter, update) {
    const db = getDb();
    if (filter.userId && update.isActive !== undefined) {
      db.prepare('UPDATE sessions SET is_active = ? WHERE user_id = ?').run(update.isActive ? 1 : 0, filter.userId);
    }
  },

  async deleteMany(filter) {
    const db = getDb();
    if (filter.expiresAt?.$lt) {
      db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(filter.expiresAt.$lt.toISOString());
    }
  },
};

export default Session;
