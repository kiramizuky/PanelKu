/**
 * AuditLog model — SQLite adapter
 */
import { getDb, generateId, now, toJson, fromJson } from '../core/db/sqlite.js';

function rowToLog(row) {
  if (!row) return null;
  return {
    _id:        row.id,
    id:         row.id,
    userId:     row.user_id,
    username:   row.username,
    action:     row.action,
    resource:   row.resource,
    resourceId: row.resource_id,
    details:    fromJson(row.details, null),
    ip:         row.ip,
    userAgent:  row.user_agent,
    status:     row.status,
    duration:   row.duration,
    createdAt:  new Date(row.created_at),
  };
}

const AuditLog = {
  async findById(id) {
    const db = getDb();
    return rowToLog(db.prepare('SELECT * FROM audit_logs WHERE id = ?').get(id));
  },

  async find(filter = {}, options = {}) {
    const db   = getDb();
    let stmt;
    if (filter.userId) {
      stmt = db.prepare(`SELECT * FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`);
      return stmt.all(filter.userId, options.limit || 1000).map(rowToLog);
    }
    stmt = db.prepare(`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?`);
    return stmt.all(options.limit || 1000).map(rowToLog);
  },

  // Fluent-like for .populate() — returns same data, userId is already a string
  findWithUser(filter = {}, limit = 100) {
    const db = getDb();
    let rows;
    if (filter.userId) {
      rows = db.prepare('SELECT * FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').all(filter.userId, limit);
    } else {
      rows = db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?').all(limit);
    }
    return rows.map(r => {
      const log = rowToLog(r);
      // Attach username from users table for populate simulation
      const userRow = db.prepare('SELECT username FROM users WHERE id = ?').get(r.user_id);
      if (userRow) log.userId = { _id: r.user_id, username: userRow.username };
      return log;
    });
  },

  async countDocuments(filter = {}) {
    const db = getDb();
    return db.prepare('SELECT COUNT(*) as c FROM audit_logs').get().c;
  },

  async create(data) {
    const db = getDb();
    const id = generateId();
    const ts = now();
    db.prepare(`
      INSERT INTO audit_logs (id, user_id, username, action, resource, resource_id, details, ip, user_agent, status, duration, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id,
      data.userId || null, data.username || null,
      data.action,
      data.resource || null, data.resourceId || null,
      toJson(data.details),
      data.ip || null, data.userAgent || null,
      data.status || 'success',
      data.duration || null,
      ts
    );
    return this.findById(id);
  },

  async deleteMany(filter = {}) {
    const db = getDb();
    db.prepare('DELETE FROM audit_logs').run();
  },
};

export default AuditLog;
