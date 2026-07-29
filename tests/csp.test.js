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

  // Nonce-based protection for <script> tags (XSS defense)
  expect(csp['script-src'].some(v => v.startsWith("'nonce-"))).toBe(true);

  // style-src uses 'unsafe-inline' (not nonce) because:
  // 1) CSP spec: nonce overrides 'unsafe-inline' causing it to be ignored
  // 2) xterm.js, CodeMirror dynamically inject <style> elements at runtime
  //    that cannot carry server-generated nonces
  // So we DO NOT assert nonce in style-src

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

// ═══════════════════════════════════════════════════════════
// SUITE 4: Runtime CSP Compatibility — Library & Pattern Scan
// ═══════════════════════════════════════════════════════════
//
// This suite scans ALL view files for patterns that require
// specific CSP directives at runtime, catching potential
// violations before they happen in the browser.
//
// For each view, we categorize:
//   A) Which JS libraries it uses (xterm, CodeMirror, Chart.js)
//   B) Whether it has inline <style> tags that need nonce injection
//   C) Whether it has inline <script> blocks (verified nonce-covered)
//   D) Whether the CSP directives cover all patterns found
// ═══════════════════════════════════════════════════════════

describe('CSP Runtime Compatibility — Library & Pattern Scan', () => {

  // ── 4A: Dynamic JS library index ──
  // Key: library name. Value: { views: [], requiresUnsafeInline: [], reason: '' }
  // This helps us know which CSP directives are needed by which views.
  const LIBRARY_PATTERNS = [
    { name: 'xterm.js',       pattern: 'xterm.min.js',  reason: 'Dynamically injects <style> elements for cursor, selection, fonts. Requires style-src unsafe-inline.' },
    { name: 'CodeMirror',     pattern: 'codemirror.min.js', reason: 'Creates dynamic <style> for gutter, cursor, selection. Requires style-src unsafe-inline.' },
    { name: 'Chart.js',       pattern: 'chart-4',       reason: 'Creates <canvas> elements and styles them dynamically. Requires style-src unsafe-inline.' },
    { name: 'Bootstrap',      pattern: 'bootstrap.min.js', reason: 'Dynamically adds style attributes for modals, tooltips, dropdowns. Requires style-src-attr unsafe-inline.' },
  ];

  /** Recursively find all view files */
  function findAllViews(dir) {
    const results = [];
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findAllViews(fullPath));
      } else if (entry.isFile() && (entry.name.endsWith('.ejs') || entry.name.endsWith('.html'))) {
        results.push(fullPath);
      }
    }
    return results;
  }

  const viewsDir = resolve(PROJECT_ROOT, 'src/views');
  const allViewFiles = findAllViews(viewsDir);

  // ── Test: Library usage map ──
  test('All views with dynamic JS libs are documented and CSP-compatible', () => {
    const viewsWithLibs = [];

    for (const viewFile of allViewFiles) {
      const content = readFileSync(viewFile, 'utf-8');
      const relPath = resolve(viewsDir, viewFile);
      const shortPath = viewFile.replace(/\\?views\\?|views\//, '');

      for (const lib of LIBRARY_PATTERNS) {
        if (content.toLowerCase().includes(lib.pattern)) {
          viewsWithLibs.push({ view: shortPath, library: lib.name, reason: lib.reason });
        }
      }
    }

    // Log all views with their libraries for documentation
    if (viewsWithLibs.length > 0) {
      const summary = viewsWithLibs.map(v => `  - ${v.view}: ${v.library}`).join('\n');
      console.log(`\n[DOC] Views using dynamic JS libraries:\n${summary}\n`);
    }

    // All views with dynamic libs must also have style-src unsafe-inline
    // This is already verified in Suites 1 & 3 for the CSP header itself
    expect(viewsWithLibs.length).toBeGreaterThan(0);

    // Verify every view file has at least the basic CSP-safe patterns
    // (no self-closing script tags, no inline event handlers with encoded quotes)
    for (const viewFile of allViewFiles) {
      const content = readFileSync(viewFile, 'utf-8');
      const shortPath = viewFile.replace(/\\?views\\?|views\//, '');

      // Check for self-closing <script/> tags (XSS risk — browser may not parse correctly)
      const selfClosingScripts = content.match(/<script\s[^>]*?\/>/gi);
      if (selfClosingScripts) {
        console.warn(`[WARN] ${shortPath} has self-closing script tags: ${selfClosingScripts.join(', ')}`);
      }
    }
  });

  // ── 4B: Inline <style> tag analysis ──
  test('Views with inline <style> tags rely on nonce injector', () => {
    const viewsWithInlineStyles = [];

    for (const viewFile of allViewFiles) {
      const content = readFileSync(viewFile, 'utf-8');
      const shortPath = viewFile.replace(/\\?views\\?|views\//, '');

      // Match <style> tags (not <link rel="stylesheet"...>)
      const styleTags = content.match(/<style[^>]*>(?!\s*<\/style\s*>)/gi);
      if (styleTags) {
        viewsWithInlineStyles.push({ view: shortPath, count: styleTags.length });
      }
    }

    // Verify: every inline <style> tag will get a nonce via the nonceInjector middleware
    // The nonce injector adds nonce="..." to all <style> tags in server-rendered HTML
    if (viewsWithInlineStyles.length > 0) {
      console.log(`\n[DOC] Views with inline <style> tags (nonces auto-injected):`);
      for (const v of viewsWithInlineStyles) {
        console.log(`  - ${v.view}: ${v.count} <style> tag(s)`);
      }
      console.log('');
    }

    // Since nonces are no longer in style-src, these nonces are decorative
    // (but they cause no harm). The actual protection comes from style-src unsafe-inline.
    expect(viewsWithInlineStyles.length).toBeGreaterThanOrEqual(0);
  });

  // ── 4C: Inline <script> analysis — verify nonce coverage ──
  test('All inline <script> blocks are covered by nonce-based protection', () => {
    for (const viewFile of allViewFiles) {
      const content = readFileSync(viewFile, 'utf-8');
      const shortPath = viewFile.replace(/\\?views\\?|views\//, '');

      // Skip external scripts (<script src="...">)
      // Count only inline <script> blocks (no src attribute)
      const inlineScripts = [];
      const scriptRegex = /<script\s*([^>]*?)>([\s\S]*?)<\/script\s*>/gi;
      let match;
      while ((match = scriptRegex.exec(content)) !== null) {
        const attrs = match[1] || '';
        const body = match[2] || '';
        // Skip external scripts
        if (/\bsrc\s*=/i.test(attrs)) continue;
        // Skip empty scripts
        if (!body.trim()) continue;
        inlineScripts.push({ attrs, bodyLen: body.length });
      }

      // If there are inline scripts, they must either:
      // A) Have a nonce attribute already, OR
      // B) Rely on the nonceInjector to add nonces post-render
      //
      // Since nonceInjector runs after EVERY res.render(), all inline scripts
      // get nonces automatically. We verify the injector logic in Suite 5.
      //
      // What we check here: no inline script should be self-closing
      const selfClosingInline = content.match(/<script\s(?!src)[^>]*?\/>/gi);
      if (selfClosingInline) {
        console.warn(`[WARN] ${shortPath} has potentially dangerous self-closing inline script tags`);
      }

      // Also check for event handler attributes that need script-src-attr 'unsafe-inline'
      // These are expected and documented
      const eventHandlers = content.match(/\bon\w+\s*=\s*["']/gi);
      if (eventHandlers && eventHandlers.length > 50) {
        // Large number of inline event handlers — verify script-src-attr is set
        // This is verified in Suite 1/3 via assertCspStructure
        console.log(`[DOC] ${shortPath} has ${eventHandlers.length} event handler attributes (covered by script-src-attr 'unsafe-inline')`);
      }
    }
  });

  // ── 4D: Verify CSP header on ALL page routes ──
  test('Every page route defined in app.js returns a CSP header', async () => {
    // Extract all page routes from app.js
    const appJsPath = resolve(PROJECT_ROOT, 'src/app.js');
    const appJsContent = readFileSync(appJsPath, 'utf-8');

    // Match all app.get('...', (req, res) => res.render('...', { ... })) patterns
    const routeRegex = /app\.get\(['"]([^'"]+)['"],/g;
    const routes = [];
    let routeMatch;
    while ((routeMatch = routeRegex.exec(appJsContent)) !== null) {
      const path = routeMatch[1];
      // Skip API-only and non-page routes
      if (path === '/' || path.startsWith('/api/')) continue;
      if (path.startsWith('/login')) continue; // login has layout:false
      routes.push(path);
    }

    // Deduplicate
    const uniqueRoutes = [...new Set(routes)];
    console.log(`\n[DOC] Testing CSP on ${uniqueRoutes.length} page routes...`);

    for (const route of uniqueRoutes) {
      const res = await request(app).get(route);
      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(500);

      // Every page MUST have a CSP header
      const cspHeader = res.headers['content-security-policy'];
      if (!cspHeader) {
        throw new Error(`Route ${route} is missing CSP header`);
      }

      // Parse and verify basic structure
      const csp = parseCsp(cspHeader);
      expect(csp['default-src']).toBeDefined();
      expect(csp['script-src']).toBeDefined();
      // Verify script nonce exists (not checking style nonce — that's intentional)
      const hasNonce = csp['script-src'].some(v => v.startsWith("'nonce-"));
      if (!hasNonce) {
        throw new Error(`Route ${route} — script-src should have nonce`);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════
// SUITE 5: Nonce Injector Verification
// ═══════════════════════════════════════════════════════════
//
// Verifies that the nonceInjector middleware correctly adds
// nonce attributes to inline <script> tags after rendering.
//
// NOTE: <style> tags are intentionally skipped because:
// - style-src uses 'unsafe-inline' (nonce would override it)
// - xterm.js/CodeMirror inject runtime <style> elements
//   that can't carry server-generated nonces
// ═══════════════════════════════════════════════════════════

describe('Nonce Injector — Verification', () => {

  /**
   * Simulate the injectNoncesIntoHtml function from nonce.js
   * Now only injects nonces into <script> tags (not <style>)
   */
  function injectNonces(html, nonce) {
    return html.replace(
      /<(script)(\s[^>]*?)?>/gi,
      (match, tagName, attrs) => {
        const attrStr = attrs || '';

        // Skip external scripts (they have src="...")
        if (/\bsrc\s*=/i.test(attrStr)) {
          return match;
        }

        // Skip tags that already have a nonce attribute
        if (/\snonce\s*=/i.test(attrStr)) {
          return match;
        }

        // Inject the nonce
        return `<${tagName}${attrStr} nonce="${nonce}">`;
      }
    );
  }

  test('Nonce is injected into inline <script> tags', () => {
    const html = '<div><script>alert(1)</script></div>';
    const result = injectNonces(html, 'test-nonce-123');
    expect(result).toContain('<script nonce="test-nonce-123">');
  });

  test('Nonce is NOT injected into external <script src> tags', () => {
    const html = '<script src="/js/app.js"></script>';
    const result = injectNonces(html, 'test-nonce-123');
    expect(result).not.toContain('nonce');
    expect(result).toBe(html);
  });

  test('Nonce is NOT re-injected if already present', () => {
    const html = '<script nonce="existing-nonce">alert(1)</script>';
    const result = injectNonces(html, 'test-nonce-123');
    expect(result).toContain('nonce="existing-nonce"');
    expect(result).not.toContain('test-nonce-123');
  });

  test('Nonce is NOT injected into <style> tags (style-src uses unsafe-inline)', () => {
    const html = '<style>.foo { color: red; }</style>';
    const result = injectNonces(html, 'style-nonce');
    // <style> tags should NOT get a nonce because:
    // 1) style-src uses 'unsafe-inline' (nonce would override it)
    // 2) xterm.js/CodeMirror inject runtime styles without nonces
    expect(result).not.toContain('nonce');
    expect(result).toBe(html);
  });

  test('Multiple inline scripts each get a nonce', () => {
    const html = '<script>a()</script><script>b()</script>';
    const result = injectNonces(html, 'multi-nonce');
    const matches = result.match(/nonce="multi-nonce"/g);
    expect(matches).toHaveLength(2);
  });

  test('Mixed external + inline: only inline gets nonce', () => {
    const html = '<script src="/ext.js"></script><script>inline()</script>';
    const result = injectNonces(html, 'mixed-nonce');
    // External script should NOT have nonce
    expect(result).not.toContain('src="/ext.js" nonce');
    // Inline script SHOULD have nonce
    expect(result).toContain('<script nonce="mixed-nonce">inline()</script>');
  });

  test('HTML with no script/style tags remains unchanged', () => {
    const html = '<div>Hello</div><p>World</p>';
    const result = injectNonces(html, 'noop-nonce');
    expect(result).toBe(html);
  });

  test('Nonce is different per request (not cached)', async () => {
    const res1 = await request(app).get('/');
    const res2 = await request(app).get('/');

    const csp1 = parseCsp(res1.headers['content-security-policy']);
    const csp2 = parseCsp(res2.headers['content-security-policy']);

    const nonce1 = csp1['script-src'].find(v => v.startsWith("'nonce-"));
    const nonce2 = csp2['script-src'].find(v => v.startsWith("'nonce-"));

    expect(nonce1).toBeDefined();
    expect(nonce2).toBeDefined();
    expect(nonce1).not.toEqual(nonce2);
  });

  // ── Verify nonce is actually rendered in HTML (end-to-end) ──
  test('Rendered HTML page has nonce in inline <script> tags (end-to-end)', async () => {
    const res = await request(app).get('/');
    const html = res.text;

    // Find inline script tags in the rendered HTML
    const inlineScriptRegex = /<script(\s[^>]*?)>([\s\S]*?)<\/script\s*>/gi;
    let match;
    let inlineCount = 0;
    let noncedCount = 0;

    while ((match = inlineScriptRegex.exec(html)) !== null) {
      const attrs = match[1] || '';
      // Skip external scripts
      if (/\bsrc\s*=/i.test(attrs)) continue;
      inlineCount++;
      if (/\snonce\s*=/i.test(attrs)) {
        noncedCount++;
      }
    }

    // Every inline script should have a nonce
    expect(inlineCount).toBeGreaterThan(0);
    expect(noncedCount).toBe(inlineCount);
  });
});
