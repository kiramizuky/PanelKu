/**
 * Caddy Module Unit Tests
 *
 * @jest-environment node
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { describe, test, expect } from '@jest/globals';
import caddyService from '../src/modules/caddy/caddy.service.js';
import caddyController from '../src/modules/caddy/caddy.controller.js';

describe('Caddy Service', () => {
  test('getStatus returns status object with installed and running flags', async () => {
    const status = await caddyService.getStatus();
    expect(status).toBeDefined();
    expect(typeof status.installed).toBe('boolean');
    expect(typeof status.running).toBe('boolean');
    expect(status.version).toBeDefined();
  });

  test('serviceAction validates supported action names', async () => {
    await expect(
      caddyService.serviceAction('unsupported_action')
    ).rejects.toThrow('Invalid action: unsupported_action');
  });

  test('getCaddyfile returns default or existing Caddyfile content', async () => {
    const res = await caddyService.getCaddyfile();
    expect(res).toBeDefined();
    expect(res.path).toBeDefined();
    expect(typeof res.content).toBe('string');
  });

  test('saveCaddyfile validates content presence and length', async () => {
    await expect(
      caddyService.saveCaddyfile('')
    ).rejects.toThrow('Caddyfile content is required');

    await expect(
      caddyService.saveCaddyfile('a'.repeat(100001))
    ).rejects.toThrow('Caddyfile too large');
  });
});

describe('Caddy Controller', () => {
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

  test('getStatus returns HTTP 200', async () => {
    const res = mockRes();
    await caddyController.getStatus({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBeDefined();
  });

  test('serviceAction rejects missing action with 400', async () => {
    const res = mockRes();
    await caddyController.serviceAction({ body: {} }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('serviceAction rejects invalid action with 400', async () => {
    const res = mockRes();
    await caddyController.serviceAction({ body: { action: 'destroy' } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('getCaddyfile returns HTTP 200 with caddyfile', async () => {
    const res = mockRes();
    await caddyController.getCaddyfile({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.caddyfile).toBeDefined();
  });
});
