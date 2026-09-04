import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { getDb, generateId, now } from '../src/core/db/sqlite.js';

const targetApiKey = process.argv[2]?.trim();

if (!targetApiKey) {
  console.error('[✗] Error: API key argument is required. Usage: node scripts/setup-agent-node.js <API_KEY>');
  process.exit(1);
}

console.log('[→] Initializing SQLite database schema...');
const db = getDb();

// 1. Ensure default roles exist
console.log('[→] Checking system roles...');
const existingRoles = db.prepare('SELECT COUNT(*) as c FROM roles').get();
if (!existingRoles || existingRoles.c === 0) {
  console.log('[→] Seeding default system roles...');
  const roles = [
    { id: generateId(), name: 'Super Admin', slug: 'super_admin', desc: 'Full system control', system: 1, perms: '["*"]', color: '#ef4444' },
    { id: generateId(), name: 'Admin', slug: 'admin', desc: 'Server management privileges', system: 1, perms: '[]', color: '#3b82f6' },
    { id: generateId(), name: 'Operator', slug: 'operator', desc: 'Basic operations and monitoring', system: 1, perms: '[]', color: '#10b981' },
    { id: generateId(), name: 'Read Only', slug: 'read_only', desc: 'View-only access', system: 1, perms: '[]', color: '#6c757d' }
  ];
  const ts = now();
  const insertRole = db.prepare(`
    INSERT OR REPLACE INTO roles (id, name, slug, description, permissions, is_system, is_active, color, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `);
  for (const r of roles) {
    insertRole.run(r.id, r.name, r.slug, r.desc, r.perms, r.system, r.color, ts, ts);
  }
}

const superAdminRole = db.prepare('SELECT id FROM roles WHERE slug = ?').get('super_admin');
const roleId = superAdminRole ? superAdminRole.id : null;

// 2. Check if admin user exists
const adminUser = db.prepare('SELECT * FROM users WHERE is_super_admin = 1 OR username = ?').get('admin');

if (!adminUser) {
  console.log('[→] Creating default admin user with pairing API Key...');
  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync('Admin@123456', salt);
  const ts = now();

  db.prepare(`
    INSERT INTO users (
      id, username, email, password, role_id, first_name, last_name,
      api_key, api_key_enabled, is_active, is_super_admin, must_change_password,
      created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, 1, 1, 1, 1,
      ?, ?
    )
  `).run(
    generateId(),
    'admin',
    'admin@panelku.local',
    passwordHash,
    roleId,
    'Super',
    'Admin',
    targetApiKey,
    ts,
    ts
  );
  console.log('[✓] Admin user created with specified Agent API Key.');
} else {
  console.log(`[→] Updating admin user (${adminUser.username}) with pairing API Key...`);
  const ts = now();
  db.prepare(`
    UPDATE users
    SET api_key = ?, api_key_enabled = 1, is_active = 1, updated_at = ?
    WHERE id = ?
  `).run(targetApiKey, ts, adminUser.id);
  console.log('[✓] Admin user updated with specified Agent API Key.');
}

// 3. Set proper directory permissions
try {
  const storageDir = path.resolve(process.cwd(), 'storage');
  if (fs.existsSync(storageDir)) {
    fs.chmodSync(storageDir, 0o750);
  }
} catch (_) {}

console.log('[✓] Agent node environment setup completed successfully.');
