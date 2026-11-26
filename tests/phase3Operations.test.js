import request from 'supertest';
import jwt from 'jsonwebtoken';
import appConfig from '../src/config/app.js';
import nftablesService from '../src/modules/firewall/nftables.service.js';
import secretVault from '../src/core/security/secretVault.js';
import createApp from '../src/app.js';
import { getDb, now, toJson } from '../src/core/db/sqlite.js';

describe('Phase 3 Pillar 1: nftables Native Firewall & Egress Filtering', () => {
  test('builds valid nftables egress script and rejects invalid ports', () => {
    const script = nftablesService.buildEgressScript({
      allowedTcpPorts: [80, 443],
      allowedUdpPorts: [53],
    });
    expect(script).toContain('table inet panelku_egress');
    expect(script).toContain('policy drop;');
    expect(script).toContain('tcp dport { 80, 443 } accept');
    expect(script).toContain('udp dport { 53 } accept');

    expect(() => nftablesService.buildEgressScript({ allowedTcpPorts: [99999] }))
      .toThrow('Invalid port number');
  });

  test('enableEgressFilter and disableEgressFilter run cleanly in test mode', async () => {
    const en = await nftablesService.enableEgressFilter({ allowedTcpPorts: [443] });
    expect(en.simulated).toBe(true);
    expect(en.script).toContain('443');

    const dis = await nftablesService.disableEgressFilter();
    expect(dis.disabled).toBe(true);
  });
});

describe('Phase 3 Pillar 2: AES-256-GCM Secret Vault & Compose Injection', () => {
  test('encrypts and decrypts with AES-256-GCM and remains backwards-compatible with plaintext', () => {
    const plain = 'super-secret-db-pass-!@#';
    const cipher = secretVault.encrypt(plain);
    expect(secretVault.isEncrypted(cipher)).toBe(true);
    expect(cipher).not.toContain(plain);
    expect(secretVault.decrypt(cipher)).toBe(plain);

    // Legacy plaintext passthrough
    expect(secretVault.decrypt('legacy-plaintext')).toBe('legacy-plaintext');
  });

  test('resolves ${VAULT:KEY} references into in-memory Compose envMap and provides rootless defaults', async () => {
    await secretVault.setSecret('DB_PASS_P3', 'vaulted-p3-secret');
    const yaml = 'services:\n  app:\n    environment:\n      - DB_PASSWORD=${VAULT:DB_PASS_P3}\n';
    const res = await secretVault.resolveComposeSecrets(yaml);

    expect(res.injectedKeys).toContain('DB_PASS_P3');
    expect(res.envMap.DB_PASS_P3).toBe('vaulted-p3-secret');
    expect(res.resolvedYaml).toContain('${DB_PASS_P3}');

    const rootless = secretVault.getRootlessContainerDefaults();
    expect(rootless.SecurityOpt).toContain('no-new-privileges:true');
    expect(rootless.CapDrop).toContain('ALL');

    await secretVault.deleteSecret('DB_PASS_P3');
  });
});

describe('Phase 3 API Integration: nftables & Secret Vault Endpoints', () => {
  let app;
  let token;

  beforeAll(() => {
    app = createApp();
    const db = getDb();
    const ts = now();
    let role = db.prepare("SELECT id FROM roles WHERE slug = 'super_admin'").get();
    if (!role) {
      const roleId = 'role-p3-super-' + Date.now();
      const perms = [
        { resource: 'system', actions: ['read', 'create', 'update', 'delete', 'execute'] },
      ];
      db.prepare(`
        INSERT INTO roles (id, name, slug, description, permissions, is_system, is_active, color, created_at, updated_at)
        VALUES (?, ?, 'super_admin', 'Full access', ?, 1, 1, '#dc3545', ?, ?)
      `).run(roleId, 'Super Admin P3 ' + Date.now(), toJson(perms), ts, ts);
      role = { id: roleId };
    }
    const userId = 'user-p3-' + Date.now();
    db.prepare(`
      INSERT INTO users (id, username, email, password, role_id, is_super_admin, is_active, must_change_password, created_at, updated_at)
      VALUES (?, ?, ?, 'hash', ?, 1, 1, 0, ?, ?)
    `).run(userId, 'p3_' + Date.now(), `p3_${Date.now()}@panelku.local`, role.id, ts, ts);
    token = jwt.sign({ sub: userId }, appConfig.jwt.secret, { algorithm: 'HS256', expiresIn: '1h' });
  });

  test('nftables & vault endpoints return 200 and mask secret values', async () => {
    const nftRes = await request(app)
      .get('/api/firewall/nftables')
      .set('Authorization', `Bearer ${token}`);
    expect(nftRes.status).toBe(200);
    expect(nftRes.body.data).toHaveProperty('egressActive');

    const egressRes = await request(app)
      .post('/api/firewall/nftables/egress')
      .set('Authorization', `Bearer ${token}`)
      .send({ allowedTcpPorts: [80, 443] });
    expect(egressRes.status).toBe(200);

    const setRes = await request(app)
      .post('/api/system/vault/secrets')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'API_TOKEN_P3', value: 'secret-token-value' });
    expect(setRes.status).toBe(200);

    const listRes = await request(app)
      .get('/api/system/vault/secrets')
      .set('Authorization', `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    const entry = listRes.body.data.find((s) => s.name === 'API_TOKEN_P3');
    expect(entry).toBeDefined();
    expect(entry.value).toBeUndefined(); // Never expose plaintext in list

    const delRes = await request(app)
      .delete('/api/system/vault/secrets/API_TOKEN_P3')
      .set('Authorization', `Bearer ${token}`);
    expect(delRes.status).toBe(200);
  });
});
