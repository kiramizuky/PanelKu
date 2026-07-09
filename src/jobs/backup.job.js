import scheduler from '../core/scheduler/Scheduler.js';
import logger from '../config/logger.js';
import { getDb } from '../core/db/sqlite.js';
import fs from 'fs/promises';
import path from 'path';

const BACKUP_DIR = path.resolve(process.cwd(), 'storage', 'backups');

export const startBackupJob = () => {
  // Register recurring job: every 24 hours (86,400,000 ms)
  scheduler.register(
    'system:backup',
    async () => {
      logger.info('Starting automated daily SQLite database backup...');
      try {
        await fs.mkdir(BACKUP_DIR, { recursive: true });

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `panel_db_auto_${timestamp}.db`;
        const filepath = path.join(BACKUP_DIR, filename);

        const db = getDb();
        // Native better-sqlite3 asynchronous backup (doesn't block WAL reader/writer threads)
        await db.backup(filepath);
        logger.info(`Automated database backup created successfully: ${filename}`);

        // Cleanup old backups (keep last 7 days of auto-backups)
        const files = await fs.readdir(BACKUP_DIR);
        const autoBackups = [];

        for (const file of files) {
          if (file.startsWith('panel_db_auto_') && file.endsWith('.db')) {
            const stat = await fs.stat(path.join(BACKUP_DIR, file));
            autoBackups.push({ name: file, time: stat.mtimeMs });
          }
        }

        // Sort descending (newest first)
        autoBackups.sort((a, b) => b.time - a.time);

        // Keep top 7, delete the rest
        if (autoBackups.length > 7) {
          const toDelete = autoBackups.slice(7);
          for (const item of toDelete) {
            await fs.unlink(path.join(BACKUP_DIR, item.name));
            logger.info(`Deleted old automated backup: ${item.name}`);
          }
        }
      } catch (err) {
        logger.error(`Automated database backup failed: ${err.message}`);
      }
    },
    24 * 60 * 60 * 1000, // 24 hours
    false // do not run immediately on startup
  );

  logger.info('Automated database backup job initialized');
};
