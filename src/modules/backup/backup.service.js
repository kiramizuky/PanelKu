import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import logger from '../../config/logger.js';

/**
 * Run a command safely using spawn (avoids shell injection).
 * @param {string} cmd  - executable
 * @param {string[]} args - arguments array (never shell-interpolated)
 * @param {object} opts - spawn options
 */
function spawnPromise(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => { stdout += d; });
    child.stderr?.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `Process exited with code ${code}`));
    });
  });
}

/**
 * Validate a database name — only alphanumeric, underscores, hyphens.
 * Prevents command injection when passed as DB name arguments.
 */
function validateDbName(name) {
  if (!name || !/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
    throw Object.assign(new Error('Invalid database name. Use only letters, numbers, underscores, or hyphens.'), { statusCode: 400 });
  }
}

/**
 * Validate a directory name for file backups — alphanumeric, underscores, hyphens only.
 */
function validateDirName(name) {
  if (!name || !/^[a-zA-Z0-9_.-]{1,128}$/.test(name)) {
    throw Object.assign(new Error('Invalid directory name. Use only letters, numbers, underscores, hyphens or dots.'), { statusCode: 400 });
  }
  // Prevent path traversal even within the pattern
  if (name.includes('..') || name.startsWith('/') || name.startsWith('\\')) {
    throw Object.assign(new Error('Path traversal detected in directory name.'), { statusCode: 400 });
  }
}

class BackupService {
  constructor() {
    this.backupDir = path.resolve('storage', 'backups');
    this._initBackupDir();
  }

  async _initBackupDir() {
    try {
      await fs.mkdir(this.backupDir, { recursive: true });
    } catch (e) {
      logger.error('Failed to create backup directory:', e.message);
    }
  }

  async getBackups() {
    try {
      const files = await fs.readdir(this.backupDir);
      const backups = [];
      for (const file of files) {
        const stats = await fs.stat(path.join(this.backupDir, file));
        backups.push({
          name: file,
          size: stats.size,
          created: stats.mtime
        });
      }
      return backups.sort((a, b) => b.created - a.created);
    } catch (err) {
      return [];
    }
  }

  async createBackup(type, target) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    // Read optional DB credentials from environment
    const mysqlUser = process.env.MYSQL_BACKUP_USER || 'root';
    const mysqlPass = process.env.MYSQL_BACKUP_PASSWORD || '';
    const pgUser    = process.env.POSTGRES_BACKUP_USER || 'postgres';

    try {
      let filepath;

      if (type === 'mysql') {
        // [CRIT-1 FIX] Validate target before use
        validateDbName(target);
        const filename = `mysql_${target}_${timestamp}.sql`;
        filepath = path.join(this.backupDir, filename);

        // [CRIT-1 + MED-6 FIX] Use spawn with args array — no shell interpolation
        // Password via environment variable (never in command string)
        const args = ['-u', mysqlUser, target];
        const env = { ...process.env };
        if (mysqlPass) env.MYSQL_PWD = mysqlPass; // safe: env variable, not CLI arg

        const sqlData = await spawnPromise('mysqldump', args, { env });
        await fs.writeFile(filepath, sqlData);

      } else if (type === 'postgres') {
        validateDbName(target);
        const filename = `postgres_${target}_${timestamp}.sql`;
        filepath = path.join(this.backupDir, filename);

        // Use pg_dump with args array — PGPASSWORD via env
        const pgPass = process.env.POSTGRES_BACKUP_PASSWORD || '';
        const env = { ...process.env };
        if (pgPass) env.PGPASSWORD = pgPass;

        await spawnPromise('pg_dump', ['-U', pgUser, '-d', target, '-f', filepath], { env });

      } else if (type === 'files') {
        validateDirName(target);
        const filename = `files_${target.replace(/[^a-zA-Z0-9]/g, '_')}_${timestamp}.tar.gz`;
        filepath = path.join(this.backupDir, filename);

        // tar with args array — target is validated above
        await spawnPromise('tar', ['-czf', filepath, '-C', '/var/www', target]);

      } else {
        throw new Error('Unsupported backup type');
      }

      this.uploadToS3(filepath).catch((e) => logger.warn('S3 upload failed: ' + e.message));
      return { success: true, file: path.basename(filepath) };

    } catch (error) {
      logger.error('Backup failed: ' + error.message);
      throw new Error(`Backup failed: ${error.message}`);
    }
  }

  async uploadToS3(filepath) {
    try {
      const Setting = (await import('../../models/Setting.js')).default;
      const s3Str = await Setting.get('s3_backup_config') || '{}';
      const config = JSON.parse(s3Str);
      if (!config.enabled) return;

      const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
      const { createReadStream } = await import('fs');
      const fsStream = createReadStream(filepath);

      const s3 = new S3Client({
        endpoint: config.endpoint || undefined,
        region: config.region || 'us-east-1',
        credentials: {
          accessKeyId: config.accessKey,
          secretAccessKey: config.secretKey
        },
        forcePathStyle: true
      });

      const filename = path.basename(filepath);
      await s3.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: filename,
        Body: fsStream
      }));
      logger.info(`Backup uploaded to S3: ${filename}`);
    } catch (err) {
      logger.error('Failed S3 backup upload:', err.message);
    }
  }

  async deleteBackup(filename) {
    // Prevent path traversal
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      throw Object.assign(new Error('Invalid filename'), { statusCode: 400 });
    }
    const filepath = path.join(this.backupDir, filename);
    // Ensure the resolved path is still inside backupDir
    if (!path.resolve(filepath).startsWith(path.resolve(this.backupDir))) {
      throw Object.assign(new Error('Path traversal detected'), { statusCode: 403 });
    }
    await fs.unlink(filepath);
    return true;
  }

  async restoreBackup(filename, target) {
    // [MED-1 FIX] Validate both filename and target
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      throw Object.assign(new Error('Invalid filename'), { statusCode: 400 });
    }

    const filepath = path.join(this.backupDir, filename);
    if (!path.resolve(filepath).startsWith(path.resolve(this.backupDir))) {
      throw Object.assign(new Error('Path traversal detected'), { statusCode: 403 });
    }

    try {
      await fs.access(filepath);
    } catch {
      throw new Error('Backup file not found');
    }

    const mysqlUser = process.env.MYSQL_BACKUP_USER || 'root';
    const mysqlPass = process.env.MYSQL_BACKUP_PASSWORD || '';
    const pgUser    = process.env.POSTGRES_BACKUP_USER || 'postgres';
    const pgPass    = process.env.POSTGRES_BACKUP_PASSWORD || '';

    try {
      if (filename.startsWith('mysql_') && filename.endsWith('.sql')) {
        // [MED-1 + CRIT-1 FIX] Validate DB target name
        validateDbName(target);
        const env = { ...process.env };
        if (mysqlPass) env.MYSQL_PWD = mysqlPass;
        const sqlContent = await fs.readFile(filepath);
        // [FIX] spawn() does not support `input` option (that's for exec/execFile).
        // Write to stdin via the existing spawnPromise approach.
        // We create a custom promise to pipe stdin.
        await new Promise((resolve, reject) => {
          const child = spawn('mysql', ['-u', mysqlUser, target], { env, stdio: ['pipe', 'pipe', 'pipe'] });
          let stderr = '';
          child.stderr?.on('data', (d) => { stderr += d; });
          child.on('error', reject);
          child.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(stderr || `mysql exited with code ${code}`));
          });
          child.stdin.write(sqlContent);
          child.stdin.end();
        });

      } else if (filename.startsWith('postgres_') && filename.endsWith('.sql')) {
        validateDbName(target);
        const env = { ...process.env };
        if (pgPass) env.PGPASSWORD = pgPass;
        await spawnPromise('psql', ['-U', pgUser, '-d', target, '-f', filepath], { env });

      } else if (filename.startsWith('files_') && filename.endsWith('.tar.gz')) {
        // [MED-1 FIX] Validate target directory path — must be within /var/www
        const resolvedTarget = path.resolve('/var/www', target);
        if (!resolvedTarget.startsWith('/var/www')) {
          throw Object.assign(new Error('Restore target must be within /var/www'), { statusCode: 400 });
        }
        await fs.mkdir(resolvedTarget, { recursive: true });
        await spawnPromise('tar', ['-xzf', filepath, '-C', resolvedTarget]);

      } else {
        throw new Error('Unsupported backup type for restore');
      }

      return { success: true, message: 'Restore completed successfully' };
    } catch (error) {
      logger.error('Restore failed: ' + error.message);
      throw new Error(`Restore failed: ${error.message}`);
    }
  }
}

export default new BackupService();
