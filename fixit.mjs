import { readFileSync, writeFileSync } from 'fs';

const code = readFileSync('src/config/swagger.js', 'utf8');
const lines = code.split(/\r?\n/);

// Track depth per character, properly handling strings
let depth = 0;
let inStr = false;
let strC = '';
let issueFound = false;

// Remove all JS strings, regex, comments from the code
// Then count braces
let cleanedCode = '';
let inBlockComment = false;

for (const line of lines) {
  let cleanedLine = '';
  for (let j = 0; j < line.length; j++) {
    const c = line[j];
    const nc = line[j+1] || '';
    
    if (inBlockComment) {
      if (c === '*' && nc === '/') { inBlockComment = false; j++; }
      continue;
    }
    
    if (c === '/' && nc === '/') break; // single line comment
    if (c === '/' && nc === '*') { inBlockComment = true; j++; continue; }
    
    if (c === '"' || c === "'" || c === '`') {
      // Add a placeholder for the string
      cleanedLine += 'S';
      const quote = c;
      j++;
      while (j < line.length) {
        if (line[j] === '\\') { j++; } // skip escaped
        else if (line[j] === quote) { break; }
        j++;
      }
      continue;
    }
    
    cleanedLine += c;
  }
  cleanedCode += cleanedLine + '\n';
}

// Now count braces in the cleaned code
let openCount = 0;
let closeCount = 0;
for (const c of cleanedCode) {
  if (c === '{') openCount++;
  if (c === '}') closeCount++;
}

console.log(`Opened braces: ${openCount}`);
console.log(`Closed braces: ${closeCount}`);
console.log(`Difference: ${openCount - closeCount}`);
console.log(`Total lines: ${lines.length}`);

// Now let's find WHERE the imbalance is
// Strategy: for each section, count deep brace... no
// Instead: check if closing ',    },' at the end is correct

// Let me look at the raw content around the last 15 lines
console.log('\n=== Last 15 lines (raw) ===');
for (let i = Math.max(0, lines.length - 15); i < lines.length; i++) {
  console.log(`${i+1}: ${lines[i]}`);
}
