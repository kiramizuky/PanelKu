/**
 * Unit tests for log-analyzer-manager plugin
 *
 * @jest-environment node
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { describe, test, expect, beforeAll } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import logAnalyzerPlugin from '../plugins/log-analyzer-manager/index.js';

describe('Log Analyzer Manager Plugin', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());

    // Mock view engine for res.render('layout', ...)
    app.engine('ejs', (filePath, options, callback) => {
      callback(null, `<html><body>${options.body}</body></html>`);
    });
    app.set('view engine', 'ejs');
    app.set('views', './src/views');

    // Register plugin routes
    logAnalyzerPlugin.register(app, {});
  });

  test('GET /plugins/log-analyzer-manager should render layout with LogAnalyzer script', async () => {
    const res = await request(app).get('/plugins/log-analyzer-manager');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Log Analyzer');
    expect(res.text).toContain('ensureReady');
    expect(res.text).toContain('LP.init');
    expect(res.text).toContain('LogAnalyzer');
  });

  test('GET /plugins/log-analyzer-manager/read?type=auth should return log lines and anomalies', async () => {
    const res = await request(app).get('/plugins/log-analyzer-manager/read?type=auth');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.lines)).toBe(true);
    expect(res.body.data.lines.length).toBeGreaterThan(0);
    expect(typeof res.body.data.anomalies.bruteForce).toBe('number');
    expect(typeof res.body.data.anomalies.invalidUser).toBe('number');
  });

  test('GET /plugins/log-analyzer-manager/read?type=syslog should return syslog lines', async () => {
    const res = await request(app).get('/plugins/log-analyzer-manager/read?type=syslog');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.lines)).toBe(true);
    expect(res.body.data.lines.length).toBeGreaterThan(0);
  });

  test('GET /api/plugins/log-analyzer-manager/read should also respond successfully', async () => {
    const res = await request(app).get('/api/plugins/log-analyzer-manager/read?type=auth');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.lines)).toBe(true);
  });

  test('GET /api/plugins/log-analyzer-manager/read with invalid/unexpected type should default safely to auth without throwing', async () => {
    const res = await request(app).get('/api/plugins/log-analyzer-manager/read?type=../../etc/passwd');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.lines)).toBe(true);
    expect(res.body.data.lines.length).toBeLessThanOrEqual(100);
  });
});
