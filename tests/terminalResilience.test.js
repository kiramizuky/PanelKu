import { jest } from '@jest/globals';

let dataHandler = null;
let exitHandler = null;

const mockPty = {
  pid: 9999,
  write: jest.fn(),
  resize: jest.fn(),
  kill: jest.fn(),
  onData: jest.fn((cb) => { dataHandler = cb; }),
  onExit: jest.fn((cb) => { exitHandler = cb; }),
};

const mockSpawn = jest.fn(() => mockPty);

jest.unstable_mockModule('node-pty', () => ({
  default: { spawn: mockSpawn },
  spawn: mockSpawn,
}));

const { default: terminalService } = await import('../src/modules/terminal/terminal.service.js');

describe('Terminal Service Resilience (Batching, Detach & Reattach)', () => {
  beforeEach(() => {
    dataHandler = null;
    exitHandler = null;
    jest.clearAllMocks();
    terminalService.killAll();
  });

  afterAll(() => {
    terminalService.killAll();
  });

  test('batches rapid PTY output and replays only missed bytes on reattach', async () => {
    const { sessionId } = terminalService.create('user-1', 'bash', 80, 24);
    const received = [];
    const offData = terminalService.onData(sessionId, (chunk, offset) => {
      received.push({ chunk, offset });
    });

    // Simulate rapid PTY output while connected
    dataHandler('hello ');
    dataHandler('world\n');

    await new Promise((r) => setTimeout(r, 35));
    expect(received.length).toBe(1);
    expect(received[0].chunk).toBe('hello world\n');
    const offsetBeforeDisconnect = received[0].offset;

    // Simulate socket disconnect -> detach (does NOT kill PTY)
    offData();
    terminalService.detach(sessionId, 60000);
    expect(terminalService.exists(sessionId)).toBe(true);
    expect(mockPty.kill).not.toHaveBeenCalled();

    // Simulate background process continuing to emit output while disconnected
    dataHandler('progress 50%\n');
    dataHandler('progress 100%\n');
    await new Promise((r) => setTimeout(r, 35));

    // Reattach with last known offset
    const attached = terminalService.attach('non-existent', 'user-1', 0);
    expect(attached).toBeNull();

    const wrongUser = terminalService.attach(sessionId, 'other-user', 0);
    expect(wrongUser).toBeNull();

    const reattached = terminalService.attach(sessionId, 'user-1', offsetBeforeDisconnect);
    expect(reattached).not.toBeNull();
    expect(reattached.missedOutput).toBe('progress 50%\nprogress 100%\n');

    terminalService.kill(sessionId);
    expect(mockPty.kill).toHaveBeenCalledTimes(1);
  });

  test('clamps invalid resize dimensions and handles PTY exit cleanly', () => {
    const { sessionId } = terminalService.create('user-1', 'bash', 0, -5);
    expect(mockSpawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ cols: 80, rows: 1 })
    );

    terminalService.resize(sessionId, -5, 999);
    expect(mockPty.resize).toHaveBeenCalledWith(1, 200);

    const onExitMock = jest.fn();
    terminalService.onExit(sessionId, onExitMock);
    exitHandler({ exitCode: 0 });

    expect(onExitMock).toHaveBeenCalledWith({ exitCode: 0 });
    expect(terminalService.exists(sessionId)).toBe(false);
  });
});
