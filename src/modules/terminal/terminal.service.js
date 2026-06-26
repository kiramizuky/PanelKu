import pty from 'node-pty';
import { v4 as uuidv4 } from 'uuid';
import logger from '../../config/logger.js';

/**
 * Terminal Service — manages PTY instances per user/session.
 */
class TerminalService {
  constructor() {
    this._sessions = new Map(); // sessionId -> { pty, userId, shell, createdAt }
    this._MAX_SESSIONS = 50;
  }

  /**
   * Create a new PTY session.
   */
  create(userId, shell = 'bash', cols = 80, rows = 24, osUser = 'root') {
    if (this._sessions.size >= this._MAX_SESSIONS) {
      throw new Error('Maximum terminal sessions reached');
    }

    const sessionId = uuidv4();
    const isWin = process.platform === 'win32';
    let shellPath = this._resolveShell(shell);
    let shellArgs = [];

    if (!isWin && osUser && osUser !== 'root') {
      shellPath = 'su';
      shellArgs = ['-', osUser];
    }

    const ptyProcess = pty.spawn(shellPath, shellArgs, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: isWin ? process.env.USERPROFILE : (process.env.HOME || '/root'),
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      },
    });

    this._sessions.set(sessionId, {
      pty: ptyProcess,
      userId: String(userId),
      shell,
      cols,
      rows,
      createdAt: new Date(),
    });

    logger.info(`Terminal session created: ${sessionId} (${shell}) for user ${userId}`);
    return { sessionId, pid: ptyProcess.pid };
  }

  /**
   * Write data to a PTY session.
   */
  write(sessionId, data) {
    const session = this._sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    session.pty.write(data);
  }

  /**
   * Resize a PTY session.
   */
  resize(sessionId, cols, rows) {
    const session = this._sessions.get(sessionId);
    if (!session) return;
    session.pty.resize(cols, rows);
    session.cols = cols;
    session.rows = rows;
  }

  /**
   * Attach a data handler to receive output from PTY.
   */
  onData(sessionId, handler) {
    const session = this._sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    session.pty.onData(handler);
  }

  /**
   * Attach an exit handler.
   */
  onExit(sessionId, handler) {
    const session = this._sessions.get(sessionId);
    if (!session) return;
    session.pty.onExit(handler);
  }

  /**
   * Kill a PTY session.
   */
  kill(sessionId) {
    const session = this._sessions.get(sessionId);
    if (!session) return;
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
   * Get session info (without PTY reference).
   */
  getSession(sessionId) {
    const session = this._sessions.get(sessionId);
    if (!session) return null;
    const { pty: _, ...info } = session;
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
      })),
    };
  }
}

const terminalService = new TerminalService();
export default terminalService;
