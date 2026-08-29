/**
 * Unit Tests for Fase 1 Features:
 * - WebAuthn / Passkeys (FIDO2) Service
 * - WebPush Notifications Service
 * - Security & Vulnerability Scanner Service
 *
 * @jest-environment node
 */
import { describe, test, expect, beforeAll } from '@jest/globals';
import { getDb, generateId, now } from '../src/core/db/sqlite.js';
import passkeyService from '../src/modules/auth/passkey.service.js';
import webpushService from '../src/modules/alerts/webpush.service.js';
import securityScannerService from '../src/modules/waf/security-scanner.service.js';

describe('Fase 1: Passkeys, WebPush & Security Scanner', () => {
  let testUserId;
  const mockReq = {
    hostname: 'localhost',
    protocol: 'http',
    headers: { 'user-agent': 'Jest Test Suite' },
    get(header) { return this.headers[header] || 'localhost:3000'; },
  };

  beforeAll(() => {
    const db = getDb();
    testUserId = generateId();

    let role = db.prepare('SELECT id FROM roles LIMIT 1').get();
    if (!role) {
      const roleId = generateId();
      db.prepare(`
        INSERT INTO roles (id, name, slug, permissions, is_system, is_active, color, created_at, updated_at)
        VALUES (?, 'Super Admin Test', 'super-admin-test', '["*"]', 1, 1, '#4f46e5', ?, ?)
      `).run(roleId, now(), now());
      role = { id: roleId };
    }

    db.prepare('INSERT OR REPLACE INTO users (id, username, email, password, role_id, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)')
      .run(testUserId, 'testfase1user', 'fase1@example.com', 'hashedpwd123', role.id, now(), now());
  });

  describe('WebAuthn / Passkeys Service', () => {
    test('generateRegistrationOptions returns valid WebAuthn options', async () => {
      const options = await passkeyService.getRegistrationOptions(testUserId, mockReq);
      expect(options).toBeDefined();
      expect(options.challenge).toBeDefined();
      expect(options.rp.name).toBe('Panelku Server Control');
      expect(options.user.name).toBe('testfase1user');
    });

    test('generateAuthenticationOptions returns challenge and options', async () => {
      const { options, challengeKey } = await passkeyService.getAuthenticationOptions('testfase1user', mockReq);
      expect(options).toBeDefined();
      expect(challengeKey).toBeDefined();
      expect(options.challenge).toBeDefined();
    });

    test('listPasskeys and deletePasskey handle DB operations', async () => {
      const db = getDb();
      const passkeyId = generateId();
      db.prepare('INSERT INTO passkeys (id, user_id, credential_id, public_key, counter, device_name, transports, created_at, last_used_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)')
        .run(passkeyId, testUserId, 'cred-123456', 'mockpubkeybase64', 'YubiKey 5C', '["usb"]', now(), now());

      const list = await passkeyService.listPasskeys(testUserId);
      expect(list.some(k => k.id === passkeyId)).toBe(true);

      const delRes = await passkeyService.deletePasskey(testUserId, passkeyId);
      expect(delRes.success).toBe(true);

      const listAfter = await passkeyService.listPasskeys(testUserId);
      expect(listAfter.some(k => k.id === passkeyId)).toBe(false);
    });
  });

  describe('WebPush Service', () => {
    test('getPublicKey returns a valid VAPID public key string', () => {
      const key = webpushService.getPublicKey();
      expect(typeof key).toBe('string');
      expect(key.length).toBeGreaterThan(20);
    });

    test('subscribe and unsubscribe store and remove browser subscriptions', async () => {
      const mockSub = {
        endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/mock-endpoint-123',
        keys: {
          p256dh: 'mock-p256dh-key',
          auth: 'mock-auth-secret',
        },
      };

      const subRes = await webpushService.subscribe(testUserId, mockSub, 'Mozilla Firefox');
      expect(subRes.success).toBe(true);

      const subs = await webpushService.listSubscriptions(testUserId);
      expect(subs.some(s => s.endpoint === mockSub.endpoint)).toBe(true);

      const unsubRes = await webpushService.unsubscribe(mockSub.endpoint);
      expect(unsubRes.success).toBe(true);

      const subsAfter = await webpushService.listSubscriptions(testUserId);
      expect(subsAfter.some(s => s.endpoint === mockSub.endpoint)).toBe(false);
    });
  });

  describe('Security & Vulnerability Scanner Service', () => {
    test('runScan generates score summary and findings', async () => {
      const scan = await securityScannerService.runScan();
      expect(scan).toBeDefined();
      expect(scan.summary).toBeDefined();
      expect(scan.summary.score).toBeGreaterThanOrEqual(0);
      expect(scan.summary.score).toBeLessThanOrEqual(100);
      expect(Array.isArray(scan.findings)).toBe(true);
    });

    test('getLatestScan retrieves recent scan from database', async () => {
      const latest = await securityScannerService.getLatestScan();
      expect(latest).toBeDefined();
      expect(latest.summary).toBeDefined();
      expect(latest.summary.score).toBeDefined();
    });
  });
});
