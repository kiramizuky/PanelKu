import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';
const execPromise = util.promisify(exec);

class BackupService {
  constructor() {
    this.backupDir = path.resolve('storage', 'backups');
    this._initBackupDir();
  }

  async _initBackupDir() {
    try {
      await fs.mkdir(this.backupDir, { recursive: true });
    } catch (e) {
      console.error('Failed to create backup directory:', e);
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
    const filename = `${type}_${target.replace(/[^a-zA-Z0-9]/g, '_')}_${timestamp}`;
    
    let command = '';
    let filepath = '';

    try {
      if (type === 'mysql') {
        filepath = path.join(this.backupDir, `${filename}.sql`);
        command = `mysqldump -u root ${target} > "${filepath}"`;
      } else if (type === 'postgres') {
        filepath = path.join(this.backupDir, `${filename}.sql`);
        command = `pg_dump -U postgres -d ${target} -f "${filepath}"`;
      } else if (type === 'files') {
        filepath = path.join(this.backupDir, `${filename}.tar.gz`);
        command = `tar -czf "${filepath}" -C /var/www "${target}"`;
      } else {
        throw new Error('Unsupported backup type');
      }

      await execPromise(command);
      this.uploadToS3(filepath).catch(() => {});
      return { success: true, file: path.basename(filepath) };
    } catch (error) {
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
      const fs = (await import('fs')).default;
      const fsStream = fs.createReadStream(filepath);

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
    } catch (err) {
      console.error('Failed S3 backup upload:', err.message);
    }
  }

  async deleteBackup(filename) {
    // Basic path traversal prevention
    if (filename.includes('..') || filename.includes('/')) throw new Error('Invalid filename');
    const filepath = path.join(this.backupDir, filename);
    await fs.unlink(filepath);
    return true;
  }

  async restoreBackup(filename, target) {
    if (filename.includes('..') || filename.includes('/')) throw new Error('Invalid filename');
    const filepath = path.join(this.backupDir, filename);
    
    try {
      await fs.access(filepath);
    } catch {
      throw new Error('Backup file not found');
    }

    let command = '';
    try {
      if (filename.startsWith('mysql_') && filename.endsWith('.sql')) {
        command = `mysql -u root ${target} < "${filepath}"`;
      } else if (filename.startsWith('postgres_') && filename.endsWith('.sql')) {
        command = `psql -U postgres -d ${target} -f "${filepath}"`;
      } else if (filename.startsWith('files_') && filename.endsWith('.tar.gz')) {
        // extract to target directory
        await fs.mkdir(target, { recursive: true });
        command = `tar -xzf "${filepath}" -C "${target}"`;
      } else {
        throw new Error('Unsupported backup type for restore');
      }

      await execPromise(command);
      return { success: true, message: 'Restore completed successfully' };
    } catch (error) {
      throw new Error(`Restore failed: ${error.message}`);
    }
  }
}

export default new BackupService();
