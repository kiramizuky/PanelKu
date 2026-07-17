import { readFileSync } from 'fs';

const code = readFileSync('src/config/swagger.js', 'utf8');
const lines = code.split(/\r?\n/);

let depth = 0;
let inString = false;
let strChar = '';

let lastHeaderLine = 0;
let lastHeaderDepth = 0;
let lastHeaderName = 'start';

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  
  for (let j = 0; j < line.length; j++) {
    const c = line[j];
    const pc = j > 0 ? line[j-1] : '';
    
    if (!inString && c === '/' && line[j+1] === '/') break;
    if (!inString && c === '/' && line[j+1] === '*') {
      j += 1;
      while (j < line.length - 1) {
        if (line[j] === '*' && line[j+1] === '/') { j++; break; }
        j++;
      }
      continue;
    }
    if ((c === '"' || c === "'" || c === '`') && !inString && pc !== '\\') {
      inString = true; strChar = c; continue;
    }
    if (inString && c === strChar && pc !== '\\') {
      inString = false; continue;
    }
    if (!inString) {
      if (c === '{') depth++;
      if (c === '}') depth--;
    }
  }

  const trimmed = line.trim();
  // Track all section headers
  if (trimmed.startsWith('// ═══') || trimmed.startsWith('// ── ') || 
      trimmed.startsWith('const') || trimmed === '};' || trimmed.startsWith('apis:') ||
      trimmed.startsWith('export')) {
    if (lastHeaderLine > 0 && i - lastHeaderLine > 2) {
      const change = depth - lastHeaderDepth;
      if (change !== 0) {
        console.log(`Section "${lastHeaderName}" (L${lastHeaderLine+1}-${i}): depth ${lastHeaderDepth} -> ${depth} (net: ${change >= 0 ? '+' : ''}${change})`);
      }
    }
    lastHeaderName = trimmed.replace(/[/=─\s]/g, ' ').trim() || trimmed;
    lastHeaderLine = i;
    lastHeaderDepth = depth;
  }
}

console.log(`\nFinal depth: ${depth}`);
