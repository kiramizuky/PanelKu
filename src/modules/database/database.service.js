import mysql from 'mysql2/promise';
import pkg from 'pg';
const { Client } = pkg;
import { MongoClient } from 'mongodb';

class DatabaseService {
  constructor() {
    this.mysqlPool = null;
    this.pgClient = null;
    this.mongoClient = null;
    
    // Configurations should ideally come from user settings in DB
    // For now, we will connect locally with default ports if possible
    this.mysqlConfig = { host: 'localhost', user: 'root', password: '' };
    this.pgConfig = { host: 'localhost', user: 'postgres', password: '' };
    this.mongoUri = 'mongodb://127.0.0.1:27017';
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

  async getMongoConnection() {
    if (!this.mongoClient) {
      this.mongoClient = new MongoClient(this.mongoUri);
      await this.mongoClient.connect();
    }
    return this.mongoClient;
  }

  async listMysqlDatabases() {
    try {
      const pool = await this.getMysqlConnection();
      const [rows] = await pool.query('SHOW DATABASES');
      return rows.map(r => r.Database).filter(d => !['information_schema', 'mysql', 'performance_schema', 'sys'].includes(d));
    } catch (err) { return []; }
  }

  async createMysqlDatabase(name) {
    const pool = await this.getMysqlConnection();
    await pool.query(`CREATE DATABASE IF NOT EXISTS \`${name}\``);
    return true;
  }

  async deleteMysqlDatabase(name) {
    const pool = await this.getMysqlConnection();
    await pool.query(`DROP DATABASE IF EXISTS \`${name}\``);
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
    const client = await this.getPgConnection();
    await client.query(`CREATE DATABASE "${name}"`);
    return true;
  }

  async deletePgDatabase(name) {
    const client = await this.getPgConnection();
    await client.query(`DROP DATABASE "${name}"`);
    return true;
  }

  async listMongoDatabases() {
    try {
      const client = await this.getMongoConnection();
      const adminDb = client.db().admin();
      const res = await adminDb.listDatabases();
      return res.databases.map(db => db.name).filter(d => !['admin', 'local', 'config'].includes(d));
    } catch (err) { return []; }
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
      
      // touch the file
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
}

export default new DatabaseService();
