/**
 * Unit tests for Sprint 4: Queue & Scale
 * - src/core/queue/QueueManager.js (expanded tasks & metrics)
 * - src/modules/tasks/tasks.controller.js
 * - src/modules/monitor/prometheus.service.js
 * - src/middleware/metrics.middleware.js
 * - src/modules/mail/mail.service.js (queue worker integration)
 *
 * @jest-environment node
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { describe, test, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import queueManager, { QueueManager } from '../src/core/queue/QueueManager.js';
import tasksController from '../src/modules/tasks/tasks.controller.js';
import prometheusService from '../src/modules/monitor/prometheus.service.js';
import httpMetrics, { metricsMiddleware } from '../src/middleware/metrics.middleware.js';
import mailService from '../src/modules/mail/mail.service.js';
import mailController from '../src/modules/mail/mail.controller.js';
import { getDb } from '../src/core/db/sqlite.js';

function createMockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(k, v) {
      this.headers[k] = v;
      return this;
    },
    send(str) {
      this.body = str;
      return this;
    },
  };
  return res;
}

beforeAll(() => {
  getDb();
});

afterAll(async () => {
  await queueManager.closeAll();
});

beforeEach(() => {
  httpMetrics.reset();
});

describe('Sprint 4: QueueManager Lifecycle & Multi-Queue Operations', () => {
  test('registers and lists all active queues', () => {
    const qm = new QueueManager();
    qm.registerWorker('queue_a', async () => 'a');
    qm.registerWorker('queue_b', async () => 'b');

    const queueNames = qm.getRegisteredQueueNames();
    expect(queueNames).toContain('queue_a');
    expect(queueNames).toContain('queue_b');
  });

  test('getAllQueueMetrics aggregates metrics across all queues', async () => {
    const qm = new QueueManager();
    qm.registerWorker('q1', async () => 'done');
    qm.registerWorker('q2', async () => 'done');

    await qm.addJob('q1', 'job_q1', { x: 1 });
    await qm.addJob('q2', 'job_q2', { y: 2 });
    await new Promise((r) => setTimeout(r, 60));

    const metrics = await qm.getAllQueueMetrics();
    expect(metrics.q1).toBeDefined();
    expect(metrics.q2).toBeDefined();
    expect(metrics.q1.completed).toBe(1);
    expect(metrics.q2.completed).toBe(1);
  });

  test('broadcasts task progress, completed, and failed events via Socket.IO', async () => {
    const qm = new QueueManager();
    const emittedEvents = [];
    const mockIo = {
      emit: jest.fn((evt, payload) => {
        emittedEvents.push({ evt, payload });
      }),
    };
    qm.setIo(mockIo);

    qm.registerWorker('socket_queue', async (job) => {
      await job.updateProgress(50, 'Halfway done');
      return { ok: true };
    });

    await qm.addJob('socket_queue', 'socket_job', { test: true });
    await new Promise((r) => setTimeout(r, 80));

    expect(mockIo.emit).toHaveBeenCalledWith('task:progress', expect.objectContaining({
      queueName: 'socket_queue',
      progress: 50,
      message: 'Halfway done',
    }));
    expect(mockIo.emit).toHaveBeenCalledWith('task:completed', expect.objectContaining({
      queueName: 'socket_queue',
      name: 'socket_job',
    }));
  });

  test('getAllRecentJobs returns chronological jobs with status and progress', async () => {
    const qm = new QueueManager();
    qm.registerWorker('recent_q', async (job) => {
      await job.updateProgress(75, 'Almost done');
      return 'ok';
    });

    const job = await qm.addJob('recent_q', 'test_recent_job', { value: 99 });
    await new Promise((r) => setTimeout(r, 60));

    const recent = await qm.getAllRecentJobs(10);
    expect(recent.length).toBeGreaterThan(0);
    const found = recent.find((j) => j.id === job.id);
    expect(found).toBeDefined();
    expect(found.name).toBe('test_recent_job');
    expect(found.status).toBe('completed');
    expect(found.progress).toBe(75);
    expect(found.progressMessage).toBe('Almost done');
  });

  test('cancelJob cancels a queued in-memory task', async () => {
    const qm = new QueueManager();
    // Do not register a worker so job stays in waiting
    const job = await qm.addJob('waiting_q', 'wait_job', { a: 1 });
    const cancelRes = await qm.cancelJob('waiting_q', job.id);

    expect(cancelRes.success).toBe(true);
    const fetched = await qm.getJob('waiting_q', job.id);
    expect(fetched.status).toBe('cancelled');
  });
});

describe('Sprint 4: Tasks Controller & Routes', () => {
  test('getAllTasks returns status 200 with job list', async () => {
    const req = { query: { limit: '20' } };
    const res = createMockRes();

    await tasksController.getAllTasks(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.jobs)).toBe(true);
  });

  test('getQueueMetrics returns aggregated metrics across queues', async () => {
    const req = {};
    const res = createMockRes();

    await tasksController.getQueueMetrics(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.metrics).toBeDefined();
  });

  test('getTask returns 404 for unknown task', async () => {
    const req = { params: { queueName: 'unknown_q', jobId: 'non_existent_id' } };
    const res = createMockRes();

    await tasksController.getTask(req, res);
    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
  });

  test('cancelTask cancels or returns 404 if not found', async () => {
    const req = { params: { queueName: 'unknown_q', jobId: 'non_existent_id' } };
    const res = createMockRes();

    await tasksController.cancelTask(req, res);
    expect(res.statusCode).toBe(404);
  });
});

describe('Sprint 4: HTTP Metrics Telemetry & Prometheus Exporter', () => {
  test('metricsMiddleware normalizes paths and collects durations', (done) => {
    const req = { method: 'GET', path: '/api/tasks/mem_12345_abc' };
    const res = {
      statusCode: 200,
      _listeners: {},
      on(evt, cb) {
        this._listeners[evt] = cb;
      },
    };

    metricsMiddleware(req, res, () => {
      // Simulate response completion
      res._listeners['finish']();

      const summary = httpMetrics.getMetricsSummary();
      expect(summary.count).toBe(1);
      expect(summary.requests.length).toBe(1);
      expect(summary.requests[0].route).toBe('/api/tasks/:id');
      expect(summary.requests[0].method).toBe('GET');
      expect(summary.requests[0].status).toBe('200');
      done();
    });
  });

  test('Prometheus service exports process, queue, and http traffic metrics', async () => {
    // Record sample HTTP traffic
    const req = { method: 'POST', path: '/api/backup/create' };
    const res = {
      statusCode: 201,
      _listeners: {},
      on(evt, cb) { this._listeners[evt] = cb; },
    };
    metricsMiddleware(req, res, () => {
      res._listeners['finish']();
    });

    const metricsStr = await prometheusService.getMetrics();
    expect(typeof metricsStr).toBe('string');

    // System metrics preserved
    expect(metricsStr).toContain('node_cpu_count');
    expect(metricsStr).toContain('node_memory_bytes_total');
    expect(metricsStr).toContain('panelku_waf_rules_total');

    // Process runtime metrics added
    expect(metricsStr).toContain('panelku_process_uptime_seconds');
    expect(metricsStr).toContain('panelku_process_memory_heap_used_bytes');

    // Queue telemetry added
    expect(metricsStr).toContain('panelku_queue_jobs');

    // HTTP telemetry added
    expect(metricsStr).toContain('panelku_http_requests_total');
    expect(metricsStr).toContain('panelku_http_request_duration_seconds');
    expect(metricsStr).toContain('method="POST"');
  });
});

describe('Sprint 4: Mail Module Queue Worker Integration', () => {
  test('mailService supports queueInstall and queueUninstall returning job info', async () => {
    const job = await mailService.queueInstall();
    expect(job).toBeDefined();
    expect(job.id).toBeDefined();
    expect(job.queueName).toBe('mail');

    const status = await mailService.getQueueJobStatus(job.id);
    expect(status).toBeDefined();

    const metrics = await mailService.getQueueMetrics();
    expect(metrics).toBeDefined();
  });

  test('mailController.install with async=true returns 200 with queued status', async () => {
    const req = { query: { async: 'true' } };
    const res = createMockRes();

    await mailController.install(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.queued).toBe(true);
    expect(res.body.data.job.queueName).toBe('mail');
  });

  test('mailController.uninstall with async=true returns 200 with queued status', async () => {
    const req = { query: { async: 'true' } };
    const res = createMockRes();

    await mailController.uninstall(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.queued).toBe(true);
  });
});
