import { readFileSync } from 'fs';

const code = readFileSync('src/config/swagger.js', 'utf8');
const lines = code.split(/\r?\n/);

// Track depth per character POSITION within each line
// to find exactly where an extra { is
let depth = 0;
let inStr = false;
let strC = '';

// Check depth at key structural items
const keyItems = [
  'const options = {',
  'definition: {',
  'components: {',
  'schemas: {',
  'tags: [',
  'paths: {',
  'apis:',
  '};'
];

console.log('Depth at key structural points:');
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  
  for (let j = 0; j < line.length; j++) {
    const c = line[j];
    const pc = j > 0 ? line[j-1] : '';
    
    if (!inStr && c === '/' && line[j+1] === '/') break;
    if (!inStr && c === '/' && line[j+1] === '*') {
      j++;
      while (j < line.length - 1) {
        if (line[j] === '*' && line[j+1] === '/') { j++; break; }
        j++;
      }
      continue;
    }
    if ((c === '"' || c === "'" || c === '`') && !inStr && pc !== '\\') {
      inStr = true; strC = c; continue;
    }
    if (inStr && c === strC && pc !== '\\') {
      inStr = false; continue;
    }
    if (!inStr) {
      if (c === '{') depth++;
      if (c === '}') depth--;
    }
  }
  
  const trimmed = line.trim();
  if (keyItems.some(k => trimmed.startsWith(k))) {
    console.log(`  Line ${i+1}: depth=${depth} | ${trimmed.slice(0, 80)}`);
  }
}

console.log(`\nFinal depth: ${depth}`);

// Now let's find ALL schemas and check their depth
// The schemas should each close before the next opens
// Look for schema patterns
let schemaCount = 0;
let lastSchemaEnd = -1;
console.log('\n=== Checking schemas section ===');
for (let i = 0; i < lines.length; i++) {
  const trimmed = lines[i].trim();
  if (trimmed.match(/^\w+Request:|^\w+Response:|^\w+:\s*\{/) && 
      !trimmed.startsWith('//') && 
      i > 100 && i < 600) {
    schemaCount++;
    if (lastSchemaEnd > 0) {
      console.log(`  Schema #${schemaCount}: approx line ${i+1}`);
    }
  }
}
console.log(`Total schemas found: ${schemaCount}`);
