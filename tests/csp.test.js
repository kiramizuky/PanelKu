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
import createApp from '../src/app.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

let app;

beforeAll(() => {
  app = createApp();
});

// ═══════════════════════════════════════════════════════════
// SUITE 1: CSP Header Integration Test
// ═══════════════════════════════════════════════════════════

describe('CSP Header — Integration Test', () => {

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
   * Used across all pages (public + authenticated) to verify consistency.
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
   * These are reused for both public and authenticated pages.
   */
  function assertCspStructure(csp, pageName) {
    // Required directives
    for (const dir of REQUIRED_DIRECTIVES) {
      expect(csp[dir]).toBeDefined();
    }

    // 'unsafe-inline' restrictions
    expect(csp['script-src'].some(v => v === "'unsafe-inline'")).toBe(false);
    expect(csp['style-src'].some(v => v === "'unsafe-inline'")).toBe(false);

    // Attr exceptions (must use unsafe-inline since nonces don't work for attributes)
    expect(csp['script-src-attr']).toContain("'unsafe-inline'");
    expect(csp['style-src-attr']).toContain("'unsafe-inline'");

    // Nonce-based protection
    expect(csp['script-src'].some(v => v.startsWith("'nonce-"))).toBe(true);
    expect(csp['style-src'].some(v => v.startsWith("'nonce-"))).toBe(true);

    // Restrictive directives locked to self
    expect(csp['form-action']).toEqual(["'self'"]);
    expect(csp['base-uri']).toEqual(["'self'"]);
    expect(csp['frame-ancestors']).toEqual(["'self'"]);

    // No Google Fonts domains (self-hosted)
    expect(csp['style-src']).not.toContain('fonts.googleapis.com');
    expect(csp['font-src']).not.toContain('fonts.gstatic.com');

    // Required CDN whitelist
    expect(csp['script-src']).toContain('cdn.jsdelivr.net');
    expect(csp['style-src']).toContain('cdn.jsdelivr.net');

    // Non-whitelisted domains NOT present
    const forbidden = ['googleapis.com', 'github.com', 'facebook.com', 'twitter.com'];
    for (const domain of forbidden) {
      expect(csp['script-src'].some(v => v.includes(domain))).toBe(false);
    }
  }

  let cspHeader;
  let csp;

  beforeAll(async () => {
    const res = await request(app).get('/');
    cspHeader = res.headers['content-security-policy'];
    expect(cspHeader).toBeDefined();
    csp = parseCsp(cspHeader);
  });

  test('Login page CSP has complete and correct structure', () => {
    assertCspStructure(csp, 'login');
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
    scriptSrc: [
      "'self'",          // local scripts
      'cdn.jsdelivr.net',
      'cdnjs.cloudflare.com',
      'cdn.socket.io',
      'static.cloudflareinsights.com',
    ],
    styleSrc: [
      "'self'",          // local CSS
      'cdn.jsdelivr.net',
    ],
    fontSrc: [
      "'self'",          // local fonts
      'cdn.jsdelivr.net',
    ],
    imgSrc: [
      "'self'",
      'data:',
      'blob:',
    ],
    connectSrc: [
      "'self'",
      'ws:',
      'wss:',
      'cdn.jsdelivr.net',
      'cdn.socket.io',
      'static.cloudflareinsights.com',
    ],
    // Note: ws: and wss: are also in connect-src but are only used
    // in JavaScript (WebSocket connections), not in HTML attributes,
    // so they are not covered by this static HTML analysis.
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
