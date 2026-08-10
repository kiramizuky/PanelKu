#!/usr/bin/env node
/**
 * check-plugin-imports.mjs
 *
 * Verifies that every relative import inside plugins/ resolves to an existing
 * file. Catches the class of bug where a plugin imported
 * `'../../middleware/auth.js'` instead of `'../../src/middleware/auth.js'` —
 * which silently prevented the plugin from loading at runtime.
 *
 * Usage:  node scripts/check-plugin-imports.mjs
 * Exit:   0 = all plugin imports resolve · 1 = broken import(s) found
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join, resolve, dirname, extname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginsDir = join(root, 'plugins');

/** Collect every relative module specifier in a source file. */
function collectRelativeSpecifiers(file) {
  // Strip comments so prose can never trip the check. The `[^:]` guard keeps
  // `https://` (used in embedded HTML/JS strings) intact — only real `//`
  // comments and `/* */` blocks are removed.
  const src = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const specifiers = [];
  // Matches: from '...', import('...'), require('...') — multiline-safe and
  // word-boundary-anchored for `from`.
  const re = /(?:\bfrom\s*|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const spec = m[1];
    if (spec.startsWith('./') || spec.startsWith('../')) specifiers.push(spec);
  }
  return specifiers;
}

/** Resolve a specifier relative to baseDir; returns the resolved file or null. */
function resolveSpecifier(baseDir, spec) {
  const candidate = join(baseDir, spec);
  const candidates = [candidate];

  // No extension → try common ESM/CJS extensions + directory index files.
  if (!extname(spec)) {
    for (const ext of ['.js', '.mjs', '.cjs', '.json']) candidates.push(candidate + ext);
  }

  for (const c of candidates) {
    let st;
    try { st = statSync(c); } catch { continue; }
    if (st.isFile()) return c;
    if (st.isDirectory()) {
      for (const idx of ['index.js', 'index.mjs', 'index.json']) {
        if (existsSync(join(c, idx))) return join(c, idx);
      }
    }
  }
  return null;
}

/** Recursively list .js files under a directory. */
function walkJs(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkJs(full, out);
    else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) out.push(full);
  }
  return out;
}

let failed = 0;
const files = walkJs(pluginsDir);
for (const file of files) {
  const baseDir = dirname(file);
  for (const spec of collectRelativeSpecifiers(file)) {
    const target = resolveSpecifier(baseDir, spec);
    if (!target) {
      failed++;
      console.error(`✗ ${file.slice(root.length + 1).replaceAll('\\', '/')} → cannot resolve '${spec}'`);
    }
  }
}

if (failed > 0) {
  console.error(`\n✗ ${failed} broken plugin import(s) found. Fix them before merging.`);
  process.exit(1);
}
console.log(`✓ All plugin imports resolve (${files.length} files checked).`);
