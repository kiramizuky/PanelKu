import { jest } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import appConfig from '../src/config/app.js';
import hardeningService from '../src/modules/vulnerabilities/hardening.service.js';
import fimService from '../src/modules/vulnerabilities/fim.service.js';
import mtlsService from '../src/modules/cluster/mtls.service.js';
import createApp from '../src/app.js';
import { getDb, now, toJson } from '../src/core/db/sqlite.js';

describe('Phase 2 Pillar 1: Baseline Hardening Profiles & Auto-Rollback', () => {
  const tempRoot = path.join(os.tmpdir(), `panelku-hardening-test-${Date.now()}`);

  beforeAll(() => {
    fs.mkdirSync(tempRoot, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('lists web, database, and bastion profiles and generates preview diffs', () => {
    const profiles = hardeningService.listProfiles();
    expect(profiles.map((p) => p.id)).toEqual(['web', 'database', 'bastion']);

    const preview = hardeningService.previewProfile('bastion');
    expect(preview.profile.id).toBe('bastion');
    expect(preview.diffs.length).toBe(4);
    expect(preview.diffs.some((d) => d.key === 'sshd' && d.proposed.includes('PasswordAuthentication no'))).toBe(true);
  });

  test('rejects applyProfile without confirmation and auto-rolls back when healthcheck fails', async () => {
    await expect(hardeningService.applyProfile('web', { confirmed: false }))
      .rejects.toThrow('Manual confirmation is required');

    // Mock filesystem redirecting /etc/* into tempRoot
    const mapPath = (p) => path.join(tempRoot, p.replace(/^\//, ''));
    const existingSysctl = mapPath('/etc/sysctl.d/99-panelku-hardening.conf');
    fs.mkdirSync(path.dirname(existingSysctl), { recursive: true });
    fs.writeFileSync(existingSysctl, '# original sysctl\n', 'utf8');

    const tempFs = {
      existsSync: (p) => fs.existsSync(mapPath(p)),
      readFileSync: (p, enc) => fs.readFileSync(mapPath(p), enc),
      writeFileSync: (p, data, enc) => fs.writeFileSync(mapPath(p), data, enc),
      mkdirSync: (p, opts) => fs.mkdirSync(mapPath(p), opts),
      unlinkSync: (p) => fs.unlinkSync(mapPath(p)),
    };

    // Simulate failed SSH healthcheck -> auto-rollback must restore original files and remove newly created ones
    const result = await hardeningService.applyProfile('web', {
      confirmed: true,
      fsImpl: tempFs,
      healthcheckFn: async () => ({ ok: false, detail: 'sshd syntax error simulated' }),
    });

    expect(result.success).toBe(false);
    expect(result.rolledBack).toBe(true);
    expect(fs.readFileSync(existingSysctl, 'utf8')).toBe('# original sysctl\n');
    expect(fs.existsSync(mapPath('/etc/ssh/sshd_config.d/99-panelku-hardening.conf'))).toBe(false);

    // Now simulate passing healthcheck
    const okResult = await hardeningService.applyProfile('web', {
      confirmed: true,
      fsImpl: tempFs,
      healthcheckFn: async () => ({ ok: true, detail: 'OK' }),
    });
    expect(okResult.success).toBe(true);
    expect(okResult.rolledBack).toBe(false);
    expect(fs.readFileSync(existingSysctl, 'utf8')).toContain('kernel.randomize_va_space = 2');
  });
});

describe('Phase 2 Pillar 2: File Integrity Monitoring (FIM) & Drift Detection', () => {
  const tempDir = path.join(os.tmpdir(), `panelku-fim-test-${Date.now()}`);
  const criticalFile = path.join(tempDir, 'sshd_config');

  beforeAll(() => {
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(criticalFile, 'PermitRootLogin prohibit-password\n', 'utf8');
  });

  afterAll(async () => {
    await fimService.stopWatcher();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('detects SHA-256 hash drift on modified files and clears drift on acceptDrift', async () => {
    const init = fimService.initBaseline([criticalFile]);
    expect(init.trackedCount).toBe(1);

    const cleanCheck = await fimService.checkNow({ notify: false });
    expect(cleanCheck.driftCount).toBe(0);

    // Mutate critical file
    fs.writeFileSync(criticalFile, 'PermitRootLogin yes\n', 'utf8');
    const driftCheck = await fimService.checkNow({ notify: false });
    expect(driftCheck.driftCount).toBe(1);
    expect(driftCheck.drifts[0].file).toBe(criticalFile);
    expect(driftCheck.drifts[0].oldHash).not.toBe(driftCheck.drifts[0].newHash);

    // Accept authorized drift
    fimService.acceptDrift(criticalFile);
    const afterAccept = await fimService.checkNow({ notify: false });
    expect(afterAccept.driftCount).toBe(0);
  });
});

describe('Phase 2 Pillar 3: Zero-Trust mTLS & API Integration', () => {
  let app;
  let token;

  beforeAll(() => {
    app = createApp();
    const db = getDb();
    const ts = now();
    let role = db.prepare("SELECT id FROM roles WHERE slug = 'super_admin'").get();
    if (!role) {
      const roleId = 'role-phase2-super-' + Date.now();
      const perms = [
        { resource: 'vulnerabilities', actions: ['read', 'create', 'update', 'delete', 'execute'] },
        { resource: 'system', actions: ['read', 'create', 'update', 'delete', 'execute'] },
      ];
      db.prepare(`
        INSERT INTO roles (id, name, slug, description, permissions, is_system, is_active, color, created_at, updated_at)
        VALUES (?, ?, 'super_admin', 'Full access', ?, 1, 1, '#dc3545', ?, ?)
      `).run(roleId, 'Super Admin P2 ' + Date.now(), toJson(perms), ts, ts);
      role = { id: roleId };
    }
    const userId = 'user-phase2-' + Date.now();
    db.prepare(`
      INSERT INTO users (id, username, email, password, role_id, is_super_admin, is_active, must_change_password, created_at, updated_at)
      VALUES (?, ?, ?, 'hash', ?, 1, 1, 0, ?, ?)
    `).run(userId, 'phase2_' + Date.now(), `phase2_${Date.now()}@panelku.local`, role.id, ts, ts);
    token = jwt.sign({ sub: userId }, appConfig.jwt.secret, { algorithm: 'HS256', expiresIn: '1h' });
  });

  test('mTLS service enforces strict flag fallback and rejects invalid certs', () => {
    expect(mtlsService.verifyNodeCert('invalid-pem').valid).toBe(false);
    const prev = process.env.AGENT_TLS_STRICT;
    process.env.AGENT_TLS_STRICT = 'true';
    const opts = mtlsService.getWsTlsOptions();
    expect(opts.rejectUnauthorized).toBe(true);
    if (prev === undefined) delete process.env.AGENT_TLS_STRICT;
    else process.env.AGENT_TLS_STRICT = prev;
  });

  test('Phase 2 endpoints return 200 for authenticated admin', async () => {
    const profRes = await request(app)
      .get('/api/vulnerabilities/hardening/profiles')
      .set('Authorization', `Bearer ${token}`);
    expect(profRes.status).toBe(200);
    expect(profRes.body.data.length).toBe(3);

    const prevRes = await request(app)
      .get('/api/vulnerabilities/hardening/preview/web')
      .set('Authorization', `Bearer ${token}`);
    expect(prevRes.status).toBe(200);
    expect(prevRes.body.data.profile.id).toBe('web');

    const fimRes = await request(app)
      .get('/api/vulnerabilities/fim/status')
      .set('Authorization', `Bearer ${token}`);
    expect(fimRes.status).toBe(200);
    expect(fimRes.body.data).toHaveProperty('trackedCount');

    const mtlsRes = await request(app)
      .get('/api/cluster/mtls/status')
      .set('Authorization', `Bearer ${token}`);
    expect(mtlsRes.status).toBe(200);
    expect(mtlsRes.body.data).toHaveProperty('initialized');
  });
});
