/**
 * Unit tests for Mail Module:
 * - src/modules/mail/mail.service.js
 * - src/modules/mail/mail.controller.js
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

let mockExecHandler = jest.fn();

jest.unstable_mockModule('child_process', () => ({
  exec: jest.fn((cmd, ...rest) => {
    const cb = rest.pop();
    const opts = typeof rest[0] === 'object' ? rest[0] : {};
    mockExecHandler(cmd, opts, cb);
  }),
}));

const mockFsReaddir = jest.fn().mockResolvedValue([]);

jest.unstable_mockModule('fs/promises', () => ({
  default: {
    readdir: mockFsReaddir,
  },
  readdir: mockFsReaddir,
}));

const { default: mailService } = await import('../src/modules/mail/mail.service.js');
const { default: mailController } = await import('../src/modules/mail/mail.controller.js');

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

  mockExecHandler.mockImplementation((cmd, opts, cb) => {
    if (cmd.includes('systemctl is-active postfix')) {
      cb(null, { stdout: 'active', stderr: '' });
    } else if (cmd.includes('systemctl is-active dovecot')) {
      cb(null, { stdout: 'active', stderr: '' });
    } else if (cmd.includes('command -v postfix')) {
      cb(null, { stdout: 'yes', stderr: '' });
    } else if (cmd.includes('postconf mail_version')) {
      cb(null, { stdout: '3.6.4', stderr: '' });
    } else if (cmd.includes('cat /etc/postfix/virtual_mailbox')) {
      cb(null, { stdout: 'user@example.com /var/mail/vhosts/example.com/user/\n', stderr: '' });
    } else if (cmd.includes('doveadm pw')) {
      cb(null, { stdout: '{SHA512-CRYPT}$6$hashvalue', stderr: '' });
    } else if (cmd.includes('postconf mydestination')) {
      cb(null, { stdout: 'mydestination = example.com mail.example.com', stderr: '' });
    } else if (cmd.includes('postconf virtual_mailbox_domains')) {
      cb(null, { stdout: 'virtual_mailbox_domains = example.com', stderr: '' });
    } else if (cmd.includes('cat /etc/spamassassin/local.cf')) {
      cb(null, { stdout: 'required_score 5.0\n', stderr: '' });
    } else if (cmd.includes('mailq')) {
      cb(null, { stdout: '4F8B31234567 1234 Mon Jan 10 12:00:00 sender@example.com\n', stderr: '' });
    } else {
      cb(null, { stdout: 'ok', stderr: '' });
    }
  });
});

describe('MailService — Validation & Status', () => {
  test('validates email, domain, and local-part format', () => {
    expect(() => mailService._validateEmail('invalid-email')).toThrow('Invalid email address');
    expect(mailService._validateEmail('user@domain.com')).toBe('user@domain.com');

    expect(() => mailService._validateDomain('bad domain')).toThrow('Invalid domain');
    expect(mailService._validateDomain('domain.com')).toBe('domain.com');

    expect(() => mailService._validateLocalPart('bad space')).toThrow('Invalid email local part');
    expect(mailService._validateLocalPart('admin')).toBe('admin');
  });

  test('getStatus checks services, queue, and postfix version', async () => {
    const status = await mailService.getStatus();
    expect(status.installed).toBe(true);
    expect(status.postfix).toBe(true);
    expect(status.version).toBe('3.6.4');
  });

  test('install, uninstall, and controlService execute system commands', async () => {
    const inst = await mailService.install();
    expect(inst.success).toBe(true);

    const uninst = await mailService.uninstall();
    expect(uninst.success).toBe(true);

    await expect(mailService.controlService('invalid', 'start')).rejects.toThrow('Invalid service name');
    await expect(mailService.controlService('postfix', 'kill')).rejects.toThrow('Invalid action');

    const ctrl = await mailService.controlService('postfix', 'restart');
    expect(ctrl.success).toBe(true);
  });
});

describe('MailService — Accounts & Domains', () => {
  test('getAccounts parses virtual mailboxes', async () => {
    const accounts = await mailService.getAccounts();
    expect(accounts.length).toBe(1);
    expect(accounts[0].email).toBe('user@example.com');
  });

  test('addAccount validates credentials and updates mailbox map', async () => {
    await expect(mailService.addAccount('bad', 'pass')).rejects.toThrow();
    await expect(mailService.addAccount('user@test.com', 'short')).rejects.toThrow('at least 6 characters');

    const res = await mailService.addAccount('new@example.com', 'securepass123');
    expect(res.success).toBe(true);
    expect(res.email).toBe('new@example.com');
  });

  test('deleteAccount and updatePassword', async () => {
    const delRes = await mailService.deleteAccount('user@example.com');
    expect(delRes.success).toBe(true);

    const passRes = await mailService.updatePassword('user@example.com', 'newpass123');
    expect(passRes.success).toBe(true);
  });

  test('getDomains, addDomain, and removeDomain', async () => {
    const domains = await mailService.getDomains();
    expect(domains).toContain('example.com');

    const addRes = await mailService.addDomain('newdomain.org');
    expect(addRes.success).toBe(true);

    const remRes = await mailService.removeDomain('newdomain.org');
    expect(remRes.success).toBe(true);
  });
});

describe('MailService — Queue, SpamAssassin & Logs', () => {
  test('getQueue parses mailq entries', async () => {
    const q = await mailService.getQueue();
    expect(q.queue.length).toBe(1);
    expect(q.queue[0].id).toBe('4F8B31234567');
  });

  test('flushQueue and deleteFromQueue', async () => {
    const flushRes = await mailService.flushQueue();
    expect(flushRes.success).toBe(true);

    await expect(mailService.deleteFromQueue('bad-id')).rejects.toThrow('Invalid queue ID');
    const delRes = await mailService.deleteFromQueue('4F8B31234567');
    expect(delRes.success).toBe(true);
  });

  test('getSpamConfig and updateSpamConfig', async () => {
    const cfg = await mailService.getSpamConfig();
    expect(cfg.requiredScore).toBe(5.0);

    await expect(mailService.updateSpamConfig(30)).rejects.toThrow('between 1 and 20');
    const updateRes = await mailService.updateSpamConfig(7.5);
    expect(updateRes.requiredScore).toBe(7.5);
  });

  test('getSslInfo and getLogs', async () => {
    mockFsReaddir.mockResolvedValue(['cert.pem']);
    const ssl = await mailService.getSslInfo();
    expect(Array.isArray(ssl)).toBe(true);

    const logs = await mailService.getLogs('postfix', 20);
    expect(Array.isArray(logs)).toBe(true);
  });
});

describe('MailController — Endpoints', () => {
  test('getStatus and getAccounts endpoints', async () => {
    const req = {};
    const resStatus = createMockRes();
    await mailController.getStatus(req, resStatus);
    expect(resStatus.statusCode).toBe(200);

    const resAccounts = createMockRes();
    await mailController.getAccounts(req, resAccounts);
    expect(resAccounts.statusCode).toBe(200);
  });

  test('addAccount endpoint validates email and password', async () => {
    const reqEmpty = { body: {} };
    const resEmpty = createMockRes();
    await mailController.addAccount(reqEmpty, resEmpty);
    expect(resEmpty.statusCode).toBe(400);

    const reqValid = { body: { email: 'test@example.com', password: 'password123' } };
    const resValid = createMockRes();
    await mailController.addAccount(reqValid, resValid);
    expect(resValid.statusCode).toBe(200);
  });

  test('controlService endpoint validates service and action', async () => {
    const reqEmpty = { body: {} };
    const resEmpty = createMockRes();
    await mailController.controlService(reqEmpty, resEmpty);
    expect(resEmpty.statusCode).toBe(400);
  });

  test('addDomain and removeDomain endpoints', async () => {
    const reqEmpty = { body: {} };
    const resEmpty = createMockRes();
    await mailController.addDomain(reqEmpty, resEmpty);
    expect(resEmpty.statusCode).toBe(400);

    const reqValid = { body: { domain: 'example.com' } };
    const resValid = createMockRes();
    await mailController.addDomain(reqValid, resValid);
    expect(resValid.statusCode).toBe(200);
  });

  test('deleteFromQueue endpoint validates queueId', async () => {
    const req = { body: {} };
    const res = createMockRes();
    await mailController.deleteFromQueue(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('updateSpamConfig endpoint validates score', async () => {
    const req = { body: {} };
    const res = createMockRes();
    await mailController.updateSpamConfig(req, res);
    expect(res.statusCode).toBe(400);
  });
});
