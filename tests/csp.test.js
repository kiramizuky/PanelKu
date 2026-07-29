/**
 * CSP Verification Tests
 *
 * Two test suites:
 * 1. Header Integration Test — Fetches pages and verifies CSP header directives.
 * 2. Static Analysis — Scans all view files for external resource URLs and
 *    checks they are covered by the CSP whitelist.
 *
 * @jest-environment node
 */

// ── Environment setup (MUST be before any app imports) ──
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'jest-csp-test-secret-' + Date.now();
process.env.JWT_REFRESH_SECRET = 'jest-csp-refresh-secret-' + Date.now();
process.env.APP_SECRET = 'jest-csp-app-secret-' + Date.now();
process.env.LOG_LEVEL = 'silent';
process.env.PORT = '0';

import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname, extname, join } from 'path';
import { fileURLToPath } from 'url';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import createApp from '../src/app.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

let app;

beforeAll(() => {
  app = createApp();
});

// ── Shared CSP helpers (used by Suite 1 and Suite 3) ──

/** Parse a CSP header string into a {directive: [values]} map */
function parseCsp(header) {
  const map = {};
  header.split(';').forEach(pair => {
    const parts = pair.trim().split(/\s+/);
    if (parts.length < 2) return;
    const directive = parts[0];
    const values = parts.slice(1);
    map[directive] = values;
  });
  return map;
}

/**
 * List of required CSP directives that MUST be present on every response.
 */
const REQUIRED_DIRECTIVES = [
  'default-src',
  'script-src',
  'style-src',
  'font-src',
  'img-src',
  'connect-src',
  'form-action',
  'base-uri',
  'frame-ancestors',
];

/**
 * Shared assertions — verify a parsed CSP object has the expected structure.
 * Reused for both public pages (login) and authenticated pages.
 */
function assertCspStructure(csp) {
  // Required directives
  for (const dir of REQUIRED_DIRECTIVES) {
    expect(csp[dir]).toBeDefined();
  }

  // 'unsafe-inline' must NOT be in script-src (nonce-based protection against XSS)
  expect(csp['script-src'].some(v => v === "'unsafe-inline'")).toBe(false);

  // style-src, script-src-attr and style-src-attr NEED 'unsafe-inline' because
  // runtime UI widgets (xterm.js, CodeMirror) inject dynamic <style> tags, and nonces
  // don't work for HTML attribute event handlers or style="..." attributes
  expect(csp['style-src']).toContain("'unsafe-inline'");
  expect(csp['script-src-attr']).toContain("'unsafe-inline'");
  expect(csp['style-src-attr']).toContain("'unsafe-inline'");

  // Nonce-based protection for <script> and <style> tags
  expect(csp['script-src'].some(v => v.startsWith("'nonce-"))).toBe(true);
  expect(csp['style-src'].some(v => v.startsWith("'nonce-"))).toBe(true);

  // Restrictive directives locked to self
  expect(csp['form-action']).toEqual(["'self'"]);
  expect(csp['base-uri']).toEqual(["'self'"]);
  expect(csp['frame-ancestors']).toEqual(["'self'"]);

  // No Google Fonts domains (self-hosted)
  expect(csp['style-src']).not.toContain('fonts.googleapis.com');
  expect(csp['font-src']).not.toContain('fonts.gstatic.com');

  // All external resources are self-hosted — no CDN domains in whitelist
  expect(csp['script-src'].some(v => v.includes('.com') || v.includes('.net'))).toBe(false);

  // Non-whitelisted domains must NOT be present
  const forbidden = ['googleapis.com', 'github.com', 'facebook.com', 'twitter.com'];
  for (const domain of forbidden) {
    expect(csp['script-src'].some(v => v.includes(domain))).toBe(false);
  }
}

// ═══════════════════════════════════════════════════════════
// SUITE 1: CSP Header Integration Test
// ═══════════════════════════════════════════════════════════

describe('CSP Header — Integration Test', () => {

  let cspHeader;
  let csp;

  beforeAll(async () => {
    const res = await request(app).get('/');
    cspHeader = res.headers['content-security-policy'];
    expect(cspHeader).toBeDefined();
    csp = parseCsp(cspHeader);
  });

  test('Login page CSP has complete and correct structure', () => {
    assertCspStructure(csp);
  });
});

// ═══════════════════════════════════════════════════════════
// SUITE 2: CSP Static Analysis — Views vs Whitelist
// ═══════════════════════════════════════════════════════════

describe('CSP Static Analysis — View CDN URLs vs Whitelist', () => {

  /**
   * Known CSP whitelist (must match app.js directives).
   * Update when app.js CSP is changed.
   */
  const CSP_WHITELIST = {
    // All external resources are now self-hosted — no CDN whitelist needed.
    // socket.io is served by the server itself at /socket.io/socket.io.js.
    // WebSocket connections (ws:, wss:) are only used in JavaScript,
    // not in HTML attributes, so they are not covered by static HTML analysis.
    scriptSrc: [
      "'self'",          // local scripts only
    ],
    styleSrc: [
      "'self'",          // local CSS only
      "'unsafe-inline'", // required for xterm.js and CodeMirror dynamic style injection
    ],
    fontSrc: [
      "'self'",          // local fonts only
    ],
    imgSrc: [
      "'self'",
      'data:',
      'blob:',
    ],
    connectSrc: [
      "'self'",
      // Note: ws: and wss: are in app.js but only used in JavaScript
    ],
  };

  /** Extract domain from a URL string */
  function extractDomain(url) {
    try {
      const u = new URL(url);
      return u.hostname;
    } catch {
      return null;
    }
  }

  /** Check if a domain is whitelisted in a CSP directive */
  function isWhitelisted(domain, directive) {
    const allowed = CSP_WHITELIST[directive] || [];
    return allowed.some(entry => {
      if (entry === "'self'") return false; // not applicable for external URLs
      // Exact domain match (most common case)
      return domain === entry;
    });
  }

  /** Find all external resource URLs in view files */
  function findExternalUrls(filePath) {
    const content = readFileSync(filePath, 'utf-8');
    const urls = [];

    // Match src/href/value in script/link/style/input tags
    const srcHrefRegex = /(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/gi;
    let match;
    while ((match = srcHrefRegex.exec(content)) !== null) {
      urls.push({ url: match[1], type: 'src/href' });
    }

    // Match @import url(...)
    const importRegex = /@import\s+(?:url\s*)?\(?\s*["']?(https?:\/\/[^"'\s)]+)["'\s)]?/gi;
    while ((match = importRegex.exec(content)) !== null) {
      urls.push({ url: match[1], type: '@import' });
    }

    // Match url(http...) in CSS
    const urlRegex = /url\(["']?(https?:\/\/[^"'\s)]+)["'\s)]?/gi;
    while ((match = urlRegex.exec(content)) !== null) {
      if (!urls.some(u => u.url === match[1])) {
        urls.push({ url: match[1], type: 'url()' });
      }
    }

    return urls;
  }

  /** Classify which CSP directive covers a given resource URL */
  function classifyResource(url) {
    const lower = url.toLowerCase();
    if (lower.endsWith('.js') || lower.includes('/js/') || lower.includes('/chunk')) return 'scriptSrc';
    if (lower.endsWith('.css') || lower.includes('/css/') || lower.includes('fonts.googleapis.com')) return 'styleSrc';
    if (lower.endsWith('.woff2') || lower.endsWith('.woff') || lower.endsWith('.ttf') || lower.includes('fonts.gstatic.com')) return 'fontSrc';
    if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.gif') || lower.endsWith('.svg') || lower.endsWith('.ico')) return 'imgSrc';
    if (lower.startsWith('ws:') || lower.startsWith('wss:')) return 'connectSrc';
    // Default: check common patterns
    if (lower.includes('/js/') || lower.includes('chart.js') || lower.includes('codemirror')) return 'scriptSrc';
    if (lower.includes('/css/') || lower.includes('styles.css')) return 'styleSrc';
    // Placeholder webhook/discord URLs are not actually loaded
    return null;
  }

  /** Recursively find all .ejs and .html files under a directory */
  function findViewFiles(dir) {
    const results = [];
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findViewFiles(fullPath));
      } else if (entry.isFile()) {
        const ext = extname(entry.name);
        if (ext === '.ejs' || ext === '.html') {
          results.push(fullPath);
        }
      }
    }
    return results;
  }

  // Gather all view files
  const viewsDir = resolve(PROJECT_ROOT, 'src/views');
  const viewFiles = findViewFiles(viewsDir);

  // Check that at least some view files were discovered
  test('At least one view file was scanned', () => {
    expect(viewFiles.length).toBeGreaterThan(0);
  });

  test.each(viewFiles)('All external URLs in %s are CSP-whitelisted', (viewFile) => {
    const fullPath = resolve(PROJECT_ROOT, viewFile);
    const urls = findExternalUrls(fullPath);

    for (const { url } of urls) {
      // Skip placeholder/example URLs that are never loaded by the browser
      const isPlaceholder =
        url.includes('discord.com/api/webhooks') ||
        url.includes('hooks.slack.com') ||
        url.includes('s3.example.com') ||
        url.includes('github.com/user/repo') ||
        url.includes('your-domain.com') ||
        url.includes('server.com/file.pdf') ||
        url.includes('example.com') ||
        url.includes('placeholder');

      if (isPlaceholder) continue;

      const domain = extractDomain(url);
      expect(domain).not.toBeNull();

      const directive = classifyResource(url);
      expect(directive).not.toBeNull();

      const whitelisted = isWhitelisted(domain, directive);
      expect(whitelisted).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════
// SUITE 3: CSP Header — Authenticated Pages
// ═══════════════════════════════════════════════════════════

describe('CSP Header — Authenticated Pages', () => {

  /** Parse a CSP header string into a {directive: [values]} map */
  function parseCsp(header) {
    const map = {};
    header.split(';').forEach(pair => {
      const parts = pair.trim().split(/\s+/);
      if (parts.length < 2) return;
      const directive = parts[0];
      const values = parts.slice(1);
      map[directive] = values;
    });
    return map;
  }

  let authToken;

  // ── Database setup + login ──
  // We use a temp directory + seeded user (same pattern as mustChangePassword test)
  beforeAll(async () => {
    // Set up temp directory for test DB
    const { mkdirSync } = await import('fs');
    const { resolve } = await import('path');
    const { tmpdir } = await import('os');
    const { randomUUID } = await import('crypto');

    const TEST_DIR = resolve(tmpdir(), `panelku-csp-auth-${randomUUID()}`);
    const STORAGE_DIR = resolve(TEST_DIR, 'storage');
    mkdirSync(STORAGE_DIR, { recursive: true });
    const originalCwd = process.cwd();
    process.chdir(TEST_DIR);

    // Seed DB with a normal user
    const { getDb, now, toJson } = await import('../src/core/db/sqlite.js');
    const db = getDb();
    db.exec('DELETE FROM audit_logs');
    db.exec('DELETE FROM sessions');
    db.exec('DELETE FROM users');
    db.exec('DELETE FROM roles');

    const roleId = 'role-super_admin';
    db.prepare(`
      INSERT INTO roles (id, name, slug, description, permissions, is_system, is_active, color, created_at, updated_at)
      VALUES (?, 'Super Admin', 'super_admin', 'Full access', ?, 1, 1, '#dc3545', ?, ?)
    `).run(roleId, toJson([{ resource: '*', actions: ['read', 'create', 'update', 'delete', 'execute'] }]), now(), now());

    const ts = now();
    const hash = bcrypt.hashSync('CspAuthPass1!', 10);
    db.prepare(`
      INSERT INTO users (id, username, email, password, role_id, first_name, last_name,
        is_active, is_super_admin, must_change_password, created_at, updated_at)
      VALUES (?, 'csptestuser', 'csptest@test.local', ?, ?, 'CSP', 'Tester', 1, 1, 0, ?, ?)
    `).run('user-csp', hash, roleId, ts, ts);

    // Create app after DB is seeded
    app = createApp();

    // Login to get auth token
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: 'csptestuser', password: 'CspAuthPass1!' })
      .set('Accept', 'application/json');

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.success).toBe(true);
    expect(loginRes.body.data.accessToken).toBeTruthy();
    authToken = loginRes.body.data.accessToken;

    // Store cleanup for afterAll
    if (!global.__cspCleanup) {
      global.__cspCleanup = [];
    }
    global.__cspCleanup.push({ dir: TEST_DIR, cwd: originalCwd });
  });

  afterAll(async () => {
    // Cleanup temp directories
    if (global.__cspCleanup) {
      const { rmSync } = await import('fs');
      for (const { dir, cwd } of global.__cspCleanup) {
        process.chdir(cwd);
        try { rmSync(dir, { recursive: true, force: true }); } catch { }
      }
      delete global.__cspCleanup;
    }
  });

  // ── Authenticated pages to test ──
  const AUTH_PAGES = [
    ['/dashboard', 'Dashboard'],
    ['/filemanager', 'File Manager'],
    ['/monitor', 'Monitoring'],
    ['/settings/profile', 'Profile'],
    ['/settings/users', 'Users'],
    ['/settings/audit', 'Audit Log'],
    ['/api-docs', 'API Docs'],
  ];

  test.each(AUTH_PAGES)('CSP on %s (%s) matches login page structure', async (page, name) => {
    const res = await request(app)
      .get(page)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(400);

    expect(res.headers['content-security-policy']).toBeDefined();
    const csp = parseCsp(res.headers['content-security-policy']);

    assertCspStructure(csp);
  });

  // ── Nonce uniqueness test ──
  test('Each authenticated request gets a unique nonce', async () => {
    const res1 = await request(app)
      .get('/dashboard')
      .set('Authorization', `Bearer ${authToken}`);

    const res2 = await request(app)
      .get('/dashboard')
      .set('Authorization', `Bearer ${authToken}`);

    const csp1 = parseCsp(res1.headers['content-security-policy']);
    const csp2 = parseCsp(res2.headers['content-security-policy']);

    const nonce1 = csp1['script-src'].find(v => v.startsWith("'nonce-"));
    const nonce2 = csp2['script-src'].find(v => v.startsWith("'nonce-"));

    expect(nonce1).toBeDefined();
    expect(nonce2).toBeDefined();
    expect(nonce1).not.toEqual(nonce2);
  });

  // ── Request without token (pages render without auth in test env) ──
  test('Page without auth token still returns CSP header', async () => {
    const res = await request(app)
      .get('/dashboard');

    // Page routes don't have auth middleware in test env, so status is 200
    expect(res.status).toBe(200);
    // CSP header MUST be present on every response
    expect(res.headers['content-security-policy']).toBeDefined();
  });

  // ── CSP on settings pages (different internal layout) ──
  test('Settings pages have consistent CSP structure', async () => {
    const settingsPages = ['/settings/profile', '/settings/users', '/settings/roles', '/settings/audit', '/settings/themes'];
    for (const page of settingsPages) {
      const res = await request(app)
        .get(page)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.headers['content-security-policy']).toBeDefined();
      const csp = parseCsp(res.headers['content-security-policy']);
      assertCspStructure(csp);
    }
  });
});
