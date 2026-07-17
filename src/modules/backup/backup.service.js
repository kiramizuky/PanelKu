import fs from 'fs/promises';
import path from 'path';
import { spawn, exec } from 'child_process';
import logger from '../../config/logger.js';
import Setting from '../../models/Setting.js';

// ── Helpers ──────────────────────────────────────────────────────────

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

function execAsync(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = exec(cmd, { ...opts, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });
}

function validateName(name, pattern = /^[a-zA-Z0-9._\-\/]+$/, label = 'Name') {
  if (!name || typeof name !== 'string') throw Object.assign(new Error(`${label} is required`), { statusCode: 400 });
  if (!pattern.test(name)) throw Object.assign(new Error(`Invalid ${label} format`), { statusCode: 400 });
  if (name.includes('..') || name.startsWith('/') || name.startsWith('\\')) {
    throw Object.assign(new Error(`Path traversal detected in ${label}`), { statusCode: 400 });
  }
  return name;
}

function validateDbName(name) {
  return validateName(name, /^[a-zA-Z0-9_-]{1,64}$/, 'Database name');
}

function validatePath(name, allowSlash = true) {
  const pattern = allowSlash ? /^[a-zA-Z0-9_./\-@]+$/ : /^[a-zA-Z0-9_.\-]+$/;
  return validateName(name, pattern, 'Path');
}

// ── Job ID generator ────────────────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

// ── Rclone detection ────────────────────────────────────────────────
async function detectRclone() {
  try {
    const { stdout } = await execAsync('rclone --version 2>/dev/null || echo ""');
    const version = stdout.split('\n')[0]?.trim() || null;
    return { installed: !!version, version };
  } catch {
    return { installed: false, version: null };
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

  // ═══════════════════════════════════════════════════════════════════
  //  SECTION 1 — Rclone Management
  // ═══════════════════════════════════════════════════════════════════

  async getRcloneStatus() {
    const info = await detectRclone();
    let remotes = [];
    let configPath = null;

    if (info.installed) {
      try {
        const out = await execAsync('rclone listremotes 2>/dev/null || echo ""');
        remotes = out.split('\n').map(r => r.replace(':', '').trim()).filter(Boolean);
      } catch { /* no remotes */ }

      try {
        const out = await execAsync('rclone config file 2>/dev/null | head -1 || echo ""');
        configPath = out.trim() || null;
      } catch { /* ignore */ }
    }

    return { ...info, remotes, configPath };
  }

  async installRclone() {
    const existing = await detectRclone();
    if (existing.installed) {
      return { message: 'Rclone is already installed', version: existing.version };
    }

    try {
      const { stdout } = await execAsync(
        'curl -fsSL https://rclone.org/install.sh | bash 2>&1',
        { timeout: 180000 }
      );

      const info = await detectRclone();
      if (!info.installed) throw new Error('Installation completed but rclone not found');

      return { message: 'Rclone installed successfully', version: info.version, output: stdout };
    } catch (err) {
      throw new Error(`Failed to install Rclone: ${err.message}`);
    }
  }

  async testRemote(remoteName) {
    validateName(remoteName, /^[a-zA-Z0-9_\-]+$/, 'Remote name');

    const rclone = await detectRclone();
    if (!rclone.installed) throw new Error('Rclone is not installed');

    try {
      const stdout = await execAsync(`rclone lsd "${remoteName}:" 2>&1`, { timeout: 15000 });
      return { success: true, output: stdout.trim() };
    } catch (err) {
      throw new Error(`Failed to connect to remote "${remoteName}": ${err.message}`);
    }
  }

  async listRemoteFiles(remoteName, remotePath = '') {
    validateName(remoteName, /^[a-zA-Z0-9_\-]+$/, 'Remote name');
    if (remotePath) validatePath(remotePath);

    const rclone = await detectRclone();
    if (!rclone.installed) throw new Error('Rclone is not installed');

    try {
      const dest = remotePath ? `${remoteName}:${remotePath}` : `${remoteName}:`;
      const stdout = await execAsync(`rclone ls "${dest}" 2>&1`, { timeout: 30000 });
      const files = stdout.split('\n')
        .filter(l => l.trim())
        .map(l => {
          const match = l.match(/^\s*(\d+)\s+(.+)$/);
          return match ? { size: parseInt(match[1]), name: match[2] } : null;
        })
        .filter(Boolean);
      return { files, remote: remoteName, path: remotePath || '/' };
    } catch (err) {
      throw new Error(`Failed to list remote files: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  SECTION 2 — Backup Jobs (Schedule-based)
  // ═══════════════════════════════════════════════════════════════════

  async _getJobs() {
    try {
      const raw = await Setting.get('backup_jobs_v2') || '[]';
      return JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw));
    } catch {
      return [];
    }
  }

  async _saveJobs(jobs) {
    await Setting.set('backup_jobs_v2', JSON.stringify(jobs), 'json');
  }

  async getBackupJobs() {
    const jobs = await this._getJobs();
    return { jobs };
  }

  async createBackupJob(data) {
    if (!data.name || !data.source || !data.remote) {
      throw Object.assign(new Error('Name, source, and remote are required'), { statusCode: 400 });
    }

    validatePath(data.name, false);
    validatePath(data.source);

    // [SECURITY] Validate remote name — only alphanumeric, underscores, hyphens
    if (!/^[a-zA-Z0-9_\-]+$/.test(data.remote)) {
      throw Object.assign(new Error('Invalid remote name'), { statusCode: 400 });
    }

    // [SECURITY] Validate destPath — only safe path characters
    const destPath = (data.destPath || 'backups').trim();
    if (!/^[a-zA-Z0-9_.\-\/]+$/.test(destPath)) {
      throw Object.assign(new Error('Invalid destination path'), { statusCode: 400 });
    }

    // [SECURITY] Validate exclude/include patterns — strict alphanumeric + safe glob chars only
    const validatePattern = (p) => /^[a-zA-Z0-9_\-*.?\/]+$/.test(p);
    const includePatterns = (data.includePatterns || []).filter(p => {
      if (!validatePattern(p)) throw Object.assign(new Error(`Invalid include pattern: ${p}`), { statusCode: 400 });
      return true;
    });
    const excludePatterns = (data.excludePatterns || []).filter(p => {
      if (!validatePattern(p)) throw Object.assign(new Error(`Invalid exclude pattern: ${p}`), { statusCode: 400 });
      return true;
    });

    const job = {
      id: uid(),
      name: data.name.trim(),
      source: data.source.trim(),
      remote: data.remote.trim(),
      destPath,
      schedule: data.schedule || '0 2 * * *',
      type: data.type || 'sync',
      enabled: data.enabled !== false,
      createdAt: new Date().toISOString(),
      lastRun: null,
      lastStatus: null,
      lastOutput: null,
      retention: parseInt(data.retention) || 0,
      includePatterns,
      excludePatterns,
    };

    const jobs = await this._getJobs();
    jobs.push(job);
    await this._saveJobs(jobs);

    return { message: `Backup job "${job.name}" created`, job };
  }

  async updateBackupJob(id, data) {
    const jobs = await this._getJobs();
    const idx = jobs.findIndex(j => j.id === id);
    if (idx === -1) throw Object.assign(new Error('Backup job not found'), { statusCode: 404 });

    const job = jobs[idx];
    if (data.name) { validatePath(data.name, false); job.name = data.name.trim(); }
    if (data.source) { validatePath(data.source); job.source = data.source.trim(); }

    // [SECURITY] Validate remote, destPath, patterns on update too
    if (data.remote) {
      if (!/^[a-zA-Z0-9_\-]+$/.test(data.remote)) throw Object.assign(new Error('Invalid remote name'), { statusCode: 400 });
      job.remote = data.remote.trim();
    }
    if (data.destPath !== undefined) {
      const p = data.destPath.trim();
      if (!/^[a-zA-Z0-9_.\-\/]+$/.test(p)) throw Object.assign(new Error('Invalid destination path'), { statusCode: 400 });
      job.destPath = p;
    }
    if (data.schedule !== undefined) job.schedule = data.schedule;
    if (data.enabled !== undefined) job.enabled = data.enabled;
    if (data.type !== undefined) job.type = data.type;
    if (data.retention !== undefined) job.retention = parseInt(data.retention) || 0;

    // [SECURITY] Validate patterns on update
    const validatePattern = (p) => /^[a-zA-Z0-9_\-*.?\/]+$/.test(p);
    if (data.includePatterns !== undefined) {
      data.includePatterns.forEach(p => { if (!validatePattern(p)) throw Object.assign(new Error(`Invalid include pattern: ${p}`), { statusCode: 400 }); });
      job.includePatterns = data.includePatterns;
    }
    if (data.excludePatterns !== undefined) {
      data.excludePatterns.forEach(p => { if (!validatePattern(p)) throw Object.assign(new Error(`Invalid exclude pattern: ${p}`), { statusCode: 400 }); });
      job.excludePatterns = data.excludePatterns;
    }

    jobs[idx] = job;
    await this._saveJobs(jobs);
    return { message: `Backup job "${job.name}" updated`, job };
  }

  async deleteBackupJob(id) {
    const jobs = await this._getJobs();
    const filtered = jobs.filter(j => j.id !== id);
    if (filtered.length === jobs.length) {
      throw Object.assign(new Error('Backup job not found'), { statusCode: 404 });
    }
    await this._saveJobs(filtered);
    return { message: 'Backup job deleted' };
  }

  async runBackupJob(id) {
    const jobs = await this._getJobs();
    const job = jobs.find(j => j.id === id);
    if (!job) throw Object.assign(new Error('Backup job not found'), { statusCode: 404 });

    const rclone = await detectRclone();
    if (!rclone.installed) throw new Error('Rclone is not installed');

    // Build rclone command
    const cmd = job.type === 'copy' ? 'copy' : 'sync';
    const dest = `${job.remote}:${job.destPath}`;
    let cmdStr = `rclone ${cmd} "${job.source}" "${dest}" --verbose`;

    if (job.includePatterns?.length > 0) {
      job.includePatterns.forEach(p => { cmdStr += ` --include "${p}"`; });
    }
    if (job.excludePatterns?.length > 0) {
      job.excludePatterns.forEach(p => { cmdStr += ` --exclude "${p}"`; });
    }

    try {
      const stdout = await execAsync(cmdStr, { timeout: 3600000 }); // 1 hour max

      // Update job status
      job.lastRun = new Date().toISOString();
      job.lastStatus = 'success';
      job.lastOutput = stdout.slice(0, 2000);

      // Retention: if set, list remote and delete old backups
      if (job.retention > 0) {
        try {
          await this._applyRetention(job);
        } catch (e) {
          logger.warn(`Retention cleanup failed for job ${job.name}: ${e.message}`);
        }
      }

      await this._saveJobs(jobs);
      return { message: `Backup job "${job.name}" completed successfully`, output: stdout.slice(0, 1000), job };
    } catch (err) {
      job.lastRun = new Date().toISOString();
      job.lastStatus = 'failed';
      job.lastOutput = err.message.slice(0, 2000);
      await this._saveJobs(jobs);
      throw new Error(`Backup job "${job.name}" failed: ${err.message}`);
    }
  }

  async _applyRetention(job) {
    // List remote files in the backup path
    try {
      const stdout = await execAsync(
        `rclone ls "${job.remote}:${job.destPath}" 2>/dev/null || echo ""`,
        { timeout: 30000 }
      );

      const files = stdout.split('\n')
        .filter(l => l.trim())
        .map(l => {
          const m = l.match(/^\s*(\d+)\s+(.+)$/);
          return m ? { size: parseInt(m[1]), name: m[2] } : null;
        })
        .filter(Boolean);

      // Group by directory (each backup run creates a dated folder)
      const dirs = [...new Set(files.map(f => path.dirname(f.name)).filter(d => d !== '.'))];

      if (dirs.length > job.retention) {
        // Sort by name (assuming ISO date naming) and delete oldest
        dirs.sort();
        const toDelete = dirs.slice(0, dirs.length - job.retention);
        for (const dir of toDelete) {
          try {
            await execAsync(`rclone purge "${job.remote}:${job.destPath}/${dir}" 2>/dev/null`, { timeout: 30000 });
          } catch { /* ignore */ }
        }
      }
    } catch (e) {
      logger.warn(`Retention check failed: ${e.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  SECTION 3 — Local Backups (original functionality)
  // ═══════════════════════════════════════════════════════════════════

  async getBackups() {
    try {
      const files = await fs.readdir(this.backupDir);
      const backups = [];
      for (const file of files) {
        const stats = await fs.stat(path.join(this.backupDir, file));
        backups.push({
          name: file,
          size: stats.size,
          created: stats.mtime,
        });
      }
      return backups.sort((a, b) => b.created - a.created);
    } catch (err) {
      return [];
    }
  }

  async createBackup(type, target) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const mysqlUser = process.env.MYSQL_BACKUP_USER || 'root';
    const mysqlPass = process.env.MYSQL_BACKUP_PASSWORD || '';
    const pgUser = process.env.POSTGRES_BACKUP_USER || 'postgres';

    try {
      let filepath;

      if (type === 'mysql') {
        validateDbName(target);
        const filename = `mysql_${target}_${timestamp}.sql`;
        filepath = path.join(this.backupDir, filename);
        const args = ['-u', mysqlUser, target];
        const env = { ...process.env };
        if (mysqlPass) env.MYSQL_PWD = mysqlPass;
        const sqlData = await spawnPromise('mysqldump', args, { env });
        await fs.writeFile(filepath, sqlData);
      } else if (type === 'postgres') {
        validateDbName(target);
        const filename = `postgres_${target}_${timestamp}.sql`;
        filepath = path.join(this.backupDir, filename);
        const pgPass = process.env.POSTGRES_BACKUP_PASSWORD || '';
        const env = { ...process.env };
        if (pgPass) env.PGPASSWORD = pgPass;
        await spawnPromise('pg_dump', ['-U', pgUser, '-d', target, '-f', filepath], { env });
      } else if (type === 'files') {
        validatePath(target, false);
        const filename = `files_${target.replace(/[^a-zA-Z0-9]/g, '_')}_${timestamp}.tar.gz`;
        filepath = path.join(this.backupDir, filename);
        await spawnPromise('tar', ['-czf', filepath, '-C', '/var/www', target]);
      } else if (type === 'panel') {
        // Full panel backup (databases + configs)
        const filename = `panel_full_${timestamp}.tar.gz`;
        filepath = path.join(this.backupDir, filename);
        const storageDir = path.resolve('storage');
        await spawnPromise('tar', [
          '-czf', filepath,
          '-C', path.dirname(storageDir),
          'storage/panelku.db',
          'storage/cron-tasks.json',
          'storage/uploads',
        ]);
      } else {
        throw new Error('Unsupported backup type');
      }

      // Auto-upload to S3 if configured
      this.uploadToS3(filepath).catch((e) => logger.warn('S3 upload failed: ' + e.message));

      return { success: true, file: path.basename(filepath) };
    } catch (error) {
      logger.error('Backup failed: ' + error.message);
      throw new Error(`Backup failed: ${error.message}`);
    }
  }

  async uploadToS3(filepath) {
    try {
      const s3Str = await Setting.get('s3_backup_config') || '{}';
      const config = JSON.parse(s3Str);
      if (!config.enabled) return;

      const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
      const { createReadStream } = await import('fs');

      const s3 = new S3Client({
        endpoint: config.endpoint || undefined,
        region: config.region || 'us-east-1',
        credentials: {
          accessKeyId: config.accessKey,
          secretAccessKey: config.secretKey,
        },
        forcePathStyle: true,
      });

      const filename = path.basename(filepath);
      await s3.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: filename,
        Body: createReadStream(filepath),
      }));
      logger.info(`Backup uploaded to S3: ${filename}`);
    } catch (err) {
      logger.error('Failed S3 backup upload:', err.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  SECTION 4 — S3 Configuration
  // ═══════════════════════════════════════════════════════════════════

  async getS3Config() {
    const raw = await Setting.get('s3_backup_config') || '{}';
    return JSON.parse(raw);
  }

  async updateS3Config(config) {
    // Validate required fields
    if (config.bucket && !/^[a-z0-9][a-z0-9.-]{2,62}$/.test(config.bucket)) {
      throw Object.assign(new Error('Invalid S3 bucket name format'), { statusCode: 400 });
    }
    await Setting.set('s3_backup_config', JSON.stringify({
      enabled: !!config.enabled,
      endpoint: config.endpoint || '',
      region: config.region || 'us-east-1',
      bucket: config.bucket || '',
      accessKey: config.accessKey || '',
      secretKey: config.secretKey || '',
    }), 'json');
    return { message: 'S3 configuration saved' };
  }

  async testS3Connection() {
    const config = await this.getS3Config();
    if (!config.enabled || !config.bucket || !config.accessKey || !config.secretKey) {
      throw Object.assign(new Error('S3 is not fully configured'), { statusCode: 400 });
    }

    try {
      const { S3Client, ListBucketsCommand } = await import('@aws-sdk/client-s3');
      const s3 = new S3Client({
        endpoint: config.endpoint || undefined,
        region: config.region || 'us-east-1',
        credentials: {
          accessKeyId: config.accessKey,
          secretAccessKey: config.secretKey,
        },
        forcePathStyle: true,
      });
      await s3.send(new ListBucketsCommand({}));
      return { success: true, message: 'S3 connection successful' };
    } catch (err) {
      throw new Error(`S3 connection failed: ${err.message}`);
    }
  }

  async listS3Backups(prefix = '') {
    const config = await this.getS3Config();
    if (!config.enabled || !config.bucket) {
      throw Object.assign(new Error('S3 is not configured'), { statusCode: 400 });
    }

    try {
      const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
      const s3 = new S3Client({
        endpoint: config.endpoint || undefined,
        region: config.region || 'us-east-1',
        credentials: {
          accessKeyId: config.accessKey,
          secretAccessKey: config.secretKey,
        },
        forcePathStyle: true,
      });

      const result = await s3.send(new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: prefix,
      }));

      return {
        files: (result.Contents || []).map(obj => ({
          key: obj.Key,
          size: obj.Size,
          lastModified: obj.LastModified,
        })),
        bucket: config.bucket,
      };
    } catch (err) {
      throw new Error(`Failed to list S3 backups: ${err.message}`);
    }
  }

  async downloadFromS3(key) {
    const config = await this.getS3Config();
    if (!config.enabled) throw Object.assign(new Error('S3 is not configured'), { statusCode: 400 });

    try {
      const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
      const { createWriteStream } = await import('fs');

      const s3 = new S3Client({
        endpoint: config.endpoint || undefined,
        region: config.region || 'us-east-1',
        credentials: {
          accessKeyId: config.accessKey,
          secretAccessKey: config.secretKey,
        },
        forcePathStyle: true,
      });

      const localPath = path.join(this.backupDir, path.basename(key));
      const response = await s3.send(new GetObjectCommand({
        Bucket: config.bucket,
        Key: key,
      }));

      await new Promise((resolve, reject) => {
        const writeStream = createWriteStream(localPath);
        response.Body.pipe(writeStream);
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });

      return { message: `Downloaded ${key} from S3`, localPath };
    } catch (err) {
      throw new Error(`Failed to download from S3: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  SECTION 5 — Delete & Restore (Local)
  // ═══════════════════════════════════════════════════════════════════

  async deleteBackup(filename) {
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      throw Object.assign(new Error('Invalid filename'), { statusCode: 400 });
    }
    const filepath = path.join(this.backupDir, filename);
    if (!path.resolve(filepath).startsWith(path.resolve(this.backupDir))) {
      throw Object.assign(new Error('Path traversal detected'), { statusCode: 403 });
    }
    await fs.unlink(filepath);
    return true;
  }

  async restoreBackup(filename, target) {
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
    const pgUser = process.env.POSTGRES_BACKUP_USER || 'postgres';
    const pgPass = process.env.POSTGRES_BACKUP_PASSWORD || '';

    try {
      if (filename.startsWith('mysql_') && filename.endsWith('.sql')) {
        validateDbName(target);
        const env = { ...process.env };
        if (mysqlPass) env.MYSQL_PWD = mysqlPass;
        const sqlContent = await fs.readFile(filepath);
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

  // ═══════════════════════════════════════════════════════════════════
  //  SECTION 6 — Disaster Recovery: Remote Restore
  // ═══════════════════════════════════════════════════════════════════

  async restoreFromRemote(remoteName, remotePath, localTarget) {
    validateName(remoteName, /^[a-zA-Z0-9_\-]+$/, 'Remote name');
    validatePath(remotePath);
    validatePath(localTarget);

    const rclone = await detectRclone();
    if (!rclone.installed) throw new Error('Rclone is not installed');

    // Ensure local target directory exists
    const fullTarget = path.resolve(localTarget);
    await fs.mkdir(fullTarget, { recursive: true });

    try {
      const stdout = await execAsync(
        `rclone copy "${remoteName}:${remotePath}" "${fullTarget}" --verbose 2>&1`,
        { timeout: 3600000 }
      );
      return { message: `Restored from ${remoteName}:${remotePath} to ${fullTarget}`, output: stdout.slice(0, 1000) };
    } catch (err) {
      throw new Error(`Remote restore failed: ${err.message}`);
    }
  }

  async listRemoteBackups(remoteName, remotePath = 'backups') {
    const rclone = await detectRclone();
    if (!rclone.installed) throw new Error('Rclone is not installed');

    try {
      const dest = `${remoteName}:${remotePath}`;
      const stdout = await execAsync(`rclone ls "${dest}" 2>&1 || echo ""`, { timeout: 30000 });
      const files = stdout.split('\n')
        .filter(l => l.trim())
        .map(l => {
          const m = l.match(/^\s*(\d+)\s+(.+)$/);
          return m ? { size: parseInt(m[1]), name: m[2] } : null;
        })
        .filter(Boolean);

      // Also list directories
      const dirsOut = await execAsync(`rclone lsd "${dest}" 2>&1 || echo ""`, { timeout: 15000 });
      const dirs = dirsOut.split('\n')
        .filter(l => l.trim())
        .map(l => {
          const m = l.match(/^\s*[-d]+\s+\d+\s+[\d:]+\s+(.+)$/);
          return m ? m[1].trim() : null;
        })
        .filter(Boolean);

      return { files, dirs, remote: remoteName, path: remotePath };
    } catch (err) {
      throw new Error(`Failed to list remote backups: ${err.message}`);
    }
  }
}

export default new BackupService();
