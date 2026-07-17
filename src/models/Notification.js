/**
 * Notification model — SQLite adapter
 */
import { getDb, generateId, now, toJson, fromJson } from '../core/db/sqlite.js';

function rowToNotif(row) {
  if (!row) return null;
  return {
    _id:       row.id,
    id:        row.id,
    userId:    row.user_id,
    title:     row.title,
    message:   row.message,
    type:      row.type,
    icon:      row.icon,
    link:      row.link,
    isRead:    Boolean(row.is_read),
    isGlobal:  Boolean(row.is_global),
    metadata:  fromJson(row.metadata, null),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    toJSON()   { return { ...this }; },
    toObject() { return { ...this }; },
  };
}

const Notification = {
  async findById(id) {
    const db = getDb();
    return rowToNotif(db.prepare('SELECT * FROM notifications WHERE id = ?').get(id));
  },

  async findOne(filter) {
    if (filter._id) return this.findById(filter._id);
    return null;
  },

  async find(filter = {}, options = {}) {
    const db = getDb();
    const limit = options.limit || 100;
    let rows;
    if (filter.userId) {
      rows = db.prepare(`
        SELECT * FROM notifications WHERE (user_id = ? OR is_global = 1) ORDER BY created_at DESC LIMIT ?
      `).all(filter.userId, limit);
    } else {
      rows = db.prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?').all(limit);
    }
    return rows.map(rowToNotif);
  },

  async countDocuments(filter = {}) {
    const db = getDb();
    if (filter.userId && filter.isRead === false) {
      return db.prepare('SELECT COUNT(*) as c FROM notifications WHERE (user_id = ? OR is_global = 1) AND is_read = 0').get(filter.userId).c;
    }
    return db.prepare('SELECT COUNT(*) as c FROM notifications').get().c;
  },

  async create(data) {
    const db = getDb();
    const id = generateId();
    const ts = now();
    db.prepare(`
      INSERT INTO notifications (id, user_id, title, message, type, icon, link, is_read, is_global, metadata, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, data.userId || null, data.title, data.message,
      data.type || 'info', data.icon || null, data.link || null,
      0, data.isGlobal ? 1 : 0,
      toJson(data.metadata), ts, ts
    );
    return this.findById(id);
  },

  async findByIdAndUpdate(id, data, _options = {}) {
    const db = getDb();
    const ts = now();
    const upd = data.$set || data;
    db.prepare('UPDATE notifications SET is_read = ?, updated_at = ? WHERE id = ?').run(
      upd.isRead ? 1 : 0, ts, id
    );
    return this.findById(id);
  },

  async updateMany(filter, update) {
    const db = getDb();
    const ts = now();
    if (filter.userId && update.$set?.isRead !== undefined) {
      db.prepare('UPDATE notifications SET is_read = ?, updated_at = ? WHERE user_id = ?').run(
        update.$set.isRead ? 1 : 0, ts, filter.userId
      );
    }
  },

  async findByIdAndDelete(id) {
    const db = getDb();
    const n = await this.findById(id);
    if (!n) return null;
    db.prepare('DELETE FROM notifications WHERE id = ?').run(id);
    return n;
  },

  async deleteMany(filter = {}) {
    const db = getDb();
    if (filter.userId) {
      db.prepare('DELETE FROM notifications WHERE user_id = ?').run(filter.userId);
    } else {
      db.prepare('DELETE FROM notifications').run();
    }
  },
};

export default Notification;
