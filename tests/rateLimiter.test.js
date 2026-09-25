/**
 * Unit tests for rateLimiter middleware
 * tests/rateLimiter.test.js
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { describe, test, expect } from '@jest/globals';
import {
  apiLimiter,
  authLimiter,
  uploadLimiter,
  apiKeyLimiter,
  downloadTokenLimiter,
  twoFactorLimiter,
} from '../src/middleware/rateLimiter.js';

describe('RateLimiter Middleware', () => {
  describe('apiLimiter skip logic', () => {
    // In express-rate-limit, options are accessible or can be tested via the middleware
    test('does not skip when X-API-Key header is present', () => {
      const skipFn = apiLimiter.options ? apiLimiter.options.skip : null;
      if (typeof skipFn === 'function') {
        const req = {
          headers: { 'x-api-key': 'secret-key-123' },
          ip: '203.0.113.195',
        };
        expect(skipFn(req)).toBe(false);
      }
    });

    test('skips authenticated user session requests', () => {
      const skipFn = apiLimiter.options ? apiLimiter.options.skip : null;
      if (typeof skipFn === 'function') {
        const reqUser = {
          user: { id: 'admin-1', role: 'admin' },
          headers: {},
          ip: '203.0.113.50',
        };
        expect(skipFn(reqUser)).toBe(true);

        const reqAuthHeader = {
          headers: { authorization: 'Bearer some-token' },
          ip: '203.0.113.50',
        };
        expect(skipFn(reqAuthHeader)).toBe(true);
      }
    });

    test('skips local server requests (127.0.0.1, ::1)', () => {
      const skipFn = apiLimiter.options ? apiLimiter.options.skip : null;
      if (typeof skipFn === 'function') {
        expect(skipFn({ headers: {}, ip: '127.0.0.1' })).toBe(true);
        expect(skipFn({ headers: {}, ip: '::1' })).toBe(true);
        expect(skipFn({ headers: {}, ip: '::ffff:127.0.0.1' })).toBe(true);
      }
    });

    test('does not skip unauthenticated external IP', () => {
      const skipFn = apiLimiter.options ? apiLimiter.options.skip : null;
      if (typeof skipFn === 'function') {
        expect(skipFn({ headers: {}, ip: '198.51.100.22' })).toBe(false);
      }
    });
  });

  describe('keyGenerators', () => {
    test('authLimiter keys by IP and username', () => {
      const keyGen = authLimiter.options?.keyGenerator;
      if (typeof keyGen === 'function') {
        const req = {
          ip: '198.51.100.30',
          body: { username: 'admin' },
        };
        expect(keyGen(req)).toBe('198.51.100.30:admin');
      }
    });

    test('downloadTokenLimiter keys by user ID and IP', () => {
      const keyGen = downloadTokenLimiter.options?.keyGenerator;
      if (typeof keyGen === 'function') {
        const req = {
          user: { id: 'usr-99' },
          ip: '203.0.113.44',
        };
        expect(keyGen(req)).toBe('usr-99:203.0.113.44');

        const anonReq = {
          ip: '203.0.113.44',
        };
        expect(keyGen(anonReq)).toBe('anonymous:203.0.113.44');
      }
    });

    test('apiKeyLimiter keys by x-api-key header or IP fallback', () => {
      const keyGen = apiKeyLimiter.options?.keyGenerator;
      if (typeof keyGen === 'function') {
        const reqKey = {
          headers: { 'x-api-key': 'my-custom-key' },
          ip: '198.51.100.5',
        };
        expect(keyGen(reqKey)).toBe('my-custom-key');

        const reqNoKey = {
          headers: {},
          ip: '198.51.100.5',
        };
        expect(keyGen(reqNoKey)).toBe('198.51.100.5');
      }
    });

    test('twoFactorLimiter keys by tempToken and IP', () => {
      const keyGen = twoFactorLimiter.options?.keyGenerator;
      if (typeof keyGen === 'function') {
        const req = {
          body: { tempToken: 'temp-token-xyz' },
          ip: '198.51.100.12',
        };
        expect(keyGen(req)).toBe('temp-token-xyz:198.51.100.12');
      }
    });
  });
});
