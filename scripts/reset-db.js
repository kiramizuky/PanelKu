import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

const DB_PATH = path.resolve(process.cwd(), 'storage', 'panelku.db');

console.log("\n========================================================");
console.log("            Panelku Database Reset Utility             ");
console.log("========================================================\n");

// 1. Delete existing database file
if (fs.existsSync(DB_PATH)) {
  console.log(`[→] Deleting existing database at ${DB_PATH}...`);
  try {
    fs.unlinkSync(DB_PATH);
    fs.unlinkSync(`${DB_PATH}-shm`);
  } catch (e) {}
  try {
    fs.unlinkSync(`${DB_PATH}-wal`);
  } catch (e) {}
  console.log("[✓] Database deleted successfully.");
} else {
  console.log("[i] No existing database found. Creating a fresh one...");
}

// Ensure storage directory exists
fs.mkdirSync(path.resolve(process.cwd(), 'storage'), { recursive: true });

// 2. Open new database
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 3. Initialize schema
console.log("[→] Initializing database tables...");
db.exec(`
  -- Roles
  CREATE TABLE IF NOT EXISTS roles (
    id            TEXT PRIMARY KEY,
    name          TEXT UNIQUE NOT NULL,
    slug          TEXT UNIQUE NOT NULL,
    description   TEXT,
    permissions   TEXT NOT NULL DEFAULT '[]',
    is_system     INTEGER NOT NULL DEFAULT 0,
    is_active     INTEGER NOT NULL DEFAULT 1,
    color         TEXT NOT NULL DEFAULT '#6c757d',
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );

  -- Users
  CREATE TABLE IF NOT EXISTS users (
    id                  TEXT PRIMARY KEY,
    username            TEXT UNIQUE NOT NULL,
    email               TEXT UNIQUE NOT NULL,
    password            TEXT NOT NULL,
    role_id             TEXT NOT NULL REFERENCES roles(id),
    first_name          TEXT,
    last_name           TEXT,
    is_active           INTEGER NOT NULL DEFAULT 1,
    is_two_factor_enabled INTEGER NOT NULL DEFAULT 0,
    two_factor_secret   TEXT,
    two_factor_temp_secret TEXT,
    login_attempts      INTEGER NOT NULL DEFAULT 0,
    lock_until          TEXT,
    last_login          TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
  );

  -- Settings
  CREATE TABLE IF NOT EXISTS settings (
    id          TEXT PRIMARY KEY,
    key         TEXT UNIQUE NOT NULL,
    value       TEXT,
    type        TEXT NOT NULL DEFAULT 'string',
    group_name  TEXT NOT NULL DEFAULT 'general',
    label       TEXT,
    description TEXT,
    is_public   INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  -- WhatsApp Sessions
  CREATE TABLE IF NOT EXISTS whatsapp_sessions (
    id            TEXT PRIMARY KEY,
    session_name  TEXT UNIQUE NOT NULL,
    status        TEXT NOT NULL DEFAULT 'disconnected',
    webhook_url   TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );
`);

// 4. Seed default roles
console.log("[→] Seeding system roles...");
const roles = [
  { id: uuidv4(), name: 'Super Admin', slug: 'super_admin', desc: 'Full system control', system: 1, perms: '["*"]', color: '#ef4444' },
  { id: uuidv4(), name: 'Admin', slug: 'admin', desc: 'Server management privileges', system: 1, perms: '[]', color: '#3b82f6' },
  { id: uuidv4(), name: 'Operator', slug: 'operator', desc: 'Basic operations and monitoring', system: 1, perms: '[]', color: '#10b981' }
];

const ts = new Date().toISOString();
const insertRole = db.prepare(`
  INSERT INTO roles (id, name, slug, description, permissions, is_system, is_active, color, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
`);

for (const r of roles) {
  insertRole.run(r.id, r.name, r.slug, r.desc, r.perms, r.system, r.color, ts, ts);
}

// 5. Seed default admin user
console.log("[→] Creating default admin user (username: admin, password: admin@123456)...");
const adminRoleId = roles[0].id;
const salt = bcrypt.genSaltSync(10);
const passwordHash = bcrypt.hashSync('admin123', salt);

db.prepare(`
  INSERT INTO users (id, username, email, password, role_id, first_name, last_name, is_active, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
`).run(uuidv4(), 'admin', 'admin@panelku.fun', passwordHash, adminRoleId, 'Super', 'Admin', ts, ts);

db.close();

// 6. Set chmod 777 on db files
console.log("[→] Setting write permissions on database files...");
try {
  fs.chmodSync(DB_PATH, 0o777);
  if (fs.existsSync(`${DB_PATH}-shm`)) fs.chmodSync(`${DB_PATH}-shm`, 0o777);
  if (fs.existsSync(`${DB_PATH}-wal`)) fs.chmodSync(`${DB_PATH}-wal`, 0o777);
} catch (e) {}

console.log("\n========================================================");
console.log("[✓] Database reset successfully!                        ");
console.log("    Username: admin                                     ");
console.log("    Password: admin123                                  ");
console.log("========================================================\n");
