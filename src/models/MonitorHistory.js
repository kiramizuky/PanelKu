/**
 * MonitorHistory model — SQLite adapter
 * Capped at 10,000 rows via cleanup on insert.
 */
import { getDb, generateId, toJson, fromJson } from '../core/db/sqlite.js';

const MAX_ROWS = 10_000;

function rowToHistory(row) {
  if (!row) return null;
  return {
    _id:       row.id,
    id:        row.id,
    timestamp: new Date(row.timestamp),
    metrics:   fromJson(row.metrics, {}),
  };
}

const MonitorHistory = {
  async find(_filter = {}, options = {}) {
    const db    = getDb();
    const limit = options.limit || 1000;
    const rows  = db.prepare('SELECT * FROM monitor_history ORDER BY timestamp DESC LIMIT ?').all(limit);
    return rows.map(rowToHistory).reverse();
  },

  async create(data) {
    const db = getDb();
    const id = generateId();
    const ts = data.timestamp instanceof Date
      ? data.timestamp.toISOString()
      : (data.timestamp || new Date().toISOString());

    db.prepare('INSERT INTO monitor_history (id, timestamp, metrics) VALUES (?,?,?)').run(
      id, ts, toJson(data.metrics || {})
    );

    // Cleanup: keep only last MAX_ROWS rows
    const count = db.prepare('SELECT COUNT(*) as c FROM monitor_history').get().c;
    if (count > MAX_ROWS) {
      db.prepare(`
        DELETE FROM monitor_history WHERE id IN (
          SELECT id FROM monitor_history ORDER BY timestamp ASC LIMIT ?
        )
      `).run(count - MAX_ROWS);
    }

    return rowToHistory(db.prepare('SELECT * FROM monitor_history WHERE id = ?').get(id));
  },

  async deleteMany() {
    getDb().prepare('DELETE FROM monitor_history').run();
  },
};

export default MonitorHistory;
