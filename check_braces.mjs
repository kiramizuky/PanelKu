import { readFileSync } from 'fs';

const code = readFileSync('src/config/swagger.js', 'utf8');
const lines = code.split('\n');

let depth = 0;
let inString = false;
let strChar = '';

// Show ALL lines where depth changes unexpectedly
let lastDepth = 0;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const commentIdx = line.indexOf('//');
  const clean = commentIdx >= 0 ? line.slice(0, commentIdx) : line;
  
  let opens = 0, closes = 0;
  for (const c of clean) {
    if ((c === '"' || c === "'" || c === '`') && !inString) {
      inString = true;
      strChar = c;
    } else if (c === strChar && inString) {
      inString = false;
    }
    if (!inString) {
      if (c === '{') { opens++; depth++; }
      if (c === '}') { closes++; depth--; }
    }
  }
  
  // Show lines with significant net depth change (> 1)
  const netChange = opens - closes;
  const trimmed = line.trim();
  
  if (netChange > 1 || netChange < -1) {
    console.log(`Line ${i+1}: ${netChange >= 0 ? '+' : ''}${netChange} | depth=${depth} | ${trimmed.slice(0, 100)}`);
  }
  
  // Show section transitions
  if (trimmed.startsWith('// ════') || trimmed.startsWith('// ── ')) {
    console.log(`Line ${i+1}: ${opens}O/${closes}C | depth=${depth} | ${trimmed.slice(0, 80)}`);
  }
  
  lastDepth = depth;
}

console.log(`\nFinal depth: ${depth}`);
