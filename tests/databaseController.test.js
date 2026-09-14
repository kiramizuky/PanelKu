/**
 * Comprehensive Unit Tests for Database Controller:
 * - src/modules/database/database.controller.js
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

const mockDatabaseService = {
  listMysqlDatabases: jest.fn(),
  listPgDatabases: jest.fn(),
  listSqliteDatabases: jest.fn(),
  createMysqlDatabase: jest.fn(),
  createPgDatabase: jest.fn(),
  createSqliteDatabase: jest.fn(),
  deleteMysqlDatabase: jest.fn(),
  deletePgDatabase: jest.fn(),
  deleteSqliteDatabase: jest.fn(),
  getSchemas: jest.fn(),
  getTables: jest.fn(),
  getTableInfo: jest.fn(),
  getTableData: jest.fn(),
  getDatabaseStats: jest.fn(),
  runQuery: jest.fn(),
  explainQuery: jest.fn(),
  insertRow: jest.fn(),
  updateRow: jest.fn(),
  deleteRow: jest.fn(),
  getQueryHistory: jest.fn(),
  clearQueryHistory: jest.fn(),
  exportData: jest.fn(),
  importSql: jest.fn(),
  importCsv: jest.fn(),
  getCredentials: jest.fn(),
  saveCredentials: jest.fn(),
  getPgConfigFiles: jest.fn(),
  savePgConfigFile: jest.fn(),
  enablePgRemoteAccess: jest.fn(),
  backupDatabase: jest.fn(),
  listDatabaseBackups: jest.fn(),
  restoreDatabase: jest.fn(),
  deleteDatabaseBackup: jest.fn(),
  getAutoBackupConfig: jest.fn(),
  saveAutoBackupConfig: jest.fn(),
  runAutoBackup: jest.fn(),
};

jest.unstable_mockModule('../src/modules/database/database.service.js', () => ({
  default: mockDatabaseService,
}));

const mockFs = {
  access: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
};

jest.unstable_mockModule('fs/promises', () => ({
  default: mockFs,
  ...mockFs,
}));

const { default: databaseController } = await import('../src/modules/database/database.controller.js');

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    headers: {},
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(d) {
      this.body = d;
      return this;
    },
    setHeader(k, v) {
      this.headers[k] = v;
      return this;
    },
  };
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('DatabaseController — Database CRUD & Schemas', () => {
  test('getDatabases aggregates databases across mysql, postgres, and sqlite', async () => {
    mockDatabaseService.listMysqlDatabases.mockResolvedValue(['db_m1']);
    mockDatabaseService.listPgDatabases.mockResolvedValue(['db_p1']);
    mockDatabaseService.listSqliteDatabases.mockResolvedValue(['db_s1']);

    const res = mockRes();
    await databaseController.getDatabases({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.mysql).toEqual(['db_m1']);
    expect(res.body.data.postgres).toEqual(['db_p1']);
    expect(res.body.data.sqlite).toEqual(['db_s1']);

    mockDatabaseService.listMysqlDatabases.mockRejectedValue(new Error('DB list fail'));
    const resErr = mockRes();
    await databaseController.getDatabases({}, resErr);
    expect(resErr.statusCode).toBe(500);
  });

  test('createDatabase handles mysql, postgres, sqlite, missing inputs, and invalid type', async () => {
    const res1 = mockRes();
    await databaseController.createDatabase({ body: { type: 'mysql', name: 'new_mysql' } }, res1);
    expect(res1.statusCode).toBe(200);
    expect(mockDatabaseService.createMysqlDatabase).toHaveBeenCalledWith('new_mysql');

    const res2 = mockRes();
    await databaseController.createDatabase({ body: { type: 'postgres', name: 'new_pg' } }, res2);
    expect(res2.statusCode).toBe(200);
    expect(mockDatabaseService.createPgDatabase).toHaveBeenCalledWith('new_pg');

    const res3 = mockRes();
    await databaseController.createDatabase({ body: { type: 'sqlite', name: 'new_sqlite' } }, res3);
    expect(res3.statusCode).toBe(200);
    expect(mockDatabaseService.createSqliteDatabase).toHaveBeenCalledWith('new_sqlite');

    const resNoName = mockRes();
    await databaseController.createDatabase({ body: { type: 'mysql' } }, resNoName);
    expect(resNoName.statusCode).toBe(400);

    const resBadType = mockRes();
    await databaseController.createDatabase({ body: { type: 'oracle', name: 'test' } }, resBadType);
    expect(resBadType.statusCode).toBe(400);
  });

  test('deleteDatabase handles mysql, postgres, sqlite, missing inputs, and invalid type', async () => {
    const res1 = mockRes();
    await databaseController.deleteDatabase({ body: { type: 'mysql', name: 'old_mysql' } }, res1);
    expect(res1.statusCode).toBe(200);
    expect(mockDatabaseService.deleteMysqlDatabase).toHaveBeenCalledWith('old_mysql');

    const res2 = mockRes();
    await databaseController.deleteDatabase({ body: { type: 'postgres', name: 'old_pg' } }, res2);
    expect(res2.statusCode).toBe(200);
    expect(mockDatabaseService.deletePgDatabase).toHaveBeenCalledWith('old_pg');

    const res3 = mockRes();
    await databaseController.deleteDatabase({ body: { type: 'sqlite', name: 'old_sqlite' } }, res3);
    expect(res3.statusCode).toBe(200);
    expect(mockDatabaseService.deleteSqliteDatabase).toHaveBeenCalledWith('old_sqlite');

    const resNoName = mockRes();
    await databaseController.deleteDatabase({ body: { type: 'mysql' } }, resNoName);
    expect(resNoName.statusCode).toBe(400);

    const resBadType = mockRes();
    await databaseController.deleteDatabase({ body: { type: 'unknown', name: 'old_db' } }, resBadType);
    expect(resBadType.statusCode).toBe(400);
  });

  test('getSchemas, getTables, getTableInfo, getTableData, getDatabaseStats', async () => {
    mockDatabaseService.getSchemas.mockResolvedValue(['public']);
    mockDatabaseService.getTables.mockResolvedValue(['users']);
    mockDatabaseService.getTableInfo.mockResolvedValue({ columns: [] });
    mockDatabaseService.getTableData.mockResolvedValue({ rows: [], total: 0 });
    mockDatabaseService.getDatabaseStats.mockResolvedValue({ sizeBytes: 1024 });

    const resSchemas = mockRes();
    await databaseController.getSchemas({ query: { type: 'postgres', name: 'mydb' } }, resSchemas);
    expect(resSchemas.statusCode).toBe(200);

    const resSchemasErr = mockRes();
    await databaseController.getSchemas({ query: {} }, resSchemasErr);
    expect(resSchemasErr.statusCode).toBe(400);

    const resTables = mockRes();
    await databaseController.getTables({ query: { type: 'postgres', name: 'mydb' } }, resTables);
    expect(resTables.statusCode).toBe(200);

    const resInfo = mockRes();
    await databaseController.getTableInfo({ query: { type: 'mysql', database: 'mydb', table: 'users' } }, resInfo);
    expect(resInfo.statusCode).toBe(200);

    const resData = mockRes();
    await databaseController.getTableData({ query: { type: 'mysql', database: 'mydb', table: 'users', page: '2', limit: '25' } }, resData);
    expect(resData.statusCode).toBe(200);

    const resStats = mockRes();
    await databaseController.getDatabaseStats({ query: { type: 'mysql', database: 'mydb' } }, resStats);
    expect(resStats.statusCode).toBe(200);
  });
});

describe('DatabaseController — Queries & Table Data Manipulation', () => {
  test('runQuery and explainQuery validate input and delegate to service', async () => {
    mockDatabaseService.runQuery.mockResolvedValue({ rows: [{ id: 1 }] });
    mockDatabaseService.explainQuery.mockResolvedValue({ plan: [] });

    const resRunErr = mockRes();
    await databaseController.runQuery({ body: {} }, resRunErr);
    expect(resRunErr.statusCode).toBe(400);

    const resRun = mockRes();
    await databaseController.runQuery({ body: { type: 'mysql', name: 'mydb', query: 'SELECT 1' } }, resRun);
    expect(resRun.statusCode).toBe(200);

    const resExpErr = mockRes();
    await databaseController.explainQuery({ body: {} }, resExpErr);
    expect(resExpErr.statusCode).toBe(400);

    const resExp = mockRes();
    await databaseController.explainQuery({ body: { type: 'mysql', name: 'mydb', query: 'SELECT 1' } }, resExp);
    expect(resExp.statusCode).toBe(200);
  });

  test('insertRow, updateRow, deleteRow validate input parameters', async () => {
    mockDatabaseService.insertRow.mockResolvedValue({ id: 5 });
    mockDatabaseService.updateRow.mockResolvedValue({ affected: 1 });
    mockDatabaseService.deleteRow.mockResolvedValue({ affected: 1 });

    const resInsErr = mockRes();
    await databaseController.insertRow({ body: {} }, resInsErr);
    expect(resInsErr.statusCode).toBe(400);

    const resIns = mockRes();
    await databaseController.insertRow({ body: { type: 'postgres', database: 'db', table: 'tbl', rowData: { a: 1 } } }, resIns);
    expect(resIns.statusCode).toBe(200);

    const resUpdErr = mockRes();
    await databaseController.updateRow({ body: {} }, resUpdErr);
    expect(resUpdErr.statusCode).toBe(400);

    const resUpd = mockRes();
    await databaseController.updateRow(
      { body: { type: 'postgres', database: 'db', table: 'tbl', pkColumn: 'id', pkValue: 1, updatedFields: { a: 2 } } },
      resUpd
    );
    expect(resUpd.statusCode).toBe(200);

    const resDelErr = mockRes();
    await databaseController.deleteRow({ body: {} }, resDelErr);
    expect(resDelErr.statusCode).toBe(400);

    const resDel = mockRes();
    await databaseController.deleteRow(
      { body: { type: 'postgres', database: 'db', table: 'tbl', pkColumn: 'id', pkValue: 1 } },
      resDel
    );
    expect(resDel.statusCode).toBe(200);
  });

  test('getQueryHistory and clearQueryHistory endpoints', async () => {
    mockDatabaseService.getQueryHistory.mockReturnValue([{ query: 'SELECT 1' }]);

    const resHist = mockRes();
    await databaseController.getQueryHistory({}, resHist);
    expect(resHist.statusCode).toBe(200);
    expect(resHist.body.data.history).toHaveLength(1);

    const resClear = mockRes();
    await databaseController.clearQueryHistory({}, resClear);
    expect(resClear.statusCode).toBe(200);
    expect(mockDatabaseService.clearQueryHistory).toHaveBeenCalled();
  });
});

describe('DatabaseController — Import, Export, Credentials, and PgConfig', () => {
  test('exportTable, importSql, importCsv validate inputs and call databaseService', async () => {
    mockDatabaseService.exportData.mockResolvedValue({ data: '[]' });
    mockDatabaseService.importSql.mockResolvedValue({ imported: 5 });
    mockDatabaseService.importCsv.mockResolvedValue({ imported: 10 });

    const resExpErr = mockRes();
    await databaseController.exportTable({ body: {} }, resExpErr);
    expect(resExpErr.statusCode).toBe(400);

    const resExp = mockRes();
    await databaseController.exportTable({ body: { type: 'mysql', database: 'db', table: 'users' } }, resExp);
    expect(resExp.statusCode).toBe(200);

    const resSqlErr = mockRes();
    await databaseController.importSql({ body: {} }, resSqlErr);
    expect(resSqlErr.statusCode).toBe(400);

    const resSql = mockRes();
    await databaseController.importSql({ body: { type: 'mysql', database: 'db', sql: 'CREATE TABLE t(a INT);' } }, resSql);
    expect(resSql.statusCode).toBe(200);

    const resCsvErr = mockRes();
    await databaseController.importCsv({ body: {} }, resCsvErr);
    expect(resCsvErr.statusCode).toBe(400);

    const resCsv = mockRes();
    await databaseController.importCsv({ body: { type: 'mysql', database: 'db', table: 't', csv: 'a\n1\n' } }, resCsv);
    expect(resCsv.statusCode).toBe(200);
  });

  test('getCredentials and updateCredentials', async () => {
    mockDatabaseService.getCredentials.mockResolvedValue({ mysql: { host: 'localhost' } });

    const resCreds = mockRes();
    await databaseController.getCredentials({}, resCreds);
    expect(resCreds.statusCode).toBe(200);

    const resUpdBadType = mockRes();
    await databaseController.updateCredentials({ body: { type: 'oracle' } }, resUpdBadType);
    expect(resUpdBadType.statusCode).toBe(400);

    const resUpd = mockRes();
    await databaseController.updateCredentials({ body: { type: 'mysql', host: '127.0.0.1', port: 3306, user: 'root', password: 'pwd' } }, resUpd);
    expect(resUpd.statusCode).toBe(200);
    expect(mockDatabaseService.saveCredentials).toHaveBeenCalled();
  });

  test('getPgConfig, savePgConfig, and enablePgRemoteAccess', async () => {
    mockDatabaseService.getPgConfigFiles.mockResolvedValue({ postgresqlConf: 'max_connections = 100' });
    mockDatabaseService.enablePgRemoteAccess.mockResolvedValue({ success: true });

    const resConf = mockRes();
    await databaseController.getPgConfig({}, resConf);
    expect(resConf.statusCode).toBe(200);

    const resSaveErr = mockRes();
    await databaseController.savePgConfig({ body: {} }, resSaveErr);
    expect(resSaveErr.statusCode).toBe(400);

    const resSave = mockRes();
    await databaseController.savePgConfig({ body: { fileType: 'postgresql.conf', content: 'listen_addresses = "*"' } }, resSave);
    expect(resSave.statusCode).toBe(200);

    const resRemote = mockRes();
    await databaseController.enablePgRemoteAccess({}, resRemote);
    expect(resRemote.statusCode).toBe(200);
  });
});

describe('DatabaseController — Backups & Auto-Backup Management', () => {
  test('backupDatabase validates params and returns download url', async () => {
    mockDatabaseService.backupDatabase.mockResolvedValue({ filename: 'backup_mysql_2026.sql.gz' });

    const resErr = mockRes();
    await databaseController.backupDatabase({ body: {} }, resErr);
    expect(resErr.statusCode).toBe(400);

    const resOk = mockRes();
    await databaseController.backupDatabase({ body: { type: 'mysql', name: 'shop_db' } }, resOk);
    expect(resOk.statusCode).toBe(200);
    expect(resOk.body.data.downloadUrl).toContain('backup_mysql_2026.sql.gz');
  });

  test('downloadBackup validates filename syntax', async () => {
    const resBad = mockRes();
    await databaseController.downloadBackup({ params: { filename: '../../etc/passwd' } }, resBad);
    expect(resBad.statusCode).toBe(400);

    const resNotFound = mockRes();
    mockFs.access.mockRejectedValueOnce(new Error('File not found'));
    await databaseController.downloadBackup({ params: { filename: 'valid-backup.sql.gz' } }, resNotFound);
    expect(resNotFound.statusCode).toBe(404);
  });

  test('getBackups and deleteBackup', async () => {
    mockDatabaseService.listDatabaseBackups.mockResolvedValue([{ filename: 'b1.sql' }]);

    const resGetErr = mockRes();
    await databaseController.getBackups({ query: {} }, resGetErr);
    expect(resGetErr.statusCode).toBe(400);

    const resGet = mockRes();
    await databaseController.getBackups({ query: { type: 'mysql', name: 'app_db' } }, resGet);
    expect(resGet.statusCode).toBe(200);
    expect(resGet.body.data).toHaveLength(1);

    const resDel = mockRes();
    await databaseController.deleteBackup({ params: { filename: 'b1.sql' } }, resDel);
    expect(resDel.statusCode).toBe(200);
  });

  test('restoreDatabase handles file upload, backup filename, sql payload, and error paths', async () => {
    mockDatabaseService.restoreDatabase.mockResolvedValue({ success: true, message: 'Restore complete' });

    // Missing type/name
    const resErr1 = mockRes();
    await databaseController.restoreDatabase({ body: {} }, resErr1);
    expect(resErr1.statusCode).toBe(400);

    // Missing restore source
    const resErr2 = mockRes();
    await databaseController.restoreDatabase({ body: { type: 'mysql', name: 'db' } }, resErr2);
    expect(resErr2.statusCode).toBe(400);

    // Bad filename with directory traversal
    const resErrBadFile = mockRes();
    await databaseController.restoreDatabase(
      { body: { type: 'mysql', name: 'db', backupFilename: '../bad.sql' } },
      resErrBadFile
    );
    expect(resErrBadFile.statusCode).toBe(400);

    // Restore from uploaded file
    const resFile = mockRes();
    await databaseController.restoreDatabase(
      { body: { type: 'mysql', name: 'db' }, file: { path: '/tmp/upload.sql' } },
      resFile
    );
    expect(resFile.statusCode).toBe(200);
    expect(mockFs.unlink).toHaveBeenCalledWith('/tmp/upload.sql');

    // Restore from server backup filename
    mockFs.access.mockResolvedValueOnce(undefined);
    const resFilename = mockRes();
    await databaseController.restoreDatabase(
      { body: { type: 'postgres', name: 'db', backupFilename: 'backup_pg.sql' } },
      resFilename
    );
    expect(resFilename.statusCode).toBe(200);

    // Restore from SQL string
    const resSql = mockRes();
    await databaseController.restoreDatabase(
      { body: { type: 'sqlite', name: 'db', sql: 'CREATE TABLE x(y INT);' } },
      resSql
    );
    expect(resSql.statusCode).toBe(200);
  });

  test('getAutoBackupConfig, saveAutoBackupConfig, triggerAutoBackupNow', async () => {
    mockDatabaseService.getAutoBackupConfig.mockResolvedValue({ enabled: true, cron: '0 2 * * *' });
    mockDatabaseService.saveAutoBackupConfig.mockResolvedValue({ enabled: false });
    mockDatabaseService.runAutoBackup.mockResolvedValue({ backupsCreated: 3 });

    const res1 = mockRes();
    await databaseController.getAutoBackupConfig({}, res1);
    expect(res1.statusCode).toBe(200);
    expect(res1.body.data.enabled).toBe(true);

    const res2 = mockRes();
    await databaseController.saveAutoBackupConfig({ body: { enabled: false } }, res2);
    expect(res2.statusCode).toBe(200);

    const res3 = mockRes();
    await databaseController.triggerAutoBackupNow({}, res3);
    expect(res3.statusCode).toBe(200);
    expect(res3.body.data.backupsCreated).toBe(3);
  });
});
