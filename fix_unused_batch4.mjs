import { readFileSync, writeFileSync } from 'fs';

function fix(file, replacements) {
  let src = readFileSync(file, 'utf8');
  let count = 0;
  for (const [from, to] of replacements) {
    if (src.includes(from)) {
      src = src.replace(from, to);
      console.log(`  OK [${file}]: ${from.replace(/\n/g, '\\n').substring(0, 60)}`);
      count++;
    } else {
      console.log(`  SKIP [${file}]: not found - ${from.replace(/\n/g, '\\n').substring(0, 60)}`);
    }
  }
  writeFileSync(file, src);
  if (count > 0) console.log(`  => ${count} fixes applied to ${file}`);
}

// power.service.js - fix execFile import (note: exec, execFile not execFile, exec)
fix('src/modules/power/power.service.js', [
  ["import { exec, execFile } from 'child_process';", "import { exec } from 'child_process';"],
]);

// apache.service.js - runCmd function never used, prefix with _
fix('src/modules/apache/apache.service.js', [
  ["async function runCmd(cmd, args = [], opts = {}) {", "async function _runCmd(cmd, args = [], opts = {}) {"],
]);

// python.service.js - runCmd function never used
fix('src/modules/python/python.service.js', [
  ["import { execFile, exec } from 'child_process';", "import { exec } from 'child_process';"],
]);

// nodejs.service.js - runCmd and remoteVersions
fix('src/modules/nodejs/nodejs.service.js', [
  ["const runCmd = promisify(exec);\n", ''],
  ["let remoteVersions = [];", "let _remoteVersions = [];"],
  ["remoteVersions = stdout.trim().split('\\n').filter(Boolean);", "_remoteVersions = stdout.trim().split('\\n').filter(Boolean);"],
]);

// autoheal.service.js - config param, stdout
fix('src/modules/autoheal/autoheal.service.js', [
  ["async _runDiagnostic(logType, config = {}) {", "async _runDiagnostic(logType, _config = {}) {"],
]);

// caddy.service.js - stdout
fix('src/modules/caddy/caddy.service.js', []);

// docker.service.js - event unused param
fix('src/modules/docker/docker.service.js', []);

// mail.service.js - stdout
fix('src/modules/mail/mail.service.js', []);

// whatsapp.service.js - options unused
fix('src/modules/whatsapp/whatsapp.service.js', []);

// mongodb.service.js - validateMongoUri
fix('src/modules/mongodb/mongodb.service.js', []);

// iot.service.js - stdout
fix('src/modules/iot/iot.service.js', []);

// users.service.js - password 
fix('src/modules/users/users.service.js', []);

// updater.service.js - systemCfg
fix('src/modules/updater/updater.service.js', []);

console.log('Batch 4 done!');
