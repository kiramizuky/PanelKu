import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../src/core/db/sqlite.js';

const DB_PATH = path.resolve(process.cwd(), 'storage', 'panelku.db');

console.log("\n========================================================");
console.log("            Panelku Database Reset Utility             ");
console.log("========================================================\n");

// 1. Delete existing database file
if (fs.existsSync(DB_PATH)) {
  console.log(`[→] Deleting existing database at ${DB_PATH}...`);
  try {
    fs.unlinkSync(DB_PATH);
    if (fs.existsSync(`${DB_PATH}-shm`)) fs.unlinkSync(`${DB_PATH}-shm`);
    if (fs.existsSync(`${DB_PATH}-wal`)) fs.unlinkSync(`${DB_PATH}-wal`);
  } catch (e) {
    console.warn(`[!] Warning deleting db files: ${e.message}`);
  }
  console.log("[✓] Database deleted successfully.");
} else {
  console.log("[i] No existing database found. Creating a fresh one...");
}

// Ensure storage directory exists
fs.mkdirSync(path.resolve(process.cwd(), 'storage'), { recursive: true });

// 2. Open new database & initialize complete schema via sqlite singleton
console.log("[→] Initializing database tables...");
const db = getDb();

// 3. Seed default roles
console.log("[→] Seeding system roles...");
const roles = [
  { id: uuidv4(), name: 'Super Admin', slug: 'super_admin', desc: 'Full system control', system: 1, perms: '["*"]', color: '#ef4444' },
  { id: uuidv4(), name: 'Admin', slug: 'admin', desc: 'Server management privileges', system: 1, perms: '[]', color: '#3b82f6' },
  { id: uuidv4(), name: 'Operator', slug: 'operator', desc: 'Basic operations and monitoring', system: 1, perms: '[]', color: '#10b981' },
  { id: uuidv4(), name: 'Read Only', slug: 'read_only', desc: 'View-only access', system: 1, perms: '[]', color: '#6c757d' }
];

const ts = new Date().toISOString();
const insertRole = db.prepare(`
  INSERT OR REPLACE INTO roles (id, name, slug, description, permissions, is_system, is_active, color, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
`);

for (const r of roles) {
  insertRole.run(r.id, r.name, r.slug, r.desc, r.perms, r.system, r.color, ts, ts);
}

// 4. Seed default admin user
console.log("[→] Creating default admin user (username: admin, password: Admin@123456)...");
const adminRoleId = roles[0].id;
const salt = bcrypt.genSaltSync(10);
const passwordHash = bcrypt.hashSync('Admin@123456', salt);

// [LOW-2 FIX] Force password change on first login for default admin
const ts2 = new Date().toISOString();
db.prepare(`
  INSERT OR REPLACE INTO users (id, username, email, password, role_id, first_name, last_name,
    is_active, is_super_admin, must_change_password, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 1, ?, ?)
`).run(uuidv4(), 'admin', 'admin@panelku.fun', passwordHash, adminRoleId, 'Super', 'Admin', ts2, ts2);

// 5. Set chmod 777 on storage directory and db files (Linux)
console.log("[→] Setting write permissions on database directory and files...");
try {
  fs.chmodSync(path.resolve(process.cwd(), 'storage'), 0o777);
  if (fs.existsSync(DB_PATH)) fs.chmodSync(DB_PATH, 0o777);
  if (fs.existsSync(`${DB_PATH}-shm`)) fs.chmodSync(`${DB_PATH}-shm`, 0o777);
  if (fs.existsSync(`${DB_PATH}-wal`)) fs.chmodSync(`${DB_PATH}-wal`, 0o777);
} catch (e) {}

console.log("\n========================================================");
console.log("[✓] Database reset successfully!                        ");
console.log("    Username: admin                                     ");
console.log("    Password: Admin@123456                              ");
console.log("========================================================\n");
