/**
 * AI Controller & AI Repair Controller Unit Tests
 *
 * @jest-environment node
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import aiController from '../src/modules/ai/ai.controller.js';
import aiRepairController from '../src/modules/ai-repair/ai-repair.controller.js';
import aiService from '../src/modules/ai/ai.service.js';
import aiRepairService from '../src/modules/ai-repair/ai-repair.service.js';
import anomalyDetectorService from '../src/modules/ai-repair/anomaly-detector.service.js';

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

describe('AIController - chat', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('returns 400 if message is missing', async () => {
    const res = mockRes();
    await aiController.chat({ body: {} }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('diagnoses terminal error when context.logType is terminal_error', async () => {
    const req = {
      body: {
        message: 'Tolong bantu error ini',
        context: {
          logType: 'terminal_error',
          logText: 'E: Could not get lock /var/lib/dpkg/lock-frontend',
        },
      },
    };
    const res = mockRes();
    await aiController.chat(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.answer).toContain('Hasil Diagnosa Error Terminal');
    expect(res.body.data.diagnosis).toBeDefined();
  });

  test('executes direct diagnostic intent when matched', async () => {
    const req = {
      body: { message: 'cek penggunaan ram tertinggi' },
    };
    const res = mockRes();
    await aiController.chat(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.intent).toBe('check_ram_highest');
  });

  test('calls external OpenAI API if apiKey is configured', async () => {
    globalThis.fetch = jest.fn(async () => ({
      json: async () => ({
        choices: [{ message: { content: 'Simulated OpenAI advice' } }],
      }),
    }));

    const req = {
      body: { message: 'Bagaimana cara optimasi server?' },
      user: {
        aiSettings: {
          provider: 'openai',
          apiKey: 'sk-test-12345',
          model: 'gpt-4o-mini',
        },
      },
    };
    const res = mockRes();
    await aiController.chat(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.answer).toBe('Simulated OpenAI advice');
    expect(globalThis.fetch).toHaveBeenCalled();
  });

  test('calls external Gemini API if apiKey is configured', async () => {
    globalThis.fetch = jest.fn(async () => ({
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'Simulated Gemini advice' }] } }],
      }),
    }));

    const req = {
      body: { message: 'Analisa server saya' },
      user: {
        aiSettings: {
          provider: 'gemini',
          apiKey: 'gemini-key-123',
          model: 'gemini-1.5-flash',
        },
      },
    };
    const res = mockRes();
    await aiController.chat(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.answer).toBe('Simulated Gemini advice');
  });

  test('calls external OpenRouter API if apiKey is configured', async () => {
    globalThis.fetch = jest.fn(async () => ({
      json: async () => ({
        choices: [{ message: { content: 'Simulated OpenRouter advice' } }],
      }),
    }));

    const req = {
      body: { message: 'Analisa performa disk' },
      user: {
        aiSettings: {
          provider: 'openrouter',
          apiKey: 'or-key-123',
          model: 'anthropic/claude-3-haiku',
        },
      },
    };
    const res = mockRes();
    await aiController.chat(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.answer).toBe('Simulated OpenRouter advice');
  });

  test('uses local heuristics for RAM query fallback', async () => {
    const req = { body: { message: 'mengapa memory penuh?' } };
    const res = mockRes();
    await aiController.chat(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.answer).toContain('free -h');
  });

  test('uses local heuristics for CPU query fallback', async () => {
    const req = { body: { message: 'proses apa yang memakan cpu?' } };
    const res = mockRes();
    await aiController.chat(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.answer).toContain('ps -eo');
  });

  test('uses local heuristics for disk query fallback', async () => {
    const req = { body: { message: 'sisa kapasitas disk berapa ya?' } };
    const res = mockRes();
    await aiController.chat(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.answer).toContain('df -h');
  });

  test('uses local heuristics for docker query fallback', async () => {
    const req = { body: { message: 'cek status container docker' } };
    const res = mockRes();
    await aiController.chat(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.answer).toContain('docker ps');
  });

  test('uses local heuristics for fail2ban query fallback', async () => {
    const req = {
      body: {
        message: 'cek fail2ban yang blokir',
        context: { logType: 'fail2ban', logText: 'Ban 192.168.1.100' },
      },
    };
    const res = mockRes();
    await aiController.chat(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.answer).toContain('fail2ban-client');
  });

  test('provides default greeting for unrecognized message', async () => {
    const req = { body: { message: 'halo selamat pagi' } };
    const res = mockRes();
    await aiController.chat(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.answer).toContain('OpenClaw AI Copilot');
  });
});

describe('AIController - exec', () => {
  test('returns 400 if command is missing', async () => {
    const res = mockRes();
    await aiController.exec({ body: {} }, res);
    expect(res.statusCode).toBe(400);
  });

  test('executes command successfully or rejects disallowed command', async () => {
    const res = mockRes();
    await aiController.exec({ body: { command: 'echo hello-openclaw' } }, res);
    expect([200, 400]).toContain(res.statusCode);
  });
});

describe('AIRepairController', () => {
  test('getConfig returns configuration', async () => {
    const res = mockRes();
    await aiRepairController.getConfig({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('saveConfig saves configuration', async () => {
    const res = mockRes();
    await aiRepairController.saveConfig({ body: { enabled: true } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('analyzeLog validates log parameter', async () => {
    const res = mockRes();
    await aiRepairController.analyzeLog({ body: {} }, res);
    expect(res.statusCode).toBe(400);

    const validRes = mockRes();
    await aiRepairController.analyzeLog({ body: { log: 'Connection refused on port 80' } }, validRes);
    expect(validRes.statusCode).toBe(200);
  });

  test('runDiagnostic returns diagnostics result', async () => {
    const res = mockRes();
    await aiRepairController.runDiagnostic({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('getFixSuggestions validates fixId and returns suggestions', async () => {
    const badRes = mockRes();
    await aiRepairController.getFixSuggestions({ query: {} }, badRes);
    expect(badRes.statusCode).toBe(400);

    const goodRes = mockRes();
    await aiRepairController.getFixSuggestions({ query: { fixId: 'disk.full' } }, goodRes);
    expect([200, 500]).toContain(goodRes.statusCode);
  });

  test('applyFix validates fixId', async () => {
    const res = mockRes();
    await aiRepairController.applyFix({ body: {} }, res);
    expect(res.statusCode).toBe(400);
  });

  test('suggestFix validates log content', async () => {
    const badRes = mockRes();
    await aiRepairController.suggestFix({ body: {} }, badRes);
    expect(badRes.statusCode).toBe(400);

    const goodRes = mockRes();
    await aiRepairController.suggestFix({ body: { log: 'Error: Cannot bind to port 8080' } }, goodRes);
    expect(goodRes.statusCode).toBe(200);
  });

  test('analyzeTrends returns predictive trend data', async () => {
    const res = mockRes();
    await aiRepairController.analyzeTrends({ query: { hours: '48' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('scanAnomalies scans log anomalies', async () => {
    const res = mockRes();
    await aiRepairController.scanAnomalies({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('listIncidents and createIncident manage post-mortem reports', async () => {
    const listRes = mockRes();
    await aiRepairController.listIncidents({ query: { limit: '5' } }, listRes);
    expect(listRes.statusCode).toBe(200);
    expect(listRes.body.data.reports).toBeDefined();

    const createRes = mockRes();
    await aiRepairController.createIncident({
      body: {
        title: 'Test Incident',
        severity: 'high',
        rootCause: 'Out of memory',
        actionTaken: 'Restarted service',
      },
    }, createRes);
    expect([200, 500]).toContain(createRes.statusCode);
  });

  test('getHealthScore returns system health metrics', async () => {
    const res = mockRes();
    await aiRepairController.getHealthScore({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('getFixPatterns returns predefined fix patterns', async () => {
    const res = mockRes();
    await aiRepairController.getFixPatterns({}, res);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.some(p => p.id === 'port.conflict')).toBe(true);
  });
});
