/**
 * Tests for CrowdSec, Honeypot Bot Trap, and Advanced WAF Core Rule Sets
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

// Mock external deps
jest.unstable_mockModule('../src/config/logger.js', () => ({
  default: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.unstable_mockModule('child_process', () => ({
  exec: jest.fn((cmd, ...rest) => {
    const cb = rest.pop();
    if (typeof cb !== 'function') return;
    cb(null, { stdout: 'version: 1.6.0', stderr: '' });
  }),
}));

const { default: crowdsecService } = await import('../src/modules/waf/crowdsec.service.js');
const { default: wafService } = await import('../src/modules/waf/waf.service.js');
const { default: wafController } = await import('../src/modules/waf/waf.controller.js');
const { wafMiddleware, refreshWafCache } = await import('../src/middleware/waf.middleware.js');
const { exec } = await import('child_process');

function fakeRes() {
  const res = {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res;
}

beforeEach(async () => {
  exec.mockClear();
  await wafService.clearHoneypotHits();
  await refreshWafCache();
});

describe('CrowdSec Threat Intelligence Service', () => {
  test('getStatus returns installed and running status with metrics', async () => {
    const status = await crowdsecService.getStatus();
    expect(status.installed).toBe(true);
    expect(status.running).toBe(true);
    expect(status.communityBlocklistCount).toBeGreaterThan(0);
    expect(Array.isArray(status.bouncers)).toBe(true);
  });

  test('getDecisions returns list of active IP bans', async () => {
    const decisions = await crowdsecService.getDecisions();
    expect(Array.isArray(decisions)).toBe(true);
    expect(decisions.length).toBeGreaterThan(0);
  });

  test('addDecision bans IP and persists to WAF rules', async () => {
    const result = await crowdsecService.addDecision('198.51.100.77', '24h', 'Brute force');
    expect(result.success).toBe(true);
    expect(result.ip).toBe('198.51.100.77');
  });

  test('addDecision rejects invalid IP formats', async () => {
    await expect(crowdsecService.addDecision('invalid-ip')).rejects.toThrow(/Invalid IP address/);
  });

  test('deleteDecision removes ban for IP', async () => {
    await crowdsecService.addDecision('198.51.100.88', '24h', 'Test ban');
    const result = await crowdsecService.deleteDecision('198.51.100.88');
    expect(result.success).toBe(true);
    expect(result.ip).toBe('198.51.100.88');
  });

  test('syncCommunityBlocklist executes hub sync', async () => {
    const syncRes = await crowdsecService.syncCommunityBlocklist();
    expect(syncRes.success).toBe(true);
  });
});

describe('Honeypot Bot Trap Engine', () => {
  test('getHoneypotTraps returns monitored trap list', () => {
    const traps = wafService.getHoneypotTraps();
    expect(traps).toContain('/.env');
    expect(traps).toContain('/wp-login.php');
    expect(traps).toContain('/phpmyadmin');
  });

  test('recordHoneypotHit logs trap probe and auto-blacklists IP', async () => {
    await wafService.recordHoneypotHit({
      ip: '198.51.100.99',
      path: '/.env',
      userAgent: 'Mozilla/5.0 Bot',
      payload: 'probe',
    });

    const hits = await wafService.getHoneypotHits();
    expect(hits).toHaveLength(1);
    expect(hits[0].ip).toBe('198.51.100.99');
    expect(hits[0].path).toBe('/.env');
  });

  test('clearHoneypotHits clears all recorded hits', async () => {
    await wafService.recordHoneypotHit({ ip: '1.2.3.4', path: '/.git/HEAD' });
    await wafService.clearHoneypotHits();
    const hits = await wafService.getHoneypotHits();
    expect(hits).toHaveLength(0);
  });
});

describe('WAF Middleware Interceptors', () => {
  test('intercepts honeypot trap requests with 403 and auto-bans IP', async () => {
    const req = {
      ip: '203.0.113.123',
      path: '/.env',
      headers: { 'user-agent': 'masscan/1.0' },
      query: {},
      body: {},
    };
    const res = fakeRes();
    const next = jest.fn();

    await wafMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining('Forbidden'));
    expect(next).not.toHaveBeenCalled();

    // Verify subsequent request from same IP is blocked by blacklist
    const req2 = {
      ip: '203.0.113.123',
      path: '/api/dashboard',
      headers: {},
      query: {},
      body: {},
    };
    const res2 = fakeRes();
    const next2 = jest.fn();
    await wafMiddleware(req2, res2, next2);
    expect(res2.status).toHaveBeenCalledWith(403);
  });

  test('blocks malicious scanner user-agents (sqlmap, nikto, masscan)', async () => {
    const req = {
      ip: '198.51.100.5',
      path: '/api/info',
      headers: { 'user-agent': 'sqlmap/1.4.11#stable' },
      query: {},
      body: {},
    };
    const res = fakeRes();
    const next = jest.fn();

    await wafMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining('scanner'));
    expect(next).not.toHaveBeenCalled();
  });

  test('blocks Remote Code Execution (RCE) payloads', async () => {
    const req = {
      ip: '198.51.100.6',
      path: '/api/test',
      headers: {},
      query: { cmd: '; cat /etc/passwd' },
      body: {},
    };
    const res = fakeRes();
    const next = jest.fn();

    await wafMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining('Remote Code Execution'));
    expect(next).not.toHaveBeenCalled();
  });
});

describe('1-Click System Hardening', () => {
  test('applySystemHardening applies security posture rules', async () => {
    const result = await wafService.applySystemHardening();
    expect(result.success).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(Array.isArray(result.actionsTaken)).toBe(true);
  });

  test('controller harden endpoint returns 200', async () => {
    const res = fakeRes();
    await wafController.applySystemHardening({}, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: expect.objectContaining({ score: expect.any(Number) }) })
    );
  });
});
