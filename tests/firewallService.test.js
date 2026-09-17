/**
 * FirewallService — Unit tests for UFW operations and validation helpers
 *
 * Uses native ESM + jest.unstable_mockModule pattern.
 * child_process is mocked to simulate UFW responses.
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

// ── Mocks ──
jest.unstable_mockModule('../src/config/logger.js', () => ({
  default: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.unstable_mockModule('child_process', () => ({
  execFile: jest.fn((bin, args, opts, cb) => {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    const argsStr = args.join(' ');
    let stdout = '';

    if (argsStr.includes('status numbered')) {
      stdout = `Status: active

     To                         Action      From
     --                         ------      ----
[ 1] 22/tcp                     ALLOW IN    Anywhere
[ 2] 80/tcp                     ALLOW IN    Anywhere
[ 3] 443/tcp                    ALLOW IN    Anywhere
`;
    } else if (argsStr.includes('status')) {
      stdout = 'Status: active';
    } else if (argsStr.includes('enable')) {
      stdout = 'Firewall is active and enabled on system startup';
    } else if (argsStr.includes('disable')) {
      stdout = 'Firewall stopped and disabled on system startup';
    } else if (argsStr.includes('delete')) {
      stdout = 'Rule deleted';
    } else {
      stdout = 'Rule added';
    }

    if (typeof cb === 'function') cb(null, { stdout, stderr: '' });
    return { kill: jest.fn() };
  }),
}));

const { default: firewallService } = await import('../src/modules/firewall/firewall.service.js');

beforeEach(() => {
  jest.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════
//  VALIDATION HELPERS
// ═══════════════════════════════════════════════════════════

describe('FirewallService — Validation Helpers', () => {
  describe('_validatePort', () => {
    test('accepts valid ports', () => {
      expect(firewallService._validatePort(22)).toBe(22);
      expect(firewallService._validatePort(80)).toBe(80);
      expect(firewallService._validatePort(443)).toBe(443);
      expect(firewallService._validatePort(65535)).toBe(65535);
      expect(firewallService._validatePort('80')).toBe(80);
    });

    test('rejects invalid ports', () => {
      expect(() => firewallService._validatePort(0)).toThrow(/Invalid port/);
      expect(() => firewallService._validatePort(-1)).toThrow(/Invalid port/);
      expect(() => firewallService._validatePort(65536)).toThrow(/Invalid port/);
      expect(() => firewallService._validatePort('abc')).toThrow(/Invalid port/);
      expect(() => firewallService._validatePort('')).toThrow(/Invalid port/);
    });
  });

  describe('_validateProtocol', () => {
    test('accepts valid protocols', () => {
      expect(firewallService._validateProtocol('tcp')).toBe('tcp');
      expect(firewallService._validateProtocol('udp')).toBe('udp');
      expect(firewallService._validateProtocol('TCP')).toBe('tcp');
      expect(firewallService._validateProtocol('UDP')).toBe('udp');
      expect(firewallService._validateProtocol(null)).toBe('tcp'); // default
      expect(firewallService._validateProtocol(undefined)).toBe('tcp');
    });

    test('rejects invalid protocols', () => {
      expect(() => firewallService._validateProtocol('icmp')).toThrow(/Invalid protocol/);
      expect(() => firewallService._validateProtocol('all')).toThrow(/Invalid protocol/);
    });
  });

  describe('_validateAction', () => {
    test('accepts valid actions', () => {
      expect(firewallService._validateAction('allow')).toBe('allow');
      expect(firewallService._validateAction('deny')).toBe('deny');
      expect(firewallService._validateAction('reject')).toBe('reject');
      expect(firewallService._validateAction('limit')).toBe('limit');
      expect(firewallService._validateAction('ALLOW')).toBe('allow');
    });

    test('rejects invalid actions', () => {
      expect(() => firewallService._validateAction('block')).toThrow(/Invalid action/);
      expect(() => firewallService._validateAction('accept')).toThrow(/Invalid action/);
    });

    test('defaults to allow when null', () => {
      expect(firewallService._validateAction(null)).toBe('allow');
    });
  });

  describe('_validateRuleId', () => {
    test('accepts valid rule IDs', () => {
      expect(firewallService._validateRuleId(1)).toBe('1');
      expect(firewallService._validateRuleId(10)).toBe('10');
      expect(firewallService._validateRuleId('5')).toBe('5');
    });

    test('rejects invalid rule IDs', () => {
      expect(() => firewallService._validateRuleId(0)).toThrow(/Invalid rule ID/);
      expect(() => firewallService._validateRuleId(-1)).toThrow(/Invalid rule ID/);
      expect(() => firewallService._validateRuleId('abc')).toThrow(/Invalid rule ID/);
      expect(() => firewallService._validateRuleId('')).toThrow(/Invalid rule ID/);
    });
  });
});

// ═══════════════════════════════════════════════════════════
//  UFW OPERATIONS
// ═══════════════════════════════════════════════════════════

describe('FirewallService — UFW Operations', () => {
  test('getStatus returns firewall status with rules', async () => {
    const result = await firewallService.getStatus();
    expect(result.isActive).toBe(true);
    expect(Array.isArray(result.rules)).toBe(true);
    expect(result.rules.length).toBeGreaterThan(0);
    expect(result.rules[0]).toHaveProperty('id');
    expect(result.rules[0]).toHaveProperty('to');
    expect(result.rules[0]).toHaveProperty('action');
  });

  test('enable activates the firewall', async () => {
    const result = await firewallService.enable();
    expect(result).toBe(true);
  });

  test('disable deactivates the firewall', async () => {
    const result = await firewallService.disable();
    expect(result).toBe(true);
  });

  test('addRule adds a firewall rule', async () => {
    const result = await firewallService.addRule(8080, 'tcp', 'allow');
    expect(result).toBe(true);
  });

  test('addRule rejects invalid port', async () => {
    await expect(firewallService.addRule(99999))
      .rejects.toThrow(/Invalid port/);
  });

  test('addRule rejects invalid protocol', async () => {
    await expect(firewallService.addRule(80, 'icmp'))
      .rejects.toThrow(/Invalid protocol/);
  });

  test('addRule rejects invalid action', async () => {
    await expect(firewallService.addRule(80, 'tcp', 'block'))
      .rejects.toThrow(/Invalid action/);
  });

  test('deleteRule deletes a firewall rule', async () => {
    const result = await firewallService.deleteRule(1);
    expect(result).toBe(true);
  });

  test('deleteRule rejects invalid rule ID', async () => {
    await expect(firewallService.deleteRule(0))
      .rejects.toThrow(/Invalid rule ID/);
    await expect(firewallService.deleteRule('abc'))
      .rejects.toThrow(/Invalid rule ID/);
  });
});

// ═══════════════════════════════════════════════════════════
//  MOCK UFW RESPONSES
// ═══════════════════════════════════════════════════════════

describe('FirewallService — Mock UFW', () => {
  test('mockUfw returns status for status command', () => {
    const result = firewallService.mockUfw('status');
    expect(result).toContain('Status: active');
  });

  test('mockUfw returns numbered rules', () => {
    const result = firewallService.mockUfw('status numbered');
    expect(result).toContain('[ 1]');
    expect(result).toContain('ALLOW');
  });

  test('mockUfw returns enable message', () => {
    const result = firewallService.mockUfw('enable');
    expect(result).toContain('active');
  });

  test('mockUfw returns disable message', () => {
    const result = firewallService.mockUfw('disable');
    expect(result).toContain('disabled');
  });
});
