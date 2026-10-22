/**
 * Panelku — detached update worker.
 *
 * Invoked by scripts/panel-update.sh, which is started before the panel
 * restarts. Responsibilities:
 *   1. apply the update (reuse updater.service.js)
 *   2. restart the panel service
 *   3. poll /api/health for up to N seconds
 *   4. automatically roll back and restart the previous commit on failure
 *
 * Every step is persisted to storage/update_state.json so the web UI can show
 * exactly what the supervisor is doing instead of guessing from a timeout.
 */

import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import updaterService from '../src/modules/updater/updater.service.js';

const execFileAsync = promisify(execFile);

function readArg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

const config = {
  jobId: readArg('job-id', `upd_${Date.now().toString(36)}`),
  branch: readArg('branch', 'master'),
  channel: readArg('channel', 'stable'),
  previousCommit: readArg('previous-commit', ''),
  panelDir: readArg('panel-dir', process.cwd()),
  storageDir: readArg('storage-dir', path.join(process.cwd(), 'storage')),
  stateFile: readArg('state-file', ''),
  service: readArg('service', 'panelku'),
  port: parseInt(readArg('port', '23456'), 10) || 23456,
  healthTimeout: parseInt(readArg('health-timeout', '120000'), 10) || 120000,
};
config.stateFile = config.stateFile || path.join(config.storageDir, 'update_state.json');

async function readState() {
  try {
    return JSON.parse(await fs.readFile(config.stateFile, 'utf8'));
  } catch {
    return null;
  }
}

async function writeState(patch) {
  const previous = (await readState()) || {};
  const state = {
    ...previous,
    id: config.jobId,
    supervised: true,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  await fs.mkdir(path.dirname(config.stateFile), { recursive: true });
  const tmp = `${config.stateFile}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
  await fs.rename(tmp, config.stateFile);
  return state;
}

function log(message) {
  process.stdout.write(`[panel-update ${new Date().toISOString()}] ${message}\n`);
}

async function restartService() {
  const errors = [];
  try {
    await execFileAsync('systemctl', ['restart', config.service], { timeout: 90000 });
    log(`systemctl restart ${config.service} succeeded`);
    return true;
  } catch (err) {
    errors.push(`systemctl: ${(err.stderr || err.message || '').toString().trim()}`);
  }

  try {
    await execFileAsync('pm2', ['restart', config.service], { timeout: 90000 });
    log(`pm2 restart ${config.service} succeeded`);
    return true;
  } catch (err) {
    errors.push(`pm2: ${(err.stderr || err.message || '').toString().trim()}`);
  }

  throw new Error(`Could not restart ${config.service} (${errors.join(' | ')})`);
}

async function probeHealth() {
  try {
    const res = await fetch(`http://127.0.0.1:${config.port}/api/health`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return false;
    const data = await res.json().catch(() => null);
    return !!data && data.success !== false && data.status === 'ok';
  } catch {
    return false;
  }
}

/**
 * Wait until the panel answers /api/health twice in a row.
 * `booted` is set when the first successful probe is seen.
 */
async function waitForHealthy(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let consecutive = 0;
  let booted = false;

  while (Date.now() < deadline) {
    if (await probeHealth()) {
      consecutive += 1;
      if (!booted) {
        booted = true;
        await writeState({ phase: 'health-ok', bootSeenAt: new Date().toISOString() });
        log('health probe succeeded — waiting for a second confirmation');
      }
      if (consecutive >= 2) return true;
    } else {
      consecutive = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  return false;
}

async function finish(state, exitCode) {
  await writeState({
    finishedAt: new Date().toISOString(),
    restartPending: false,
    ...state,
  });
  process.exit(exitCode);
}

async function main() {
  log(`supervisor started for job ${config.jobId} (${config.branch}/${config.channel})`);
  await writeState({
    status: 'running',
    phase: 'updating',
    startedAt: new Date().toISOString(),
    previousCommit: config.previousCommit || null,
    log: 'Update supervisor started. Applying git + npm + native build...',
  });

  let result;
  try {
    result = await updaterService.performUpdate({
      method: 'git',
      branch: config.branch,
      channel: config.channel,
      _internal: true,
      _deferRestart: true,
    });
  } catch (err) {
    await finish({
      status: 'failed',
      phase: 'failed',
      error: err.message,
      log: `Update failed before restart: ${err.message}`,
    }, 1);
    return;
  }

  if (!result.success) {
    await finish({
      status: 'failed',
      phase: 'failed',
      error: 'Update failed (see log)',
      expectedCommit: result.commit || null,
      previousCommit: result.previousCommit || config.previousCommit || null,
      log: result.log || 'Update failed',
    }, 1);
    return;
  }

  const previousCommit = result.previousCommit || config.previousCommit;
  const expectedCommit = result.commit || '';

  await writeState({
    status: 'restarting',
    phase: 'restarting',
    expectedCommit,
    previousCommit,
    restartPending: true,
    log: `${result.log || ''}\n\nSupervisor: restarting panel service...`.trim(),
  });

  let restartOk = true;
  try {
    await restartService();
  } catch (err) {
    restartOk = false;
    log(`restart failed: ${err.message}`);
  }

  if (restartOk) {
    await writeState({ status: 'verifying', phase: 'health-check', log: `${result.log || ''}\n\nSupervisor: waiting for /api/health...`.trim() });
    const healthy = await waitForHealthy(config.healthTimeout);
    if (healthy) {
      await finish({
        status: 'success',
        phase: 'done',
        expectedCommit,
        previousCommit,
        bootVerifiedAt: new Date().toISOString(),
        log: `${result.log || ''}\n\n✅ Supervisor: panel is healthy after restart.`.trim(),
      }, 0);
      return;
    }
  }

  // ── Rollback path ────────────────────────────────────────────────
  const failureReason = restartOk
    ? `Panel did not become healthy within ${Math.round(config.healthTimeout / 1000)}s`
    : 'Panel could not be restarted';

  log(`update unhealthy: ${failureReason}. Rolling back to ${previousCommit || 'previous commit'}`);

  await writeState({
    status: 'rolling_back',
    phase: 'rolling-back',
    error: failureReason,
    log: `${result.log || ''}\n\n⚠️ ${failureReason}. Rolling back...`.trim(),
  });

  let rollbackLog = '';
  try {
    const rollback = await updaterService.performRollback({
      commit: previousCommit || undefined,
      _deferRestart: true,
    });
    rollbackLog = rollback.log || '';
  } catch (err) {
    rollbackLog = `Rollback failed: ${err.message}`;
  }

  await writeState({
    status: 'restarting',
    phase: 'restarting-rollback',
    restartPending: true,
    log: `${result.log || ''}\n\n${rollbackLog}\n\nSupervisor: restarting rollback build...`.trim(),
  });

  let rollbackHealthy = false;
  try {
    await restartService();
    rollbackHealthy = await waitForHealthy(config.healthTimeout);
  } catch (err) {
    rollbackLog += `\nRestart after rollback failed: ${err.message}`;
  }

  await finish({
    status: rollbackHealthy ? 'rolled_back' : 'failed',
    phase: rollbackHealthy ? 'rolled-back' : 'rollback-failed',
    error: failureReason,
    previousCommit,
    expectedCommit,
    bootVerifiedAt: rollbackHealthy ? new Date().toISOString() : null,
    log: `${result.log || ''}\n\n${rollbackLog}\n\n${
      rollbackHealthy
        ? '↩️ Supervisor: rolled back and panel is healthy again.'
        : '❌ Supervisor: rollback did not restore a healthy panel. Manual intervention required.'
    }`.trim(),
  }, rollbackHealthy ? 2 : 1);
}

main().catch(async (err) => {
  log(`fatal: ${err.stack || err.message}`);
  try {
    await finish({
      status: 'failed',
      phase: 'fatal',
      error: err.message,
      log: `Supervisor crashed: ${err.stack || err.message}`,
    }, 1);
  } catch {
    process.exit(1);
  }
});
