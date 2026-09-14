/**
 * Comprehensive Unit Tests for WebSockets:
 * - src/websocket/index.js
 * - src/websocket/monitor.ws.js
 * - src/websocket/notifications.ws.js
 * - src/websocket/terminal.ws.js
 * - src/websocket/docker.ws.js
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import jwt from 'jsonwebtoken';
import eventBus, { EVENTS } from '../src/core/events/EventBus.js';

const mockUserRepository = {
  findById: jest.fn(),
};

jest.unstable_mockModule('../src/repositories/user.repository.js', () => ({
  default: mockUserRepository,
}));

const mockMonitorService = {
  getCurrent: jest.fn().mockResolvedValue({ cpu: 20 }),
};

jest.unstable_mockModule('../src/modules/monitor/monitor.service.js', () => ({
  default: mockMonitorService,
}));

const mockNotificationModel = {
  find: jest.fn(),
  create: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  updateMany: jest.fn(),
};

jest.unstable_mockModule('../src/models/Notification.js', () => ({
  default: mockNotificationModel,
}));

const mockTerminalService = {
  create: jest.fn().mockReturnValue({ sessionId: 'sess-123' }),
  onData: jest.fn(),
  onExit: jest.fn(),
  write: jest.fn(),
  resize: jest.fn(),
  kill: jest.fn(),
};

jest.unstable_mockModule('../src/modules/terminal/terminal.service.js', () => ({
  default: mockTerminalService,
}));

const mockDockerService = {
  docker: {
    getContainer: jest.fn(() => ({
      exec: jest.fn().mockResolvedValue({
        start: jest.fn().mockResolvedValue({
          on: jest.fn(),
          destroy: jest.fn(),
          write: jest.fn(),
        }),
      }),
      logs: jest.fn().mockResolvedValue({
        on: jest.fn(),
        destroy: jest.fn(),
      }),
      stats: jest.fn().mockResolvedValue({
        on: jest.fn(),
        destroy: jest.fn(),
      }),
    })),
  },
};

jest.unstable_mockModule('../src/modules/docker/docker.service.js', () => ({
  default: mockDockerService,
}));

const mockPermissionManager = {
  userCan: jest.fn().mockReturnValue(true),
};

jest.unstable_mockModule('../src/core/permissions/PermissionManager.js', () => ({
  default: mockPermissionManager,
}));

const { initWebSocket } = await import('../src/websocket/index.js');
const { registerMonitorSocket } = await import('../src/websocket/monitor.ws.js');
const { registerNotificationSocket } = await import('../src/websocket/notifications.ws.js');
const { registerTerminalSocket } = await import('../src/websocket/terminal.ws.js');
const { registerDockerSocket } = await import('../src/websocket/docker.ws.js');
const { default: appConfig } = await import('../src/config/app.js');

function createMockNamespace() {
  const listeners = new Map();
  const ns = {
    use: jest.fn(),
    on: jest.fn((event, handler) => {
      listeners.set(event, handler);
    }),
    emit: jest.fn(),
    sockets: new Map(),
    trigger(event, ...args) {
      const h = listeners.get(event);
      if (h) return h(...args);
    },
  };
  return ns;
}

function createMockSocket(user = { _id: 'u1', username: 'admin', isActive: true }) {
  const eventHandlers = new Map();
  return {
    id: 'sock-1',
    user,
    userId: String(user._id),
    handshake: { auth: {}, headers: {} },
    join: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
    on: jest.fn((event, handler) => {
      eventHandlers.set(event, handler);
    }),
    trigger(event, ...args) {
      const h = eventHandlers.get(event);
      if (h) return h(...args);
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('WebSocket Root & Auth Initialization', () => {
  test('initWebSocket registers namespaces and global auth middleware', async () => {
    const namespaces = new Map();
    let authMiddleware = null;

    const mockIo = {
      use: jest.fn((fn) => { authMiddleware = fn; }),
      of: jest.fn((name) => {
        const ns = createMockNamespace();
        namespaces.set(name, ns);
        return ns;
      }),
      on: jest.fn(),
    };

    initWebSocket(mockIo);

    expect(mockIo.use).toHaveBeenCalled();
    expect(namespaces.has('/monitor')).toBe(true);
    expect(namespaces.has('/terminal')).toBe(true);
    expect(namespaces.has('/notifications')).toBe(true);
    expect(namespaces.has('/docker')).toBe(true);

    // Test authMiddleware with no token -> Error
    const nextNoToken = jest.fn();
    await authMiddleware({ handshake: { auth: {}, headers: {} } }, nextNoToken);
    expect(nextNoToken).toHaveBeenCalledWith(expect.any(Error));

    // Test authMiddleware with valid token
    const token = jwt.sign({ sub: 'u1' }, appConfig.jwt.secret);
    mockUserRepository.findById.mockResolvedValue({ _id: 'u1', username: 'tester', isActive: true });

    const socketWithToken = { handshake: { auth: { token } } };
    const nextSuccess = jest.fn();
    await authMiddleware(socketWithToken, nextSuccess);
    expect(nextSuccess).toHaveBeenCalledWith();
    expect(socketWithToken.userId).toBe('u1');
  });
});

describe('Monitor WebSocket Namespace', () => {
  test('handles connection, client request:metrics, and system alert forward', async () => {
    const ns = createMockNamespace();
    registerMonitorSocket(ns);

    const socket = createMockSocket();
    ns.trigger('connection', socket);

    // Request metrics
    await socket.trigger('request:metrics');
    expect(socket.emit).toHaveBeenCalledWith('metrics', { cpu: 20 });

    // Broadcast system alert via EventBus
    eventBus.publish(EVENTS.SYSTEM_ALERT, { type: 'cpu', value: 95 });
    expect(ns.emit).toHaveBeenCalledWith('system:alert', expect.objectContaining({ type: 'cpu' }));

    // Disconnect
    socket.trigger('disconnect');
  });
});

describe('Notifications WebSocket Namespace', () => {
  test('sends unread notifications and marks notifications read', async () => {
    const ns = createMockNamespace();
    registerNotificationSocket(ns);

    mockNotificationModel.find.mockResolvedValue([
      { id: 'n1', isRead: false, title: 'Alert 1' },
      { id: 'n2', isRead: true, title: 'Alert 2' },
    ]);

    const socket = createMockSocket();
    await ns.trigger('connection', socket);
    expect(socket.emit).toHaveBeenCalledWith('notifications:unread', expect.any(Array));

    // Mark single notification as read
    await socket.trigger('notification:read', { notificationId: 'n1' });
    expect(mockNotificationModel.findByIdAndUpdate).toHaveBeenCalledWith('n1', { isRead: true });
    expect(socket.emit).toHaveBeenCalledWith('notification:marked_read', { notificationId: 'n1' });

    // Mark all as read
    await socket.trigger('notifications:read_all');
    expect(mockNotificationModel.updateMany).toHaveBeenCalledWith({ userId: 'u1' }, { isRead: true });
    expect(socket.emit).toHaveBeenCalledWith('notifications:all_read');

    socket.trigger('disconnect');
  });
});

describe('Terminal WebSocket Namespace', () => {
  test('creates local PTY session, receives input, resizes, and kills session', () => {
    const ns = createMockNamespace();
    registerTerminalSocket(ns);

    const socket = createMockSocket();
    ns.trigger('connection', socket);

    // Create terminal
    socket.trigger('terminal:create', { shell: 'bash', cols: 80, rows: 24 });
    expect(mockTerminalService.create).toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('terminal:created', { sessionId: 'sess-123' });

    // Input
    socket.trigger('terminal:input', { sessionId: 'sess-123', data: 'ls\r' });
    expect(mockTerminalService.write).toHaveBeenCalledWith('sess-123', 'ls\r');

    // Resize
    socket.trigger('terminal:resize', { sessionId: 'sess-123', cols: 100, rows: 30 });
    expect(mockTerminalService.resize).toHaveBeenCalledWith('sess-123', 100, 30);

    // Kill
    socket.trigger('terminal:kill', { sessionId: 'sess-123' });
    expect(mockTerminalService.kill).toHaveBeenCalledWith('sess-123');
  });
});

describe('Docker WebSocket Namespace', () => {
  test('checks permission and disconnects unauthorized socket', async () => {
    const ns = createMockNamespace();
    registerDockerSocket(ns);

    mockPermissionManager.userCan.mockReturnValue(false);
    const socket = createMockSocket();
    await ns.trigger('connection', socket);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  test('executes container exec and streams data when authorized', async () => {
    const ns = createMockNamespace();
    registerDockerSocket(ns);

    mockPermissionManager.userCan.mockReturnValue(true);
    const socket = createMockSocket();
    await ns.trigger('connection', socket);

    await socket.trigger('exec:create', { containerId: 'web-container', shell: 'bash' });
    expect(mockDockerService.docker.getContainer).toHaveBeenCalledWith('web-container');

    // Invalid container ID throws error emitted to socket
    await socket.trigger('exec:create', { containerId: '../escape', shell: 'bash' });
    expect(socket.emit).toHaveBeenCalledWith('exec:error', expect.any(String));
  });
});

describe('Agent Terminal WebSocket', () => {
  test('handleAgentTerminalUpgrade is exported and callable', async () => {
    const { handleAgentTerminalUpgrade } = await import('../src/websocket/agent-terminal.ws.js');
    expect(typeof handleAgentTerminalUpgrade).toBe('function');
  });
});

