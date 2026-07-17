import { readFileSync } from 'fs';

const code = readFileSync('src/config/swagger.js', 'utf8');
const lines = code.split('\n');

// Track depth per line to find where the extra 2 depth comes from
let depth = 0;
let inStr = false;
let strC = '';
let maxDepth = 0;

console.log('=== Depth at each line ===');
for (let i = 0; i < Math.min(lines.length, 1500); i++) {
  const line = lines[i];
  const clean = line.split('//')[0];
  
  for (const c of clean) {
    if ((c === '"' || c === "'" || c === '`') && !inStr) {
      inStr = true;
      strC = c;
    } else if (c === strC && inStr) {
      inStr = false;
    }
    if (!inStr) {
      if (c === '{') depth++;
      if (c === '}') depth--;
    }
  }
  
  if (depth > maxDepth) maxDepth = depth;
  
  // Print lines around key sections
  const t = line.trim();
  if (t.startsWith('//') || t.startsWith("'") || t.startsWith('/') || 
      t.startsWith('const') || t.startsWith('export') || t === '};' || 
      t.startsWith('apis:') || t.startsWith('  },')) {
    const depthBar = '|'.repeat(depth);
    console.log(`${(i+1).toString().padStart(4)}:${depth.toString().padStart(2)} ${depthBar} ${t.slice(0, 100)}`);
  }
}

console.log(`\nMax depth: ${maxDepth}`);
console.log(`Final depth: ${depth}`);
