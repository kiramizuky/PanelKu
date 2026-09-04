process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import fs from 'fs/promises';
import path from 'path';
import databaseService from '../src/modules/database/database.service.js';
import backupService from '../src/modules/backup/backup.service.js';

describe('Database Backup, Restore & Auto-Backup', () => {
  const testDbName = 'test_backup_restore_db.sqlite';
  const testDbPath = path.resolve('storage', 'databases', testDbName);

  beforeAll(async () => {
    await fs.mkdir(path.resolve('storage', 'databases'), { recursive: true });
    await fs.mkdir(path.resolve('storage', 'backups', 'databases'), { recursive: true });
  });

  afterAll(async () => {
    await fs.unlink(testDbPath).catch(() => {});
  });

  test('1. Creates SQLite database, backs it up, and checks backup file', async () => {
    // 1. Initialize SQLite database with test data
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(testDbPath);
    db.exec(`
      CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, val INT);
      INSERT INTO items (name, val) VALUES ('Initial Apple', 100);
      INSERT INTO items (name, val) VALUES ('Initial Orange', 200);
    `);
    db.close();

    // 2. Perform backup
    const backupRes = await databaseService.backupDatabase('sqlite', testDbName);
    expect(backupRes).toBeDefined();
    expect(backupRes.filename).toContain('sqlite_test_backup_restore_db_');
    expect(backupRes.size).toBeGreaterThan(0);

    const exists = await fs.access(backupRes.filePath).then(() => true).catch(() => false);
    expect(exists).toBe(true);

    // List backups should include this backup
    const list = await databaseService.listDatabaseBackups('sqlite', testDbName);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].filename).toBe(backupRes.filename);

    // 3. Mutate the live database (simulate new/changed data)
    const dbMutated = new Database(testDbPath);
    dbMutated.exec(`
      DELETE FROM items;
      INSERT INTO items (name, val) VALUES ('Mutated Banana', 999);
      CREATE TABLE extra_table (id INT);
    `);
    const mutatedCount = dbMutated.prepare('SELECT COUNT(*) as c FROM items').get().c;
    const mutatedName = dbMutated.prepare('SELECT name FROM items LIMIT 1').get().name;
    expect(mutatedCount).toBe(1);
    expect(mutatedName).toBe('Mutated Banana');
    dbMutated.close();

    // 4. Perform Restore with Overwrite
    const restoreRes = await databaseService.restoreDatabase('sqlite', testDbName, { filePath: backupRes.filePath });
    expect(restoreRes.success).toBe(true);

    // 5. Verify the live database is completely overwritten back to initial state
    const dbRestored = new Database(testDbPath);
    const restoredRows = dbRestored.prepare('SELECT * FROM items ORDER BY id ASC').all();
    expect(restoredRows.length).toBe(2);
    expect(restoredRows[0].name).toBe('Initial Apple');
    expect(restoredRows[1].name).toBe('Initial Orange');

    // extra_table created during mutation must be gone
    const extraTable = dbRestored.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='extra_table'").get();
    expect(extraTable).toBeUndefined();
    dbRestored.close();

    // Cleanup backup file
    await databaseService.deleteDatabaseBackup(backupRes.filename);
    const afterDelete = await databaseService.listDatabaseBackups('sqlite', testDbName);
    expect(afterDelete.find(b => b.filename === backupRes.filename)).toBeUndefined();
  });

  test('2. Path traversal security checks on backup and restore filenames', async () => {
    await expect(databaseService.backupDatabase('sqlite', '../../../etc/passwd'))
      .rejects.toThrow(/Invalid database name/);

    await expect(databaseService.deleteDatabaseBackup('../sensitive.txt'))
      .rejects.toThrow(/Invalid backup filename/);

    await expect(databaseService.deleteDatabaseBackup('foo/../../bar.sql'))
      .rejects.toThrow(/Invalid backup filename/);
  });

  test('3. Auto-backup configuration and execution', async () => {
    const config = await databaseService.saveAutoBackupConfig({
      enabled: true,
      frequency: 'daily',
      time: '03:00',
      retentionDays: 14,
      targets: { mysql: false, postgres: false, sqlite: true }
    });

    expect(config.enabled).toBe(true);
    expect(config.retentionDays).toBe(14);
    expect(config.targets.sqlite).toBe(true);

    const loaded = await databaseService.getAutoBackupConfig();
    expect(loaded.time).toBe('03:00');

    // Trigger auto backup
    const runRes = await databaseService.runAutoBackup(true);
    expect(runRes.success).toBe(true);
    expect(Array.isArray(runRes.results)).toBe(true);
  });

  test('4. Backup local service prevents non-existent database dump with friendly 400 error', async () => {
    // When a user requests a database that does not exist in postgres
    await expect(backupService.createBackup('postgres', 'non_existent_db_xyz'))
      .rejects.toThrow(/does not exist|failed/i);
  });
});
