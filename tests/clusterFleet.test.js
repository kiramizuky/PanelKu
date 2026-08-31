/**
 * Tests for Cluster Fleet Management, 1-Click Pairing Token, and Remote Command Execution
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

// Mock external deps
jest.unstable_mockModule('../src/config/logger.js', () => ({
  default: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const { default: clusterService } = await import('../src/modules/cluster/cluster.service.js');
const { default: clusterController } = await import('../src/modules/cluster/cluster.controller.js');
const { getDb } = await import('../src/core/db/sqlite.js');

function fakeRes() {
  const res = {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
  };
  return res;
}

beforeEach(async () => {
  const db = getDb();
  db.prepare('DELETE FROM cluster_nodes').run();
});

describe('Cluster Fleet Capacity Aggregation', () => {
  test('getClusterFleetSummary aggregates master and remote node capacities', async () => {
    // Add 2 mock nodes in DB
    await clusterService.addNode('Edge-Node-01', '192.168.1.51', 23456, 'key1');
    await clusterService.addNode('Edge-Node-02', '192.168.1.52', 23456, 'key2');

    const summary = await clusterService.getClusterFleetSummary();

    expect(summary.totalNodes).toBe(3); // 1 Master + 2 Agents
    expect(summary.totalCores).toBeGreaterThanOrEqual(4);
    expect(summary.totalMemoryBytes).toBeGreaterThan(0);
    expect(Array.isArray(summary.fleetNodes)).toBe(true);
    expect(summary.fleetNodes).toHaveLength(2);
  });
});

describe('1-Click Pairing Token & Registration', () => {
  test('generatePairingToken creates 15-minute token with suggested name', () => {
    const res = clusterService.generatePairingToken('node-alpha');
    expect(res.token).toHaveLength(48); // 24 hex bytes
    expect(res.suggestedName).toBe('node-alpha');
    expect(res.expiresAt).toBeGreaterThan(Date.now());
  });

  test('registerNodeByToken registers new agent node and consumes token', async () => {
    const pairing = clusterService.generatePairingToken('edge-sgp');
    const node = await clusterService.registerNodeByToken({
      token: pairing.token,
      name: 'edge-sgp',
      ipAddress: '103.20.10.5',
      port: 23456,
      apiKey: 'sec-token-12345',
    });

    expect(node.name).toBe('edge-sgp');
    expect(node.ipAddress).toBe('103.20.10.5');

    // Token should now be consumed
    await expect(
      clusterService.registerNodeByToken({
        token: pairing.token,
        name: 'edge-sgp',
        ipAddress: '103.20.10.5',
        port: 23456,
        apiKey: 'sec-token-12345',
      })
    ).rejects.toThrow(/Invalid or expired pairing token/);
  });

  test('getAgentInstallScript produces executable bash with master url', () => {
    const script = clusterService.getAgentInstallScript('tok-abc', 'http://192.168.1.234:23456');
    expect(script).toContain('#!/usr/bin/env bash');
    expect(script).toContain('MASTER_URL="http://192.168.1.234:23456"');
    expect(script).toContain('PAIRING_TOKEN="tok-abc"');
    expect(script).toContain('/api/cluster/register-token');
  });
});

describe('Distributed Remote Command Dispatcher', () => {
  test('executeRemoteCommand runs command on master when specified', async () => {
    const results = await clusterService.executeRemoteCommand(['master'], 'echo "fleet testing"');
    expect(results).toHaveLength(1);
    expect(results[0].nodeId).toBe('master');
    expect(results[0].status).toBe('success');
    expect(results[0].exitCode).toBe(0);
    expect(results[0].stdout).toContain('fleet testing');
  });

  test('controller executeCommand returns results object', async () => {
    const req = {
      body: {
        nodeIds: ['master'],
        command: 'echo 123',
      },
    };
    const res = fakeRes();
    await clusterController.executeCommand(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          results: expect.any(Array),
        }),
      })
    );
  });
});
