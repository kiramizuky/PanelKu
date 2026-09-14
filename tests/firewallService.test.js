/**
 * Unit tests for Firewall Module:
 * - src/modules/firewall/firewall.service.js
 * - src/modules/firewall/firewall.controller.js
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

const { default: firewallService } = await import('../src/modules/firewall/firewall.service.js');
const { default: firewallController } = await import('../src/modules/firewall/firewall.controller.js');

function createMockRes() {
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

describe('FirewallService — Input Validation', () => {
  test('validates port range (1-65535)', () => {
    expect(firewallService._validatePort(80)).toBe(80);
    expect(firewallService._validatePort('443')).toBe(443);
    expect(firewallService._validatePort(65535)).toBe(65535);

    expect(() => firewallService._validatePort(0)).toThrow('Invalid port');
    expect(() => firewallService._validatePort(70000)).toThrow('Invalid port');
    expect(() => firewallService._validatePort('abc')).toThrow('Invalid port');
  });

  test('validates protocol (tcp / udp)', () => {
    expect(firewallService._validateProtocol('tcp')).toBe('tcp');
    expect(firewallService._validateProtocol('UDP')).toBe('udp');
    expect(firewallService._validateProtocol(null)).toBe('tcp');

    expect(() => firewallService._validateProtocol('icmp')).toThrow('Invalid protocol');
  });

  test('validates action (allow / deny / reject / limit)', () => {
    expect(firewallService._validateAction('allow')).toBe('allow');
    expect(firewallService._validateAction('DENY')).toBe('deny');
    expect(firewallService._validateAction('reject')).toBe('reject');
    expect(firewallService._validateAction('limit')).toBe('limit');

    expect(() => firewallService._validateAction('drop')).toThrow('Invalid action');
  });

  test('validates rule ID', () => {
    expect(firewallService._validateRuleId(1)).toBe('1');
    expect(firewallService._validateRuleId('12')).toBe('12');

    expect(() => firewallService._validateRuleId(0)).toThrow('Invalid rule ID');
    expect(() => firewallService._validateRuleId(-3)).toThrow('Invalid rule ID');
    expect(() => firewallService._validateRuleId('bad')).toThrow('Invalid rule ID');
  });
});

describe('FirewallService — Status & Operations', () => {
  test('getStatus parses active UFW status and rules', async () => {
    const status = await firewallService.getStatus();
    expect(status.isActive).toBe(true);
    expect(Array.isArray(status.rules)).toBe(true);
    expect(status.rules.length).toBeGreaterThan(0);
    expect(status.rules[0]).toHaveProperty('id');
    expect(status.rules[0]).toHaveProperty('to');
    expect(status.rules[0]).toHaveProperty('action');
  });

  test('enable and disable execute without throwing', async () => {
    await expect(firewallService.enable()).resolves.toBe(true);
    await expect(firewallService.disable()).resolves.toBe(true);
  });

  test('addRule validates inputs and succeeds', async () => {
    await expect(firewallService.addRule(8080, 'tcp', 'allow')).resolves.toBe(true);
    await expect(firewallService.addRule('invalid')).rejects.toThrow();
  });

  test('deleteRule validates id and succeeds', async () => {
    await expect(firewallService.deleteRule(2)).resolves.toBe(true);
    await expect(firewallService.deleteRule('invalid')).rejects.toThrow();
  });
});

describe('FirewallController', () => {
  test('getStatus sends active rules to response', async () => {
    const req = {};
    const res = createMockRes();

    await firewallController.getStatus(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isActive).toBe(true);
  });

  test('toggleStatus enables or disables firewall based on body.enable', async () => {
    const reqEnable = { body: { enable: true } };
    const resEnable = createMockRes();
    await firewallController.toggleStatus(reqEnable, resEnable);
    expect(resEnable.statusCode).toBe(200);
    expect(resEnable.body.message).toContain('enabled');

    const reqDisable = { body: { enable: false } };
    const resDisable = createMockRes();
    await firewallController.toggleStatus(reqDisable, resDisable);
    expect(resDisable.statusCode).toBe(200);
    expect(resDisable.body.message).toContain('disabled');
  });

  test('addRule rejects missing port with 400', async () => {
    const req = { body: {} };
    const res = createMockRes();

    await firewallController.addRule(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('addRule succeeds with valid port', async () => {
    const req = { body: { port: 8443, protocol: 'tcp', action: 'allow' } };
    const res = createMockRes();

    await firewallController.addRule(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('deleteRule deletes by rule ID param', async () => {
    const req = { params: { id: '3' } };
    const res = createMockRes();

    await firewallController.deleteRule(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
