import { readFileSync, writeFileSync } from 'fs';

const code = readFileSync('src/config/swagger.js', 'utf8');
const lines = code.split(/\r?\n/);

let depth = 0;
let inStr = false;
let strC = '';
let depthByLine = [];

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
  depthByLine.push(depth);
}

console.log(`Lines: ${lines.length}, Final depth: ${depth}`);

// Strategy: find the exact problem
// At the end, we should be at depth 0 (balanced)
// The depth right before 'apis:' line minus 1 is the depth after 'apis:' line
// We need depth to be 1 at 'apis:' line (inside options), then 0 after '};'

// Find the 'apis:' line and the last few structural lines
const apisLine = lines.findIndex(l => l.trim().startsWith('apis:'));
console.log(`\n'apis:' on line ${apisLine + 1}, depth at this line: ${depthByLine[apisLine]}`);

// Show depth around the end
const endLines = [
  'Close paths', 'Close definition', 'apis line', 'close options', 'end', 'after exports'
];

// Let's find where to add the missing brace
// Strategy: look for the LAST place where depth increases by 1 more than expected
// If depth at 'apis:' is 2, and we need it to be 1, we need to add 1 '}' before apis:

if (depth !== 0) {
  console.log(`\nFile is unbalanced by ${depth}. Fixing...`);
  
  // Add missing closing braces before 'apis:' line
  const fixCount = depth;
  
  // Build fixed lines
  const fixedLines = [...lines];
  
  // Insert the missing closing braces right before the 'apis:' line
  // But after the 'definition' close (which is at a 2-space indent, same as apis)
  
  // Find the last '  },' before apis: (that's the definition close)
  let insertIdx = apisLine; // right before apis: line
  
  // Instead, let's just insert after the definition close (2-space indent '},')
  // We know the line before apis is the definition close or comments
  
  // Work backwards from apisLine to find where to insert
  for (let i = apisLine - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    // Skip comment lines
    if (trimmed.startsWith('//')) continue;
    // Found the definition close (2-space indent)
    if (trimmed === '},' || trimmed === '}') {
      insertIdx = i + 1; // insert AFTER this line
      break;
    }
  }
  
  console.log(`Inserting ${fixCount} missing '}' at line ${insertIdx + 1}`);
  
  // Insert fixCount closing braces at 2-space indent
  for (let i = 0; i < fixCount; i++) {
    fixedLines.splice(insertIdx, 0, '  }');
  }
  
  // Also fix: remove trailing comma from 'apis: [],' if it has one
  const apisIdx2 = fixedLines.findIndex(l => l.trim().startsWith('apis:'));
  if (apisIdx2 >= 0) {
    fixedLines[apisIdx2] = fixedLines[apisIdx2].replace(/,$/, '');
  }
  
  // Write fixed file
  const fixed = fixedLines.join('\n');
  // writeFileSync('src/config/swagger.js', fixed, 'utf8');
  
  // Save as .fixed for comparison
  writeFileSync('src/config/swagger.fixed.js', fixed, 'utf8');
  console.log(`\nFixed version written to src/config/swagger.fixed.js`);
  console.log('Now rename it to swagger.js if it works.');
}
