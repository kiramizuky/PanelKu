import mysql from 'mysql2/promise';
import pkg from 'pg';
const { Client } = pkg;

class DatabaseService {
  constructor() {
    this.mysqlPool = null;
    this.pgClient = null;
    
    // Configurations loaded from environment variables
    this.mysqlConfig = {
      host: process.env.DB_MYSQL_HOST || 'localhost',
      user: process.env.DB_MYSQL_USER || 'root',
      password: process.env.DB_MYSQL_PASSWORD || ''
    };
    this.pgConfig = {
      host: process.env.DB_PG_HOST || 'localhost',
      user: process.env.DB_PG_USER || 'postgres',
      password: process.env.DB_PG_PASSWORD || ''
    };
  }

  async getMysqlConnection() {
    if (!this.mysqlPool) {
      this.mysqlPool = mysql.createPool(this.mysqlConfig);
    }
    return this.mysqlPool;
  }

  async getPgConnection() {
    if (!this.pgClient) {
      this.pgClient = new Client(this.pgConfig);
      try {
        await this.pgClient.connect();
      } catch (err) {
        this.pgClient = null;
        throw new Error('Failed to connect to PostgreSQL: ' + err.message);
      }
    }
    return this.pgClient;
  }

  async listMysqlDatabases() {
    try {
      const pool = await this.getMysqlConnection();
      const [rows] = await pool.query('SHOW DATABASES');
      return rows.map(r => r.Database).filter(d => !['information_schema', 'mysql', 'performance_schema', 'sys'].includes(d));
    } catch (err) { return []; }
  }

  /**
   * Validate database name — only alphanumeric and underscores, prevent SQL injection.
   */
  _sanitizeDbName(name) {
    if (!name || !/^[a-zA-Z_][a-zA-Z0-9_$]{0,63}$/.test(name)) {
      throw new Error(`Invalid database name: "${name}". Use only letters, numbers, and underscores.`);
    }
    return name;
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

  async listPgDatabases() {
    try {
      const client = await this.getPgConnection();
      const res = await client.query('SELECT datname FROM pg_database WHERE datistemplate = false;');
      return res.rows.map(r => r.datname).filter(d => d !== 'postgres');
    } catch (err) { return []; }
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

  async listSqliteDatabases() {
    try {
      const fs = (await import('fs/promises')).default;
      const path = (await import('path')).default;
      const dbDir = path.resolve('storage', 'databases');
      await fs.mkdir(dbDir, { recursive: true });
      const files = await fs.readdir(dbDir);
      return files.filter(f => f.endsWith('.sqlite') || f.endsWith('.db'));
    } catch (err) { return []; }
  }

  async createSqliteDatabase(name) {
    try {
      const fs = (await import('fs/promises')).default;
      const path = (await import('path')).default;
      const dbDir = path.resolve('storage', 'databases');
      await fs.mkdir(dbDir, { recursive: true });
      const filename = name.endsWith('.sqlite') || name.endsWith('.db') ? name : `${name}.sqlite`;
      const dbPath = path.join(dbDir, filename);
      
      const handle = await fs.open(dbPath, 'w');
      await handle.close();
      return true;
    } catch (err) { throw new Error('Failed to create SQLite database: ' + err.message); }
  }

  async deleteSqliteDatabase(name) {
    try {
      const fs = (await import('fs/promises')).default;
      const path = (await import('path')).default;
      const dbDir = path.resolve('storage', 'databases');
      const dbPath = path.join(dbDir, name);
      await fs.unlink(dbPath);
      return true;
    } catch (err) { throw new Error('Failed to delete SQLite database: ' + err.message); }
  }

  async getTables(type, name) {
    if (type === 'sqlite') {
      const path = (await import('path')).default;
      const Database = (await import('better-sqlite3')).default;
      const dbPath = path.resolve('storage', 'databases', name);
      const db = new Database(dbPath);
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name);
      db.close();
      return tables;
    } else if (type === 'mysql') {
      const pool = await this.getMysqlConnection();
      this._sanitizeDbName(name);
      await pool.query('USE `' + name + '`');
      const [rows] = await pool.query('SHOW TABLES');
      return rows.map(r => Object.values(r)[0]);
    } else if (type === 'postgres') {
      const pkg = (await import('pg')).default;
      const client = new pkg.Client({
        ...this.pgConfig,
        database: name
      });
      await client.connect();
      const res = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public';");
      await client.end();
      return res.rows.map(r => r.table_name);
    }
    throw new Error('Unsupported database type');
  }

  async runQuery(type, name, query) {
    const upper = query.trim().toUpperCase();
    if (upper.startsWith('DROP') || upper.startsWith('TRUNCATE')) {
      throw new Error('DROP or TRUNCATE operations are restricted via UI.');
    }

    if (type === 'sqlite') {
      const path = (await import('path')).default;
      const Database = (await import('better-sqlite3')).default;
      const dbPath = path.resolve('storage', 'databases', name);
      const db = new Database(dbPath);
      try {
        const stmt = db.prepare(query);
        const rows = stmt.reader ? stmt.all() : stmt.run();
        db.close();
        return Array.isArray(rows) ? rows : [rows];
      } catch (err) {
        db.close();
        throw err;
      }
    } else if (type === 'mysql') {
      const pool = await this.getMysqlConnection();
      await pool.query(`USE \`${name}\``);
      const [rows] = await pool.query(query);
      return Array.isArray(rows) ? rows : [rows];
    } else if (type === 'postgres') {
      const pkg = (await import('pg')).default;
      const client = new pkg.Client({
        ...this.pgConfig,
        database: name
      });
      await client.connect();
      try {
        const res = await client.query(query);
        await client.end();
        return Array.isArray(res.rows) ? res.rows : [res.rows];
      } catch (err) {
        await client.end();
        throw err;
      }
    }
    throw new Error('Unsupported database type');
  }
}

export default new DatabaseService();
