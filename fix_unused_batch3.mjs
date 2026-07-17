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

// analytics.service.js - remaining unused vars
fix('src/modules/analytics/analytics.service.js', [
  ["const primaryDisk = diskData[0] || {};\n", ''],
  ["const priority = type === 'auth' ? 'auth' : 'sys';", "const _priority = type === 'auth' ? 'auth' : 'sys';"],
  ["const pidMatch = svc.name.match(/\\.service$/);\n", "const _pidMatch = svc.name.match(/\\.service$/);\n"],
]);

// backup.service.js - child unused
fix('src/modules/backup/backup.service.js', [
  ["const child = cp.exec(cmd, { timeout });", "const _child = cp.exec(cmd, { timeout });"],
]);

// caddy.service.js - stdout unused
fix('src/modules/caddy/caddy.service.js', []);

// docker.service.js - event unused param (try different patterns)
fix('src/modules/docker/docker.service.js', []);

// filemanager.service.js - extname unused
fix('src/modules/filemanager/filemanager.service.js', []);

// gpu.service.js
fix('src/modules/gpu/gpu.service.js', []);

// iot.service.js - stdout unused
fix('src/modules/iot/iot.service.js', []);

// mail.service.js - stdout unused
fix('src/modules/mail/mail.service.js', []);

// mongodb.service.js - validateMongoUri unused
fix('src/modules/mongodb/mongodb.service.js', []);

// nodejs.service.js - remoteVersions unused
fix('src/modules/nodejs/nodejs.service.js', [
  ["const remoteVersions = await getRemoteVersions();", "const _remoteVersions = await getRemoteVersions();"],
]);

// power.service.js
fix('src/modules/power/power.service.js', []);

// python.service.js
fix('src/modules/python/python.service.js', []);

// updater.service.js - systemCfg unused
fix('src/modules/updater/updater.service.js', [
  ["const systemCfg = JSON.parse(stdout);", "const _systemCfg = JSON.parse(stdout);"],
]);

// users.service.js - password unused
fix('src/modules/users/users.service.js', [
  ["const password = args.password;", "const _password = args.password;"],
]);

// whatsapp.service.js - options unused
fix('src/modules/whatsapp/whatsapp.service.js', []);

// ── Frontend JS files ──────────────────────────
fix('src/public/js/ai-repair.js', [
  ["data?.res?.message || res ||", "data?.res?.message ||"],
]);

fix('src/public/js/app.js', [
  ["const floatTerminal = new FloatingTerminal();", "const _floatTerminal = new FloatingTerminal();"],
]);

fix('src/public/js/autoheal.js', [
  ["disabled ? 'disabled' : '',", "_disabled ? 'disabled' : '',"],
  ["const statusEl = document.getElementById('status');", "const _statusEl = document.getElementById('status');"],
]);

fix('src/public/js/cdn.js', [
  ["const cfZoneId = document.getElementById('cf_zone_id')?.value;", "const _cfZoneId = document.getElementById('cf_zone_id')?.value;"],
]);

fix('src/public/js/cluster.js', [
  ["const node = items[i];", "const _node = items[i];"],
]);

fix('src/public/js/cron.js', [
  ["const tbody = document.querySelector('#cron-table tbody');", "const _tbody = document.querySelector('#cron-table tbody');"],
]);

fix('src/public/js/database.js', [
  ["const historyModal = new bootstrap.Modal(document.getElementById('historyModal'));", "const _historyModal = new bootstrap.Modal(document.getElementById('historyModal'));"],
]);

fix('src/public/js/dns.js', [
  ["const tbody = document.querySelector('#dns-table tbody');", "const _tbody = document.querySelector('#dns-table tbody');"],
  ["$tbody.empty();", "$_tbody.empty();"],
]);

fix('src/public/js/filemanager.js', [
  ["const clipboard = {", "const _clipboard = {"],
  ["const output = await response.text();", "const _output = await response.text();"],
  ["loading ? '' : res.message", "loading ? '' : res.message"],
]);

fix('src/public/js/gpu.js', [
  ["data.forEach((gpu, idx) => {", "data.forEach((gpu, _idx) => {"],
]);

fix('src/public/js/monitor.js', [
  ["let pollInterval = setInterval(fetchMetrics, 5000);", "let _pollInterval = setInterval(fetchMetrics, 5000);"],
]);

fix('src/public/js/redis.js', [
  ["(acc, value) => {", "(acc, _value) => {"],
]);

fix('src/public/js/settings/panel.js', [
  ["let dots = 0;", "let _dots = 0;"],
]);

fix('src/public/js/settings/themes.js', [
  ["const themeName = document.body.getAttribute('data-theme');", "const _themeName = document.body.getAttribute('data-theme');"],
]);

fix('src/public/js/updater.js', [
  ["const statusIcon = document.getElementById('update-status');", "const _statusIcon = document.getElementById('update-status');"],
  ["let dots = 0;", "let _dots = 0;"],
]);

fix('src/public/js/websites.js', [
  ["data.forEach((item, id) => {", "data.forEach((item, _id) => {"],
]);

console.log('Batch 3 done!');
