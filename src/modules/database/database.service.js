import mysql from 'mysql2/promise';
import pkg from 'pg';
const { Client } = pkg;
import path from 'path';
import fs from 'fs/promises';




class DatabaseService {
  constructor() {
    this.mysqlPool = null;
    this.pgClient = null;
    this.queryHistory = [];
  }

  async loadMysqlConfig() {
    try {
      const { default: Setting } = await import('../../models/Setting.js');
      let saved = await Setting.get('db_credentials_mysql');
      if (typeof saved === 'string') {
        try { saved = JSON.parse(saved); } catch (_) {}
      }
      if (saved && typeof saved === 'object') {
        return {
          host: saved.host || process.env.DB_MYSQL_HOST || 'localhost',
          port: parseInt(saved.port || process.env.DB_MYSQL_PORT || 3306),
          user: saved.user || process.env.DB_MYSQL_USER || 'root',
          password: saved.password !== undefined ? String(saved.password) : (process.env.DB_MYSQL_PASSWORD || ''),
        };
      }
    } catch (_) {}
    return {
      host: process.env.DB_MYSQL_HOST || 'localhost',
      port: parseInt(process.env.DB_MYSQL_PORT || 3306),
      user: process.env.DB_MYSQL_USER || 'root',
      password: process.env.DB_MYSQL_PASSWORD || '',
    };
  }

  async loadPgConfig() {
    try {
      const { default: Setting } = await import('../../models/Setting.js');
      let saved = await Setting.get('db_credentials_pg');
      if (typeof saved === 'string') {
        try { saved = JSON.parse(saved); } catch (_) {}
      }
      if (saved && typeof saved === 'object') {
        return {
          host: saved.host || process.env.DB_PG_HOST || 'localhost',
          port: parseInt(saved.port || process.env.DB_PG_PORT || 5432),
          user: saved.user || process.env.DB_PG_USER || 'postgres',
          password: saved.password !== undefined ? String(saved.password) : (process.env.DB_PG_PASSWORD !== undefined ? String(process.env.DB_PG_PASSWORD) : ''),
          database: saved.database || 'postgres'
        };
      }
    } catch (_) {}
    return {
      host: process.env.DB_PG_HOST || 'localhost',
      port: parseInt(process.env.DB_PG_PORT || 5432),
      user: process.env.DB_PG_USER || 'postgres',
      password: process.env.DB_PG_PASSWORD !== undefined ? String(process.env.DB_PG_PASSWORD) : '',
      database: 'postgres'
    };
  }

  async resetConnections() {
    if (this.mysqlPool) {
      try { await this.mysqlPool.end(); } catch (_) {}
      this.mysqlPool = null;
    }
    if (this.pgClient) {
      try { await this.pgClient.end(); } catch (_) {}
      this.pgClient = null;
    }
  }

  async getMysqlConnection() {
    if (!this.mysqlPool) {
      const config = await this.loadMysqlConfig();
      this.mysqlPool = mysql.createPool(config);
    }
    return this.mysqlPool;
  }

  async getPgConnection() {
    if (this.pgClient) {
      try {
        await this.pgClient.query('SELECT 1');
        return this.pgClient;
      } catch (_) {
        this.pgClient = null;
      }
    }

    const config = await this.loadPgConfig();
    let lastErr = null;

    // 1. If Linux and no password provided, try Unix Domain Socket first (/var/run/postgresql) for peer auth
    if (process.platform === 'linux' && (config.host === 'localhost' || config.host === '127.0.0.1') && !config.password) {
      try {
        const socketClient = new Client({
          host: '/var/run/postgresql',
          user: config.user || 'postgres',
          database: config.database || 'postgres',
        });
        await socketClient.connect();
        this.pgClient = socketClient;
        return this.pgClient;
      } catch (_) {}
    }

    // 2. TCP Client
    const clientOptions = {
      host: config.host,
      port: config.port,
      user: config.user,
      password: String(config.password ?? ''),
      database: config.database || 'postgres',
    };

    try {
      const client = new Client(clientOptions);
      await client.connect();
      this.pgClient = client;
      return this.pgClient;
    } catch (err) {
      lastErr = err;
    }

    // 3. Fallback on Linux: Try Unix Domain Socket if TCP connection failed
    if (process.platform === 'linux' && (config.host === 'localhost' || config.host === '127.0.0.1')) {
      try {
        const socketClient = new Client({
          host: '/var/run/postgresql',
          user: config.user || 'postgres',
          database: config.database || 'postgres',
        });
        await socketClient.connect();
        this.pgClient = socketClient;
        return this.pgClient;
      } catch (_) {}
    }

    if (lastErr?.message?.includes('SASL') || lastErr?.message?.includes('password')) {
      throw new Error(`PostgreSQL authentication failed for user '${config.user}'. Please check DB Credentials in settings.`);
    }

    throw new Error('Failed to connect to PostgreSQL: ' + (lastErr?.message || 'Connection failed'));
  }

  async getCredentials() {
    const mysqlCfg = await this.loadMysqlConfig();
    const pgCfg = await this.loadPgConfig();
    return {
      mysql: { host: mysqlCfg.host, port: mysqlCfg.port, user: mysqlCfg.user, password: mysqlCfg.password },
      postgres: { host: pgCfg.host, port: pgCfg.port, user: pgCfg.user, password: pgCfg.password }
    };
  }

  async saveCredentials(type, data) {
    const { default: Setting } = await import('../../models/Setting.js');
    if (type === 'mysql') {
      const payload = {
        host: data.host || 'localhost',
        port: parseInt(data.port || 3306),
        user: data.user || 'root',
        password: String(data.password ?? ''),
      };
      await Setting.set('db_credentials_mysql', payload, 'json');
    } else if (type === 'postgres') {
      const payload = {
        host: data.host || 'localhost',
        port: parseInt(data.port || 5432),
        user: data.user || 'postgres',
        password: String(data.password ?? ''),
        database: 'postgres',
      };
      await Setting.set('db_credentials_pg', payload, 'json');
    }
    await this.resetConnections();
  }

  _sanitizeDbName(name) {
    if (!name || !/^[a-zA-Z_][a-zA-Z0-9_$]{0,63}$/.test(name)) {
      throw new Error(`Invalid database name: "${name}". Use only letters, numbers, and underscores.`);
    }
    return name;
  }

  _sanitizeTableName(name) {
    if (!name || !/^[a-zA-Z_][a-zA-Z0-9_$]{0,127}$/.test(name)) {
      throw new Error(`Invalid table name: "${name}".`);
    }
    return name;
  }

  _sanitizeColumnName(name) {
    if (!name || !/^[a-zA-Z_][a-zA-Z0-9_$]{0,127}$/.test(name)) {
      throw new Error(`Invalid column name: "${name}".`);
    }
    return name;
  }

  // ── Database Listing ───────────────────────────────────────

  async listMysqlDatabases() {
    try {
      const pool = await this.getMysqlConnection();
      const [rows] = await pool.query('SHOW DATABASES');
      return rows.map(r => r.Database).filter(d => !['information_schema', 'mysql', 'performance_schema', 'sys'].includes(d));
    } catch (err) { return []; }
  }

  async listPgDatabases() {
    try {
      const client = await this.getPgConnection();
      const res = await client.query('SELECT datname FROM pg_database WHERE datistemplate = false;');
      return res.rows.map(r => r.datname).filter(d => d !== 'postgres');
    } catch (err) { return []; }
  }

  async listSqliteDatabases() {
    try {
      const dbDir = path.resolve('storage', 'databases');
      await fs.mkdir(dbDir, { recursive: true });
      const files = await fs.readdir(dbDir);
      return files.filter(f => f.endsWith('.sqlite') || f.endsWith('.db'));
    } catch (err) { return []; }
  }

  // ── Database CRUD ──────────────────────────────────────────

  async createMysqlDatabase(name) {
    this._sanitizeDbName(name);
    const pool = await this.getMysqlConnection();
    await pool.query('CREATE DATABASE IF NOT EXISTS `' + name + '`');
    return true;
  }

  async deleteMysqlDatabase(name) {
    this._sanitizeDbName(name);
    const pool = await this.getMysqlConnection();
    await pool.query('DROP DATABASE IF EXISTS `' + name + '`');
    return true;
  }

  async createPgDatabase(name) {
    this._sanitizeDbName(name);
    const client = await this.getPgConnection();
    await client.query('CREATE DATABASE "' + name + '"');
    return true;
  }

  async deletePgDatabase(name) {
    this._sanitizeDbName(name);
    const client = await this.getPgConnection();
    await client.query('DROP DATABASE "' + name + '"');
    return true;
  }

  async createSqliteDatabase(name) {
    const dbDir = path.resolve('storage', 'databases');
    await fs.mkdir(dbDir, { recursive: true });
    const filename = name.endsWith('.sqlite') || name.endsWith('.db') ? name : `${name}.sqlite`;
    const dbPath = path.join(dbDir, filename);
    const handle = await fs.open(dbPath, 'w');
    await handle.close();
    return true;
  }

  async deleteSqliteDatabase(name) {
    const dbDir = path.resolve('storage', 'databases');
    const dbPath = path.join(dbDir, name);
    await fs.unlink(dbPath);
    return true;
  }

  // ── Tables ─────────────────────────────────────────────────

  async getTables(type, name) {
    if (type === 'sqlite') {
      const Database = (await import('better-sqlite3')).default;
      const dbPath = path.resolve('storage', 'databases', name);
      const db = new Database(dbPath);
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => r.name);
      db.close();
      return tables;
    } else if (type === 'mysql') {
      const pool = await this.getMysqlConnection();
      this._sanitizeDbName(name);
      await pool.query('USE `' + name + '`');
      const [rows] = await pool.query('SHOW TABLES');
      return rows.map(r => Object.values(r)[0]);
    } else if (type === 'postgres') {
      const pkgPg = (await import('pg')).default;
      const client = new pkgPg.Client({ ...this.pgConfig, database: name });
      await client.connect();
      const res = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;");
      await client.end();
      return res.rows.map(r => r.table_name);
    }
    throw new Error('Unsupported database type');
  }

  // ── Table Info (Structure, Indexes, Foreign Keys) ──────────

  async getTableInfo(type, dbName, tableName) {
    this._sanitizeTableName(tableName);
    if (type === 'mysql') {
      this._sanitizeDbName(dbName);
      const pool = await this.getMysqlConnection();
      await pool.query('USE `' + dbName + '`');
      const [columns] = await pool.query('SHOW FULL COLUMNS FROM `' + tableName + '`');
      const [indexes] = await pool.query('SHOW INDEX FROM `' + tableName + '`');
      const [foreignKeys] = await pool.query(
        'SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE ' +
        'WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL',
        [dbName, tableName]
      );
      const [createTable] = await pool.query('SHOW CREATE TABLE `' + tableName + '`');
      return {
        columns: columns.map(c => ({
          field: c.Field,
          type: c.Type,
          nullable: c.Null === 'YES',
          key: c.Key,
          default: c.Default,
          extra: c.Extra,
          privileges: c.Privileges,
          comment: c.Comment,
        })),
        indexes: this._formatMysqlIndexes(indexes),
        foreignKeys,
        createTable: createTable[0]?.['Create Table'] || '',
        rowCount: 0,
      };
    } else if (type === 'postgres') {
      const pkgPg = (await import('pg')).default;
      const client = new pkgPg.Client({ ...this.pgConfig, database: dbName });
      await client.connect();
      const colRes = await client.query(
        "SELECT column_name, data_type, is_nullable, column_default, character_maximum_length " +
        "FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
        [tableName]
      );
      const idxRes = await client.query(
        "SELECT indexname, indexdef FROM pg_indexes WHERE tablename=$1 AND schemaname='public'",
        [tableName]
      );
      const fkRes = await client.query(
        "SELECT kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name " +
        "FROM information_schema.table_constraints AS tc " +
        "JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name " +
        "JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name " +
        "WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = $1",
        [tableName]
      );
      const countRes = await client.query('SELECT COUNT(*) as cnt FROM "' + tableName + '"');
      await client.end();
      return {
        columns: colRes.rows.map(c => ({
          field: c.column_name,
          type: c.data_type + (c.character_maximum_length ? '(' + c.character_maximum_length + ')' : ''),
          nullable: c.is_nullable === 'YES',
          key: '',
          default: c.column_default,
          extra: '',
        })),
        indexes: idxRes.rows.map(i => ({ name: i.indexname, definition: i.indexdef })),
        foreignKeys: fkRes.rows,
        createTable: '',
        rowCount: parseInt(countRes.rows[0]?.cnt || 0),
      };
    } else if (type === 'sqlite') {
      const Database = (await import('better-sqlite3')).default;
      const dbPath = path.resolve('storage', 'databases', dbName);
      const db = new Database(dbPath);
      const cols = db.prepare('PRAGMA table_info(`' + tableName + '`)').all();
      const idx = db.prepare('PRAGMA index_list(`' + tableName + '`)').all();
      const fk = db.prepare('PRAGMA foreign_key_list(`' + tableName + '`)').all();
      const countRow = db.prepare('SELECT COUNT(*) as cnt FROM `' + tableName + '`').get();
      // Get CREATE TABLE statement
      const createRow = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(tableName);
      db.close();
      return {
        columns: cols.map(c => ({
          field: c.name,
          type: c.type,
          nullable: c.notnull === 0,
          key: c.pk ? 'PRI' : '',
          default: c.dflt_value,
          extra: c.pk > 1 ? 'composite key' : '',
        })),
        indexes: idx.map(i => ({ name: i.name, unique: i.unique ? 1 : 0 })),
        foreignKeys: fk,
        createTable: createRow?.sql || '',
        rowCount: countRow?.cnt || 0,
      };
    }
    throw new Error('Unsupported database type');
  }

  _formatMysqlIndexes(indexes) {
    const map = {};
    for (const idx of indexes) {
      if (!map[idx.Key_name]) {
        map[idx.Key_name] = { name: idx.Key_name, unique: !idx.Non_unique, columns: [] };
      }
      map[idx.Key_name].columns.push(idx.Column_name);
    }
    return Object.values(map);
  }

  // ── Table Data with Pagination ─────────────────────────────

  async getTableData(type, dbName, tableName, page = 1, limit = 50, sortColumn = null, sortDir = 'ASC') {
    this._sanitizeTableName(tableName);
    const offset = (page - 1) * limit;
    let orderClause = '';
    if (sortColumn) {
      this._sanitizeColumnName(sortColumn);
      const dir = sortDir === 'DESC' ? 'DESC' : 'ASC';
      if (type === 'mysql') orderClause = ` ORDER BY \`${sortColumn}\` ${dir}`;
      else if (type === 'postgres') orderClause = ` ORDER BY "${sortColumn}" ${dir}`;
      else orderClause = ` ORDER BY "${sortColumn}" ${dir}`;
    }

    if (type === 'mysql') {
      this._sanitizeDbName(dbName);
      const pool = await this.getMysqlConnection();
      await pool.query('USE `' + dbName + '`');
      const [rows] = await pool.query('SELECT * FROM `' + tableName + '`' + orderClause + ' LIMIT ' + parseInt(limit) + ' OFFSET ' + parseInt(offset));
      const [countRows] = await pool.query('SELECT COUNT(*) as total FROM `' + tableName + '`');
      return { rows, total: countRows[0]?.total || 0 };
    } else if (type === 'postgres') {
      const pkgPg = (await import('pg')).default;
      const client = new pkgPg.Client({ ...this.pgConfig, database: dbName });
      await client.connect();
      const dataRes = await client.query('SELECT * FROM "' + tableName + '"' + orderClause + ' LIMIT ' + parseInt(limit) + ' OFFSET ' + parseInt(offset));
      const countRes = await client.query('SELECT COUNT(*) as total FROM "' + tableName + '"');
      await client.end();
      return { rows: dataRes.rows, total: parseInt(countRes.rows[0]?.total || 0) };
    } else if (type === 'sqlite') {
      const Database = (await import('better-sqlite3')).default;
      const dbPath = path.resolve('storage', 'databases', dbName);
      const db = new Database(dbPath);
      const rows = db.prepare('SELECT * FROM "' + tableName + '"' + orderClause + ' LIMIT ? OFFSET ?').all(limit, offset);
      const countRow = db.prepare('SELECT COUNT(*) as total FROM "' + tableName + '"').get();
      db.close();
      return { rows, total: countRow?.total || 0 };
    }
    throw new Error('Unsupported database type');
  }

  // ── Query Console ──────────────────────────────────────────

  async runQuery(type, name, query) {
    const upper = query.trim().toUpperCase();
    if (upper.startsWith('DROP') || upper.startsWith('TRUNCATE') || upper.startsWith('ALTER')) {
      throw new Error('DROP, TRUNCATE, and ALTER are restricted via UI.');
    }

    // Save to history
    this.queryHistory.unshift({ type, database: name, query, timestamp: new Date().toISOString() });
    if (this.queryHistory.length > 100) this.queryHistory.pop();

    if (type === 'sqlite') {
      const Database = (await import('better-sqlite3')).default;
      const dbPath = path.resolve('storage', 'databases', name);
      const db = new Database(dbPath);
      try {
        const stmt = db.prepare(query);
        const info = stmt.reader ? stmt.all() : { changes: stmt.run().changes };
        db.close();
        return { rows: Array.isArray(info) ? info : [], affected: info.changes || 0, columns: Array.isArray(info) && info.length > 0 ? Object.keys(info[0]) : [] };
      } catch (err) {
        db.close();
        throw err;
      }
    } else if (type === 'mysql') {
      const pool = await this.getMysqlConnection();
      await pool.query('USE `' + name + '`');
      if (upper.startsWith('SELECT') || upper.startsWith('SHOW') || upper.startsWith('DESCRIBE') || upper.startsWith('EXPLAIN')) {
        const [rows] = await pool.query(query);
        return { rows: Array.isArray(rows) ? rows : [], columns: rows.length > 0 ? Object.keys(rows[0]) : [], affected: 0 };
      } else {
        const [result] = await pool.query(query);
        return { rows: [], columns: [], affected: result.affectedRows || 0, insertId: result.insertId };
      }
    } else if (type === 'postgres') {
      const pkgPg = (await import('pg')).default;
      const client = new pkgPg.Client({ ...this.pgConfig, database: name });
      await client.connect();
      try {
        const res = await client.query(query);
        await client.end();
        return { rows: res.rows || [], columns: res.fields?.map(f => f.name) || [], affected: res.rowCount || 0 };
      } catch (err) {
        await client.end();
        throw err;
      }
    }
    throw new Error('Unsupported database type');
  }

  getQueryHistory() {
    return this.queryHistory;
  }

  clearQueryHistory() {
    this.queryHistory = [];
  }

  // ── Export ─────────────────────────────────────────────────

  async exportData(type, dbName, tableName, format = 'json') {
    this._sanitizeTableName(tableName);
    const { rows } = await this.getTableData(type, dbName, tableName, 1, 100000);
    const dbDir = path.resolve('storage', 'exports');
    await fs.mkdir(dbDir, { recursive: true });

    const timestamp = Date.now();
    let filename, content, mime;

    if (format === 'json') {
      filename = `${tableName}_${timestamp}.json`;
      content = JSON.stringify(rows, null, 2);
      mime = 'application/json';
    } else if (format === 'csv') {
      filename = `${tableName}_${timestamp}.csv`;
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      let csv = columns.join(',') + '\n';
      for (const row of rows) {
        csv += columns.map(c => {
          const val = row[c];
          if (val === null || val === undefined) return '';
          const str = String(val);
          return str.includes(',') || str.includes('"') || str.includes('\n') ? '"' + str.replace(/"/g, '""') + '"' : str;
        }).join(',') + '\n';
      }
      content = csv;
      mime = 'text/csv';
    } else if (format === 'sql') {
      filename = `${tableName}_${timestamp}.sql`;
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      let sql = `-- Export of ${tableName} at ${new Date().toISOString()}\n`;
      for (const row of rows) {
        const vals = columns.map(c => {
          const v = row[c];
          if (v === null || v === undefined) return 'NULL';
          return typeof v === 'string' ? "'" + v.replace(/'/g, "''") + "'" : String(v);
        }).join(', ');
        sql += `INSERT INTO \`${tableName}\` (\`${columns.join('`, `')}\`) VALUES (${vals});\n`;
      }
      content = sql;
      mime = 'text/plain';
    } else {
      throw new Error('Unsupported export format');
    }

    const filePath = path.join(dbDir, filename);
    await fs.writeFile(filePath, content, 'utf8');
    return { filename, filePath, mime, content };
  }

  // ── Import ─────────────────────────────────────────────────

  async importSql(type, dbName, sqlContent) {
    // Split by semicolons and execute each statement
    const statements = sqlContent.split(';').filter(s => s.trim().length > 0);
    let count = 0;
    for (const stmt of statements) {
      const trimmed = stmt.trim();
      const upper = trimmed.toUpperCase();
      // Only allow INSERT statements for safety
      if (upper.startsWith('INSERT') || upper.startsWith('UPDATE') || upper.startsWith('DELETE')) {
        try {
          await this.runQuery(type, dbName, trimmed);
          count++;
        } catch (e) {
          // Skip problematic statements
        }
      }
    }
    return { imported: count };
  }

  async importCsv(type, dbName, tableName, csvContent) {
    this._sanitizeTableName(tableName);
    const lines = csvContent.split('\n').filter(l => l.trim());
    if (lines.length < 2) throw new Error('CSV must have header + at least one row');

    const columns = lines[0].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    let imported = 0;

    for (let i = 1; i < lines.length; i++) {
      const values = [];
      let current = '';
      let inQuote = false;
      for (const ch of lines[i]) {
        if (ch === '"') { inQuote = !inQuote; }
        else if (ch === ',' && !inQuote) { values.push(current); current = ''; }
        else { current += ch; }
      }
      values.push(current);

      if (values.length !== columns.length) continue;

      const setClause = columns.map((c, idx) => {
        const val = values[idx]?.trim();
        return { column: c, value: val === '' || val === undefined ? null : val };
      });

      // Build INSERT statement per row
      const colList = setClause.map(s => '`' + s.column + '`').join(', ');
      const valList = setClause.map(s => {
        if (s.value === null) return 'NULL';
        return "'" + String(s.value).replace(/'/g, "''") + "'";
      }).join(', ');

      try {
        await this.runQuery(type, dbName, `INSERT INTO \`${tableName}\` (${colList}) VALUES (${valList})`);
        imported++;
      } catch (e) {
        // Skip failed rows
      }
    }
    return { imported };
  }

  // ── Database Size & Stats ──────────────────────────────────

  async getDatabaseStats(type, dbName) {
    if (type === 'mysql') {
      this._sanitizeDbName(dbName);
      const pool = await this.getMysqlConnection();
      const [rows] = await pool.query(
        "SELECT table_name AS table_name, engine, table_rows, data_length + index_length AS size, data_free " +
        "FROM information_schema.tables WHERE table_schema = ? ORDER BY data_length DESC",
        [dbName]
      );
      return {
        tables: rows.map(r => ({
          name: r.table_name,
          engine: r.engine,
          rows: r.table_rows,
          size: r.size || 0,
          dataFree: r.data_free || 0,
        })),
        totalSize: rows.reduce((a, r) => a + (r.size || 0), 0),
        totalDataFree: rows.reduce((a, r) => a + (r.data_free || 0), 0),
      };
    }
    // For others, return basic info
    return { tables: [], totalSize: 0, totalDataFree: 0 };
  }
}

export default new DatabaseService();
