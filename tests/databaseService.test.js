/**
 * DatabaseService — security tests
 *
 * 1. CSV import: importCsv() rejects crafted CSV headers that try to
 *    break out of the backtick-quoted identifier (column-name injection).
 * 2. Query restriction: runQuery() blocks DROP/TRUNCATE/ALTER even when
 *    hidden behind comments or multi-statement chains.
 *
 * All cases throw BEFORE any DB connection is attempted, so no DB is required.
 */

// ── Environment setup ──
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import databaseService from '../src/modules/database/database.service.js';

describe('DatabaseService.importCsv — column name sanitization', () => {

  test('rejects CSV header with SQL injection payload in a column name', async () => {
    const maliciousCsv = 'id`); DROP TABLE users; --\n1,a';
    await expect(databaseService.importCsv('mysql', 'app_db', 'users', maliciousCsv))
      .rejects.toThrow(/Invalid column name/);
  });

  test('rejects CSV header with semicolon in a column name', async () => {
    const maliciousCsv = 'id;name\n1,x';
    await expect(databaseService.importCsv('mysql', 'app_db', 'users', maliciousCsv))
      .rejects.toThrow(/Invalid column name/);
  });

  test('rejects CSV with malicious header before touching the database', async () => {
    // The malicious header must throw BEFORE the first await (no DB connection),
    // so this resolves fast even without a running MySQL/PostgreSQL server.
    const maliciousCsv = 'id`) DELETE FROM users; --\n1,a';
    await expect(databaseService.importCsv('postgres', 'app_db', 'users', maliciousCsv))
      .rejects.toThrow(/Invalid column name/);
  });
});

describe('DatabaseService.runQuery — restricted statement detection', () => {
  const RESTRICTED_MSG = 'DROP, TRUNCATE, and ALTER are restricted via UI.';

  // ── Restricted queries must throw BEFORE any DB access ──

  test('blocks DROP even when preceded by a block comment', async () => {
    await expect(databaseService.runQuery('mysql', 'app_db', '/* cleanup */ DROP TABLE users'))
      .rejects.toThrow(RESTRICTED_MSG);
  });

  test('blocks DROP hidden after a line comment', async () => {
    await expect(databaseService.runQuery('mysql', 'app_db', '-- note\nDROP TABLE users'))
      .rejects.toThrow(RESTRICTED_MSG);
  });

  test('blocks DROP in a multi-statement chain', async () => {
    await expect(databaseService.runQuery('mysql', 'app_db', 'SELECT 1; DROP TABLE users'))
      .rejects.toThrow(RESTRICTED_MSG);
  });

  test('blocks TRUNCATE and ALTER anywhere in the chain', async () => {
    await expect(databaseService.runQuery('postgres', 'app_db', 'SELECT 1; TRUNCATE users; ALTER TABLE users ADD COLUMN x INT'))
      .rejects.toThrow(RESTRICTED_MSG);
  });

  // ── Scanner unit checks: true positives ──

  test('flags restricted keywords as the first token of any statement', () => {
    expect(databaseService._hasRestrictedStatement('DROP TABLE users')).toBe(true);
    expect(databaseService._hasRestrictedStatement('  TRUNCATE users')).toBe(true);
    expect(databaseService._hasRestrictedStatement('ALTER TABLE users ADD COLUMN x INT')).toBe(true);
    expect(databaseService._hasRestrictedStatement('/* c */ DROP TABLE users')).toBe(true);
    expect(databaseService._hasRestrictedStatement('SELECT 1; DROP TABLE users')).toBe(true);
    expect(databaseService._hasRestrictedStatement("SELECT 'x'; -- y\nDROP TABLE users")).toBe(true);
    // MySQL versioned comments are executed, so their content is inspected
    expect(databaseService._hasRestrictedStatement('/*!50000 DROP TABLE users */')).toBe(true);
    expect(databaseService._hasRestrictedStatement('/*!50000 ; DROP TABLE users */')).toBe(true);
  });

  // ── Scanner unit checks: false-positive protection ──

  test('does not flag restricted words inside comments', () => {
    expect(databaseService._hasRestrictedStatement('-- DROP TABLE users (future migration)\nSELECT 1')).toBe(false);
    expect(databaseService._hasRestrictedStatement('/* TODO: TRUNCATE old logs */ SELECT 1')).toBe(false);
  });

  test('does not flag restricted words inside string literals', () => {
    expect(databaseService._hasRestrictedStatement("SELECT 'DROP TABLE users'")).toBe(false);
    expect(databaseService._hasRestrictedStatement("INSERT INTO t VALUES ('a; DROP TABLE x; --')")).toBe(false);
  });

  test('does not flag quoted identifiers or dollar-quoted bodies', () => {
    expect(databaseService._hasRestrictedStatement('SELECT * FROM truncate')).toBe(false); // SQLite-safe: TRUNCATE is not a reserved word there
    expect(databaseService._hasRestrictedStatement('SELECT "DROP" AS x')).toBe(false);
    expect(databaseService._hasRestrictedStatement('SELECT $tag$ DROP TABLE t $tag$')).toBe(false);
  });

  // ── DB-type-aware '#' comment handling ──
  // '#' is a comment only in MySQL/MariaDB. In PostgreSQL it is an operator
  // (bitwise XOR, JSONB #>), so it must NOT hide a restricted statement there.

  test('PostgreSQL: does not hide DROP behind the # operator', () => {
    expect(databaseService._hasRestrictedStatement('SELECT 1 # 2; DROP TABLE users', 'postgres')).toBe(true);
    expect(databaseService._hasRestrictedStatement('SELECT 5 # 3', 'postgres')).toBe(false); // no false positive on plain # usage
  });

  test('MySQL: still treats # as a comment and blocks what follows', () => {
    expect(databaseService._hasRestrictedStatement('# cleanup\nDROP TABLE users', 'mysql')).toBe(true);
    expect(databaseService._hasRestrictedStatement('SELECT 5 # trailing comment', 'mysql')).toBe(false);
  });
});

describe('DatabaseService schema support', () => {

  test('getSchemas returns empty array for non-postgres types (no DB connection needed)', async () => {
    await expect(databaseService.getSchemas('mysql', 'app_db')).resolves.toEqual([]);
    await expect(databaseService.getSchemas('sqlite', 'app_db')).resolves.toEqual([]);
  });

  test('_sanitizeSchemaName validates schema identifiers', () => {
    expect(databaseService._sanitizeSchemaName('public')).toBe('public');
    expect(databaseService._sanitizeSchemaName('analytics_2')).toBe('analytics_2');
    expect(() => databaseService._sanitizeSchemaName('bad schema; DROP')).toThrow(/Invalid schema name/);
    expect(() => databaseService._sanitizeSchemaName('../etc')).toThrow(/Invalid schema name/);
  });

  test('_quoteIdentifier uses backticks for mysql/sqlite and double quotes for postgres', () => {
    expect(databaseService._quoteIdentifier('users', 'mysql')).toBe('`users`');
    expect(databaseService._quoteIdentifier('users', 'sqlite')).toBe('`users`');
    expect(databaseService._quoteIdentifier('users', 'postgres')).toBe('"users"');
    expect(databaseService._quoteIdentifier('analytics', 'postgres')).toBe('"analytics"');
  });

  test('importCsv rejects an invalid postgres schema before touching the database', async () => {
    await expect(databaseService.importCsv('postgres', 'app_db', 'users', 'id,name\n1,a', 'bad schema; DROP'))
      .rejects.toThrow(/Invalid schema name/);
  });
});
