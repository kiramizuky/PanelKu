/**
 * Extended Unit Tests for Cluster & K8s Module:
 * - src/modules/cluster/k8s.service.js
 * - src/modules/cluster/cluster.service.js
 * - src/modules/cluster/cluster.controller.js
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

const mockExecCmdHandlers = [];

jest.unstable_mockModule('../src/helpers/exec.js', () => ({
  execCmd: jest.fn(async (bin, args) => {
    const cmd = [bin, ...(args || [])].join(' ');
    for (const handler of mockExecCmdHandlers) {
      const match = handler(cmd);
      if (match !== undefined) {
        if (match instanceof Error) throw match;
        return match.stdout || '';
      }
    }
    return '';
  }),
  execShell: jest.fn(async () => ''),
}));

const mockDb = {
  prepare: jest.fn(),
};

jest.unstable_mockModule('../src/core/db/sqlite.js', () => ({
  getDb: () => mockDb,
  generateId: () => 'uuid-123',
  now: () => '2026-09-14 12:00:00',
  toJson: (v) => JSON.stringify(v),
  fromJson: (s) => JSON.parse(s),
}));

const mockFetch = jest.fn();
globalThis.fetch = mockFetch;

const { default: k8sService } = await import('../src/modules/cluster/k8s.service.js');
const { default: clusterService } = await import('../src/modules/cluster/cluster.service.js');
const { default: clusterController } = await import('../src/modules/cluster/cluster.controller.js');

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    send(data) {
      this.body = data;
      return this;
    },
    setHeader(k, v) {
      this.headers[k] = v;
      return this;
    },
  };
  return res;
}

beforeEach(() => {
  mockExecCmdHandlers.length = 0;
  k8sService._cli = null;
  jest.clearAllMocks();
});

describe('K8sService — Kubernetes & K3s Discovery', () => {
  test('detectCli identifies available kubectl binary', async () => {
    mockExecCmdHandlers.push(cmd => {
      if (cmd.includes('k3s kubectl')) return { stdout: '{"clientVersion":{"gitVersion":"v1.28.2+k3s1"}}' };
    });

    const cli = await k8sService.detectCli();
    expect(cli).toBe('k3s kubectl');
  });

  test('getClusterSummary returns not installed when no k8s cli is present', async () => {
    mockExecCmdHandlers.push(() => new Error('command not found'));

    const summary = await k8sService.getClusterSummary();
    expect(summary.installed).toBe(false);
    expect(summary.engine).toBe('none');
    expect(summary.nodes).toEqual([]);
  });

  test('getClusterSummary parses nodes, pods, and services', async () => {
    k8sService._cli = 'kubectl';

    mockExecCmdHandlers.push(cmd => {
      if (cmd.includes('get nodes')) {
        return {
          stdout: JSON.stringify({
            items: [
              {
                metadata: { name: 'node1', labels: { 'node-role.kubernetes.io/control-plane': 'true' } },
                status: { conditions: [{ type: 'Ready' }], nodeInfo: { kubeletVersion: 'v1.28.0', osImage: 'Ubuntu 24.04' } },
              },
            ],
          }),
        };
      }
      if (cmd.includes('get pods')) {
        return {
          stdout: JSON.stringify({
            items: [
              {
                metadata: { namespace: 'default', name: 'app-pod-1' },
                status: { phase: 'Running', podIP: '10.42.0.5', startTime: '2026-09-14T00:00:00Z' },
              },
            ],
          }),
        };
      }
      if (cmd.includes('get svc')) {
        return {
          stdout: JSON.stringify({
            items: [
              {
                metadata: { namespace: 'default', name: 'app-svc' },
                spec: { type: 'ClusterIP', clusterIP: '10.43.0.10', ports: [{ port: 80, protocol: 'TCP' }] },
              },
            ],
          }),
        };
      }
    });

    const summary = await k8sService.getClusterSummary();
    expect(summary.installed).toBe(true);
    expect(summary.nodeCount).toBe(1);
    expect(summary.podCount).toBe(1);
    expect(summary.serviceCount).toBe(1);
    expect(summary.nodes[0].name).toBe('node1');
    expect(summary.pods[0].name).toBe('app-pod-1');
    expect(summary.services[0].ports).toBe('80/TCP');
  });
});

describe('ClusterService — Node Operations & Ping', () => {
  test('pingNode returns online when agent responds and offline on network error', async () => {
    mockDb.prepare.mockImplementation(sql => {
      if (sql.includes('SELECT * FROM cluster_nodes WHERE id = ?')) {
        return { get: () => ({ id: 'n1', ip_address: '10.0.0.5', port: 23456, api_key: 'key123' }) };
      }
      return { run: jest.fn(), get: jest.fn() };
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'ok' }),
    });
    const online = await clusterService.pingNode('n1');
    expect(online).toBe('online');

    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
    const offline = await clusterService.pingNode('n1');
    expect(offline).toBe('offline');
  });

  test('getNodeMetrics fetches telemetry from agent endpoint', async () => {
    mockDb.prepare.mockImplementation(sql => {
      if (sql.includes('SELECT * FROM cluster_nodes WHERE id = ?')) {
        return { get: () => ({ id: 'n1', ip_address: '10.0.0.5', port: 23456, api_key: 'key123' }) };
      }
      return { run: jest.fn(), get: jest.fn() };
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { cpu: 15, ram: 45 } }),
    });
    const metrics = await clusterService.getNodeMetrics('n1');
    expect(metrics).toEqual({ cpu: 15, ram: 45 });

    mockFetch.mockRejectedValueOnce(new Error('timeout'));
    const fallback = await clusterService.getNodeMetrics('n1');
    expect(fallback).toBeNull();
  });
});

describe('ClusterController — Endpoints', () => {
  test('getNodes, addNode, deleteNode, pingNode, getNodeMetrics', async () => {
    jest.spyOn(clusterService, 'getNodes').mockResolvedValue([{ id: 'n1', name: 'Agent1' }]);
    jest.spyOn(clusterService, 'addNode').mockResolvedValue({ id: 'n2', name: 'Agent2' });
    jest.spyOn(clusterService, 'deleteNode').mockResolvedValue(undefined);
    jest.spyOn(clusterService, 'pingNode').mockResolvedValue('online');
    jest.spyOn(clusterService, 'getNodeMetrics').mockResolvedValue({ cpu: 10 });

    const res1 = mockRes();
    await clusterController.getNodes({}, res1);
    expect(res1.statusCode).toBe(200);
    expect(res1.body.data).toHaveLength(1);

    const res2Err = mockRes();
    await clusterController.addNode({ body: { name: 'n2' } }, res2Err);
    expect(res2Err.statusCode).toBe(400);

    const res2 = mockRes();
    await clusterController.addNode({ body: { name: 'Agent2', ipAddress: '1.2.3.4', port: 23456, apiKey: 'abc' } }, res2);
    expect(res2.statusCode).toBe(200);

    const res3 = mockRes();
    await clusterController.deleteNode({ params: { id: 'n2' } }, res3);
    expect(res3.statusCode).toBe(200);

    const res4 = mockRes();
    await clusterController.pingNode({ params: { id: 'n1' } }, res4);
    expect(res4.statusCode).toBe(200);
    expect(res4.body.data.status).toBe('online');

    const res5 = mockRes();
    await clusterController.getNodeMetrics({ params: { id: 'n1' } }, res5);
    expect(res5.statusCode).toBe(200);
  });

  test('getFleetSummary, generatePairingToken, registerNodeByToken, getInstallScript, executeCommand, getK8sSummary', async () => {
    jest.spyOn(clusterService, 'getClusterFleetSummary').mockResolvedValue({ totalNodes: 2 });
    jest.spyOn(clusterService, 'generatePairingToken').mockReturnValue({ token: 'tok123', expiresAt: 12345 });
    jest.spyOn(clusterService, 'registerNodeByToken').mockResolvedValue({ id: 'n1', name: 'node' });
    jest.spyOn(clusterService, 'getAgentInstallScript').mockReturnValue('#!/bin/bash\necho install');
    jest.spyOn(clusterService, 'executeRemoteCommand').mockResolvedValue([{ nodeId: 'master', status: 'success' }]);
    jest.spyOn(k8sService, 'getClusterSummary').mockResolvedValue({ installed: true });

    const resFleet = mockRes();
    await clusterController.getFleetSummary({}, resFleet);
    expect(resFleet.statusCode).toBe(200);

    const resTok = mockRes();
    await clusterController.generatePairingToken({ body: { suggestedName: 'my-node' }, get: () => 'localhost:23456' }, resTok);
    expect(resTok.statusCode).toBe(200);
    expect(resTok.body.data.token).toBe('tok123');

    const resRegErr = mockRes();
    await clusterController.registerNodeByToken({ body: {} }, resRegErr);
    expect(resRegErr.statusCode).toBe(400);

    const resReg = mockRes();
    await clusterController.registerNodeByToken({ body: { token: 'tok123', ipAddress: '1.2.3.4', apiKey: 'key' } }, resReg);
    expect(resReg.statusCode).toBe(200);

    const resScript = mockRes();
    await clusterController.getInstallScript({ query: { token: 'tok123' }, get: () => 'localhost:23456' }, resScript);
    expect(resScript.body).toContain('#!/bin/bash');

    const resExecErr = mockRes();
    await clusterController.executeCommand({ body: {} }, resExecErr);
    expect(resExecErr.statusCode).toBe(400);

    const resExec = mockRes();
    await clusterController.executeCommand({ body: { nodeIds: ['master'], command: 'uptime' } }, resExec);
    expect(resExec.statusCode).toBe(200);

    const resK8s = mockRes();
    await clusterController.getK8sSummary({}, resK8s);
    expect(resK8s.statusCode).toBe(200);
  });
});
