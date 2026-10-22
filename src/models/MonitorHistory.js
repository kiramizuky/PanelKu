/**
 * MonitorHistory model — SQLite adapter
 * Capped at 10,000 rows via cleanup on insert.
 */
import { getDb, generateId, toJson, fromJson } from '../core/db/sqlite.js';

const MAX_ROWS = 10_000;
let rowCount = null;
let rowCountDb = null;

function getRowCount(db) {
  if (rowCount === null || rowCountDb !== db) {
    rowCount = db.prepare('SELECT COUNT(*) AS c FROM monitor_history').get().c;
    rowCountDb = db;
  }
  return rowCount;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

const AGGREGATE_BUCKETS = [30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600, 43200, 86400];

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
  async find(filter = {}, options = {}) {
    const db = getDb();
    let query = 'SELECT * FROM monitor_history';
    const params = [];

    const since = filter?.since || filter?.timestamp?.$gte || (filter?.timestamp instanceof Date ? filter.timestamp : null);
    if (since) {
      query += ' WHERE timestamp >= ?';
      params.push(since instanceof Date ? since.toISOString() : String(since));
    }

    query += ' ORDER BY timestamp DESC';
    const limit = options.limit || (since ? MAX_ROWS : 1000);
    query += ' LIMIT ?';
    params.push(limit);

    const rows = db.prepare(query).all(...params);
    return rows.map(rowToHistory).reverse();
  },

  /**
   * Downsample history in SQLite instead of loading every row into Node.
   * The query filters by timestamp in SQL, buckets with strftime(), and
   * aggregates the JSON metric fields. Falls back to find() if JSON1 is not
   * available in a custom SQLite build.
   */
  async aggregate({ since, maxPoints = 500 } = {}) {
    const db = getDb();
    const sinceDate = since instanceof Date ? since : new Date(since || Date.now() - 24 * 3600 * 1000);
    const sinceIso = sinceDate.toISOString();
    const sinceMs = sinceDate.getTime();
    const rangeSec = Math.max(60, (Date.now() - sinceMs) / 1000);
    const points = Math.max(5, Math.min(2000, Number(maxPoints) || 500));
    const idealBucket = rangeSec / points;
    const bucketSeconds = AGGREGATE_BUCKETS.find((b) => b >= idealBucket) || AGGREGATE_BUCKETS[AGGREGATE_BUCKETS.length - 1];

    try {
      const rows = db.prepare(`
        SELECT
          CAST(strftime('%s', timestamp) AS INTEGER) / CAST(? AS INTEGER) AS bucket,
          AVG(json_extract(metrics, '$.cpu')) AS cpu,
          AVG(json_extract(metrics, '$.ramUsed')) AS ramUsed,
          MAX(json_extract(metrics, '$.ramTotal')) AS ramTotal,
          AVG(json_extract(metrics, '$.ramPercent')) AS ramPercent,
          AVG(json_extract(metrics, '$.diskUsed')) AS diskUsed,
          MAX(json_extract(metrics, '$.diskTotal')) AS diskTotal,
          AVG(json_extract(metrics, '$.diskPercent')) AS diskPercent,
          AVG(json_extract(metrics, '$.networkRx')) AS networkRx,
          AVG(json_extract(metrics, '$.networkTx')) AS networkTx,
          AVG(json_extract(metrics, '$.diskRead')) AS diskRead,
          AVG(json_extract(metrics, '$.diskWrite')) AS diskWrite,
          AVG(json_extract(metrics, '$.loadAvg[0]')) AS load1,
          AVG(json_extract(metrics, '$.loadAvg[1]')) AS load5,
          AVG(json_extract(metrics, '$.loadAvg[2]')) AS load15
        FROM monitor_history
        WHERE timestamp >= ?
        GROUP BY bucket
        ORDER BY bucket ASC
      `).all(bucketSeconds, sinceIso);

      const count = db.prepare('SELECT COUNT(*) AS c FROM monitor_history WHERE timestamp >= ?').get(sinceIso).c;

      const series = rows.map((row) => {
        const ramTotal = num(row.ramTotal);
        const ramUsed = num(row.ramUsed);
        const ramPercent = row.ramPercent === null
          ? (ramTotal ? Math.round((ramUsed / ramTotal) * 100) : 0)
          : num(row.ramPercent);
        return {
          t: num(row.bucket) * bucketSeconds * 1000,
          cpu: Math.round(num(row.cpu)),
          ramUsed: Math.round(ramUsed),
          ramTotal: Math.round(ramTotal),
          ramPercent: Math.round(ramPercent),
          diskUsed: num(row.diskUsed),
          diskTotal: num(row.diskTotal),
          diskPercent: Math.round(num(row.diskPercent)),
          networkRx: num(row.networkRx),
          networkTx: num(row.networkTx),
          diskRead: num(row.diskRead),
          diskWrite: num(row.diskWrite),
          loadAvg: [num(row.load1), num(row.load5), num(row.load15)],
        };
      });

      return { series, count, bucketSeconds };
    } catch {
      const all = await this.find({ since: sinceDate });
      const step = all.length > points ? Math.ceil(all.length / points) : 1;
      const sampled = all.filter((_, i) => i % step === 0);
      return {
        series: sampled.map((h) => {
          const m = h.metrics || {};
          return {
            t: new Date(h.timestamp).getTime(),
            cpu: m.cpu ?? 0,
            ramUsed: m.ramUsed ?? 0,
            ramTotal: m.ramTotal ?? 0,
            ramPercent: m.ramPercent ?? (m.ramTotal ? Math.round((m.ramUsed / m.ramTotal) * 100) : 0),
            diskUsed: m.diskUsed ?? 0,
            diskTotal: m.diskTotal ?? 0,
            diskPercent: m.diskPercent ?? 0,
            networkRx: m.networkRx ?? 0,
            networkTx: m.networkTx ?? 0,
            diskRead: m.diskRead ?? 0,
            diskWrite: m.diskWrite ?? 0,
            loadAvg: m.loadAvg ?? [0, 0, 0],
          };
        }),
        count: all.length,
        bucketSeconds,
      };
    }
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

    // Cleanup: keep only the newest MAX_ROWS rows. The row count is cached
    // in memory so the hot monitor job does not run COUNT(*) on every insert.
    const count = getRowCount(db) + 1;
    rowCount = count;
    if (count > MAX_ROWS) {
      const remove = count - MAX_ROWS + 100;
      const deleted = db.prepare(`
        DELETE FROM monitor_history WHERE id IN (
          SELECT id FROM monitor_history ORDER BY timestamp ASC LIMIT ?
        )
      `).run(remove).changes;
      rowCount -= deleted;
    }

    return rowToHistory(db.prepare('SELECT * FROM monitor_history WHERE id = ?').get(id));
  },

  async deleteMany() {
    getDb().prepare('DELETE FROM monitor_history').run();
    rowCount = 0;
    rowCountDb = getDb();
  },
};

export default MonitorHistory;
