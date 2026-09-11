/**
 * WhatsApp Module Unit Tests
 *
 * @jest-environment node
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { describe, test, expect, beforeAll } from '@jest/globals';
import WhatsappSession from '../src/models/WhatsappSession.js';
import whatsappService from '../src/modules/whatsapp/whatsapp.service.js';
import whatsappController from '../src/modules/whatsapp/whatsapp.controller.js';
import { getDb } from '../src/core/db/sqlite.js';

beforeAll(() => {
  getDb();
});

describe('WhatsappSession Model', () => {
  test('creates, updates, retrieves, and deletes a WhatsApp session', async () => {
    const sessionName = `test_sess_${Date.now()}`;
    const created = await WhatsappSession.create({
      sessionName,
      status: 'connecting',
      webhookUrl: 'https://example.com/webhook',
    });

    expect(created).toBeDefined();
    expect(created.session_name).toBe(sessionName);
    expect(created.status).toBe('connecting');
    expect(created.webhook_url).toBe('https://example.com/webhook');

    // Find by sessionName
    const found = await WhatsappSession.findOne({ sessionName });
    expect(found).toBeDefined();
    expect(found.id).toBe(created.id);

    // Update
    const updated = await WhatsappSession.findByIdAndUpdate(created.id, {
      status: 'connected',
      webhookUrl: 'https://example.com/webhook2',
    });
    expect(updated.status).toBe('connected');
    expect(updated.webhook_url).toBe('https://example.com/webhook2');

    // Find all
    const all = await WhatsappSession.find();
    expect(Array.isArray(all)).toBe(true);
    expect(all.some(s => s.session_name === sessionName)).toBe(true);

    // Delete
    const deleted = await WhatsappSession.findByIdAndDelete(created.id);
    expect(deleted).toBeDefined();
    const afterDelete = await WhatsappSession.findById(created.id);
    expect(afterDelete).toBeUndefined();
  });
});

describe('WhatsApp Service', () => {
  test('getSessionStatus returns null for non-existent session', async () => {
    const status = await whatsappService.getSessionStatus('non_existent_random_session');
    expect(status).toBeNull();
  });

  test('getSessionStatus returns record when session exists in DB', async () => {
    const sessionName = `sess_status_${Date.now()}`;
    await WhatsappSession.create({ sessionName, status: 'disconnected' });

    const status = await whatsappService.getSessionStatus(sessionName);
    expect(status).toBeDefined();
    expect(status.sessionName).toBe(sessionName);
    expect(status.status).toBe('disconnected');

    await whatsappService.deleteSession(sessionName);
  });

  test('sendMessage throws error when session is inactive or unconnected', async () => {
    await expect(
      whatsappService.sendMessage('inactive_session_xyz', '628123456789', 'Hello test')
    ).rejects.toThrow('Session is not active or connected');
  });

  test('deleteSession removes runtime and db records gracefully', async () => {
    const sessionName = `sess_del_${Date.now()}`;
    await WhatsappSession.create({ sessionName, status: 'connecting' });

    const result = await whatsappService.deleteSession(sessionName);
    expect(result).toBe(true);

    const check = await WhatsappSession.findOne({ sessionName });
    expect(check).toBeUndefined();
  });
});

describe('WhatsApp Controller', () => {
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

  test('listAccounts returns HTTP 200 with accounts array', async () => {
    const res = mockRes();
    await whatsappController.listAccounts({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.accounts)).toBe(true);
  });

  test('getSession returns 404 for unknown session', async () => {
    const res = mockRes();
    await whatsappController.getSession({ params: { name: 'non_existent_abc' } }, res);
    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
  });

  test('initSession rejects request when name is missing', async () => {
    const res = mockRes();
    await whatsappController.initSession({ body: {} }, res);
    expect(res.statusCode).toBe(400);
  });

  test('sendMessage rejects request when destination is missing', async () => {
    const res = mockRes();
    await whatsappController.sendMessage({ params: { name: 'test' }, body: { message: 'hi' } }, res);
    expect(res.statusCode).toBe(400);
  });

  test('updateWebhook updates webhook URL for an existing session', async () => {
    const sessionName = `sess_wh_${Date.now()}`;
    await WhatsappSession.create({ sessionName, status: 'disconnected' });

    const res = mockRes();
    await whatsappController.updateWebhook(
      { params: { name: sessionName }, body: { webhookUrl: 'https://new-webhook.org' } },
      res
    );
    expect(res.statusCode).toBe(200);

    const updated = await WhatsappSession.findOne({ sessionName });
    expect(updated.webhook_url).toBe('https://new-webhook.org');

    await whatsappService.deleteSession(sessionName);
  });
});
