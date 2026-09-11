/**
 * Mail Module Unit Tests
 *
 * @jest-environment node
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { describe, test, expect } from '@jest/globals';
import mailService from '../src/modules/mail/mail.service.js';
import mailController from '../src/modules/mail/mail.controller.js';

describe('Mail Service Validation & Status', () => {
  test('_validateEmail accepts valid email formats', () => {
    expect(mailService._validateEmail('user@example.com')).toBe('user@example.com');
    expect(mailService._validateEmail('john.doe+tag@sub.domain.org')).toBe('john.doe+tag@sub.domain.org');
  });

  test('_validateEmail rejects malformed emails', () => {
    expect(() => mailService._validateEmail('invalid_email')).toThrow('Invalid email address');
    expect(() => mailService._validateEmail('@example.com')).toThrow('Invalid email address');
    expect(() => mailService._validateEmail('user@')).toThrow('Invalid email address');
  });

  test('_validateDomain accepts valid domains and rejects invalid', () => {
    expect(mailService._validateDomain('example.com')).toBe('example.com');
    expect(mailService._validateDomain('mail.my-domain.co.id')).toBe('mail.my-domain.co.id');

    expect(() => mailService._validateDomain('invalid_domain')).toThrow('Invalid domain');
    expect(() => mailService._validateDomain('http://example.com')).toThrow('Invalid domain');
  });

  test('_validateLocalPart accepts standard usernames and rejects symbols', () => {
    expect(mailService._validateLocalPart('admin')).toBe('admin');
    expect(mailService._validateLocalPart('user_123')).toBe('user_123');

    expect(() => mailService._validateLocalPart('!invalid')).toThrow('Invalid email local part');
  });

  test('getStatus returns status object with services and queueSize', async () => {
    const status = await mailService.getStatus();
    expect(status).toBeDefined();
    expect(typeof status.installed).toBe('boolean');
    expect(typeof status.queueSize).toBe('number');
  });
});

describe('Mail Controller', () => {
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

  test('getStatus returns HTTP 200 with data', async () => {
    const res = mockRes();
    await mailController.getStatus({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
  });

  test('controlService requires service and action', async () => {
    const res = mockRes();
    await mailController.controlService({ body: {} }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('addAccount requires email and password', async () => {
    const res = mockRes();
    await mailController.addAccount({ body: { email: 'test@example.com' } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('deleteAccount requires email', async () => {
    const res = mockRes();
    await mailController.deleteAccount({ body: {} }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('addDomain requires domain', async () => {
    const res = mockRes();
    await mailController.addDomain({ body: {} }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('deleteFromQueue requires queueId', async () => {
    const res = mockRes();
    await mailController.deleteFromQueue({ body: {} }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
