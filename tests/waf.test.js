/**
 * WAF Middleware Unit Tests
 *
 * Verifies that:
 * 1. SQL query/import bodies on the admin-only database endpoints
 *    (/api/database/explore, /api/database/import/sql) pass through the WAF
 *    instead of being blocked as "Suspected SQL Injection".
 * 2. The same payloads are STILL blocked on regular endpoints.
 * 3. XSS / directory-traversal protection remains active elsewhere.
 *
 * Tests the middleware directly with mock req/res — no DB or server needed.
 */

// ── Environment setup (MUST be before app imports) ──
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { wafMiddleware } from '../src/middleware/waf.middleware.js';

// ── Helpers ─────────────────────────────────────────────────

function makeReq({ method = 'POST', path = '/', query = {}, body = {}, ip = '127.0.0.1' } = {}) {
  return {
    method,
    path,
    originalUrl: path,
    query,
    body,
    ip,
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
  };
}

function makeRes() {
  return {
    statusCode: 200,
    body: '',
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; },
  };
}

/** Run the WAF middleware synchronously; returns { passed, status, body } */
function runWaf(req, res) {
  let passed = false;
  wafMiddleware(req, res, () => { passed = true; });
  return { passed, status: res.statusCode, body: res.body };
}

// ── Test data ───────────────────────────────────────────────

const SQL_QUERY_BODY = { type: 'mysql', name: 'app_db', query: 'SELECT * FROM users WHERE id = 1 AND status = "active"' };
const SQL_INSERT_BODY = { type: 'mysql', name: 'app_db', query: "INSERT INTO logs (message) VALUES ('hello')" };
const SQL_UPDATE_BODY = { type: 'postgres', name: 'app_db', query: 'UPDATE users SET name = $1 WHERE id = 1' };
const SQL_DUMP_BODY = {
  type: 'mysql',
  database: 'app_db',
  sql: '-- Dump of app_db\nINSERT INTO users (id, name) VALUES (1, "a");\nINSERT INTO users (id, name) VALUES (2, "b");\nUPDATE users SET name = "c" WHERE id = 1;\n',
};
const XSS_BODY = { message: '<script>alert("xss")</script>' };
const TRAVERSAL_BODY = { path: '../../etc/passwd' };

// ═══════════════════════════════════════════════════════════
//  SUITE 1: Database admin endpoints must NOT be blocked
// ═══════════════════════════════════════════════════════════

describe('WAF — database query/import endpoints (skip body scan)', () => {

  test('run-query endpoint allows SELECT queries', () => {
    const res = makeRes();
    const result = runWaf(makeReq({ path: '/api/database/explore', body: SQL_QUERY_BODY }), res);
    expect(result.passed).toBe(true);
    expect(result.status).toBe(200);
  });

  test('run-query endpoint allows INSERT queries', () => {
    const res = makeRes();
    const result = runWaf(makeReq({ path: '/api/database/explore', body: SQL_INSERT_BODY }), res);
    expect(result.passed).toBe(true);
  });

  test('run-query endpoint allows UPDATE queries', () => {
    const res = makeRes();
    const result = runWaf(makeReq({ path: '/api/database/explore', body: SQL_UPDATE_BODY }), res);
    expect(result.passed).toBe(true);
  });

  test('import-sql endpoint allows full SQL dumps', () => {
    const res = makeRes();
    const result = runWaf(makeReq({ path: '/api/database/import/sql', body: SQL_DUMP_BODY }), res);
    expect(result.passed).toBe(true);
    expect(result.status).toBe(200);
  });

  test('import-csv endpoint allows CSV data with SQL-like cell values', () => {
    const res = makeRes();
    const result = runWaf(makeReq({
      path: '/api/database/import/csv',
      body: { type: 'mysql', database: 'app_db', table: 'users', csv: 'id,name,note\n1,Alice,SELECT * FROM secret\n2,Bob,<script>x</script>' },
    }), res);
    expect(result.passed).toBe(true);
    expect(result.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════
//  SUITE 2: Same payloads MUST still be blocked elsewhere
// ═══════════════════════════════════════════════════════════

describe('WAF — SQLi still blocked on regular endpoints', () => {

  test.each([
    ['SELECT query body', SQL_QUERY_BODY],
    ['INSERT query body', SQL_INSERT_BODY],
    ['SQL dump body', SQL_DUMP_BODY],
  ])('blocks %s on a regular endpoint', (_name, body) => {
    const res = makeRes();
    const result = runWaf(makeReq({ path: '/api/auth/login', body }), res);
    expect(result.passed).toBe(false);
    expect(result.status).toBe(403);
    expect(result.body).toContain('Forbidden: Suspected SQL Injection');
  });

  test('blocks SQLi in query string', () => {
    const res = makeRes();
    const result = runWaf(makeReq({
      path: '/api/users',
      query: { q: 'x\' OR 1=1 --' },
    }), res);
    expect(result.passed).toBe(false);
    expect(result.status).toBe(403);
  });

  // Proves the skip is targeted — non-skipped plugin paths are still scanned
  test('blocks SQL payload on a non-skipped plugin path', () => {
    const res = makeRes();
    const result = runWaf(makeReq({
      path: '/api/plugins/php-manager/config',
      body: { version: '8.2', memory_limit: 'SELECT * FROM users' },
    }), res);
    expect(result.passed).toBe(false);
    expect(result.status).toBe(403);
    expect(result.body).toContain('Forbidden: Suspected SQL Injection');
  });
});

// ═══════════════════════════════════════════════════════════
//  SUITE 3: Other arbitrary-content endpoints (skip body scan)
// ═══════════════════════════════════════════════════════════

describe('WAF — other arbitrary-content endpoints (skip body scan)', () => {

  test('mongodb query endpoint allows arbitrary query content', () => {
    const res = makeRes();
    const result = runWaf(makeReq({
      path: '/api/mongodb/query',
      body: { database: 'app_db', collection: 'users', query: 'db.users.find({ name: /<script>alert(1)<\/script>/ })' },
    }), res);
    expect(result.passed).toBe(true);
    expect(result.status).toBe(200);
  });

  test('git-deploy webhook allows arbitrary webhook payloads', () => {
    const res = makeRes();
    const result = runWaf(makeReq({
      path: '/api/git-deploy/webhook/abc123',
      body: { ref: 'refs/heads/main', commits: [{ message: 'fix: SELECT * FROM users -- cleanup' }] },
    }), res);
    expect(result.passed).toBe(true);
  });

  test('git-deploy webhook-configs allows arbitrary shell script field', () => {
    const res = makeRes();
    const result = runWaf(makeReq({
      path: '/api/plugins/git-deploy/webhook-configs',
      body: { name: 'prod', path: '/var/www/app', branch: 'main', script: 'npm install && ./scripts/migrate.sh # SELECT * FROM --' },
    }), res);
    expect(result.passed).toBe(true);
  });

  test.each([
    ['/plugins/db-admin-manager/index.php'],
    ['/api/plugins/db-admin-manager/index.php'],
  ])('db-admin-manager path %s allows SQL payloads (phpMyAdmin proxy)', (path) => {
    const res = makeRes();
    const result = runWaf(makeReq({
      path,
      body: { sql_query: 'SELECT * FROM users WHERE 1=1; INSERT INTO logs (x) VALUES (1)', token: 'abc' },
    }), res);
    expect(result.passed).toBe(true);
  });

  test('db-admin-manager deploy route allows SQL-looking pgAdmin password', () => {
    const res = makeRes();
    const result = runWaf(makeReq({
      path: '/plugins/db-admin-manager/deploy',
      body: { package: 'pgadmin', port: 8083, pgadminEmail: 'admin@panelku.local', pgadminPassword: 'SELECT * FROM users' },
    }), res);
    expect(result.passed).toBe(true);
  });

  test('whatsapp send endpoint allows arbitrary message text', () => {
    const res = makeRes();
    const result = runWaf(makeReq({
      path: '/api/whatsapp/accounts/main/send',
      body: { to: '628123', message: 'Check this <script>alert(1)</script> ../docs link' },
    }), res);
    expect(result.passed).toBe(true);
  });

  test('ai-repair analyze endpoint allows arbitrary log content', () => {
    const res = makeRes();
    const result = runWaf(makeReq({
      path: '/api/ai-repair/analyze',
      body: { type: 'nginx', lines: 50, log: 'ERROR: query failed: SELECT * FROM users WHERE id = 1 --\npath: /var/www/../config' },
    }), res);
    expect(result.passed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
//  SUITE 4: Other protections remain intact
// ═══════════════════════════════════════════════════════════

describe('WAF — XSS & directory traversal still blocked', () => {

  test('blocks XSS payload in body', () => {
    const res = makeRes();
    const result = runWaf(makeReq({ path: '/api/monitor/save', body: XSS_BODY }), res);
    expect(result.passed).toBe(false);
    expect(result.status).toBe(403);
    expect(result.body).toContain('Forbidden: Suspected XSS');
  });

  test('blocks directory traversal in body', () => {
    const res = makeRes();
    const result = runWaf(makeReq({ path: '/api/settings', body: TRAVERSAL_BODY }), res);
    expect(result.passed).toBe(false);
    expect(result.status).toBe(403);
    expect(result.body).toContain('Forbidden: Suspected Directory Traversal');
  });

  test('clean request passes through', () => {
    const res = makeRes();
    const result = runWaf(makeReq({
      path: '/api/dashboard',
      body: { page: 1, filter: 'active' },
    }), res);
    expect(result.passed).toBe(true);
    expect(result.status).toBe(200);
  });
});
