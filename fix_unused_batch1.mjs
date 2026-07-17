import { readFileSync, writeFileSync } from 'fs';

function fix(file, replacements) {
  let src = readFileSync(file, 'utf8');
  for (const [from, to] of replacements) {
    if (src.includes(from)) {
      src = src.replace(from, to);
      console.log(`  OK: ${from.substring(0, 60)}`);
    } else {
      console.log(`  SKIP (not found): ${from.substring(0, 60)}`);
    }
  }
  writeFileSync(file, src);
}

// ai-repair.service.js
fix('src/modules/ai-repair/ai-repair.service.js', [
  ["import { exec, execFile } from 'child_process';", "import { exec } from 'child_process';"],
  ["import path from 'path';\n", ''],
  ["import alertsService from '../alerts/alerts.service.js';\n", ''],
  ["const execFileAsync = promisify(execFile);\n", ''],
  ["async analyzeLog(logText, logType = 'system', maxLines = 200)", "async analyzeLog(logText, _logType = 'system', maxLines = 200)"],
]);

// ai.controller.js
fix('src/modules/ai/ai.controller.js', [
  ["const logSnippet = (context.logText || '').slice(0, 800);", "const _logSnippet = (context.logText || '').slice(0, 800);"],
]);

// apache.service.js
fix('src/modules/apache/apache.service.js', [
  ["import { execFile, exec } from 'child_process';", "import { exec } from 'child_process';"],
]);

// auth.service.js
fix('src/modules/auth/auth.service.js', [
  ["import roleRepository from '../../repositories/role.repository.js';\n", ''],
  ["import { generateToken } from '../../helpers/crypto.js';\n", ''],
]);

// autoheal.service.js
fix('src/modules/autoheal/autoheal.service.js', [
  ["import { exec, execFile } from 'child_process';", "import { exec } from 'child_process';"],
]);

// backup.service.js
fix('src/modules/backup/backup.service.js', []);

// dns.service.js - logger unused
fix('src/modules/dns/dns.service.js', [
  ["import logger from '../../config/logger.js';\n", ''],
]);

console.log('Batch 1 done!');
