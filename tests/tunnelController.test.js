/**
 * Tunnel & Extra Apps Controller Unit Tests
 *
 * @jest-environment node
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

const mockContainer = {
  Id: 'c123456789012345',
  Names: ['/cloudflare-tunnel'],
  State: 'running',
  Status: 'Up 2 hours',
  Image: 'cloudflare/cloudflared:latest',
  Ports: [{ PublicPort: 5678 }],
  start: jest.fn(async () => {}),
  stop: jest.fn(async () => {}),
  remove: jest.fn(async () => {}),
};

const mockDocker = {
  listContainers: jest.fn(async () => [mockContainer]),
  getContainer: jest.fn(() => mockContainer),
  getImage: jest.fn(() => ({ inspect: jest.fn(async () => ({})) })),
  createContainer: jest.fn(async () => mockContainer),
  pull: jest.fn((img, cb) => cb(null, {})),
  modem: { followProgress: jest.fn((s, cb) => cb(null, {})) },
};

jest.unstable_mockModule('dockerode', () => ({
  default: jest.fn(() => mockDocker),
}));

const { default: tunnelController } = await import('../src/modules/system/tunnel.controller.js');

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(d) {
      this.body = d;
      return this;
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('TunnelAndAppsController - Cloudflare Tunnel', () => {
  test('getCloudflareStatus returns running state when container is present', async () => {
    mockDocker.listContainers.mockResolvedValueOnce([mockContainer]);
    const res = mockRes();
    await tunnelController.getCloudflareStatus({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.status).toBe('running');
    expect(res.body.data.info.id).toBe('c12345678901');
  });

  test('getCloudflareStatus returns not_installed when container is missing', async () => {
    mockDocker.listContainers.mockResolvedValueOnce([]);
    const res = mockRes();
    await tunnelController.getCloudflareStatus({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.status).toBe('not_installed');
  });

  test('getCloudflareStatus returns docker_not_running if listContainers throws', async () => {
    mockDocker.listContainers.mockRejectedValueOnce(new Error('daemon down'));
    const res = mockRes();
    await tunnelController.getCloudflareStatus({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.status).toBe('docker_not_running');
  });

  test('startCloudflare validates token parameter', async () => {
    const res = mockRes();
    await tunnelController.startCloudflare({ body: {} }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('startCloudflare pulls image, stops old container and creates new one', async () => {
    mockDocker.listContainers.mockResolvedValueOnce([mockContainer]);
    const req = { body: { token: 'cf-tunnel-token-secret' } };
    const res = mockRes();
    await tunnelController.startCloudflare(req, res);
    expect(res.statusCode).toBe(200);
    expect(mockContainer.stop).toHaveBeenCalled();
    expect(mockContainer.remove).toHaveBeenCalled();
    expect(mockDocker.createContainer).toHaveBeenCalled();
  });

  test('stopCloudflare stops and removes container', async () => {
    mockDocker.listContainers.mockResolvedValueOnce([mockContainer]);
    const res = mockRes();
    await tunnelController.stopCloudflare({}, res);
    expect(res.statusCode).toBe(200);
    expect(mockContainer.stop).toHaveBeenCalled();
    expect(mockContainer.remove).toHaveBeenCalled();
  });

  test('stopCloudflare returns 404 if tunnel container not found', async () => {
    mockDocker.listContainers.mockResolvedValueOnce([]);
    const res = mockRes();
    await tunnelController.stopCloudflare({}, res);
    expect(res.statusCode).toBe(404);
  });
});

describe('TunnelAndAppsController - n8n Automation', () => {
  const n8nContainer = {
    Id: 'n8n1234567890123',
    Names: ['/n8n-container'],
    State: 'running',
    Status: 'Up 1 day',
    Ports: [{ HostPort: '5678' }],
    start: jest.fn(async () => {}),
    stop: jest.fn(async () => {}),
    remove: jest.fn(async () => {}),
  };

  test('getN8nStatus returns container info', async () => {
    mockDocker.listContainers.mockResolvedValueOnce([n8nContainer]);
    const res = mockRes();
    await tunnelController.getN8nStatus({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.status).toBe('running');
  });

  test('getN8nStatus returns not_installed when not present', async () => {
    mockDocker.listContainers.mockResolvedValueOnce([]);
    const res = mockRes();
    await tunnelController.getN8nStatus({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.status).toBe('not_installed');
  });

  test('startN8n starts existing container or creates new one', async () => {
    // Case 1: Existing container not running -> starts it
    const stoppedContainer = { ...n8nContainer, State: 'exited', start: jest.fn(async () => {}) };
    mockDocker.listContainers.mockResolvedValueOnce([stoppedContainer]);
    mockDocker.getContainer.mockReturnValueOnce(stoppedContainer);
    const res1 = mockRes();
    await tunnelController.startN8n({}, res1);
    expect(res1.statusCode).toBe(200);
    expect(stoppedContainer.start).toHaveBeenCalled();

    // Case 2: New container creation
    mockDocker.listContainers.mockResolvedValueOnce([]);
    const res2 = mockRes();
    await tunnelController.startN8n({}, res2);
    expect(res2.statusCode).toBe(200);
    expect(mockDocker.createContainer).toHaveBeenCalled();
  });

  test('stopN8n stops container or returns 404', async () => {
    mockDocker.listContainers.mockResolvedValueOnce([n8nContainer]);
    mockDocker.getContainer.mockReturnValueOnce(n8nContainer);
    const res = mockRes();
    await tunnelController.stopN8n({}, res);
    expect(res.statusCode).toBe(200);
    expect(n8nContainer.stop).toHaveBeenCalled();

    mockDocker.listContainers.mockResolvedValueOnce([]);
    const notFoundRes = mockRes();
    await tunnelController.stopN8n({}, notFoundRes);
    expect(notFoundRes.statusCode).toBe(404);
  });

  test('uninstallN8n removes container or returns 404', async () => {
    mockDocker.listContainers.mockResolvedValueOnce([n8nContainer]);
    mockDocker.getContainer.mockReturnValueOnce(n8nContainer);
    const res = mockRes();
    await tunnelController.uninstallN8n({}, res);
    expect(res.statusCode).toBe(200);
    expect(n8nContainer.remove).toHaveBeenCalled();

    mockDocker.listContainers.mockResolvedValueOnce([]);
    const notFoundRes = mockRes();
    await tunnelController.uninstallN8n({}, notFoundRes);
    expect(notFoundRes.statusCode).toBe(404);
  });
});
