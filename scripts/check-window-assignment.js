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
 *   node scripts/check-window-assignment.js              # Check only (exit 0/1)
 *   node scripts/check-window-assignment.js --fix         # Auto-fix violations
 *   node scripts/check-window-assignment.js --dry-run     # Show what would be fixed
 *
 * Exit code: 0 = all good, 1 = violations found (even if --fix was applied
 * and not all could be auto-fixed).
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// -- CLI args -----------------------------------------------------------------

const args = process.argv.slice(2);
const IS_FIX = args.includes('--fix');
const IS_DRY_RUN = args.includes('--dry-run');

// -- Helpers -----------------------------------------------------------------

/**
 * Extract module name from a line that defines a MODULE, returning type info.
 *
 * Returns { name, type } where type is 'iife' or 'object', or null.
 *
 * - `const Foo = (() => {`         -> IIFE (arrow)
 * - `let  Foo = (() => {`         -> IIFE (arrow)
 * - `const Foo = (function() {`   -> IIFE (function keyword)
 * - `let   Foo = (function() {`   -> IIFE (function keyword)
 * - `const Foo = {`               -> Object (only at column 0)
 * - `let   Foo = {`               -> Object (only at column 0)
 */
function extractModuleName(line) {
  const iife = line.match(/^(\s*)(?:const|let)\s+(\w+)\s*=\s*\(\s*(?:\(\s*\)\s*=>\s*\{|function\s*\()/);
  if (iife) return { name: iife[2], type: 'iife' };

  const obj = line.match(/^(?:const|let)\s+(\w+)\s*=\s*\{/);
  if (obj) return { name: obj[1], type: 'object' };

  return null;
}

/** Extract module name from `window.Foo = Foo;` or `window.Foo = ` */
function extractWindowName(line) {
  const m = line.match(/^window\.(\w+)\s*=\s*/);
  return m ? m[1] : null;
}

/** Check if a filename should be excluded */
function isExcluded(filename, excludes) {
  return excludes.some(pat => {
    if (pat.startsWith('*.')) return filename.endsWith(pat.slice(1));
    if (pat.endsWith('*')) return filename.startsWith(pat.slice(0, -1));
    return filename === pat;
  });
}

// -- Brace-tracking: find insertion point ------------------------------------

/**
 * Given a module definition line index (where extractModuleName matched),
 * find the line where the matching close `}` (and optionally `})();`) sits.
 *
 * Uses brace-depth tracking with string/template literal awareness:
 * 1. Skip the opening `{` in the definition line
 * 2. Count `{` (+1) and `}` (-1) depth across subsequent lines
 * 3. Skip `{`/`}` inside single/double-quoted strings and template literals
 * 4. When `}` is hit at depth 0, that's the matching close
 *
 * Returns the line index right AFTER which `window.X = X;` should be inserted.
 *
 * For IIFE: returns the line containing `})();` (same or next line).
 * For Object: returns the `};` line.
 */
function findInsertionLine(lines, defIdx) {
  const defLine = lines[defIdx];
  const info = extractModuleName(defLine);
  if (!info) return -1;

  // Find opening `{` in the definition line
  const openBraceIdx = defLine.indexOf('{');
  if (openBraceIdx < 0) return -1;

  let depth = 0;

  for (let i = defIdx; i < lines.length; i++) {
    const line = lines[i];
    let inSingle = false;   // inside '
    let inDouble = false;   // inside "
    let inTemplate = false; // inside `
    let templateBraceDepth = 0; // track {} inside ${...} expressions

    for (let j = 0; j < line.length; j++) {
      // Skip characters up to and including the opening `{`
      if (i === defIdx && j <= openBraceIdx) continue;

      const ch = line[j];
      const prev = j > 0 ? line[j - 1] : '';

      // -- String / template literal state machine --

      if (ch === '\\') {
        // Skip escaped character (prevents mis-closing quotes like \")
        j++;
        continue;
      }

      if (!inSingle && !inDouble && !inTemplate) {
        // Entering a string or template literal
        if (ch === "'") { inSingle = true; continue; }
        if (ch === '"') { inDouble = true; continue; }
        if (ch === '`') { inTemplate = true; templateBraceDepth = 0; continue; }
      } else if (inSingle) {
        if (ch === "'") inSingle = false;
        continue;
      } else if (inDouble) {
        if (ch === '"') inDouble = false;
        continue;
      } else if (inTemplate) {
        if (ch === '`' && templateBraceDepth === 0) {
          inTemplate = false;
          continue;
        }
        // ${...} inside template literal — track brace depth
        if (ch === '$' && j + 1 < line.length && line[j + 1] === '{') {
          templateBraceDepth++;
          j++; // skip the `{` too
          continue;
        }
        if (ch === '{' && templateBraceDepth > 0) {
          templateBraceDepth++;
          continue;
        }
        if (ch === '}' && templateBraceDepth > 0) {
          templateBraceDepth--;
          continue;
        }
        // Skip all other template content
        continue;
      }

      // -- Normal code: track brace depth --

      if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        if (depth === 0) {
          // Matching close found!
          if (info.type === 'iife') {
            const rest = line.slice(j + 1).trim();
            if (/^\)\s*\(\s*\)\s*;?\s*$/.test(rest)) {
              return i;
            }
            if (i + 1 < lines.length) {
              const nextLine = lines[i + 1].trim();
              if (/^\)\s*\(\s*\)\s*;?\s*$/.test(nextLine)) {
                return i + 1;
              }
            }
            return i;
          }
          return i;
        }
        depth--;
      }
    }
  }

  return -1;
}

/**
 * Find insertion point inside a plugin's inline <script> block.
 * Plugin modules are always IIFE. Insert between `})();` and `</script>`.
 */
function findPluginInsertionLine(lines, scriptStart, scriptEnd) {
  for (let i = scriptEnd - 1; i >= scriptStart; i--) {
    if (/^\s*\)\s*\(\s*\)\s*;?\s*$/.test(lines[i].trim())) {
      return i;
    }
  }
  return -1;
}

// -- Scan / Fix helpers ------------------------------------------------------

/**
 * Scan a public/js file and return violations.
 */
function scanFile(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  const moduleNames = new Map();
  const windowNames = new Set();

  for (let i = 0; i < lines.length; i++) {
    const info = extractModuleName(lines[i]);
    if (info) {
      moduleNames.set(info.name, { lineIdx: i, type: info.type });
    }
    const wName = extractWindowName(lines[i].trim());
    if (wName) {
      windowNames.add(wName);
    }
  }

  const missing = [];
  for (const [name, meta] of moduleNames) {
    if (!windowNames.has(name)) {
      missing.push({ name, lineIdx: meta.lineIdx, type: meta.type });
    }
  }

  return { missing, lines, content };
}

/**
 * Fix a public/js file by inserting `window.X = X;` for each missing module.
 */
function fixFile(filePath, violations, { lines, content }) {
  if (violations.length === 0) return { fixed: false, reason: 'no violations' };

  // Process from bottom to top so line indices stay valid
  const sorted = [...violations].sort((a, b) => b.lineIdx - a.lineIdx);

  for (const v of sorted) {
    const insertLine = findInsertionLine(lines, v.lineIdx);
    if (insertLine < 0) {
      console.error(`  * Could not find insertion point for ${v.name} in ${filePath}`);
      continue;
    }

    const indent = lines[insertLine].match(/^\s*/)[0];
    const stmt = `// [FIX] Expose to window for LP.call() resolution\n${indent}window.${v.name} = ${v.name};`;

    if (IS_DRY_RUN) {
      console.log(`     -> Would insert: window.${v.name} = ${v.name}; at line ${insertLine + 1}`);
    } else {
      lines.splice(insertLine + 1, 0, stmt);
    }
  }

  if (!IS_DRY_RUN) {
    writeFileSync(filePath, lines.join('\n'), 'utf-8');
    return { fixed: true, inserted: violations.length };
  }

  return { fixed: true, inserted: violations.length, dryRun: true };
}

/**
 * Scan a plugin index.js file for inline <script> const definitions.
 */
function scanPluginFile(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  const scriptBlocks = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('<script>')) {
      let j = i + 1;
      while (j < lines.length && !lines[j].includes('</script>')) {
        j++;
      }
      scriptBlocks.push({ start: i + 1, end: j });
      i = j;
    }
  }

  const moduleNames = [];
  const windowNames = new Set();

  for (const block of scriptBlocks) {
    for (let i = block.start; i < block.end; i++) {
      const info = extractModuleName(lines[i]);
      if (info) {
        moduleNames.push({ name: info.name, type: info.type, lineIdx: i, block });
      }
      const wName = extractWindowName(lines[i].trim());
      if (wName) {
        windowNames.add(wName);
      }
    }
  }

  const missing = moduleNames.filter(n => !windowNames.has(n.name));
  return { missing, lines, content, scriptBlocks };
}

/**
 * Fix a plugin file by inserting `window.X = X;` for each missing module.
 */
function fixPluginFile(filePath, violations, { lines, content, scriptBlocks }) {
  if (violations.length === 0) return { fixed: false, reason: 'no violations' };

  const byBlock = new Map();
  for (const v of violations) {
    const blockKey = `${v.block.start}-${v.block.end}`;
    if (!byBlock.has(blockKey)) byBlock.set(blockKey, { block: v.block, names: [] });
    byBlock.get(blockKey).names.push(v.name);
  }

  const sortedBlocks = [...byBlock.entries()].sort((a, b) => b[1].block.end - a[1].block.end);

  for (const [, { block, names }] of sortedBlocks) {
    const insertLine = findPluginInsertionLine(lines, block.start, block.end);
    if (insertLine < 0) {
      console.error(`  * Could not find insertion point in script block for ${filePath}`);
      continue;
    }

    const scriptCloseLine = lines[block.end] || '';
    const indent = scriptCloseLine.match(/^\s*/)[0];

    // Insert in REVERSE order so the first name ends up on top
    for (let idx = names.length - 1; idx >= 0; idx--) {
      const name = names[idx];
      const stmt = `${indent}// [FIX] Expose to window for LP.call() resolution\n${indent}window.${name} = ${name};`;

      if (IS_DRY_RUN) {
        console.log(`     -> Would insert: window.${name} = ${name}; at line ${insertLine + 1}`);
      } else {
        lines.splice(insertLine + 1, 0, stmt);
      }
    }
  }

  if (!IS_DRY_RUN) {
    writeFileSync(filePath, lines.join('\n'), 'utf-8');
    return { fixed: true, inserted: violations.length };
  }

  return { fixed: true, inserted: violations.length, dryRun: true };
}

// -- Main --------------------------------------------------------------------

function main() {
  if (IS_FIX) {
    console.log(`\n=== Window Assignment Check (--fix mode) ===\n`);
  } else if (IS_DRY_RUN) {
    console.log(`\n=== Window Assignment Check (--dry-run mode) ===\n`);
  } else {
    console.log(`\n=== Window Assignment Check ===\n`);
  }

  let violations = [];
  let checked = 0;
  let fixed = 0;
  let failCount = 0;

  // 1. Scan src/public/js/*.js (recursive, including subdirectories like settings/)
  const jsDir = join(ROOT, 'src', 'public', 'js');

  /** Recursively find all .js files in a directory */
  function findJsFiles(dir) {
    const results = [];
    if (!existsSync(dir)) return results;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findJsFiles(fullPath));
      } else if (entry.name.endsWith('.js') && !isExcluded(entry.name, ['*.min.js', 'bootstrap*', 'chart*', 'xterm*', 'app.js'])) {
        results.push(fullPath);
      }
    }
    return results;
  }

  if (existsSync(jsDir)) {
    const jsFiles = findJsFiles(jsDir);
    for (const file of jsFiles) {
      const result = scanFile(file);
      checked++;
      if (result.missing.length > 0) {
        const relPath = file.replace(ROOT + '/', '').replace(/\\/g, '/');
        for (const m of result.missing) {
          violations.push({ file: relPath, filePath: file, name: m.name, lineIdx: m.lineIdx, type: m.type });
        }

        if (IS_FIX || IS_DRY_RUN) {
          const fixResult = fixFile(file, result.missing, result);
          if (fixResult.fixed) {
            fixed += fixResult.inserted || 0;
            const recheck = scanFile(file);
            if (recheck.missing.length > 0 && !IS_DRY_RUN) {
              console.error(`  * ${relPath}: Fix applied but ${recheck.missing.length} violation(s) remain!`);
              failCount++;
            }
          }
        }
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
            for (const m of result.missing) {
              violations.push({ file: relPath, filePath: pluginFile, name: m.name, lineIdx: m.lineIdx, type: m.type });
            }

            if (IS_FIX || IS_DRY_RUN) {
              const fixResult = fixPluginFile(pluginFile, result.missing, result);
              if (fixResult.fixed) {
                fixed += fixResult.inserted || 0;
                const recheck = scanPluginFile(pluginFile);
                if (recheck.missing.length > 0 && !IS_DRY_RUN) {
                  console.error(`  * ${relPath}: Fix applied but ${recheck.missing.length} violation(s) remain!`);
                  failCount++;
                }
              }
            }
          }
        } catch (e) {
          console.error(`  * Error scanning ${dirent.name}/index.js: ${e.message}`);
        }
      }
    }
  }

  // Report
  console.log('');
  console.log(`  Files scanned: ${checked}`);

  if (violations.length === 0) {
    console.log(`  [OK] All module definitions have matching window.ModuleName assignments.\n`);
    process.exit(0);
  }

  if (IS_DRY_RUN) {
    console.log(`  [LIST] ${violations.length} violation(s) found - DRY RUN, no files modified:\n`);
    const grouped = new Map();
    for (const v of violations) {
      if (!grouped.has(v.file)) grouped.set(v.file, []);
      grouped.get(v.file).push(v);
    }
    for (const [file, vs] of grouped) {
      console.log(`     ${file}:`);
      for (const v of vs) {
        console.log(`       line ${v.lineIdx + 1} -> const/let ${v.name} = ...`);
      }
      console.log('');
    }
    console.log(`  Run \`node scripts/check-window-assignment.js --fix\` to apply fixes.\n`);
    process.exit(1);
  }

  if (IS_FIX) {
    const total = violations.length;
    const remaining = total - fixed;
    if (remaining === 0) {
      console.log(`  [OK] All ${total} violation(s) auto-fixed! No remaining issues.\n`);
      process.exit(0);
    }
    console.log(`  [WARN] ${total} violation(s) found, ${fixed} auto-fixed, ${remaining} remaining:\n`);
  } else {
    console.log(`  [FAIL] ${violations.length} violation(s) found:\n`);
  }

  const grouped = new Map();
  for (const v of violations) {
    if (IS_FIX && fixed > 0) continue;
    if (!grouped.has(v.file)) grouped.set(v.file, []);
    grouped.get(v.file).push(v);
  }

  if (!IS_FIX) {
    for (const [file, vs] of grouped) {
      console.log(`     ${file}:`);
      for (const v of vs) {
        console.log(`       line ${v.lineIdx + 1} -> const/let ${v.name} = ...  (missing window.${v.name} = ${v.name};)`);
      }
    }
    console.log(`\n  Tip: Run \`node scripts/check-window-assignment.js --fix\` to auto-fix.\n`);
  }

  if (failCount > 0) {
    console.log(`  [WARN] ${failCount} file(s) had remaining violations after fix - manual review needed.\n`);
  }

  process.exit(IS_FIX ? (failCount > 0 ? 1 : 0) : 1);
}

main();
