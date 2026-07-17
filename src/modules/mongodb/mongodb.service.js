import { execFile, exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

/**
 * Validate a MongoDB database/collection/user name.
 */
function validateName(name) {
  if (!name || typeof name !== 'string') throw new Error('Name is required');
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(name)) {
    throw new Error('Name must start with a letter or underscore, max 64 chars, alphanumeric/underscore only');
  }
  return name;
}

/**
 * Sanitize a MongoDB connection URI — only allow safe characters.
 */
function _validateMongoUri(uri) {
  if (!uri) return '';
  if (typeof uri !== 'string') throw new Error('Invalid connection URI');
  // Allow mongodb:// or mongodb+srv:// URIs
  if (!/^mongodb(\+srv)?:\/\/.+/.test(uri)) throw new Error('Invalid MongoDB URI format');
  // Block shell special characters
  if (/[;&|$`(){}]/.test(uri)) throw new Error('URI contains unsafe characters');
  return uri;
}

class MongoDBService {
  constructor() {
    this._mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017';
    this._mongoUser = process.env.MONGO_USER || '';
    this._mongoPass = process.env.MONGO_PASS || '';
  }

  /**
   * Build mongosh command arguments.
   */
  _buildArgs(db = 'admin', extraArgs = []) {
    const args = [];

    if (this._mongoUser && this._mongoPass) {
      args.push('--username', this._mongoUser);
      args.push('--password', this._mongoPass);
      args.push('--authenticationDatabase', 'admin');
    }

    // Use the connection URI
    args.push(this._mongoUri);
    if (db) args.push('--db', db);

    return [...args, ...extraArgs];
  }

  /**
   * Run a MongoDB command via mongosh and return JSON output.
   */
  async _runMongoCommand(jsCode, db = 'admin') {
    try {
      const args = this._buildArgs(db, ['--quiet', '--eval', jsCode]);
      const { stdout } = await execFileAsync('mongosh', args, { timeout: 15000 });
      // mongosh sometimes wraps output — try to extract JSON
      const trimmed = stdout.trim();
      // Find JSON in output (mongosh may print warnings before JSON)
      const jsonMatch = trimmed.match(/\{[\s\S]+\}/) || trimmed.match(/\[[\s\S]+\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return { raw: trimmed };
    } catch (err) {
      // Try without mongosh — use mongo (legacy shell)
      try {
        const args = this._buildArgs(db, ['--quiet', '--eval', jsCode]);
        const { stdout } = await execFileAsync('mongo', args, { timeout: 15000 });
        const trimmed = stdout.trim();
        const jsonMatch = trimmed.match(/\{[\s\S]+\}/) || trimmed.match(/\[[\s\S]+\]/);
        if (jsonMatch) return JSON.parse(jsonMatch[0]);
        return { raw: trimmed };
      } catch (err2) {
        throw new Error(`MongoDB command failed: ${err.message}. Also tried legacy mongo: ${err2.message}`);
      }
    }
  }

  /**
   * Check if MongoDB is installed and running.
   */
  async _checkMongoInstalled() {
    try {
      await execFileAsync('mongosh', ['--version'], { timeout: 5000 });
      return true;
    } catch {
      try {
        await execFileAsync('mongo', ['--version'], { timeout: 5000 });
        return true;
      } catch {
        return false;
      }
    }
  }

  // ── Installation ─────────────────────────────────────

  /**
   * Install MongoDB server on the host.
   */
  async installMongoDB() {
    if (process.platform === 'win32') {
      throw new Error('MongoDB installation is only supported on Linux. On Windows, use Docker.');
    }

    const installed = await this._checkMongoInstalled();
    if (installed) {
      return { message: 'MongoDB shell is already installed. Checking server status...', status: 'already_installed' };
    }

    try {
      // Detect package manager and install MongoDB
      const { stdout: osRelease } = await execAsync('cat /etc/os-release 2>/dev/null || echo ""');
      const isUbuntu = osRelease.includes('ubuntu');
      const isDebian = osRelease.includes('debian');

      if (isUbuntu || isDebian) {
        // Import MongoDB GPG key and add repo
        await execAsync(
          'curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg && ' +
          'echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] http://repo.mongodb.org/apt/debian bookworm/mongodb-org/7.0 main" | tee /etc/apt/sources.list.d/mongodb-org-7.0.list && ' +
          'apt-get update -qq && apt-get install -y mongodb-org mongosh',
          { timeout: 180000 }
        );
      } else {
        // Generic: try npm global install of mongosh
        await execAsync('npm install -g mongosh', { timeout: 60000 });
      }

      // Try to start MongoDB
      try {
        await execAsync('systemctl start mongod 2>/dev/null || systemctl start mongodb 2>/dev/null || mongod --fork --logpath /var/log/mongod.log --dbpath /var/lib/mongodb 2>/dev/null || true');
      } catch {
        // Non-critical
      }

      return { message: 'MongoDB installed successfully. The mongosh client is available.' };
    } catch (err) {
      throw new Error(`Failed to install MongoDB: ${err.message}`);
    }
  }

  // ── Status & Info ────────────────────────────────────

  /**
   * Get MongoDB server status.
   */
  async getStatus() {
    const isInstalled = await this._checkMongoInstalled();

    if (!isInstalled) {
      return {
        installed: false,
        running: false,
        version: null,
        connectionOk: false,
      };
    }

    try {
      const status = await this._runMongoCommand('JSON.stringify({ version: db.version(), serverStatus: { uptime: db.serverStatus().uptime, connections: db.serverStatus().connections, ok: 1 } })');
      return {
        installed: true,
        running: true,
        version: status?.version || 'unknown',
        uptime: status?.serverStatus?.uptime || 0,
        connections: status?.serverStatus?.connections || {},
        connectionOk: true,
      };
    } catch {
      return {
        installed: true,
        running: false,
        version: null,
        connectionOk: false,
      };
    }
  }

  /**
   * Get detailed server info.
   */
  async getServerInfo() {
    try {
      const info = await this._runMongoCommand(`
        JSON.stringify({
          version: db.version(),
          buildInfo: db.adminCommand('buildInfo'),
          serverStatus: {
            uptime: db.serverStatus().uptime,
            connections: db.serverStatus().connections,
            network: db.serverStatus().network,
            opcounters: db.serverStatus().opcounters,
            mem: db.serverStatus().mem,
            storageEngine: db.serverStatus().storageEngine,
          },
          dbStats: db.stats(),
        })
      `);

      // Get database list separately
      const dbsResult = await this._runMongoCommand(`
        JSON.stringify(
          db.adminCommand('listDatabases').databases.map(d => ({
            name: d.name,
            sizeOnDisk: d.sizeOnDisk,
            empty: d.empty,
          }))
        )
      `);

      return {
        server: info,
        databases: Array.isArray(dbsResult) ? dbsResult : [],
      };
    } catch (err) {
      throw new Error(`Failed to get MongoDB server info: ${err.message}`);
    }
  }

  // ── Database Management ──────────────────────────────

  /**
   * List all databases.
   */
  async listDatabases() {
    try {
      const result = await this._runMongoCommand(`
        JSON.stringify(
          db.adminCommand('listDatabases').databases.map(d => ({
            name: d.name,
            sizeOnDisk: d.sizeOnDisk || 0,
            empty: d.empty || false,
          }))
        )
      `);
      return Array.isArray(result) ? result : [];
    } catch (err) {
      throw new Error(`Failed to list databases: ${err.message}`);
    }
  }

  /**
   * Create a new database (by inserting into it).
   */
  async createDatabase(name) {
    validateName(name);
    try {
      await this._runMongoCommand(`db.getSiblingDB('${name}').createCollection('_init_placeholder'); db.getSiblingDB('${name}').getCollection('_init_placeholder').drop();`, name);
      return { message: `Database "${name}" created.` };
    } catch (err) {
      throw new Error(`Failed to create database: ${err.message}`);
    }
  }

  /**
   * Drop a database.
   */
  async dropDatabase(name) {
    validateName(name);
    if (['admin', 'config', 'local'].includes(name)) {
      throw new Error(`Cannot drop system database "${name}"`);
    }
    try {
      await this._runMongoCommand(`db.getSiblingDB('${name}').dropDatabase()`, name);
      return { message: `Database "${name}" dropped.` };
    } catch (err) {
      throw new Error(`Failed to drop database: ${err.message}`);
    }
  }

  /**
   * Get database stats.
   */
  async getDatabaseStats(name) {
    validateName(name);
    try {
      const stats = await this._runMongoCommand(`JSON.stringify(db.stats())`, name);
      return stats;
    } catch (err) {
      throw new Error(`Failed to get database stats: ${err.message}`);
    }
  }

  // ── Collection Management ────────────────────────────

  /**
   * List collections in a database.
   */
  async listCollections(dbName) {
    validateName(dbName);
    try {
      const result = await this._runMongoCommand(`
        JSON.stringify(
          db.getCollectionInfos().map(c => ({
            name: c.name,
            type: c.type || 'collection',
            options: c.options || {},
            size: c.options?.size || 0,
            count: db.getCollection(c.name).countDocuments()
          }))
        )
      `, dbName);
      return Array.isArray(result) ? result : [];
    } catch (err) {
      throw new Error(`Failed to list collections: ${err.message}`);
    }
  }

  /**
   * Drop a collection.
   */
  async dropCollection(dbName, collectionName) {
    validateName(dbName);
    validateName(collectionName);
    try {
      await this._runMongoCommand(`db.getCollection('${collectionName}').drop()`, dbName);
      return { message: `Collection "${collectionName}" dropped.` };
    } catch (err) {
      throw new Error(`Failed to drop collection: ${err.message}`);
    }
  }

  /**
   * Find documents in a collection.
   */
  async findDocuments(dbName, collectionName, filter = {}, limit = 50, skip = 0) {
    validateName(dbName);
    validateName(collectionName);
    try {
      const safeLimit = Math.min(Math.max(parseInt(limit) || 50, 1), 500);
      const safeSkip = Math.max(parseInt(skip) || 0, 0);
      const filterStr = typeof filter === 'object' ? JSON.stringify(filter) : '{}';

      const result = await this._runMongoCommand(`
        JSON.stringify({
          documents: db.getCollection('${collectionName}').find(${filterStr}).limit(${safeLimit}).skip(${safeSkip}).toArray(),
          totalCount: db.getCollection('${collectionName}').countDocuments(${filterStr})
        })
      `, dbName);

      return {
        documents: result?.documents || [],
        totalCount: result?.totalCount || 0,
        limit: safeLimit,
        skip: safeSkip,
      };
    } catch (err) {
      throw new Error(`Failed to find documents: ${err.message}`);
    }
  }

  // ── User Management ──────────────────────────────────

  /**
   * List MongoDB users.
   */
  async listUsers() {
    try {
      const result = await this._runMongoCommand(`
        JSON.stringify(
          db.getSiblingDB('admin').system.users.find().toArray().map(u => ({
            id: u._id,
            user: u.user,
            db: u.db,
            roles: u.roles,
            mechanisms: u.mechanisms || [],
          }))
        )
      `);
      return Array.isArray(result) ? result : [];
    } catch (err) {
      throw new Error(`Failed to list users: ${err.message}`);
    }
  }

  /**
   * Create a MongoDB user.
   */
  async createUser(username, password, roles = []) {
    if (!username || !/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(username)) {
      throw new Error('Invalid username');
    }
    // [SECURITY] Validate password to prevent mongosh JS injection.
    // Only allow safe characters — blocks single quotes, backticks, etc.
    if (!password || password.length < 6) {
      throw new Error('Password must be at least 6 characters');
    }
    if (!/^[a-zA-Z0-9@#$%^&*!_\-+=.]+$/.test(password)) {
      throw new Error('Password contains invalid characters');
    }

    const safeRoles = Array.isArray(roles) && roles.length > 0
      ? JSON.stringify(roles.map(r => ({ role: r.role || 'readWrite', db: r.db || 'admin' })))
      : JSON.stringify([{ role: 'readWrite', db: 'admin' }]);

    try {
      await this._runMongoCommand(`
        db.getSiblingDB('admin').createUser({
          user: '${username}',
          pwd: '${password}',
          roles: ${safeRoles}
        })
      `);
      return { message: `User "${username}" created.` };
    } catch (err) {
      throw new Error(`Failed to create user: ${err.message}`);
    }
  }

  /**
   * Drop a MongoDB user.
   */
  async dropUser(username) {
    if (!username || !/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(username)) {
      throw new Error('Invalid username');
    }
    try {
      await this._runMongoCommand(`db.getSiblingDB('admin').dropUser('${username}')`);
      return { message: `User "${username}" dropped.` };
    } catch (err) {
      throw new Error(`Failed to drop user: ${err.message}`);
    }
  }

  // ── Query Console ────────────────────────────────────

  /**
   * Run a raw MongoDB query.
   */
  async runQuery(dbName, query) {
    validateName(dbName);
    if (!query || typeof query !== 'string') throw new Error('Query is required');

    // Block dangerous operations
    const upper = query.trim().toUpperCase();
    if (upper.includes('DROP') && (upper.includes('DATABASE') || upper.includes('ADMIN'))) {
      throw new Error('DROP DATABASE and DROP ADMIN operations are restricted via the query console.');
    }

    try {
      const result = await this._runMongoCommand(`JSON.stringify(eval(${JSON.stringify(query)}))`, dbName);
      return result;
    } catch (err) {
      throw new Error(`Query failed: ${err.message}`);
    }
  }

  // ── Backup & Restore ─────────────────────────────────

  /**
   * Perform mongodump backup.
   */
  async backupDatabase(dbName, outputPath = '') {
    if (dbName) validateName(dbName);
    const safeName = dbName || 'all';
    const backupDir = outputPath || path.resolve(process.cwd(), 'storage', 'backups', `mongodb_${safeName}_${Date.now()}`);

    try {
      await fs.mkdir(backupDir, { recursive: true });

      const args = [];
      if (this._mongoUser && this._mongoPass) {
        args.push('--username', this._mongoUser);
        args.push('--password', this._mongoPass);
        args.push('--authenticationDatabase', 'admin');
      }
      args.push('--uri', this._mongoUri);
      if (dbName) args.push('--db', dbName);
      args.push('--out', backupDir);

      await execFileAsync('mongodump', args, { timeout: 300000 });
      return { message: `Backup completed: ${backupDir}`, path: backupDir };
    } catch (err) {
      throw new Error(`Backup failed: ${err.message}`);
    }
  }

  /**
   * Perform mongorestore.
   */
  async restoreDatabase(backupPath, dbName = '') {
    try {
      await fs.access(backupPath);

      const args = [];
      if (this._mongoUser && this._mongoPass) {
        args.push('--username', this._mongoUser);
        args.push('--password', this._mongoPass);
        args.push('--authenticationDatabase', 'admin');
      }
      args.push('--uri', this._mongoUri);
      if (dbName) args.push('--nsInclude', `${dbName}.*`);
      args.push(backupPath);

      await execFileAsync('mongorestore', args, { timeout: 300000 });
      return { message: `Restore completed from: ${backupPath}` };
    } catch (err) {
      throw new Error(`Restore failed: ${err.message}`);
    }
  }
}

export default new MongoDBService();
