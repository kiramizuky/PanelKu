/**
 * Unit Tests for Terminal Module:
 * - src/modules/terminal/copilot.service.js
 * - src/modules/terminal/terminal.service.js
 * - src/modules/terminal/terminal.controller.js
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

const mockPtyProcess = {
  pid: 4321,
  write: jest.fn(),
  resize: jest.fn(),
  kill: jest.fn(),
  onData: jest.fn(),
  onExit: jest.fn(),
};

const mockPty = {
  spawn: jest.fn(() => mockPtyProcess),
};

jest.unstable_mockModule('node-pty', () => ({
  default: mockPty,
  spawn: mockPty.spawn,
}));

const { default: copilotService } = await import('../src/modules/terminal/copilot.service.js');
const { default: terminalService } = await import('../src/modules/terminal/terminal.service.js');
const { default: terminalController } = await import('../src/modules/terminal/terminal.controller.js');

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('CopilotService — Safety Assessment & Guardrails', () => {
  test('assessSafety flags low risk for standard non-destructive commands', () => {
    const safety = copilotService.assessSafety('ls -la /var/www');
    expect(safety.isSafe).toBe(true);
    expect(safety.riskLevel).toBe('low');
    expect(safety.requiresConfirmation).toBe(false);
    expect(safety.warnings).toEqual([]);

    const emptySafety = copilotService.assessSafety('');
    expect(emptySafety.isSafe).toBe(true);
    expect(emptySafety.riskLevel).toBe('low');
  });

  test('assessSafety flags medium risk for privilege escalation and process kill', () => {
    const sudoCheck = copilotService.assessSafety('sudo systemctl restart nginx');
    expect(sudoCheck.isSafe).toBe(false);
    expect(sudoCheck.riskLevel).toBe('medium');
    expect(sudoCheck.requiresConfirmation).toBe(true);
    expect(sudoCheck.warnings[0]).toContain('Elevated privileges');

    const killCheck = copilotService.assessSafety('kill -9 1234');
    expect(killCheck.riskLevel).toBe('medium');
  });

  test('assessSafety flags critical risk for destructive patterns', () => {
    expect(copilotService.assessSafety('rm -rf /').riskLevel).toBe('critical');
    expect(copilotService.assessSafety('mkfs.ext4 /dev/sdb1').riskLevel).toBe('critical');
    expect(copilotService.assessSafety('dd if=/dev/zero of=/dev/sda').riskLevel).toBe('critical');
    expect(copilotService.assessSafety('iptables -F').riskLevel).toBe('critical');
    expect(copilotService.assessSafety('chmod -R 777 /').riskLevel).toBe('critical');
    expect(copilotService.assessSafety('> /dev/sda').riskLevel).toBe('critical');
    expect(copilotService.assessSafety(':(){ :|:& };:').riskLevel).toBe('critical');
    expect(copilotService.assessSafety('shutdown -h now').riskLevel).toBe('critical');
    expect(copilotService.assessSafety('reboot').riskLevel).toBe('critical');
  });
});

describe('CopilotService — Command Generation & Explanation', () => {
  test('generateCommand requires prompt and rejects empty inputs', async () => {
    await expect(copilotService.generateCommand('')).rejects.toThrow('Prompt is required');
    await expect(copilotService.generateCommand(null)).rejects.toThrow('Prompt is required');
  });

  test('generateCommand maps natural language queries to specialized Linux commands', async () => {
    const cases = [
      { prompt: 'find large files over 100mb', expectedBin: 'find' },
      { prompt: 'check storage and disk space', expectedBin: 'df' },
      { prompt: 'show top ram and memory usage', expectedBin: 'free' },
      { prompt: 'check cpu and high load processes', expectedBin: 'uptime' },
      { prompt: 'list open ports and listening services', expectedBin: 'ss' },
      { prompt: 'restart nginx service', expectedBin: 'nginx -t' },
      { prompt: 'restart apache webserver', expectedBin: 'apache2ctl' },
      { prompt: 'clean unused docker containers and prune', expectedBin: 'docker system prune' },
      { prompt: 'docker stats live snapshot', expectedBin: 'docker stats' },
      { prompt: 'check failed ssh login attempts', expectedBin: 'grep' },
      { prompt: 'who is currently logged in', expectedBin: 'w' },
      { prompt: 'update and upgrade packages', expectedBin: 'sudo apt update' },
      { prompt: 'random custom instruction', expectedBin: 'echo "Executing task: random custom instruction"' },
    ];

    for (const item of cases) {
      const result = await copilotService.generateCommand(item.prompt, { env: 'prod' });
      expect(result.command).toContain(item.expectedBin);
      expect(result.explanation).toBeDefined();
      expect(result.safety).toBeDefined();
      expect(result.context).toEqual({ env: 'prod' });
    }
  });

  test('explainCommand breaks down binary and option flags', async () => {
    await expect(copilotService.explainCommand('')).rejects.toThrow('Command is required');

    const explanation = await copilotService.explainCommand('tar -czvf archive.tar.gz /data');
    expect(explanation.command).toBe('tar -czvf archive.tar.gz /data');
    expect(explanation.summary).toContain('tar');
    expect(explanation.breakdown).toHaveLength(2);
    expect(explanation.breakdown[0].token).toBe('tar');
    expect(explanation.breakdown[1].token).toBe('-czvf');
  });
});

describe('TerminalService — PTY Lifecycle and Session Pool', () => {
  test('creates, writes, resizes, and hooks handlers on session', () => {
    const session = terminalService.create(101, 'bash', 100, 30);
    const id = session.sessionId;

    expect(session.pid).toBe(4321);
    expect(terminalService.exists(id)).toBe(true);

    const info = terminalService.getSession(id);
    expect(info.userId).toBe('101');
    expect(info.shell).toBe('bash');
    expect(info.cols).toBe(100);
    expect(info.rows).toBe(30);

    terminalService.write(id, 'echo test\n');
    expect(mockPtyProcess.write).toHaveBeenCalledWith('echo test\n');

    terminalService.resize(id, 120, 40);
    expect(mockPtyProcess.resize).toHaveBeenCalledWith(120, 40);

    const dataHandler = jest.fn();
    const exitHandler = jest.fn();
    terminalService.onData(id, dataHandler);
    terminalService.onExit(id, exitHandler);
    expect(mockPtyProcess.onData).toHaveBeenCalledWith(dataHandler);
    expect(mockPtyProcess.onExit).toHaveBeenCalledWith(exitHandler);

    terminalService.kill(id);
    expect(terminalService.exists(id)).toBe(false);
    expect(mockPtyProcess.kill).toHaveBeenCalled();
  });

  test('write and onData throw when session does not exist', () => {
    expect(() => terminalService.write('non-existent', 'data')).toThrow('Session non-existent not found');
    expect(() => terminalService.onData('non-existent', () => {})).toThrow('Session non-existent not found');
    expect(terminalService.getSession('non-existent')).toBeNull();
  });

  test('killUserSessions deletes all active sessions for a specific user', () => {
    const s1 = terminalService.create(202, 'bash');
    const s2 = terminalService.create(202, 'bash');
    const s3 = terminalService.create(303, 'bash');

    terminalService.killUserSessions(202);

    expect(terminalService.exists(s1.sessionId)).toBe(false);
    expect(terminalService.exists(s2.sessionId)).toBe(false);
    expect(terminalService.exists(s3.sessionId)).toBe(true);

    terminalService.kill(s3.sessionId);
  });

  test('getStats summarizes active session pool', () => {
    const s = terminalService.create(404, 'sh');
    const stats = terminalService.getStats();

    expect(stats.activeSessions).toBeGreaterThanOrEqual(1);
    expect(stats.sessions.some(item => item.sessionId === s.sessionId)).toBe(true);

    terminalService.kill(s.sessionId);
  });

  test('_resolveShell returns appropriate shells for linux and fallback', () => {
    const originalPlatform = process.platform;
    try {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      expect(terminalService._resolveShell('zsh')).toBe('/bin/zsh');
      expect(terminalService._resolveShell('fish')).toBe('/usr/bin/fish');
      expect(terminalService._resolveShell('sh')).toBe('/bin/sh');
      expect(terminalService._resolveShell('unknown')).toBe('/bin/bash');
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  test('create enforces MAX_SESSIONS limit', () => {
    terminalService._MAX_SESSIONS = 1;
    const s1 = terminalService.create(500, 'bash');

    expect(() => terminalService.create(500, 'bash')).toThrow('Maximum terminal sessions reached');

    terminalService.kill(s1.sessionId);
    terminalService._MAX_SESSIONS = 50;
  });
});

describe('TerminalController — Endpoints', () => {
  test('create, kill, and getStats endpoints', async () => {
    const resCreate = mockRes();
    await terminalController.create(
      { user: { _id: 99 }, body: { shell: 'bash', cols: 80, rows: 24 } },
      resCreate
    );
    expect(resCreate.statusCode).toBe(200);
    expect(resCreate.body.data.sessionId).toBeDefined();

    const sessId = resCreate.body.data.sessionId;

    const resStats = mockRes();
    await terminalController.getStats({}, resStats);
    expect(resStats.statusCode).toBe(200);
    expect(resStats.body.data.activeSessions).toBeGreaterThanOrEqual(1);

    const resKill = mockRes();
    await terminalController.kill({ params: { sessionId: sessId } }, resKill);
    expect(resKill.statusCode).toBe(200);
  });

  test('generateCommand and explainCommand endpoints validate inputs', async () => {
    const resErr1 = mockRes();
    await terminalController.generateCommand({ body: {} }, resErr1);
    expect(resErr1.statusCode).toBe(400);

    const resGen = mockRes();
    await terminalController.generateCommand({ body: { prompt: 'check storage' } }, resGen);
    expect(resGen.statusCode).toBe(200);
    expect(resGen.body.data.command).toContain('df');

    const resErr2 = mockRes();
    await terminalController.explainCommand({ body: {} }, resErr2);
    expect(resErr2.statusCode).toBe(400);

    const resExp = mockRes();
    await terminalController.explainCommand({ body: { command: 'ls -l' } }, resExp);
    expect(resExp.statusCode).toBe(200);
    expect(resExp.body.data.breakdown).toBeDefined();
  });
});
