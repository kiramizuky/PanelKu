/**
 * AutoHeal Database Provider
 * Handles PostgreSQL, MySQL/MariaDB, SQLite, Redis, and MongoDB health & recovery.
 */

import { execCmd } from '../../../helpers/exec.js';
import logger from '../../../config/logger.js';
import fs from 'fs/promises';
import path from 'path';

class DatabaseProvider {
  constructor() {
    this.name = 'database';
    this.displayName = 'Databases & In-Memory Stores';
  }

  /**
   * Run health checks on all supported database engines
   */
  async check() {
    const isWindows = process.platform === 'win32';
    const items = [];

    // 1. SQLite (Panelku's internal database)
    try {
      const sqliteHealth = await this._checkSqlite();
      items.push({
        name: 'SQLite (Panelku Core)',
        serviceName: 'sqlite',
        type: 'database',
        status: sqliteHealth.healthy ? 'healthy' : 'warning',
        message: sqliteHealth.message,
        healable: true,
      });
    } catch (err) {
      items.push({
        name: 'SQLite (Panelku Core)',
        serviceName: 'sqlite',
        type: 'database',
        status: 'warning',
        message: `SQLite check failed: ${err.message}`,
        healable: true,
      });
    }

    if (isWindows) {
      return items;
    }

    // 2. PostgreSQL
    try {
      const pgInstalled = await this._isInstalled('postgresql');
      if (pgInstalled) {
        const pgActive = await this._isServiceActive('postgresql');
        items.push({
          name: 'PostgreSQL Database',
          serviceName: 'postgresql',
          type: 'database',
          status: pgActive ? 'healthy' : 'critical',
          message: pgActive ? 'PostgreSQL cluster is running' : 'PostgreSQL daemon is stopped',
          healable: true,
        });
      }
    } catch (_) {}

    // 3. MySQL / MariaDB
    try {
      const mysqlSvc = (await this._isInstalled('mariadb')) ? 'mariadb' : ((await this._isInstalled('mysql')) ? 'mysql' : null);
      if (mysqlSvc) {
        const mysqlActive = await this._isServiceActive(mysqlSvc);
        items.push({
          name: 'MySQL / MariaDB',
          serviceName: mysqlSvc,
          type: 'database',
          status: mysqlActive ? 'healthy' : 'critical',
          message: mysqlActive ? `${mysqlSvc} service is active` : `${mysqlSvc} service is inactive`,
          healable: true,
        });
      }
    } catch (_) {}

    // 4. Redis
    try {
      const redisSvc = (await this._isInstalled('redis-server')) ? 'redis-server' : ((await this._isInstalled('redis')) ? 'redis' : null);
      if (redisSvc) {
        const redisActive = await this._isServiceActive(redisSvc);
        items.push({
          name: 'Redis In-Memory Cache',
          serviceName: redisSvc,
          type: 'database',
          status: redisActive ? 'healthy' : 'critical',
          message: redisActive ? `${redisSvc} is active` : `${redisSvc} is inactive`,
          healable: true,
        });
      }
    } catch (_) {}

    // 5. MongoDB
    try {
      const mongoSvc = (await this._isInstalled('mongod')) ? 'mongod' : ((await this._isInstalled('mongodb')) ? 'mongodb' : null);
      if (mongoSvc) {
        const mongoActive = await this._isServiceActive(mongoSvc);
        items.push({
          name: 'MongoDB NoSQL',
          serviceName: mongoSvc,
          type: 'database',
          status: mongoActive ? 'healthy' : 'critical',
          message: mongoActive ? `${mongoSvc} is active` : `${mongoSvc} is stopped`,
          healable: true,
        });
      }
    } catch (_) {}

    return items;
  }

  /**
   * Execute auto-healing for databases
   */
  async heal(target = 'all') {
    const isWindows = process.platform === 'win32';
    const actionsTaken = [];

    // 1. SQLite WAL Checkpointing & Vacuum
    if (target === 'all' || target === 'sqlite') {
      try {
        const res = await this._healSqlite();
        if (res.action) actionsTaken.push(res.action);
      } catch (err) {
        logger.warn(`[AutoHeal:Database] SQLite heal error: ${err.message}`);
      }
    }

    if (isWindows) {
      return {
        success: actionsTaken.length > 0,
        actionsTaken,
        message: actionsTaken.length > 0 ? actionsTaken.join(', ') : 'Database checks completed',
      };
    }

    // 2. PostgreSQL Healing (Collation, stale PID, service restart)
    if (target === 'all' || target === 'postgresql') {
      try {
        if (await this._isInstalled('postgresql')) {
          const pgActive = await this._isServiceActive('postgresql');
          if (!pgActive) {
            // Check for stale postmaster.pid lock if no postgres process runs
            const pidRemoved = await this._cleanStalePostgresPid();
            if (pidRemoved) actionsTaken.push('Removed stale postmaster.pid lock');
            await execCmd('systemctl', ['restart', 'postgresql'], { timeout: 20000 });
            actionsTaken.push('Restarted PostgreSQL service');
          }

          // Auto-refresh collation versions if postgres is running
          if (await this._isServiceActive('postgresql')) {
            const collationRefreshed = await this._refreshPgCollation();
            if (collationRefreshed) actionsTaken.push('Refreshed PostgreSQL template1/postgres collation versions');
          }
        }
      } catch (err) {
        logger.warn(`[AutoHeal:Database] PostgreSQL heal error: ${err.message}`);
      }
    }

    // 3. MySQL / MariaDB Healing
    if (target === 'all' || target === 'mysql' || target === 'mariadb') {
      try {
        const svc = (await this._isInstalled('mariadb')) ? 'mariadb' : ((await this._isInstalled('mysql')) ? 'mysql' : null);
        if (svc && !(await this._isServiceActive(svc))) {
          await execCmd('systemctl', ['restart', svc], { timeout: 25000 });
          actionsTaken.push(`Restarted ${svc} service`);
        }
      } catch (err) {
        logger.warn(`[AutoHeal:Database] MySQL/MariaDB heal error: ${err.message}`);
      }
    }

    // 4. Redis Healing
    if (target === 'all' || target === 'redis' || target === 'redis-server') {
      try {
        const svc = (await this._isInstalled('redis-server')) ? 'redis-server' : ((await this._isInstalled('redis')) ? 'redis' : null);
        if (svc) {
          if (!(await this._isServiceActive(svc))) {
            await execCmd('systemctl', ['restart', svc], { timeout: 15000 });
            actionsTaken.push(`Restarted ${svc}`);
          } else {
            // Memory defrag / purge if redis-cli is present
            try {
              await execCmd('redis-cli', ['MEMORY', 'PURGE'], { timeout: 5000 });
              actionsTaken.push('Purged Redis memory fragments');
            } catch (_) {}
          }
        }
      } catch (err) {
        logger.warn(`[AutoHeal:Database] Redis heal error: ${err.message}`);
      }
    }

    // 5. MongoDB Healing (stale lock/socket cleanup)
    if (target === 'all' || target === 'mongodb' || target === 'mongod') {
      try {
        const svc = (await this._isInstalled('mongod')) ? 'mongod' : ((await this._isInstalled('mongodb')) ? 'mongodb' : null);
        if (svc && !(await this._isServiceActive(svc))) {
          const cleaned = await this._cleanStaleMongoLock();
          if (cleaned) actionsTaken.push('Cleaned stale MongoDB lockfile/socket');
          await execCmd('systemctl', ['restart', svc], { timeout: 25000 });
          actionsTaken.push(`Restarted ${svc} service`);
        }
      } catch (err) {
        logger.warn(`[AutoHeal:Database] MongoDB heal error: ${err.message}`);
      }
    }

    return {
      success: actionsTaken.length > 0,
      actionsTaken,
      message: actionsTaken.length > 0 ? actionsTaken.join(', ') : 'No database healing actions needed',
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  async _checkSqlite() {
    try {
      const { getDb } = await import('../../../core/db/sqlite.js');
      const db = getDb();
      const check = db.prepare('PRAGMA integrity_check').get();
      const walCheck = db.prepare('PRAGMA journal_mode').get();
      const isOk = check && Object.values(check)[0] === 'ok';

      // Check WAL file size
      let walSizeMb = 0;
      try {
        const stat = await fs.stat(path.resolve('storage', 'database.sqlite-wal'));
        walSizeMb = Math.round(stat.size / (1024 * 1024));
      } catch (_) {}

      return {
        healthy: isOk && walSizeMb < 50,
        message: isOk
          ? `Integrity OK (mode: ${walCheck?.journal_mode || 'wal'}, WAL: ${walSizeMb}MB)`
          : 'Integrity check detected warnings',
      };
    } catch (err) {
      return { healthy: false, message: err.message };
    }
  }

  async _healSqlite() {
    try {
      const { getDb } = await import('../../../core/db/sqlite.js');
      const db = getDb();
      // Force WAL checkpoint truncate
      db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').run();
      return { action: 'Executed SQLite WAL checkpoint (TRUNCATE)' };
    } catch (_) {
      return { action: null };
    }
  }

  async _refreshPgCollation() {
    try {
      await execCmd('sudo', ['-u', 'postgres', 'psql', '-c', 'ALTER DATABASE template1 REFRESH COLLATION VERSION;'], { timeout: 8000 });
      await execCmd('sudo', ['-u', 'postgres', 'psql', '-c', 'ALTER DATABASE postgres REFRESH COLLATION VERSION;'], { timeout: 8000 });
      return true;
    } catch {
      return false;
    }
  }

  async _cleanStalePostgresPid() {
    try {
      // Check if postgres process is running
      const ps = await execCmd('pgrep', ['-f', 'postgres:']).catch(() => '');
      if (!ps.trim()) {
        // Safe to check common data dirs
        const commonDirs = ['/var/lib/postgresql/16/main', '/var/lib/postgresql/15/main', '/var/lib/postgresql/14/main'];
        for (const dir of commonDirs) {
          const pidFile = path.join(dir, 'postmaster.pid');
          try {
            await fs.access(pidFile);
            await fs.unlink(pidFile);
            return true;
          } catch (_) {}
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  async _cleanStaleMongoLock() {
    try {
      const ps = await execCmd('pgrep', ['-f', 'mongod']).catch(() => '');
      if (!ps.trim()) {
        const paths = ['/tmp/mongodb-27017.sock', '/var/lib/mongodb/mongod.lock'];
        let cleaned = false;
        for (const p of paths) {
          try {
            await fs.access(p);
            await fs.unlink(p);
            cleaned = true;
          } catch (_) {}
        }
        return cleaned;
      }
      return false;
    } catch {
      return false;
    }
  }

  async _isServiceActive(serviceName) {
    try {
      const stdout = await execCmd('systemctl', ['is-active', serviceName], { timeout: 5000 });
      return stdout.trim() === 'active';
    } catch {
      return false;
    }
  }

  async _isInstalled(binOrService) {
    try {
      const out = await execCmd('which', [binOrService], { timeout: 4000 });
      if (out.trim()) return true;
    } catch {}
    try {
      const out = await execCmd('systemctl', ['list-unit-files', `${binOrService}.service`], { timeout: 4000 });
      return out.includes(`${binOrService}.service`);
    } catch {
      return false;
    }
  }
}

export default new DatabaseProvider();
