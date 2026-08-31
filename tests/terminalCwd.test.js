import { jest } from '@jest/globals';
import path from 'path';
import fs from 'fs';
import os from 'os';

const mockSpawn = jest.fn((shell, args, options) => ({
  pid: 12345,
  write: jest.fn(),
  resize: jest.fn(),
  kill: jest.fn(),
  onData: jest.fn(),
  onExit: jest.fn(),
  options,
}));

jest.unstable_mockModule('node-pty', () => ({
  default: {
    spawn: mockSpawn,
  },
  spawn: mockSpawn,
}));

const { default: terminalService } = await import('../src/modules/terminal/terminal.service.js');

describe('Terminal Service CWD & Session Management', () => {
  const tempDir = path.join(os.tmpdir(), 'panelku-terminal-test-' + Date.now());

  beforeAll(() => {
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  });

  afterAll(() => {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
  });

  beforeEach(() => {
    mockSpawn.mockClear();
  });

  test('creates a terminal session with custom cwd directory', () => {
    const session = terminalService.create(1, 'bash', 80, 24, 'root', tempDir);

    expect(session).toBeDefined();
    expect(session.sessionId).toBeDefined();
    expect(mockSpawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ cwd: tempDir })
    );

    terminalService.kill(session.sessionId);
    expect(terminalService.exists(session.sessionId)).toBe(false);
  });

  test('resolves file path to parent directory when file is passed as cwd', () => {
    const sampleFile = path.join(tempDir, 'sample.txt');
    fs.writeFileSync(sampleFile, 'hello');

    const session = terminalService.create(1, 'bash', 80, 24, 'root', sampleFile);

    expect(session).toBeDefined();
    expect(mockSpawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ cwd: tempDir })
    );

    terminalService.kill(session.sessionId);
  });
});

