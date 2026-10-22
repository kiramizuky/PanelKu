#!/usr/bin/env node
/**
 * Panelku operational CLI.
 *
 * Usage:
 *   panelku status
 *   panelku doctor [--json]
 *   panelku check-update [--json]
 *   panelku rollback (--commit <sha> | --backup <name>) [--yes]
 *   panelku reset-password [--user admin] [--password <new>]
 *
 * The CLI is intentionally read-only unless an explicit destructive flag
 * (--yes) is supplied. All imports are dynamic so .env is loaded before the
 * database and updater resolve their paths.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomBytes } from 'crypto';
import { parseArgs } from 'util';
import dotenv from 'dotenv';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '.env') });
process.env.PANELKU_HOME = process.env.PANELKU_HOME || ROOT;

const colors = process.stdout.isTTY
  ? { green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m', dim: '\x1b[2m', reset: '\x1b[0m' }
  : { green: '', yellow: '', red: '', cyan: '', dim: '', reset: '' };

const ok = (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`);
const warn = (msg) => console.log(`${colors.yellow}!${colors.reset} ${msg}`);
const fail = (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`);
const info = (msg) => console.log(`${colors.cyan}→${colors.reset} ${msg}`);

function readPackage() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  } catch {
    return { version: 'unknown' };
  }
}

async function systemdState(service = 'panelku') {
  try {
    const { stdout } = await execFileAsync('systemctl', ['is-active', service], { timeout: 4000 });
    return stdout.trim() || 'unknown';
  } catch (err) {
    return (err.stdout || '').trim() || 'unavailable';
  }
}

async function healthCheck(port) {
  const url = `http://127.0.0.1:${port}/api/health`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body, url };
  } catch (err) {
    return { ok: false, status: 0, error: err.message, url };
  }
}

async function commandStatus(args) {
  const pkg = readPackage();
  const port = Number(process.env.PORT) || 23456;
  const service = await systemdState();
  const health = await healthCheck(port);

  const result = {
    version: pkg.version,
    node: process.version,
    home: ROOT,
    storage: process.env.PANELKU_STORAGE || path.join(ROOT, 'storage'),
    systemd: service,
    health: { ok: health.ok, status: health.status, url: health.url },
    updateSupervisor: process.env.PANELKU_UPDATE_SUPERVISOR !== 'false',
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return health.ok ? 0 : 1;
  }

  info(`Panelku ${result.version}  (Node ${result.node})`);
  console.log(`  home:      ${result.home}`);
  console.log(`  storage:   ${result.storage}`);
  console.log(`  systemd:   ${service}`);
  console.log(`  health:    ${health.ok ? `${health.status} OK` : (health.error || `HTTP ${health.status}`)}  ${health.url}`);
  console.log(`  updater:   ${result.updateSupervisor ? 'systemd supervisor' : 'in-process'}`);
  return health.ok ? 0 : 1;
}

async function commandDoctor(args) {
  const checks = [];
  const add = (level, name, detail) => checks.push({ level, name, detail });

  const major = Number(process.versions.node.split('.')[0]);
  add(major >= 20 ? 'ok' : 'fail', 'Node.js >= 20', `found ${process.version}`);
  if (major < 22) add('warn', 'Node.js 22 recommended', 'Node 20 still works, but CI/Docker use Node 22');

  const storage = process.env.PANELKU_STORAGE || path.join(ROOT, 'storage');
  try {
    fs.mkdirSync(storage, { recursive: true });
    fs.accessSync(storage, fs.constants.W_OK);
    add('ok', 'storage writable', storage);
  } catch (err) {
    add('fail', 'storage writable', `${storage}: ${err.message}`);
  }

  const envFile = path.join(ROOT, '.env');
  if (fs.existsSync(envFile)) {
    add('ok', '.env present', envFile);
    const dangerous = new Set([
      'dev-secret-change-in-production',
      'jwt-secret-change-in-production',
      'refresh-secret-change-in-production',
      'change_this_to_a_very_long_random_secret_string',
      'change_this_jwt_secret_very_long_random_string',
      'change_this_refresh_secret_very_long_random',
    ]);
    for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'APP_SECRET']) {
      const value = process.env[key] || '';
      if (!value) add('fail', `${key} missing`, 'set a random value in .env');
      else if (dangerous.has(value)) add('fail', `${key} is a placeholder`, 'replace it with a random value');
      else if (value.length < 32) add('warn', `${key} is short`, 'use at least 32 random characters');
      else add('ok', `${key} length`, `${value.length} chars`);
    }
  } else {
    add('warn', '.env missing', 'copy .env.example and set JWT_SECRET');
  }

  try {
    const { getDb } = await import('../src/core/db/sqlite.js');
    const { getDbPath } = await import('../src/config/paths.js');
    const db = getDb();
    const users = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    add('ok', 'SQLite reachable', `${getDbPath()} (${users} users)`);
  } catch (err) {
    add('fail', 'SQLite reachable', err.message);
  }

  try {
    const { default: dockerService } = await import('../src/modules/docker/docker.service.js');
    const dockerInfo = await Promise.race([
      dockerService.getInfo(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('docker info timeout')), 3500)),
    ]);
    add('ok', 'Docker reachable', dockerInfo?.ServerVersion || process.env.DOCKER_HOST || 'local socket');
  } catch (err) {
    add('warn', 'Docker unreachable', err.message);
  }

  const redisHost = process.env.REDIS_HOST;
  if (redisHost) {
    const net = await import('net');
    const port = Number(process.env.REDIS_PORT) || 6379;
    const reachable = await new Promise((resolve) => {
      const socket = net.connect({ host: redisHost, port, timeout: 2000 });
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('timeout', () => { socket.destroy(); resolve(false); });
      socket.once('error', () => resolve(false));
    });
    add(reachable ? 'ok' : 'warn', 'Redis', `${redisHost}:${port} ${reachable ? 'reachable' : 'unreachable (optional)'}`);
  } else {
    add('ok', 'Redis', 'not configured (optional)');
  }

  const service = await systemdState();
  add(service === 'active' ? 'ok' : 'warn', 'systemd panelku.service', service);

  try {
    const stat = fs.statfsSync ? fs.statfsSync(storage) : null;
    if (stat) {
      const freeMb = Math.round((stat.bavail * stat.bsize) / 1024 / 1024);
      add(freeMb > 256 ? 'ok' : 'warn', 'free disk space', `${freeMb} MB available`);
    }
  } catch {
    // statfs is not available on every platform/Node build
  }

  if (args.json) {
    console.log(JSON.stringify({ root: ROOT, checks }, null, 2));
  } else {
    console.log(`Panelku doctor — ${ROOT}`);
    for (const c of checks) {
      if (c.level === 'ok') ok(`${c.name}: ${c.detail}`);
      else if (c.level === 'warn') warn(`${c.name}: ${c.detail}`);
      else fail(`${c.name}: ${c.detail}`);
    }
  }

  return checks.some((c) => c.level === 'fail') ? 1 : 0;
}

async function commandCheckUpdate(args) {
  const { default: updater } = await import('../src/modules/updater/updater.service.js');
  const result = await updater.checkForUpdates();
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return result.checkFailed ? 1 : 0;
  }

  console.log(`current:  ${result.current} (${result.commit?.slice(0, 12) || 'no git commit'})`);
  console.log(`latest:   ${result.latest}`);
  console.log(`branch:   ${result.branch} / ${result.channel}`);
  if (result.checkFailed) {
    fail(result.checkError || 'update check failed');
    return 1;
  }
  if (result.hasUpdate) {
    warn(`${result.behindCount} commit(s) behind`);
    if (result.changelogSummary) console.log(`\n${result.changelogSummary}`);
  } else {
    ok('up to date');
  }
  return 0;
}

async function commandRollback(args) {
  const { default: updater } = await import('../src/modules/updater/updater.service.js');

  if (!args.commit && !args.backup) {
    const backups = await updater.listBackups();
    info('Specify --commit <sha> or --backup <name>.');
    if (backups.length) {
      console.log('\nAvailable backups:');
      for (const b of backups.slice(0, 20)) {
        console.log(`  ${b.id || b.name}  ${b.createdAt || ''}  ${b.version || ''}`);
      }
    }
    return 1;
  }

  const target = args.commit ? `commit ${args.commit}` : `backup ${args.backup}`;
  if (!args.yes) {
    warn(`Would roll back to ${target}. Re-run with --yes to execute.`);
    return 1;
  }

  info(`Rolling back to ${target}...`);
  const result = await updater.performRollback({
    commit: args.commit,
    restoreBackup: args.backup,
  });
  console.log(result.log || result.message || 'Rollback finished');
  return result.success === false ? 1 : 0;
}

async function commandResetPassword(args) {
  const username = String(args.user || 'admin').toLowerCase();
  const provided = args.password || process.env.PANELKU_NEW_PASSWORD || '';
  const password = provided || randomBytes(18).toString('base64url');

  if (password.length < 12) {
    fail('password must be at least 12 characters');
    return 1;
  }

  const { default: User } = await import('../src/models/User.js');
  const { default: bcrypt } = await import('bcryptjs');
  const user = await User.findOne({ username });
  if (!user) {
    fail(`user not found: ${username}`);
    return 1;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await User.findByIdAndUpdate(user.id, {
    password: passwordHash,
    mustChangePassword: true,
    passwordChangedAt: new Date(),
    sessions: [],
    loginCount: 0,
  });

  ok(`password reset for ${username}`);
  if (!provided) {
    console.log(`\n  New temporary password: ${password}`);
    console.log('  The user must change it after login.');
  }
  return 0;
}

function usage() {
  console.log(`Panelku CLI

Usage:
  panelku status [--json]
  panelku doctor [--json]
  panelku check-update [--json]
  panelku rollback (--commit <sha> | --backup <name>) [--yes]
  panelku reset-password [--user <name>] [--password <new>]

Environment:
  PANELKU_HOME, PANELKU_STORAGE, PANELKU_DB_PATH, DB_PATH,
  DOCKER_HOST, REDIS_HOST, REDIS_PORT, PORT, METRICS_TOKEN
`);
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      json: { type: 'boolean', default: false },
      yes: { type: 'boolean', short: 'y', default: false },
      commit: { type: 'string' },
      backup: { type: 'string' },
      user: { type: 'string', short: 'u' },
      password: { type: 'string', short: 'p' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  const command = positionals[0] || 'help';
  if (values.help || command === 'help') {
    usage();
    return 0;
  }

  switch (command) {
    case 'status': return commandStatus(values);
    case 'doctor': return commandDoctor(values);
    case 'check-update': return commandCheckUpdate(values);
    case 'rollback': return commandRollback(values);
    case 'reset-password': return commandResetPassword(values);
    case 'version':
      console.log(readPackage().version);
      return 0;
    default:
      fail(`unknown command: ${command}`);
      usage();
      return 1;
  }
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((err) => {
    fail(err.message);
    if (process.env.DEBUG) console.error(err.stack);
    process.exitCode = 1;
  });
