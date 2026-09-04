import mysql from 'mysql2/promise';
import pkg from 'pg';
const { Pool } = pkg;
import path from 'path';
import fs from 'fs/promises';
import { spawn } from 'child_process';

function runCli(cmd, args, envVars = {}) {
  return new Promise((resolve, reject) => {
    const extraPath = process.platform === 'win32'
      ? ''
      : ':/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/snap/bin';
    const env = {
      ...process.env,
      PATH: process.env.PATH ? `${process.env.PATH}${extraPath}` : extraPath,
      ...envVars,
    };
    const child = spawn(cmd, args, { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', err => reject(err));
    child.on('close', code => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `Process ${cmd} exited with code ${code}`));
    });
  });
}

// SQL keywords that are always restricted via the query UI, regardless of where
// they appear in the query — comments or multi-statement chains cannot bypass.
const RESTRICTED_SQL_KEYWORDS = new Set(['DROP', 'TRUNCATE', 'ALTER']);

class DatabaseService {
  constructor() {
    this.mysqlPool = null;
    this.pgPool = null;
    this._lastPgConfigKey = null;
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
    if (this.pgPool) {
      try { await this.pgPool.end(); } catch (_) {}
      this.pgPool = null;
    }
    this._lastPgConfigKey = null;
  }

  async getMysqlConnection() {
    if (!this.mysqlPool) {
      const config = await this.loadMysqlConfig();
      this.mysqlPool = mysql.createPool(config);
    }
    return this.mysqlPool;
  }

  async getPgConnection() {
    const config = await this.loadPgConfig();
    const configKey = JSON.stringify(config);

    if (this.pgPool && this._lastPgConfigKey !== configKey) {
      try { await this.pgPool.end(); } catch (_) {}
      this.pgPool = null;
    }

    if (!this.pgPool) {
      this._lastPgConfigKey = configKey;
      let lastErr = null;

      // Hosts to attempt in order (127.0.0.1 IPv4 first to avoid localhost IPv6 resolution mismatch)
      const hostsToTry = [];
      if (config.host === 'localhost') {
        hostsToTry.push('127.0.0.1', 'localhost');
      } else {
        hostsToTry.push(config.host);
      }

      // 1. Try TCP hosts
      for (const h of hostsToTry) {
        try {
          const pool = new Pool({
            host: h,
            port: config.port || 5432,
            user: config.user || 'postgres',
            password: String(config.password ?? ''),
            database: config.database || 'postgres',
            max: 10,
            idleTimeoutMillis: 30000,
          });
          const client = await pool.connect();
          client.release();
          this.pgPool = pool;
          return this.pgPool;
        } catch (err) {
          lastErr = err;
        }
      }

      // 2. Try Unix domain sockets on Linux (/var/run/postgresql, /tmp)
      if (process.platform === 'linux') {
        for (const sockDir of ['/var/run/postgresql', '/tmp']) {
          try {
            const socketPool = new Pool({
              host: sockDir,
              port: config.port || 5432,
              user: config.user || 'postgres',
              password: String(config.password ?? ''),
              database: config.database || 'postgres',
              max: 10,
              idleTimeoutMillis: 30000,
            });
            const client = await socketPool.connect();
            client.release();
            this.pgPool = socketPool;
            return this.pgPool;
          } catch (_) {}
        }
      }

      this.pgPool = null;
      this._lastPgConfigKey = null;

      if (lastErr?.message?.includes('SASL') || lastErr?.message?.includes('password') || lastErr?.message?.includes('authentication failed')) {
        throw new Error(`PostgreSQL authentication failed for user '${config.user}'. Password does not match or is invalid.`);
      }

      throw new Error('Failed to connect to PostgreSQL: ' + (lastErr?.message || 'Connection failed'));
    }

    return this.pgPool;
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

    // Verify connection immediately with new credentials
    if (type === 'postgres') {
      await this.getPgConnection();
    } else if (type === 'mysql') {
      await this.getMysqlConnection();
    }
  }

  async _findPgConfigPaths() {
    let confPath = '';
    let hbaPath = '';

    // Search Debian/Ubuntu versioned paths
    try {
      const versions = await fs.readdir('/etc/postgresql').catch(() => []);
      for (const v of versions) {
        const pConf = path.join('/etc/postgresql', v, 'main', 'postgresql.conf');
        const pHba = path.join('/etc/postgresql', v, 'main', 'pg_hba.conf');
        try { await fs.access(pConf); confPath = pConf; } catch (_) {}
        try { await fs.access(pHba); hbaPath = pHba; } catch (_) {}
        if (confPath && hbaPath) break;
      }
    } catch (_) {}

    if (!confPath) {
      const altConf = ['/etc/postgresql.conf', '/var/lib/pgsql/data/postgresql.conf', '/var/lib/postgres/data/postgresql.conf'];
      for (const p of altConf) {
        try { await fs.access(p); confPath = p; break; } catch (_) {}
      }
    }

    if (!hbaPath) {
      const altHba = ['/etc/pg_hba.conf', '/var/lib/pgsql/data/pg_hba.conf', '/var/lib/postgres/data/pg_hba.conf'];
      for (const p of altHba) {
        try { await fs.access(p); hbaPath = p; break; } catch (_) {}
      }
    }

    return { confPath, hbaPath };
  }

  async getPgConfigFiles() {
    const { confPath, hbaPath } = await this._findPgConfigPaths();
    let confContent = '';
    let hbaContent = '';

    if (confPath) {
      try { confContent = await fs.readFile(confPath, 'utf8'); } catch (_) {}
    }
    if (hbaPath) {
      try { hbaContent = await fs.readFile(hbaPath, 'utf8'); } catch (_) {}
    }

    return { confPath, hbaPath, confContent, hbaContent };
  }

  async savePgConfigFile(fileType, content) {
    const { confPath, hbaPath } = await this._findPgConfigPaths();
    const target = (fileType === 'postgresql.conf' || fileType === 'conf') ? confPath : hbaPath;
    if (!target) throw new Error(`Configuration file ${fileType} not found on server.`);

    await fs.writeFile(target, content, 'utf8');

    // Restart postgresql service
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    try {
      await execAsync('systemctl restart postgresql || service postgresql restart 2>&1');
    } catch (_) {}

    return true;
  }

  async enablePgRemoteAccess() {
    const { confPath, hbaPath } = await this._findPgConfigPaths();
    if (!confPath || !hbaPath) {
      throw new Error('PostgreSQL configuration files (postgresql.conf / pg_hba.conf) could not be located automatically.');
    }

    // 1. Update postgresql.conf: listen_addresses = '*'
    let confContent = await fs.readFile(confPath, 'utf8');
    if (/^\s*listen_addresses\s*=\s*/m.test(confContent)) {
      confContent = confContent.replace(/^\s*listen_addresses\s*=\s*['"][^'"]*['"]/gm, "listen_addresses = '*'");
    } else if (/#\s*listen_addresses\s*=\s*/.test(confContent)) {
      confContent = confContent.replace(/#\s*listen_addresses\s*=\s*['"][^'"]*['"]/, "listen_addresses = '*'");
    } else {
      confContent += "\nlisten_addresses = '*'\n";
    }
    await fs.writeFile(confPath, confContent, 'utf8');

    // 2. Update pg_hba.conf: add rules for Docker (172.16.0.0/12) & LAN (0.0.0.0/0)
    let hbaContent = await fs.readFile(hbaPath, 'utf8');
    const dockerRule = 'host    all             all             172.16.0.0/12           scram-sha-256';
    const lanRule = 'host    all             all             0.0.0.0/0               scram-sha-256';

    if (!hbaContent.includes('172.16.0.0/12')) {
      hbaContent += `\n${dockerRule}\n`;
    }
    if (!hbaContent.includes('0.0.0.0/0') && !hbaContent.includes('192.168.')) {
      hbaContent += `${lanRule}\n`;
    }
    await fs.writeFile(hbaPath, hbaContent, 'utf8');

    // 3. Restart PostgreSQL service
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    try {
      await execAsync('systemctl restart postgresql || service postgresql restart 2>&1');
    } catch (_) {}

    return {
      confPath,
      hbaPath,
      message: 'PostgreSQL configured for Remote & Docker access successfully. Service restarted.'
    };
  }

  _normalizeType(type) {
    if (!type) return '';
    const t = String(type).toLowerCase().trim();
    if (t === 'postgres' || t === 'postgresql' || t === 'pg') return 'postgres';
    if (t === 'mysql' || t === 'mariadb') return 'mysql';
    if (t === 'sqlite' || t === 'sqlite3') return 'sqlite';
    return t;
  }

  async getPgClientForDb(database) {
    const config = await this.loadPgConfig();
    const pkgPg = (await import('pg')).default;

    const hostsToTry = [];
    if (config.host === 'localhost') {
      hostsToTry.push('127.0.0.1', 'localhost');
    } else {
      hostsToTry.push(config.host);
    }

    let lastErr = null;
    for (const h of hostsToTry) {
      try {
        const client = new pkgPg.Client({
          host: h,
          port: config.port || 5432,
          user: config.user || 'postgres',
          password: String(config.password ?? ''),
          database: database || 'postgres',
        });
        await client.connect();
        return client;
      } catch (err) {
        lastErr = err;
      }
    }

    if (process.platform === 'linux') {
      for (const sockDir of ['/var/run/postgresql', '/tmp']) {
        try {
          const socketClient = new pkgPg.Client({
            host: sockDir,
            port: config.port || 5432,
            user: config.user || 'postgres',
            password: String(config.password ?? ''),
            database: database || 'postgres',
          });
          await socketClient.connect();
          return socketClient;
        } catch (_) {}
      }
    }

    throw new Error(`Failed to connect to PostgreSQL database "${database}": ${lastErr?.message || 'Connection failed'}`);
  }

  _cleanStr(str) {
    if (!str) return '';
    let val = String(str);
    try { val = decodeURIComponent(val); } catch (_) {}
    return val.replace(/^["']|["']$/g, '').trim();
  }

  _sanitizeDbName(name) {
    name = this._cleanStr(name);
    const withoutExt = name.replace(/\.sqlite$|\.db$/, '');
    if (!name || !/^[a-zA-Z_][a-zA-Z0-9_$.]{0,63}$/.test(name) || !/^[a-zA-Z_][a-zA-Z0-9_$]{0,63}$/.test(withoutExt)) {
      throw new Error(`Invalid database name: "${name}". Use only letters, numbers, and underscores.`);
    }
    return name;
  }

  _sanitizeTableName(name) {
    name = this._cleanStr(name);
    if (!name || !/^[a-zA-Z_][a-zA-Z0-9_$]{0,127}$/.test(name)) {
      throw new Error(`Invalid table name: "${name}".`);
    }
    return name;
  }

  _sanitizeSchemaName(name) {
    name = this._cleanStr(name);
    if (!name || !/^[a-zA-Z_][a-zA-Z0-9_$]{0,127}$/.test(name)) {
      throw new Error(`Invalid schema name: "${name}".`);
    }
    return name;
  }

  _sanitizeColumnName(name) {
    name = this._cleanStr(name);
    if (!name || !/^[a-zA-Z_][a-zA-Z0-9_$]{0,127}$/.test(name)) {
      throw new Error(`Invalid column name: "${name}".`);
    }
    return name;
  }

  // Identifier quoting per engine: backticks for MySQL/SQLite, double quotes for PostgreSQL.
  // Callers MUST sanitize the identifier first (they are interpolated into SQL strings).
  _quoteIdentifier(name, norm) {
    return norm === 'postgres' ? '"' + name + '"' : '`' + name + '`';
  }

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
    this._sanitizeDbName(name);
    const dbDir = path.resolve('storage', 'databases');
    await fs.mkdir(dbDir, { recursive: true });
    const dbPath = path.join(dbDir, name.endsWith('.sqlite') ? name : `${name}.sqlite`);
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath);
    db.prepare('CREATE TABLE IF NOT EXISTS _schema_info (id INTEGER PRIMARY KEY, created_at TEXT)').run();
    db.close();
    return true;
  }

  async deleteSqliteDatabase(name) {
    this._sanitizeDbName(name);
    const dbDir = path.resolve('storage', 'databases');
    const dbPath = path.join(dbDir, name);
    await fs.unlink(dbPath);
    return true;
  }

  async getSchemas(type, name) {
    const norm = this._normalizeType(type);
    if (norm !== 'postgres') return [];
    this._sanitizeDbName(name);
    const client = await this.getPgClientForDb(name);
    try {
      // Exclude system schemas: pg_% (pg_catalog, pg_toast*, pg_temp*) and information_schema
      const res = await client.query(
        "SELECT schema_name FROM information_schema.schemata " +
        "WHERE schema_name NOT LIKE 'pg_%' AND schema_name != 'information_schema' " +
        "ORDER BY schema_name"
      );
      await client.end();
      return res.rows.map(r => r.schema_name);
    } catch (err) {
      await client.end();
      throw err;
    }
  }

  async getTables(type, name, schema = 'public') {
    const norm = this._normalizeType(type);
    if (norm === 'sqlite') {
      const Database = (await import('better-sqlite3')).default;
      const dbPath = path.resolve('storage', 'databases', name);
      const db = new Database(dbPath);
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => r.name);
      db.close();
      return tables;
    } else if (norm === 'mysql') {
      const pool = await this.getMysqlConnection();
      this._sanitizeDbName(name);
      await pool.query('USE `' + name + '`');
      const [rows] = await pool.query('SHOW TABLES');
      return rows.map(r => Object.values(r)[0]);
    } else if (norm === 'postgres') {
      this._sanitizeDbName(name);
      schema = this._sanitizeSchemaName(schema);
      const client = await this.getPgClientForDb(name);
      try {
        const res = await client.query(
          'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name;',
          [schema]
        );
        await client.end();
        return res.rows.map(r => r.table_name);
      } catch (err) {
        await client.end();
        throw err;
      }
    }
    throw new Error('Unsupported database type: ' + type);
  }

  async getTableInfo(type, dbName, tableName, schema = 'public') {
    const norm = this._normalizeType(type);
    this._sanitizeTableName(tableName);
    if (norm === 'mysql') {
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
    } else if (norm === 'postgres') {
      this._sanitizeDbName(dbName);
      schema = this._sanitizeSchemaName(schema);
      const client = await this.getPgClientForDb(dbName);
      try {
        const colRes = await client.query(
          "SELECT column_name, data_type, is_nullable, column_default, character_maximum_length " +
          "FROM information_schema.columns WHERE table_schema=$2 AND table_name=$1 ORDER BY ordinal_position",
          [tableName, schema]
        );
        const idxRes = await client.query(
          "SELECT indexname, indexdef FROM pg_indexes WHERE tablename=$1 AND schemaname=$2",
          [tableName, schema]
        );
        const fkRes = await client.query(
          "SELECT kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name " +
          "FROM information_schema.table_constraints AS tc " +
          "JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name " +
          "JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name " +
          "WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = $1 AND tc.table_schema = $2",
          [tableName, schema]
        );
        const countRes = await client.query('SELECT COUNT(*) as cnt FROM ' + this._quoteIdentifier(schema, norm) + '.' + this._quoteIdentifier(tableName, norm));
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
      } catch (err) {
        await client.end();
        throw err;
      }
    } else if (norm === 'sqlite') {
      const Database = (await import('better-sqlite3')).default;
      const dbPath = path.resolve('storage', 'databases', dbName);
      const db = new Database(dbPath);
      const cols = db.prepare('PRAGMA table_info(`' + tableName + '`)').all();
      const idx = db.prepare('PRAGMA index_list(`' + tableName + '`)').all();
      const fk = db.prepare('PRAGMA foreign_key_list(`' + tableName + '`)').all();
      const countRow = db.prepare('SELECT COUNT(*) as cnt FROM `' + tableName + '`').get();
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
    throw new Error('Unsupported database type: ' + type);
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

  async getTableData(type, dbName, tableName, page = 1, limit = 50, sortColumn = null, sortDir = 'ASC', schema = 'public') {
    const norm = this._normalizeType(type);
    this._sanitizeTableName(tableName);
    const offset = (page - 1) * limit;
    let orderClause = '';
    if (sortColumn) {
      this._sanitizeColumnName(sortColumn);
      const dir = sortDir === 'DESC' ? 'DESC' : 'ASC';
      if (norm === 'mysql') orderClause = ` ORDER BY \`${sortColumn}\` ${dir}`;
      else if (norm === 'postgres') orderClause = ` ORDER BY "${sortColumn}" ${dir}`;
      else orderClause = ` ORDER BY "${sortColumn}" ${dir}`;
    }

    if (norm === 'mysql') {
      this._sanitizeDbName(dbName);
      const pool = await this.getMysqlConnection();
      await pool.query('USE `' + dbName + '`');
      const [rows] = await pool.query('SELECT * FROM `' + tableName + '`' + orderClause + ' LIMIT ' + parseInt(limit) + ' OFFSET ' + parseInt(offset));
      const [countRows] = await pool.query('SELECT COUNT(*) as total FROM `' + tableName + '`');
      return { rows, total: countRows[0]?.total || 0 };
    } else if (norm === 'postgres') {
      this._sanitizeDbName(dbName);
      schema = this._sanitizeSchemaName(schema);
      const client = await this.getPgClientForDb(dbName);
      try {
        const tableRef = this._quoteIdentifier(schema, norm) + '.' + this._quoteIdentifier(tableName, norm);
        const dataRes = await client.query('SELECT * FROM ' + tableRef + orderClause + ' LIMIT ' + parseInt(limit) + ' OFFSET ' + parseInt(offset));
        const countRes = await client.query('SELECT COUNT(*) as total FROM ' + tableRef);
        await client.end();
        return { rows: dataRes.rows, total: parseInt(countRes.rows[0]?.total || 0) };
      } catch (err) {
        await client.end();
        throw err;
      }
    } else if (norm === 'sqlite') {
      const Database = (await import('better-sqlite3')).default;
      const dbPath = path.resolve('storage', 'databases', dbName);
      const db = new Database(dbPath);
      const rows = db.prepare('SELECT * FROM "' + tableName + '"' + orderClause + ' LIMIT ? OFFSET ?').all(limit, offset);
      const countRow = db.prepare('SELECT COUNT(*) as total FROM "' + tableName + '"').get();
      db.close();
      return { rows, total: countRow?.total || 0 };
    }
    throw new Error('Unsupported database type: ' + type);
  }

  /**
   * Detect whether a query contains DROP / TRUNCATE / ALTER as the first keyword
   * of ANY top-level statement — even when hidden behind leading comments,
   * whitespace, or multi-statement chaining (e.g. "SELECT 1; DROP TABLE x").
   *
   * Quote-aware scanner: single/double-quoted strings, backtick identifiers,
   * PostgreSQL dollar-quoted strings, line comments (--, #) and block comments
   * are skipped so legitimate text containing these words is not flagged.
   * MySQL versioned comments (/*! ...) are treated as CODE because MySQL
   * executes their content, so restricted keywords inside them are caught too.
   */
  _hasRestrictedStatement(query, norm = '') {
    const q = String(query);
    const n = q.length;
    let i = 0;
    let atStmtStart = true; // at the beginning of a statement, no token seen yet

    const skipLineComment = () => {
      while (i < n && q[i] !== '\n') i++;
    };

    const skipQuoted = (quote) => {
      i++; // opening quote
      while (i < n) {
        if (q[i] === quote) {
          if (q[i + 1] === quote) { i += 2; continue; } // '' / "" escape
          i++;
          return;
        }
        if (q[i] === '\\') { i += 2; continue; } // backslash escape
        i++;
      }
    };

    const skipDollarQuoted = () => {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(q[j])) j++;
      if (j < n && q[j] === '$') {
        const tag = q.slice(i, j + 1);
        const close = q.indexOf(tag, j + 1);
        i = close === -1 ? n : close + tag.length;
      } else {
        i++;
      }
    };

    while (i < n) {
      const ch = q[i];

      if (/\s/.test(ch)) { i++; continue; }

      // Line comments run to end of line. '--' is standard SQL, but '#' is
      // MySQL/MariaDB-only: in PostgreSQL '#' is a real operator (bitwise XOR,
      // JSONB #>), so treating it as a comment there would hide a following
      // restricted statement (e.g. "SELECT 1 # 2; DROP TABLE x").
      if ((ch === '-' && q[i + 1] === '-') || (ch === '#' && norm === 'mysql')) {
        skipLineComment();
        continue;
      }

      // Block comments. Versioned comments (/*! ... */) are executed by MySQL,
      // so inspect each embedded statement instead of skipping them.
      if (ch === '/' && q[i + 1] === '*') {
        if (q[i + 2] === '!') {
          const closeIdx = q.indexOf('*/', i + 3);
          const content = closeIdx === -1 ? q.slice(i + 3) : q.slice(i + 3, closeIdx);
          for (const piece of content.split(';')) {
            const m = piece.match(/^\s*\d*\s*([A-Za-z][A-Za-z0-9_$]*)/);
            if (m && RESTRICTED_SQL_KEYWORDS.has(m[1].toUpperCase())) return true;
          }
          i = closeIdx === -1 ? n : closeIdx + 2;
          atStmtStart = false;
          continue;
        }
        i += 2;
        while (i < n && !(q[i] === '*' && q[i + 1] === '/')) i++;
        i += 2;
        continue;
      }

      // Strings and quoted identifiers are data, never keywords.
      if (ch === "'" || ch === '"' || ch === '`') { skipQuoted(ch); atStmtStart = false; continue; }

      // PostgreSQL dollar-quoted strings: $$ ... $$ or $tag$ ... $tag$.
      if (ch === '$') { skipDollarQuoted(); atStmtStart = false; continue; }

      // A semicolon ends the current statement and starts a new one.
      if (ch === ';') { atStmtStart = true; i++; continue; }

      // Inspect only the FIRST keyword of each statement.
      if (atStmtStart && /[A-Za-z]/.test(ch)) {
        let j = i;
        while (j < n && /[A-Za-z0-9_$]/.test(q[j])) j++;
        const word = q.slice(i, j).toUpperCase();
        if (RESTRICTED_SQL_KEYWORDS.has(word)) return true;
        atStmtStart = false;
        i = j;
        continue;
      }

      atStmtStart = false;
      i++;
    }
    return false;
  }

  async runQuery(type, name, query) {
    const norm = this._normalizeType(type);
    const upper = query.trim().toUpperCase();
    if (this._hasRestrictedStatement(query, norm)) {
      throw new Error('DROP, TRUNCATE, and ALTER are restricted via UI.');
    }

    this.queryHistory.unshift({ type, database: name, query, timestamp: new Date().toISOString() });
    if (this.queryHistory.length > 100) this.queryHistory.pop();

    if (norm === 'sqlite') {
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
    } else if (norm === 'mysql') {
      const pool = await this.getMysqlConnection();
      await pool.query('USE `' + name + '`');
      if (upper.startsWith('SELECT') || upper.startsWith('SHOW') || upper.startsWith('DESCRIBE') || upper.startsWith('EXPLAIN')) {
        const [rows] = await pool.query(query);
        return { rows: Array.isArray(rows) ? rows : [], columns: rows.length > 0 ? Object.keys(rows[0]) : [], affected: 0 };
      } else {
        const [result] = await pool.query(query);
        return { rows: [], columns: [], affected: result.affectedRows || 0, insertId: result.insertId };
      }
    } else if (norm === 'postgres') {
      this._sanitizeDbName(name);
      const client = await this.getPgClientForDb(name);
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

  async exportData(type, dbName, tableName, format = 'json', schema = 'public') {
    this._sanitizeTableName(tableName);
    const { rows } = await this.getTableData(type, dbName, tableName, 1, 100000, null, 'ASC', schema);
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

  async importSql(type, dbName, sqlContent, schema = 'public') {
    const norm = this._normalizeType(type);
    // Split by semicolons and execute each statement
    const statements = sqlContent.split(';').filter(s => s.trim().length > 0);
    let count = 0;
    let pgClient = null;
    try {
      // PostgreSQL: run all statements on a single connection whose search_path
      // points at the selected schema, so unqualified INSERT/UPDATE/DELETE
      // statements land in that schema. (pg_dump-style SET search_path lines are
      // filtered out below by the INSERT/UPDATE/DELETE prefix check.)
      if (norm === 'postgres' && statements.length > 0) {
        this._sanitizeDbName(dbName);
        schema = this._sanitizeSchemaName(schema);
        pgClient = await this.getPgClientForDb(dbName);
        await pgClient.query('SET search_path TO "' + schema + '"');
      }

      for (const stmt of statements) {
        const trimmed = stmt.trim();
        const upper = trimmed.toUpperCase();
        // Only allow INSERT/UPDATE/DELETE statements for safety
        if (upper.startsWith('INSERT') || upper.startsWith('UPDATE') || upper.startsWith('DELETE')) {
          try {
            if (pgClient) {
              // [SECURITY] Keep the DROP/TRUNCATE/ALTER guard even though we
              // bypass runQuery here (statements are checked per piece).
              if (this._hasRestrictedStatement(trimmed, 'postgres')) continue;
              await pgClient.query(trimmed);
            } else {
              await this.runQuery(type, dbName, trimmed);
            }
            count++;
          } catch (e) {
            // Skip problematic statements
          }
        }
      }
    } finally {
      if (pgClient) await pgClient.end();
    }
    return { imported: count };
  }

  async importCsv(type, dbName, tableName, csvContent, schema = 'public') {
    const norm = this._normalizeType(type);
    this._sanitizeTableName(tableName);
    if (norm === 'postgres') {
      this._sanitizeDbName(dbName);
      schema = this._sanitizeSchemaName(schema);
    }
    const lines = csvContent.split('\n').filter(l => l.trim());
    if (lines.length < 2) throw new Error('CSV must have header + at least one row');

    // [SECURITY] Sanitize header column names before interpolating into the INSERT —
    // a crafted header like `id`); DROP TABLE users; -- would otherwise break out of
    // the quoted identifier. Values are escaped below, columns must be too.
    const columns = lines[0].split(',').map(c => this._sanitizeColumnName(c.trim().replace(/^"|"$/g, '')));
    // Table reference: "schema"."table" for PostgreSQL (so imports go to the
    // selected schema), backtick-quoted table for MySQL/SQLite.
    const tableRef = norm === 'postgres'
      ? this._quoteIdentifier(schema, norm) + '.' + this._quoteIdentifier(tableName, norm)
      : this._quoteIdentifier(tableName, norm);
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

      // Build INSERT statement per row (identifiers quoted per engine)
      const colList = setClause.map(s => this._quoteIdentifier(s.column, norm)).join(', ');
      const valList = setClause.map(s => {
        if (s.value === null) return 'NULL';
        return "'" + String(s.value).replace(/'/g, "''") + "'";
      }).join(', ');

      try {
        await this.runQuery(type, dbName, `INSERT INTO ${tableRef} (${colList}) VALUES (${valList})`);
        imported++;
      } catch (e) {
        // Skip failed rows
      }
    }
    return { imported };
  }

  // ── Database Size & Stats ──────────────────────────────────

  async getDatabaseStats(type, dbName, schema = 'public') {
    const norm = this._normalizeType(type);
    if (norm === 'mysql') {
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
    } else if (norm === 'postgres') {
      try {
        this._sanitizeDbName(dbName);
        schema = this._sanitizeSchemaName(schema);
        const client = await this.getPgClientForDb(dbName);
        const res = await client.query(
          "SELECT table_name, pg_total_relation_size(quote_ident($1) || '.' || quote_ident(table_name)) as size " +
          "FROM information_schema.tables WHERE table_schema = $1 ORDER BY size DESC",
          [schema]
        );
        await client.end();
        return {
          tables: res.rows.map(r => ({
            name: r.table_name,
            engine: 'PostgreSQL',
            rows: 0,
            size: parseInt(r.size || 0),
            dataFree: 0,
          })),
          totalSize: res.rows.reduce((a, r) => a + parseInt(r.size || 0), 0),
          totalDataFree: 0,
        };
      } catch (err) {
        return { tables: [], totalSize: 0, totalDataFree: 0 };
      }
    } else if (norm === 'sqlite') {
      try {
        const Database = (await import('better-sqlite3')).default;
        const dbPath = path.resolve('storage', 'databases', dbName);
        const db = new Database(dbPath);
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
        const statRows = tables.map(t => {
          const count = db.prepare(`SELECT COUNT(*) as count FROM "${t.name}"`).get()?.count || 0;
          return { name: t.name, engine: 'SQLite', rows: count, size: 0, dataFree: 0 };
        });
        db.close();
        return { tables: statRows, totalSize: 0, totalDataFree: 0 };
      } catch (_) {
        return { tables: [], totalSize: 0, totalDataFree: 0 };
      }
    }
    return { tables: [], totalSize: 0, totalDataFree: 0 };
  }

  // ── Visual Table Data Editor (Row CRUD) ─────────────────────

  async insertRow(type, dbName, tableName, rowData = {}, schema = 'public') {
    const norm = this._normalizeType(type);
    this._sanitizeTableName(tableName);
    const keys = Object.keys(rowData).map(k => this._sanitizeColumnName(k));
    if (keys.length === 0) throw new Error('No data provided to insert');

    const tableRef = norm === 'postgres'
      ? this._quoteIdentifier(this._sanitizeSchemaName(schema), norm) + '.' + this._quoteIdentifier(tableName, norm)
      : this._quoteIdentifier(tableName, norm);

    const colList = keys.map(k => this._quoteIdentifier(k, norm)).join(', ');
    const valList = keys.map(k => {
      const v = rowData[k];
      if (v === null || v === undefined) return 'NULL';
      return "'" + String(v).replace(/'/g, "''") + "'";
    }).join(', ');

    const sql = `INSERT INTO ${tableRef} (${colList}) VALUES (${valList})`;
    return await this.runQuery(type, dbName, sql);
  }

  async updateRow(type, dbName, tableName, pkColumn, pkValue, updatedFields = {}, schema = 'public') {
    const norm = this._normalizeType(type);
    this._sanitizeTableName(tableName);
    this._sanitizeColumnName(pkColumn);

    const keys = Object.keys(updatedFields).map(k => this._sanitizeColumnName(k));
    if (keys.length === 0) throw new Error('No fields provided to update');

    const tableRef = norm === 'postgres'
      ? this._quoteIdentifier(this._sanitizeSchemaName(schema), norm) + '.' + this._quoteIdentifier(tableName, norm)
      : this._quoteIdentifier(tableName, norm);

    const setClauses = keys.map(k => {
      const v = updatedFields[k];
      const valStr = (v === null || v === undefined) ? 'NULL' : ("'" + String(v).replace(/'/g, "''") + "'");
      return `${this._quoteIdentifier(k, norm)} = ${valStr}`;
    }).join(', ');

    const pkValStr = typeof pkValue === 'number' ? pkValue : ("'" + String(pkValue).replace(/'/g, "''") + "'");
    const sql = `UPDATE ${tableRef} SET ${setClauses} WHERE ${this._quoteIdentifier(pkColumn, norm)} = ${pkValStr}`;
    return await this.runQuery(type, dbName, sql);
  }

  async deleteRow(type, dbName, tableName, pkColumn, pkValue, schema = 'public') {
    const norm = this._normalizeType(type);
    this._sanitizeTableName(tableName);
    this._sanitizeColumnName(pkColumn);

    const tableRef = norm === 'postgres'
      ? this._quoteIdentifier(this._sanitizeSchemaName(schema), norm) + '.' + this._quoteIdentifier(tableName, norm)
      : this._quoteIdentifier(tableName, norm);

    const pkValStr = typeof pkValue === 'number' ? pkValue : ("'" + String(pkValue).replace(/'/g, "''") + "'");
    const sql = `DELETE FROM ${tableRef} WHERE ${this._quoteIdentifier(pkColumn, norm)} = ${pkValStr}`;
    return await this.runQuery(type, dbName, sql);
  }

  // ── SQL Query Scratchpad with EXPLAIN ─────────────────────────

  async explainQuery(type, dbName, query) {
    const norm = this._normalizeType(type);
    const trimmed = query.trim();
    let explainSql = '';

    if (norm === 'sqlite') {
      explainSql = `EXPLAIN QUERY PLAN ${trimmed}`;
    } else if (norm === 'postgres') {
      explainSql = `EXPLAIN (ANALYZE, VERBOSE, BUFFERS, FORMAT JSON) ${trimmed}`;
    } else {
      // MySQL
      explainSql = `EXPLAIN ${trimmed}`;
    }

    try {
      return await this.runQuery(type, dbName, explainSql);
    } catch (err) {
      if (norm === 'postgres') {
        // Fallback for Postgres without ANALYZE
        return await this.runQuery(type, dbName, `EXPLAIN ${trimmed}`);
      }
      throw err;
    }
  }

  // ── Database Backup & Restore (Full Overwrite Flow) ──────────

  async backupDatabase(type, dbName) {
    const norm = this._normalizeType(type);
    this._sanitizeDbName(dbName);

    const backupDir = path.resolve('storage', 'backups', 'databases');
    await fs.mkdir(backupDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const cleanName = dbName.replace(/\.sqlite$|\.db$/, '');

    let filename = '';
    let filePath = '';

    if (norm === 'mysql') {
      filename = `mysql_${cleanName}_${timestamp}.sql`;
      filePath = path.join(backupDir, filename);

      const cfg = await this.loadMysqlConfig();
      const args = [
        '-h', cfg.host,
        '-P', String(cfg.port || 3306),
        '-u', cfg.user,
        '--add-drop-table',
        '--routines',
        '--triggers',
        '--single-transaction',
        cleanName
      ];
      const env = {};
      if (cfg.password) env.MYSQL_PWD = cfg.password;

      try {
        const sqlData = await runCli('mysqldump', args, env);
        await fs.writeFile(filePath, sqlData, 'utf8');
      } catch (cliErr) {
        // Fallback to programmatic dumper if mysqldump CLI is unavailable
        await this._programmaticMysqlDump(cleanName, filePath);
      }
    } else if (norm === 'postgres') {
      filename = `postgres_${cleanName}_${timestamp}.sql`;
      filePath = path.join(backupDir, filename);

      const cfg = await this.loadPgConfig();
      const args = [
        '-h', cfg.host,
        '-p', String(cfg.port || 5432),
        '-U', cfg.user,
        '--clean',
        '--if-exists',
        '-d', cleanName,
        '-f', filePath
      ];
      const env = {};
      if (cfg.password) env.PGPASSWORD = String(cfg.password);

      try {
        await runCli('pg_dump', args, env);
      } catch (cliErr) {
        // Fallback to programmatic dumper if pg_dump CLI is unavailable
        await this._programmaticPgDump(cleanName, filePath);
      }
    } else if (norm === 'sqlite') {
      filename = `sqlite_${cleanName}_${timestamp}.sqlite`;
      filePath = path.join(backupDir, filename);
      await this._sqliteBackup(dbName, filePath);
    } else {
      throw new Error(`Unsupported database type: ${type}`);
    }

    const stat = await fs.stat(filePath);
    return {
      filename,
      filePath,
      size: stat.size,
      type: norm,
      dbName,
      timestamp
    };
  }

  async restoreDatabase(type, dbName, { filePath, fileContent }) {
    const norm = this._normalizeType(type);
    this._sanitizeDbName(dbName);

    if (!filePath && !fileContent) {
      throw new Error('Either filePath or fileContent is required for database restore');
    }

    const cleanName = dbName.replace(/\.sqlite$|\.db$/, '');

    if (norm === 'mysql') {
      // Ensure database exists
      await this.createMysqlDatabase(cleanName);
      const cfg = await this.loadMysqlConfig();
      const env = {};
      if (cfg.password) env.MYSQL_PWD = cfg.password;

      let success = false;
      if (filePath) {
        try {
          const sql = await fs.readFile(filePath, 'utf8');
          await this._programmaticMysqlRestore(cleanName, sql);
          success = true;
        } catch (_) {}
      }

      if (!success && fileContent) {
        await this._programmaticMysqlRestore(cleanName, fileContent);
        success = true;
      }

      if (!success && filePath) {
        const args = ['-h', cfg.host, '-P', String(cfg.port || 3306), '-u', cfg.user, cleanName];
        await runCli('mysql', args, env);
      }
    } else if (norm === 'postgres') {
      const dbs = await this.listPgDatabases();
      if (!dbs.includes(cleanName)) {
        await this.createPgDatabase(cleanName);
      }

      let content = fileContent;
      if (!content && filePath) {
        content = await fs.readFile(filePath, 'utf8');
      }

      if (content) {
        await this._programmaticPgRestore(cleanName, content);
      } else if (filePath) {
        const cfg = await this.loadPgConfig();
        const env = {};
        if (cfg.password) env.PGPASSWORD = String(cfg.password);
        const args = ['-h', cfg.host, '-p', String(cfg.port || 5432), '-U', cfg.user, '-d', cleanName, '-f', filePath];
        await runCli('psql', args, env);
      }
    } else if (norm === 'sqlite') {
      await this._sqliteRestore(dbName, filePath, fileContent);
    } else {
      throw new Error(`Unsupported database type: ${type}`);
    }

    return {
      success: true,
      message: `Database "${dbName}" restored successfully (all previous data overwritten).`
    };
  }

  async _programmaticMysqlDump(dbName, filePath) {
    const pool = await this.getMysqlConnection();
    await pool.query(`USE \`${dbName}\``);
    const [tables] = await pool.query('SHOW TABLES');
    const tableNames = tables.map(r => Object.values(r)[0]);

    let dump = `-- PanelKu MySQL Dump: ${dbName}\n-- Created: ${new Date().toISOString()}\n\n`;
    dump += 'SET FOREIGN_KEY_CHECKS = 0;\n\n';

    for (const tbl of tableNames) {
      this._sanitizeTableName(tbl);
      dump += `DROP TABLE IF EXISTS \`${tbl}\`;\n`;
      const [createRes] = await pool.query(`SHOW CREATE TABLE \`${tbl}\``);
      const createSql = createRes[0]?.['Create Table'] || '';
      dump += `${createSql};\n\n`;

      const [rows] = await pool.query(`SELECT * FROM \`${tbl}\``);
      if (rows.length > 0) {
        const cols = Object.keys(rows[0]);
        const colList = cols.map(c => `\`${c}\``).join(', ');
        const valuesList = rows.map(r => {
          return '(' + cols.map(c => {
            const v = r[c];
            if (v === null || v === undefined) return 'NULL';
            if (typeof v === 'number') return v;
            return "'" + String(v).replace(/'/g, "''").replace(/\\/g, '\\\\') + "'";
          }).join(', ') + ')';
        }).join(',\n');
        dump += `INSERT INTO \`${tbl}\` (${colList}) VALUES\n${valuesList};\n\n`;
      }
    }
    dump += 'SET FOREIGN_KEY_CHECKS = 1;\n';
    await fs.writeFile(filePath, dump, 'utf8');
  }

  async _programmaticMysqlRestore(dbName, sqlContent) {
    const pool = await this.getMysqlConnection();
    await pool.query(`USE \`${dbName}\``);

    const statements = sqlContent
      .split(/;\s*[\r\n]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    await pool.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const stmt of statements) {
      try {
        await pool.query(stmt);
      } catch (err) {
        if (!stmt.toUpperCase().startsWith('DROP TABLE')) {
          throw err;
        }
      }
    }
    await pool.query('SET FOREIGN_KEY_CHECKS = 1');
  }

  async _programmaticPgDump(dbName, filePath) {
    const client = await this.getPgClientForDb(dbName);
    try {
      const tableRes = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      `);

      let dump = `-- PanelKu PostgreSQL Dump: ${dbName}\n-- Created: ${new Date().toISOString()}\n\n`;
      for (const row of tableRes.rows) {
        const tbl = row.table_name;
        dump += `DROP TABLE IF EXISTS "${tbl}" CASCADE;\n`;

        const colRes = await client.query(`
          SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1
          ORDER BY ordinal_position
        `, [tbl]);

        const colDefs = colRes.rows.map(c => {
          let def = `"${c.column_name}" ${c.data_type}`;
          if (c.character_maximum_length) def += `(${c.character_maximum_length})`;
          if (c.is_nullable === 'NO') def += ' NOT NULL';
          if (c.column_default) def += ` DEFAULT ${c.column_default}`;
          return def;
        }).join(', ');

        dump += `CREATE TABLE "${tbl}" (${colDefs});\n`;

        const dataRes = await client.query(`SELECT * FROM "${tbl}"`);
        if (dataRes.rows.length > 0) {
          for (const d of dataRes.rows) {
            const cols = Object.keys(d);
            const colList = cols.map(c => `"${c}"`).join(', ');
            const valList = cols.map(c => {
              const v = d[c];
              if (v === null || v === undefined) return 'NULL';
              if (typeof v === 'number') return v;
              return "'" + String(v).replace(/'/g, "''") + "'";
            }).join(', ');
            dump += `INSERT INTO "${tbl}" (${colList}) VALUES (${valList});\n`;
          }
        }
        dump += '\n';
      }
      await fs.writeFile(filePath, dump, 'utf8');
    } finally {
      await client.end();
    }
  }

  async _programmaticPgRestore(dbName, sqlContent) {
    const client = await this.getPgClientForDb(dbName);
    try {
      // Overwrite: Cleanly reset public schema
      await client.query('DROP SCHEMA public CASCADE');
      await client.query('CREATE SCHEMA public');
      await client.query('GRANT ALL ON SCHEMA public TO public');

      const statements = sqlContent
        .split(/;\s*[\r\n]+/)
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

      for (const stmt of statements) {
        await client.query(stmt);
      }
    } finally {
      await client.end();
    }
  }

  async _sqliteBackup(dbName, filePath) {
    const targetFile = dbName.endsWith('.sqlite') || dbName.endsWith('.db') ? dbName : `${dbName}.sqlite`;
    const dbPath = path.resolve('storage', 'databases', targetFile);
    await fs.access(dbPath).catch(() => {
      throw new Error(`SQLite database "${dbName}" not found at ${dbPath}`);
    });

    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath);
    try {
      await db.backup(filePath);
    } finally {
      db.close();
    }
  }

  async _sqliteRestore(dbName, srcFilePath, sqlContent = null) {
    const targetFile = dbName.endsWith('.sqlite') || dbName.endsWith('.db') ? dbName : `${dbName}.sqlite`;
    const dbDir = path.resolve('storage', 'databases');
    await fs.mkdir(dbDir, { recursive: true });
    const targetPath = path.join(dbDir, targetFile);

    // If source file is a binary SQLite database:
    if (srcFilePath && (srcFilePath.endsWith('.sqlite') || srcFilePath.endsWith('.db'))) {
      await fs.copyFile(srcFilePath, targetPath);
      return;
    }

    let content = sqlContent;
    if (!content && srcFilePath) {
      // Detect binary sqlite format header
      const buffer = await fs.readFile(srcFilePath);
      if (buffer.subarray(0, 16).toString('utf8').startsWith('SQLite format 3')) {
        await fs.writeFile(targetPath, buffer);
        return;
      }
      content = buffer.toString('utf8');
    }

    if (content) {
      await fs.unlink(targetPath).catch(() => {});
      const Database = (await import('better-sqlite3')).default;
      const db = new Database(targetPath);
      try {
        db.exec(content);
      } finally {
        db.close();
      }
    } else if (srcFilePath) {
      await fs.copyFile(srcFilePath, targetPath);
    }
  }

  async listDatabaseBackups(type, dbName) {
    const norm = this._normalizeType(type);
    this._sanitizeDbName(dbName);
    const cleanName = dbName.replace(/\.sqlite$|\.db$/, '');
    const prefix = `${norm}_${cleanName}_`;

    const backupDir = path.resolve('storage', 'backups', 'databases');
    await fs.mkdir(backupDir, { recursive: true });

    const files = await fs.readdir(backupDir);
    const backups = [];

    for (const file of files) {
      if (file.startsWith(prefix)) {
        try {
          const st = await fs.stat(path.join(backupDir, file));
          backups.push({
            filename: file,
            size: st.size,
            created: st.mtimeMs,
            type: norm,
            dbName: cleanName
          });
        } catch (_) {}
      }
    }

    return backups.sort((a, b) => b.created - a.created);
  }

  async deleteDatabaseBackup(filename) {
    if (!filename || !/^[a-zA-Z0-9._-]+$/.test(filename) || filename.includes('..')) {
      throw new Error('Invalid backup filename');
    }
    const backupDir = path.resolve('storage', 'backups', 'databases');
    const filePath = path.join(backupDir, filename);
    await fs.unlink(filePath);
    return true;
  }

  // ── Automated Database Backup Management ───────────────────

  async getAutoBackupConfig() {
    try {
      const { default: Setting } = await import('../../models/Setting.js');
      let val = await Setting.get('db_autobackup_config');
      if (typeof val === 'string') {
        try { val = JSON.parse(val); } catch (_) {}
      }
      if (val && typeof val === 'object') return val;
    } catch (_) {}
    return {
      enabled: false,
      frequency: 'daily',
      time: '02:00',
      retentionDays: 7,
      targets: { mysql: true, postgres: true, sqlite: true }
    };
  }

  async saveAutoBackupConfig(config = {}) {
    const { default: Setting } = await import('../../models/Setting.js');
    const payload = {
      enabled: !!config.enabled,
      frequency: config.frequency || 'daily',
      time: config.time || '02:00',
      retentionDays: Math.max(1, parseInt(config.retentionDays) || 7),
      targets: {
        mysql: config.targets?.mysql !== false,
        postgres: config.targets?.postgres !== false,
        sqlite: config.targets?.sqlite !== false,
      }
    };
    await Setting.set('db_autobackup_config', payload, 'json');
    return payload;
  }

  async runAutoBackup(force = false) {
    const config = await this.getAutoBackupConfig();
    if (!config.enabled && !force) {
      return { skipped: true, reason: 'Auto-backup is disabled in settings' };
    }

    const results = [];

    // 1. MySQL
    if (config.targets?.mysql) {
      const dbs = await this.listMysqlDatabases();
      for (const d of dbs) {
        try {
          const res = await this.backupDatabase('mysql', d);
          results.push({ type: 'mysql', db: d, file: res.filename, size: res.size, status: 'success' });
        } catch (err) {
          results.push({ type: 'mysql', db: d, error: err.message, status: 'failed' });
        }
      }
    }

    // 2. PostgreSQL
    if (config.targets?.postgres) {
      const dbs = await this.listPgDatabases();
      for (const d of dbs) {
        try {
          const res = await this.backupDatabase('postgres', d);
          results.push({ type: 'postgres', db: d, file: res.filename, size: res.size, status: 'success' });
        } catch (err) {
          results.push({ type: 'postgres', db: d, error: err.message, status: 'failed' });
        }
      }
    }

    // 3. SQLite
    if (config.targets?.sqlite) {
      const dbs = await this.listSqliteDatabases();
      for (const d of dbs) {
        try {
          const res = await this.backupDatabase('sqlite', d);
          results.push({ type: 'sqlite', db: d, file: res.filename, size: res.size, status: 'success' });
        } catch (err) {
          results.push({ type: 'sqlite', db: d, error: err.message, status: 'failed' });
        }
      }
    }

    // 4. Prune old backups past retention threshold
    const retentionMs = (config.retentionDays || 7) * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let cleanedCount = 0;

    try {
      const backupDir = path.resolve('storage', 'backups', 'databases');
      const files = await fs.readdir(backupDir);
      for (const file of files) {
        const fp = path.join(backupDir, file);
        const st = await fs.stat(fp);
        if (now - st.mtimeMs > retentionMs) {
          await fs.unlink(fp).catch(() => {});
          cleanedCount++;
        }
      }
    } catch (_) {}

    return {
      success: true,
      timestamp: new Date().toISOString(),
      results,
      cleanedCount
    };
  }
}

export default new DatabaseService();
