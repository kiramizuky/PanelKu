import { readFileSync, writeFileSync } from 'fs';

const code = readFileSync('src/config/swagger.js', 'utf8');
const lines = code.split('\n');

// Parse the file carefully with proper string handling
let inString = false;
let strChar = '';
let result = '';
let braceCount = 0;
let lastIssueLine = -1;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const commentIdx = line.indexOf('//');
  const clean = commentIdx >= 0 ? line.slice(0, commentIdx) : line;
  
  let opens = 0, closes = 0;
  for (let j = 0; j < clean.length; j++) {
    const c = clean[j];
    const pc = j > 0 ? clean[j-1] : '';
    
    if ((c === '"' || c === "'" || c === '`') && !inString && pc !== '\\') {
      inString = true;
      strChar = c;
      continue;
    }
    if (inString && c === strChar && pc !== '\\') {
      inString = false;
      continue;
    }
    
    if (!inString) {
      if (c === '{') braceCount++;
      if (c === '}') braceCount--;
    }
  }
}

console.log('Total brace balance: ' + braceCount);
console.log('Total lines: ' + lines.length);

// The structure should be:
// const options = {  (1 brace)
//   definition: {    (2 braces)
//     ... schemas, tags, paths ...
//   },               (1 brace)
//   apis: []         (1 brace)
// };                 (0 braces)

// If braceCount > 0, we need to find the extra brace
// Let's check where each { appears that doesn't have a matching }

console.log('\nThe file is ' + (braceCount === 0 ? 'balanced!' : 
  braceCount > 0 ? `missing ${braceCount} closing brace(s)` :
  `has ${-braceCount} extra closing brace(s)`));

// Let's just rewrite the end of the file correctly
// The last 6 meaningful lines should be:
//     },
//   },
//   apis: []
// };

// Find the last occurrence of key patterns
const lastPathEntry = code.lastIndexOf("'/agent/terminal/ws'");
if (lastPathEntry >= 0) {
  console.log('\nLast path entry found at position ' + lastPathEntry);
  const afterLastPath = code.slice(lastPathEntry);
  console.log('Content after last path entry:');
  console.log(afterLastPath.slice(0, 200));
}

// Check if the apis line exists
const apisIdx = code.indexOf('apis:');
console.log('\n"apis:" found at position ' + apisIdx);

// Now create a fixed version
// Strategy: everything before "apis:" stays the same
// everything after is rewritten with proper structure

const apisLineIdx = lines.findIndex(l => l.trim().startsWith('apis:'));
if (apisLineIdx >= 0) {
  console.log('\n"apis:" found on line ' + (apisLineIdx + 1));
  console.log('Line content: ' + lines[apisLineIdx]);
  
  // Show lines around it
  for (let i = Math.max(0, apisLineIdx - 3); i <= Math.min(lines.length - 1, apisLineIdx + 3); i++) {
    console.log(`  ${i+1}: ${lines[i]}`);
  }
}
