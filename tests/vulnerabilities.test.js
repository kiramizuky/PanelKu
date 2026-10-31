/**
 * Vulnerabilities Module & Remediation Tests (v3.8.0)
 *
 * @jest-environment node
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'jest-vuln-test-secret-' + Date.now();
process.env.JWT_REFRESH_SECRET = 'jest-vuln-refresh-secret-' + Date.now();
process.env.APP_SECRET = 'jest-vuln-app-secret-' + Date.now();
process.env.LOG_LEVEL = 'silent';
process.env.PORT = '0';

import request from 'supertest';
import bcrypt from 'bcryptjs';
import createApp from '../src/app.js';
import vulnerabilitiesService from '../src/modules/vulnerabilities/vulnerabilities.service.js';
import { getDb, now, toJson } from '../src/core/db/sqlite.js';

let app;
let authToken;

beforeAll(async () => {
  const db = getDb();
  db.exec('DELETE FROM audit_logs');
  db.exec('DELETE FROM sessions');
  db.exec('DELETE FROM users');
  db.exec('DELETE FROM roles');
  db.exec('DELETE FROM vulnerability_findings');
  db.exec('DELETE FROM vulnerability_scans');

  const roleId = 'role-super_admin';
  db.prepare(`
    INSERT INTO roles (id, name, slug, description, permissions, is_system, is_active, color, created_at, updated_at)
    VALUES (?, 'Super Admin', 'super_admin', 'Full access', ?, 1, 1, '#dc3545', ?, ?)
  `).run(roleId, toJson([{ resource: '*', actions: ['read', 'create', 'update', 'delete', 'execute'] }]), now(), now());

  const ts = now();
  const hash = bcrypt.hashSync('VulnTestPass1!', 10);
  db.prepare(`
    INSERT INTO users (id, username, email, password, role_id, first_name, last_name,
      is_active, is_super_admin, must_change_password, created_at, updated_at)
    VALUES (?, 'vulntester', 'vuln@test.local', ?, ?, 'Vuln', 'Tester', 1, 1, 0, ?, ?)
  `).run('user-vuln-test', hash, roleId, ts, ts);

  app = createApp();

  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ username: 'vulntester', password: 'VulnTestPass1!' });

  expect(loginRes.status).toBe(200);
  authToken = loginRes.body.data.accessToken;
});

describe('Vulnerabilities Service Unit Tests', () => {
  test('calculateScore should penalize according to severity weights and floor at 0', () => {
    // 0 findings -> 100
    expect(vulnerabilitiesService.calculateScore(0, 0, 0, 0)).toBe(100);
    // 1 critical (-25) -> 75
    expect(vulnerabilitiesService.calculateScore(1, 0, 0, 0)).toBe(75);
    // 1 high (-15), 1 medium (-8), 1 low (-3) -> 100 - 26 = 74
    expect(vulnerabilitiesService.calculateScore(0, 1, 1, 1)).toBe(74);
    // Heavy penalties floor at 0
    expect(vulnerabilitiesService.calculateScore(5, 5, 5, 5)).toBe(0);
  });

  test('getScoreRating should return correct grades and labels', () => {
    expect(vulnerabilitiesService.getScoreRating(95).grade).toBe('A+');
    expect(vulnerabilitiesService.getScoreRating(85).grade).toBe('A');
    expect(vulnerabilitiesService.getScoreRating(70).grade).toBe('B');
    expect(vulnerabilitiesService.getScoreRating(50).grade).toBe('C');
    expect(vulnerabilitiesService.getScoreRating(30).grade).toBe('F');
  });

  test('startScan should complete and record findings in the database', async () => {
    const result = await vulnerabilitiesService.startScan('full');
    expect(result).toHaveProperty('scanId');
    expect(result).toHaveProperty('totalFindings');
    expect(result.securityScore).toBeGreaterThanOrEqual(0);
    expect(result.securityScore).toBeLessThanOrEqual(100);

    const findings = await vulnerabilitiesService.getFindings({ scanId: result.scanId });
    expect(findings.length).toBe(result.totalFindings);

    const summary = await vulnerabilitiesService.getSummary();
    expect(summary.counts.total).toBeGreaterThanOrEqual(result.totalFindings);
  });

  test('remediate should reject without confirmation', async () => {
    const findings = await vulnerabilitiesService.getFindings({ status: 'open' });
    if (findings.length > 0) {
      await expect(vulnerabilitiesService.remediate(findings[0].id, { confirmed: false }))
        .rejects.toThrow('Persetujuan manual diperlukan');
    }
  });

  test('remediate should execute safe command and mark finding as fixed', async () => {
    const findings = await vulnerabilitiesService.getFindings({ status: 'open' });
    const target = findings.find(f => f.auto_fix_command);
    if (target) {
      const res = await vulnerabilitiesService.remediate(target.id, {
        confirmed: true,
        user: { id: 'user-vuln-test', username: 'vulntester' },
      });
      expect(res.success).toBe(true);

      const db = getDb();
      const updated = db.prepare('SELECT * FROM vulnerability_findings WHERE id = ?').get(target.id);
      expect(updated.status).toBe('fixed');
      expect(updated.remediation_notes).toBeTruthy();
    }
  });

  test('askAI should return structured advisory with bash command', async () => {
    const res = await vulnerabilitiesService.askAI('Bagaimana cara hardening SSH di Linux?');
    expect(res).toHaveProperty('answer');
    expect(res.answer).toContain('Rekomendasi');
  });

  test('exportReport should generate markdown and JSON reports', async () => {
    const md = await vulnerabilitiesService.exportReport('markdown');
    expect(typeof md).toBe('string');
    expect(md).toContain('Laporan Audit Keamanan');

    const json = await vulnerabilitiesService.exportReport('json');
    expect(json).toHaveProperty('summary');
    expect(json).toHaveProperty('findings');
  });
});

describe('Vulnerabilities API Integration Tests', () => {
  test('GET /api/vulnerabilities/summary should require authentication', async () => {
    const res = await request(app).get('/api/vulnerabilities/summary');
    expect(res.status).toBe(401);
  });

  test('GET /api/vulnerabilities/summary should return 200 with valid token', async () => {
    const res = await request(app)
      .get('/api/vulnerabilities/summary')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('score');
    expect(res.body.data).toHaveProperty('counts');
  });

  test('POST /api/vulnerabilities/scan should trigger new scan', async () => {
    const res = await request(app)
      .post('/api/vulnerabilities/scan')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ type: 'full' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('scanId');
  });

  test('GET /api/vulnerabilities/findings should return findings list', async () => {
    const res = await request(app)
      .get('/api/vulnerabilities/findings')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('POST /api/vulnerabilities/ask-ai should return AI advice', async () => {
    const res = await request(app)
      .post('/api/vulnerabilities/ask-ai')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ question: 'Apa itu CVE-2024-6387 regreSSHion?' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('answer');
  });

  test('GET /vulnerabilities view page should return 200 and render HTML', async () => {
    const res = await request(app).get('/vulnerabilities');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Pusat Kerentanan');
  });
});

