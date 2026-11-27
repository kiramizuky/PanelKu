import { spawn } from 'child_process';
import crypto from 'crypto';

const processes = new Map();
const MAX_STORED_PROCESSES = 100;
const MAX_LOGS_PER_PROCESS = 500;

function pruneOldProcesses() {
  if (processes.size <= MAX_STORED_PROCESSES) return;
  const oldestKey = processes.keys().next().value;
  if (oldestKey) processes.delete(oldestKey);
}

/**
 * Real-time multi-step process & live log streamer over Socket.IO.
 */
class ProcessRunner {
  create(io, { title, subtitle = '', steps = [] } = {}) {
    const id = `proc_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const state = {
      id,
      title: title || 'Running Process',
      subtitle,
      status: 'running', // 'running' | 'completed' | 'failed'
      progress: 0,
      steps: steps.map((label, idx) => ({
        index: idx,
        label,
        status: 'pending', // 'pending' | 'running' | 'done' | 'failed'
        detail: '',
      })),
      logs: [],
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
      result: null,
    };

    processes.set(id, state);
    pruneOldProcesses();

    const emit = () => {
      if (io) {
        io.emit('process:state', state);
      }
    };

    const recalcProgress = () => {
      if (!state.steps.length) return;
      const doneCount = state.steps.filter((s) => s.status === 'done').length;
      const runningCount = state.steps.filter((s) => s.status === 'running').length;
      state.progress = Math.min(100, Math.round(((doneCount + runningCount * 0.4) / state.steps.length) * 100));
    };

    const handle = {
      id,
      getState: () => state,
      log(message, stream = 'info') {
        const lines = String(message || '').split(/\r?\n/).filter((l) => l.length > 0);
        const ts = new Date().toLocaleTimeString('en-GB', { hour12: false });
        for (const line of lines) {
          state.logs.push({ ts, stream, text: line });
        }
        if (state.logs.length > MAX_LOGS_PER_PROCESS) {
          state.logs = state.logs.slice(-MAX_LOGS_PER_PROCESS);
        }
        emit();
      },
      startStep(index, detail = '') {
        if (state.steps[index]) {
          state.steps[index].status = 'running';
          state.steps[index].detail = detail;
          recalcProgress();
          emit();
        }
      },
      completeStep(index, detail = '') {
        if (state.steps[index]) {
          state.steps[index].status = 'done';
          if (detail) state.steps[index].detail = detail;
          recalcProgress();
          emit();
        }
      },
      failStep(index, errMsg = '') {
        if (state.steps[index]) {
          state.steps[index].status = 'failed';
          state.steps[index].detail = errMsg;
          emit();
        }
      },
      execStream(cmd, args = [], opts = {}) {
        return new Promise((resolve, reject) => {
          const child = spawn(cmd, args, {
            cwd: opts.cwd,
            env: opts.env || process.env,
            shell: false,
          });
          let stdout = '';
          let stderr = '';
          const timeoutMs = opts.timeout ?? 180000;
          const timer = setTimeout(() => {
            try { child.kill('SIGTERM'); } catch (_) {}
            reject(new Error(`Command ${cmd} timed out after ${timeoutMs}ms`));
          }, timeoutMs);
          if (timer.unref) timer.unref();

          child.stdout?.on('data', (chunk) => {
            const txt = chunk.toString();
            stdout += txt;
            handle.log(txt, 'stdout');
          });
          child.stderr?.on('data', (chunk) => {
            const txt = chunk.toString();
            stderr += txt;
            handle.log(txt, 'stderr');
          });
          child.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
          });
          child.on('close', (code) => {
            clearTimeout(timer);
            if (code === 0) resolve({ stdout, stderr, code });
            else reject(new Error(stderr.trim() || `Command exited with code ${code}`));
          });
        });
      },
      finish(result = null, summary = '') {
        state.steps.forEach((s) => {
          if (s.status === 'running' || s.status === 'pending') s.status = 'done';
        });
        state.status = 'completed';
        state.progress = 100;
        state.result = result;
        state.finishedAt = new Date().toISOString();
        if (summary) handle.log(summary, 'info');
        emit();
      },
      fail(errMsg = 'Process failed') {
        state.steps.forEach((s) => {
          if (s.status === 'running') s.status = 'failed';
        });
        state.status = 'failed';
        state.error = errMsg;
        state.finishedAt = new Date().toISOString();
        handle.log(`ERROR: ${errMsg}`, 'stderr');
        emit();
      },
    };

    emit();
    return handle;
  }

  get(id) {
    return processes.get(id) || null;
  }
}

export default new ProcessRunner();
