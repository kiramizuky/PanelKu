import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import logger from '../../config/logger.js';

let pty = null;
let ptyLoadError = null;

try {
  const ptyModule = await import('node-pty');
  pty = ptyModule.default || ptyModule;
} catch (err) {
  ptyLoadError = err;
  logger.warn(`Failed to load native module "node-pty": ${err.message}. Web terminal will be unavailable until rebuilt.`);
}

const MAX_SCROLLBACK_CHARS = 128 * 1024; // 128 KB ring buffer per session
const FLUSH_INTERVAL_MS = 16; // ~60fps batching to prevent Socket.IO event-loop flooding
const MAX_BATCH_CHARS = 32 * 1024; // Flush immediately if batch exceeds 32 KB
const DETACH_GRACE_MS = 10 * 60 * 1000; // Keep detached PTY alive for 10 minutes on network drop

/**
 * Terminal Service — manages PTY instances per user/session with
 * output batching, scrollback ring buffer, and seamless reconnect/reattach.
 */
class TerminalService {
  constructor() {
    this._sessions = new Map();
    this._MAX_SESSIONS = 50;
  }

  /**
   * Check if native PTY is available.
   */
  isAvailable() {
    return pty !== null;
  }

  /**
   * Create a new PTY session.
   */
  create(userId, shell = 'bash', cols = 80, rows = 24, osUser = 'root', cwd = null) {
    if (!pty) {
      const hint = ptyLoadError ? `: ${ptyLoadError.message}` : '';
      throw new Error(`Web terminal is unavailable because native module "node-pty" failed to load${hint}. Run "npm rebuild node-pty" in /opt/panelku to fix.`);
    }

    if (this._sessions.size >= this._MAX_SESSIONS) {
      throw new Error('Maximum terminal sessions reached');
    }

    const sessionId = uuidv4();
    const isWin = process.platform === 'win32';
    const safeCols = Math.max(1, Math.min(500, parseInt(cols, 10) || 80));
    const safeRows = Math.max(1, Math.min(200, parseInt(rows, 10) || 24));
    let shellPath = this._resolveShell(shell);
    let shellArgs = [];

    const fallbackDir = isWin ? (process.env.USERPROFILE || 'C:\\') : (process.env.HOME || '/root');
    let workingDir = fallbackDir;
    let hasCustomCwd = false;

    if (cwd && typeof cwd === 'string' && cwd.trim()) {
      const trimmed = cwd.trim();
      try {
        if (fs.existsSync(trimmed)) {
          const stat = fs.statSync(trimmed);
          workingDir = stat.isDirectory() ? trimmed : path.dirname(trimmed);
          hasCustomCwd = true;
        }
      } catch (_) {
        workingDir = fallbackDir;
      }
    }

    if (!fs.existsSync(workingDir)) {
      workingDir = isWin ? 'C:\\' : '/';
    }

    if (!isWin && osUser && osUser !== 'root') {
      shellPath = 'su';
      // If custom working directory is specified, avoid '-' which forces reset to user home directory
      shellArgs = hasCustomCwd ? [osUser] : ['-', osUser];
    }

    const ptyProcess = pty.spawn(shellPath, shellArgs, {
      name: 'xterm-256color',
      cols: safeCols,
      rows: safeRows,
      cwd: workingDir,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      },
    });

    const session = {
      pty: ptyProcess,
      userId: String(userId),
      shell,
      cols: safeCols,
      rows: safeRows,
      createdAt: new Date(),
      exited: false,
      exitCode: null,
      dataListeners: new Set(),
      exitListeners: new Set(),
      scrollbackChunks: [],
      scrollbackBytes: 0,
      totalBytes: 0,
      pendingOutput: '',
      flushTimer: null,
      detachTimer: null,
    };

    // Single PTY data handler with 16ms batching + ring-buffer scrollback
    ptyProcess.onData((data) => {
      if (!data) return;
      session.pendingOutput += data;
      if (session.pendingOutput.length >= MAX_BATCH_CHARS) {
        this._flushOutput(session);
      } else if (!session.flushTimer) {
        session.flushTimer = setTimeout(() => {
          this._flushOutput(session);
        }, FLUSH_INTERVAL_MS);
      }
    });

    // Single PTY exit handler
    ptyProcess.onExit(({ exitCode }) => {
      this._flushOutput(session);
      session.exited = true;
      session.exitCode = exitCode;
      if (session.detachTimer) {
        clearTimeout(session.detachTimer);
        session.detachTimer = null;
      }
      for (const listener of [...session.exitListeners]) {
        try {
          listener({ exitCode });
        } catch (err) {
          logger.error(`Terminal exit listener error (${sessionId}): ${err.message}`);
        }
      }
      session.dataListeners.clear();
      session.exitListeners.clear();
      this._sessions.delete(sessionId);
    });

    // Ensure shell switches to target directory if requested
    if (hasCustomCwd && workingDir) {
      setTimeout(() => {
        try {
          if (!session.exited && session.pty) {
            const escapedDir = workingDir.replace(/"/g, '\\"');
            session.pty.write(`cd "${escapedDir}"\n`);
          }
        } catch (_) { /* ignore if already closed */ }
      }, 250);
    }

    this._sessions.set(sessionId, session);

    logger.info(`Terminal session created: ${sessionId} (${shell}) for user ${userId} in ${workingDir}`);
    return { sessionId, pid: ptyProcess.pid };
  }

  _flushOutput(session) {
    if (session.flushTimer) {
      clearTimeout(session.flushTimer);
      session.flushTimer = null;
    }
    const batch = session.pendingOutput;
    if (!batch) return;
    session.pendingOutput = '';

    // Append to ring buffer
    session.scrollbackChunks.push(batch);
    session.scrollbackBytes += batch.length;
    session.totalBytes += batch.length;

    while (session.scrollbackBytes > MAX_SCROLLBACK_CHARS && session.scrollbackChunks.length > 1) {
      const removed = session.scrollbackChunks.shift();
      session.scrollbackBytes -= removed.length;
    }

    for (const listener of [...session.dataListeners]) {
      try {
        listener(batch, session.totalBytes);
      } catch (err) {
        logger.error(`Terminal data listener error: ${err.message}`);
      }
    }
  }

  /**
   * Write data to a PTY session.
   */
  write(sessionId, data) {
    const session = this._sessions.get(sessionId);
    if (!session || session.exited) throw new Error(`Session ${sessionId} not found`);
    try {
      session.pty.write(data);
    } catch (err) {
      logger.warn(`Terminal write failed (${sessionId}): ${err.message}`);
    }
  }

  /**
   * Resize a PTY session safely.
   */
  resize(sessionId, cols, rows) {
    const session = this._sessions.get(sessionId);
    if (!session || session.exited) return;
    const safeCols = Math.max(1, Math.min(500, parseInt(cols, 10) || session.cols || 80));
    const safeRows = Math.max(1, Math.min(200, parseInt(rows, 10) || session.rows || 24));
    try {
      session.pty.resize(safeCols, safeRows);
      session.cols = safeCols;
      session.rows = safeRows;
    } catch (err) {
      logger.debug(`Terminal resize ignored (${sessionId}): ${err.message}`);
    }
  }

  /**
   * Attach a data handler to receive output from PTY.
   * Returns an unsubscribe function.
   */
  onData(sessionId, handler) {
    const session = this._sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    session.dataListeners.add(handler);
    return () => session.dataListeners.delete(handler);
  }

  /**
   * Attach an exit handler.
   * Returns an unsubscribe function.
   */
  onExit(sessionId, handler) {
    const session = this._sessions.get(sessionId);
    if (!session) return () => {};
    session.exitListeners.add(handler);
    return () => session.exitListeners.delete(handler);
  }

  /**
   * Reattach to an existing live session after a WebSocket reconnect.
   * Returns missed output since `lastOffset`, or null if session is gone/unauthorized.
   */
  attach(sessionId, userId, lastOffset = 0) {
    const session = this._sessions.get(sessionId);
    if (!session || session.exited || session.userId !== String(userId)) {
      return null;
    }

    if (session.detachTimer) {
      clearTimeout(session.detachTimer);
      session.detachTimer = null;
    }

    this._flushOutput(session);

    let missedOutput = '';
    const safeOffset = Math.max(0, Number(lastOffset) || 0);
    if (safeOffset < session.totalBytes) {
      const fullBuffer = session.scrollbackChunks.join('');
      const bufferStart = session.totalBytes - fullBuffer.length;
      if (safeOffset <= bufferStart) {
        missedOutput = fullBuffer;
      } else {
        missedOutput = fullBuffer.slice(safeOffset - bufferStart);
      }
    }

    return {
      sessionId,
      pid: session.pty?.pid || 0,
      missedOutput,
      totalBytes: session.totalBytes,
    };
  }

  /**
   * Mark a session as detached; keep PTY alive for graceMs before killing
   * if no client reattaches.
   */
  detach(sessionId, graceMs = DETACH_GRACE_MS) {
    const session = this._sessions.get(sessionId);
    if (!session || session.exited) return;
    if (session.dataListeners.size > 0) return;

    if (session.detachTimer) {
      clearTimeout(session.detachTimer);
    }

    session.detachTimer = setTimeout(() => {
      logger.info(`Terminal session ${sessionId} timed out after detach grace period; killing.`);
      this.kill(sessionId);
    }, graceMs);
    session.detachTimer.unref?.();
  }

  /**
   * Kill a PTY session immediately.
   */
  kill(sessionId) {
    const session = this._sessions.get(sessionId);
    if (!session) return;
    if (session.flushTimer) {
      clearTimeout(session.flushTimer);
      session.flushTimer = null;
    }
    if (session.detachTimer) {
      clearTimeout(session.detachTimer);
      session.detachTimer = null;
    }
    session.exited = true;
    session.dataListeners.clear();
    session.exitListeners.clear();
    try {
      session.pty.kill();
    } catch { /* ignore */ }
    this._sessions.delete(sessionId);
    logger.info(`Terminal session killed: ${sessionId}`);
  }

  /**
   * Kill all sessions for a user.
   */
  killUserSessions(userId) {
    for (const [id, session] of this._sessions) {
      if (session.userId === String(userId)) {
        this.kill(id);
      }
    }
  }

  /**
   * Kill all active PTY sessions (used during graceful shutdown).
   */
  killAll() {
    for (const id of [...this._sessions.keys()]) {
      this.kill(id);
    }
  }

  /**
   * Get session info (without PTY reference).
   */
  getSession(sessionId) {
    const session = this._sessions.get(sessionId);
    if (!session) return null;
    const {
      pty: _,
      dataListeners: _dl,
      exitListeners: _el,
      scrollbackChunks: _sc,
      flushTimer: _ft,
      detachTimer: _dt,
      ...info
    } = session;
    return info;
  }

  exists(sessionId) {
    return this._sessions.has(sessionId);
  }

  _resolveShell(shell) {
    if (process.platform === 'win32') {
      return process.env.comspec || 'cmd.exe';
    }
    const shells = {
      bash: '/bin/bash',
      zsh: '/bin/zsh',
      fish: '/usr/bin/fish',
      sh: '/bin/sh',
    };
    return shells[shell] || '/bin/bash';
  }

  getStats() {
    return {
      activeSessions: this._sessions.size,
      sessions: [...this._sessions.entries()].map(([id, s]) => ({
        sessionId: id,
        userId: s.userId,
        shell: s.shell,
        createdAt: s.createdAt,
        detached: s.dataListeners.size === 0,
      })),
    };
  }
}

const terminalService = new TerminalService();
export default terminalService;
