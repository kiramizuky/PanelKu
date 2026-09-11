/**
 * Queue Architecture & BullMQ / In-Memory Fallback Tests
 *
 * @jest-environment node
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import queueManager, { QueueManager } from '../src/core/queue/QueueManager.js';
import eventBus, { EVENTS } from '../src/core/events/EventBus.js';
import backupService from '../src/modules/backup/backup.service.js';
import backupController from '../src/modules/backup/backup.controller.js';
import { getDb } from '../src/core/db/sqlite.js';

beforeAll(() => {
  getDb();
});

afterAll(async () => {
  await queueManager.closeAll();
});

describe('QueueManager Core Functionality', () => {
  test('instantiates QueueManager correctly', () => {
    const qm = new QueueManager();
    expect(qm).toBeDefined();
    expect(qm._useBullMQ).toBe(false);
  });

  test('executes in-memory jobs and reports progress and completion', async () => {
    const qm = new QueueManager();
    const processed = [];

    qm.registerWorker('test_queue', async (job) => {
      await job.updateProgress(50);
      processed.push(job.data.value);
      return { echo: job.data.value * 2 };
    });

    const jobInfo = await qm.addJob('test_queue', 'test_job', { value: 21 });
    expect(jobInfo).toBeDefined();
    expect(jobInfo.id).toBeDefined();
    expect(jobInfo.isFallback).toBe(true);

    // Wait for setImmediate drain
    await new Promise((resolve) => setTimeout(resolve, 50));

    const job = await qm.getJob('test_queue', jobInfo.id);
    expect(job).toBeDefined();
    expect(job.status).toBe('completed');
    expect(job.progress).toBe(50);
    expect(job.returnvalue).toEqual({ echo: 42 });
    expect(processed).toContain(21);
  });

  test('handles failed jobs and records failedReason', async () => {
    const qm = new QueueManager();

    qm.registerWorker('fail_queue', async () => {
      throw new Error('Planned job failure');
    });

    const jobInfo = await qm.addJob('fail_queue', 'failing_job', { item: 1 });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const job = await qm.getJob('fail_queue', jobInfo.id);
    expect(job).toBeDefined();
    expect(job.status).toBe('failed');
    expect(job.failedReason).toBe('Planned job failure');
  });

  test('getQueueMetrics returns accurate job counts', async () => {
    const qm = new QueueManager();
    qm.registerWorker('metric_queue', async (job) => {
      if (job.data.fail) throw new Error('Fail');
      return 'ok';
    });

    await qm.addJob('metric_queue', 'j1', { fail: false });
    await qm.addJob('metric_queue', 'j2', { fail: true });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const metrics = await qm.getQueueMetrics('metric_queue');
    expect(metrics).toBeDefined();
    expect(metrics.completed).toBe(1);
    expect(metrics.failed).toBe(1);
    expect(metrics.isFallback).toBe(true);
  });

  test('publishes EventBus events for backup queue jobs', async () => {
    const qm = new QueueManager();
    let completedEvent = null;

    const handler = (evt) => {
      completedEvent = evt;
    };
    eventBus.on(EVENTS.BACKUP_COMPLETE, handler);

    qm.registerWorker('backup', async (job) => {
      return { result: 'backed_up', file: job.data.target };
    });

    const jobInfo = await qm.addJob('backup', 'backup_run', { target: 'test_db' });
    await new Promise((resolve) => setTimeout(resolve, 50));

    eventBus.removeListener(EVENTS.BACKUP_COMPLETE, handler);

    expect(completedEvent).toBeDefined();
    expect(completedEvent.jobId).toBe(jobInfo.id);
  });
});

describe('Backup Module Queue Integration', () => {
  test('backupService can enqueue a backup job', async () => {
    const queued = await backupService.queueBackupJob('job_123');
    expect(queued).toBeDefined();
    expect(queued.id).toBeDefined();
    expect(queued.queueName).toBe('backup');
  });

  test('backupService can enqueue create backup', async () => {
    const queued = await backupService.queueCreateBackup('files', '/var/www/test');
    expect(queued).toBeDefined();
    expect(queued.id).toBeDefined();
  });

  test('backupService.getQueueMetrics returns queue metrics', async () => {
    const metrics = await backupService.getQueueMetrics();
    expect(metrics).toBeDefined();
    expect(typeof metrics.waiting).toBe('number');
  });

  test('backupController.getQueueMetrics returns HTTP success', async () => {
    let responseData = null;
    let statusCode = null;

    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseData = data;
        return this;
      },
    };

    await backupController.getQueueMetrics({}, res);
    expect(statusCode).toBe(200);
    expect(responseData.success).toBe(true);
    expect(responseData.data).toBeDefined();
  });

  test('backupController.getQueueJobStatus returns 404 for non-existent job', async () => {
    let statusCode = null;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json() {
        return this;
      },
    };

    await backupController.getQueueJobStatus({ params: { jobId: 'non_existent_999' } }, res);
    expect(statusCode).toBe(404);
  });
});
