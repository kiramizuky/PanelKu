import { readFileSync, writeFileSync } from 'fs';

function fix(file, replacements) {
  let src = readFileSync(file, 'utf8');
  for (const [from, to] of replacements) {
    if (src.includes(from)) {
      src = src.replace(from, to);
      console.log(`  OK: ${file} - ${from.substring(0, 50)}`);
    } else {
      console.log(`  SKIP: ${file} - not found: ${from.substring(0, 50)}`);
    }
  }
  writeFileSync(file, src);
}

// database.service.js - remove unused stream imports
fix('src/modules/database/database.service.js', [
  ["import { createReadStream, createWriteStream } from 'fs';", ''],
  ["import { pipeline } from 'stream/promises';", ''],
  ["import { createGzip, createGunzip } from 'zlib';", ''],
  ["import logger from '../../config/logger.js';\n", ''],
]);

// docker.service.js - event unused param
fix('src/modules/docker/docker.service.js', [
  ["(err, event) => {", "(err, _event) => {"],
  ["(chunk, event) => {", "(chunk, _event) => {"],
]);

// filemanager.controller.js
fix('src/modules/filemanager/filemanager.controller.js', [
  ["import { join } from 'path';\n", ''],
  ["import logger from '../../config/logger.js';\n", ''],
]);

// filemanager.routes.js
fix('src/modules/filemanager/filemanager.routes.js', [
  ["import { join } from 'path';\n", ''],
]);

// filemanager.service.js
fix('src/modules/filemanager/filemanager.service.js', [
  ["import { extname, join } from 'path';", "import { join } from 'path';"],
  ["import fs from 'fs';\nimport fsPromise from 'fs/promises';", "import fsPromise from 'fs/promises';"],
]);

// gpu.service.js
fix('src/modules/gpu/gpu.service.js', [
  ["import path from 'path';\n", ''],
  ["import fs from 'fs';\n", ''],
]);

// iot.service.js
fix('src/modules/iot/iot.service.js', []);

// mail.service.js
fix('src/modules/mail/mail.service.js', [
  ["import { exec, execFile } from 'child_process';", "import { exec } from 'child_process';"],
]);

// mongodb.service.js
fix('src/modules/mongodb/mongodb.service.js', [
  ["import logger from '../../config/logger.js';\n", ''],
  ["const validateMongoUri = (uri) => {\n    return uri && uri.startsWith('mongodb');\n  };\n", ''],
]);

// nodejs.service.js
fix('src/modules/nodejs/nodejs.service.js', [
  ["const runCmd = promisify(exec);\n", ''],
]);

// power.service.js
fix('src/modules/power/power.service.js', [
  ["import { execFile, exec } from 'child_process';", "import { exec } from 'child_process';"],
]);

// python.service.js
fix('src/modules/python/python.service.js', [
  ["const runCmd = promisify(exec);\n", ''],
]);

// redis.service.js
fix('src/modules/redis/redis.service.js', [
  ["import logger from '../../config/logger.js';\n", ''],
]);

// ssl.service.js
fix('src/modules/ssl/ssl.service.js', [
  ["import path from 'path';\n", ''],
]);

// updater.service.js
fix('src/modules/updater/updater.service.js', [
  ["import { exec, spawn } from 'child_process';", "import { exec } from 'child_process';"],
  ["import { existsSync } from 'fs';\n", ''],
]);

// users.service.js
fix('src/modules/users/users.service.js', [
  ["import permissionManager from '../../core/permissions/PermissionManager.js';\n", ''],
  ["import { toSlug } from '../../helpers/validate.js';\n", ''],
]);

// whatsapp.service.js
fix('src/modules/whatsapp/whatsapp.service.js', [
  ["import { existsSync } from 'fs';\n", ''],
]);

console.log('Batch 2 done!');
