import { readFileSync } from 'fs';

const code = readFileSync('src/config/swagger.js', 'utf8');
const lines = code.split(/\r?\n/);

// Robust state machine to track strings, comments, and regex
let depth = 0;
let inStr = false;
let strC = '';
let inBlockComment = false;

// Track depth at the end of every 10 lines to find where it goes wrong
console.log('=== Depth every 10 lines ===');
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  
  for (let j = 0; j < line.length; j++) {
    const c = line[j];
    const nc = line[j+1] || '';
    
    // Handle block comments
    if (!inStr && !inBlockComment && c === '/' && nc === '*') {
      inBlockComment = true;
      j++;
      continue;
    }
    if (inBlockComment) {
      if (c === '*' && nc === '/') {
        inBlockComment = false;
        j++;
      }
      continue;
    }
    
    // Handle single-line comments (only if not in a string)
    if (!inStr && !inBlockComment && c === '/' && nc === '/') break;
    
    // Handle strings (with escape sequence awareness)
    if (!inBlockComment) {
      const pc = j > 0 ? line[j-1] : '';
      if ((c === '"' || c === "'" || c === '`') && !inStr) {
        // Check this is not an escaped quote or part of regex
        if (pc !== '\\') {
          inStr = true;
          strC = c;
          continue;
        }
      }
      if (inStr && c === strC && pc !== '\\') {
        inStr = false;
        continue;
      }
      // Skip characters inside strings
      if (inStr) continue;
    }
    
    // Count braces (only when not in a string or comment)
    if (!inBlockComment) {
      if (c === '{') depth++;
      if (c === '}') depth--;
    }
  }
  
  // Print depth at section boundaries and every 10 lines  
  const trimmed = line.trim();
  if (i % 10 === 0 || i < 15 || i > lines.length - 20 || 
      trimmed.startsWith('// ═══') || trimmed.startsWith('// ── ') ||
      trimmed.startsWith('const options') || trimmed.startsWith('definition:') ||
      trimmed.startsWith('components:') || trimmed.startsWith('schemas:') ||
      trimmed.startsWith('paths:') || trimmed.startsWith('apis:') ||
      trimmed === '};') {
    console.log(`L${i+1}: depth=${depth} | ${trimmed.slice(0, 80)}`);
  }
}

console.log(`\nFinal depth: ${depth}`);
console.log(`Total lines: ${lines.length}`);

// Now find the specific region with the problem
// Re-scan with a focus on the schemas section (where most nesting occurs)
console.log('\n=== Detailed schemas section (lines 100-600) ===');
depth = 0;
inStr = false;
strC = '';
inBlockComment = false;

let lastDepth = 0;
let anomalyFound = false;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  
  for (let j = 0; j < line.length; j++) {
    const c = line[j];
    const nc = line[j+1] || '';
    
    if (!inStr && !inBlockComment && c === '/' && nc === '*') {
      inBlockComment = true; j++; continue;
    }
    if (inBlockComment) {
      if (c === '*' && nc === '/') { inBlockComment = false; j++; }
      continue;
    }
    if (!inStr && !inBlockComment && c === '/' && nc === '/') break;
    
    if (!inBlockComment) {
      const pc = j > 0 ? line[j-1] : '';
      if ((c === '"' || c === "'" || c === '`') && !inStr && pc !== '\\') {
        inStr = true; strC = c; continue;
      }
      if (inStr && c === strC && pc !== '\\') {
        inStr = false; continue;
      }
      if (inStr) continue;
    }
    
    if (!inBlockComment) {
      if (c === '{') depth++;
      if (c === '}') depth--;
    }
  }
  
  // Check for anomaly: when depth doesn't return to expected levels
  const trimmed = line.trim();
  
  // In paths section (after line 632 where paths: { is), depth should be 3+
  // At line 632, depth should be 2 (inside definition)
  // After paths: {, depth should be 3
  // Path entries should add and remove depth
  // After the last path entry, depth should go back to 2
  
  // Show key structural lines
  if (i < 10 || 
      (i >= 95 && i <= 110) || // schemas area
      trimmed.match(/^(?:Ai|Agent|Alert|Audit|Backup|Cluster|Container|Create|Cron|DNS|Dashboard|Database|Docker|Error|Firewall|Health|Login|Monitor|Pagination|Public|Query|Refresh|Role|SSLCertificate|Session|Success|System|TwoFactor|User|Waf)/) ||
      trimmed.includes('// ──') || 
      trimmed.includes('export')) {
    if (i >= 100 && i <= 110) {
      console.log(`L${i+1}: depth=${depth} | ${trimmed.slice(0, 100)}`);
    }
  }
}

// Check whether the extra brace is BEFORE or AFTER the paths section
console.log('\n=== Brace count at key boundaries ===');
console.log('Note: Just checking total open/close counts at specific sections');
