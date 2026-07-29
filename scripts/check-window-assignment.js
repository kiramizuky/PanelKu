#!/usr/bin/env node
/**
 * CI Gate: Check JS files for `const ModuleName = ...` without a matching
 * `window.ModuleName = ModuleName;` assignment.
 *
 * Why? `const` at global scope creates a global lexical variable but does NOT
 * set a property on `window`. LP.call() and inline onclick="Module.fn()"
 * both fail if the module isn't explicitly assigned to window.
 *
 * Usage:
 *   node scripts/check-window-assignment.js
 *
 * Exit code: 0 = all good, 1 = violations found
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// === Helpers ===

/** Extract module name from `const Foo = (() => {` or `const Foo = {` */
function extractConstName(line) {
  const m = line.match(/^const\s+(\w+)\s*=\s*(?:\(\s*\(\s*\)\s*=>\s*\{|\(\s*function\s*\(|{)/);
  return m ? m[1] : null;
}

/** Extract module name from `window.Foo = Foo;` or `window.Foo = ` */
function extractWindowName(line) {
  const m = line.match(/^window\.(\w+)\s*=\s*/);
  return m ? m[1] : null;
}

/** Check if a filename should be excluded */
function isExcluded(filename, excludes) {
  return excludes.some(pat => {
    if (pat.startsWith('*.')) {
      return filename.endsWith(pat.slice(1));
    }
    if (pat.endsWith('*')) {
      return filename.startsWith(pat.slice(0, -1));
    }
    return filename === pat;
  });
}

/** Scan a JS file for const definitions and window assignments */
function scanFile(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  const constNames = new Set();
  const windowNames = new Set();

  for (const line of lines) {
    const trimmed = line.trim();
    const cName = extractConstName(trimmed);
    if (cName) {
      constNames.add(cName);
    }
    const wName = extractWindowName(trimmed);
    if (wName) {
      windowNames.add(wName);
    }
  }

  const missing = [];
  for (const name of constNames) {
    if (!windowNames.has(name)) {
      missing.push(name);
    }
  }

  return { constNames: [...constNames], windowNames: [...windowNames], missing };
}

/** Scan plugin index.js files for inline <script> const definitions */
function scanPluginFile(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  // Extract inline <script> block ranges
  const scriptBlocks = [];
  let inScript = false;
  let blockStart = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('<script>')) {
      inScript = true;
      blockStart = i + 1;
    } else if (inScript && lines[i].trim() === '</script>') {
      inScript = false;
      scriptBlocks.push({ start: blockStart, end: i });
    }
  }

  // Only scan within <script> blocks
  const constNames = [];
  const windowNames = [];

  for (const block of scriptBlocks) {
    for (let i = block.start; i < block.end; i++) {
      const trimmed = lines[i].trim();
      const cName = extractConstName(trimmed);
      if (cName) {
        constNames.push(cName);
      }
      const wName = extractWindowName(trimmed);
      if (wName) {
        windowNames.push(wName);
      }
    }
  }

  const missing = constNames.filter(n => !windowNames.includes(n));
  return { constNames, windowNames, missing };
}

// === Main ===

const args = process.argv.slice(2);
const shouldFix = args.includes('--fix');

let violations = [];
let checked = 0;

// 1. Scan src/public/js/*.js
const jsDir = join(ROOT, 'src', 'public', 'js');
const files = [];

if (existsSync(jsDir)) {
  const entries = readdirSync(jsDir);
  for (const entry of entries) {
    if (entry.endsWith('.js') && !isExcluded(entry, ['*.min.js', 'bootstrap*', 'chart*', 'xterm*', 'app.js'])) {
      files.push(join(jsDir, entry));
    }
  }
}

for (const file of files) {
  const result = scanFile(file);
  checked++;
  if (result.missing.length > 0) {
    const relPath = file.replace(ROOT + '/', '').replace(/\\/g, '/');
    for (const name of result.missing) {
      violations.push({ file: relPath, name });
    }
  }
}

// 2. Scan plugins/*/index.js
const pluginsDir = join(ROOT, 'plugins');
if (existsSync(pluginsDir)) {
  const pluginDirs = readdirSync(pluginsDir, { withFileTypes: true });
  for (const dirent of pluginDirs) {
    if (!dirent.isDirectory()) continue;
    const pluginFile = join(pluginsDir, dirent.name, 'index.js');
    if (existsSync(pluginFile)) {
      try {
        const result = scanPluginFile(pluginFile);
        checked++;
        if (result.missing.length > 0) {
          const relPath = pluginFile.replace(ROOT + '/', '').replace(/\\/g, '/');
          for (const name of result.missing) {
            violations.push({ file: relPath, name });
          }
        }
      } catch (e) {
        console.error(`  ⚠ Error scanning ${dirent.name}/index.js: ${e.message}`);
      }
    }
  }
}

// === Report ===

console.log(`\n═══ Window Assignment Check ═══\n`);
console.log(`  Files scanned: ${checked}`);

if (violations.length === 0) {
  console.log(`  ✅ All module definitions have matching window.ModuleName assignments.`);
  process.exit(0);
}

console.log(`  ❌ ${violations.length} violation(s) found:\n`);
for (const v of violations) {
  console.log(`     ${v.file}`);
  console.log(`       → const ${v.name} = ...  (missing window.${v.name} = ${v.name};)`);
}
console.log(`\n  💡 Tip: Run \`node scripts/check-window-assignment.js\` to check and fix.\n`);
process.exit(1);
