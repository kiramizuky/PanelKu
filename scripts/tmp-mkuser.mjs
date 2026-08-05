import bcrypt from 'bcryptjs';
import { getDb, now, generateId } from '../src/core/db/sqlite.js';

const db = getDb();
const roles = db.prepare('SELECT id, slug FROM roles').all();
console.log('ROLES:', JSON.stringify(roles));
let roleId = roles.find(r => r.slug === 'super_admin')?.id;
if (!roleId) {
  roleId = generateId();
  const ts = now();
  db.prepare("INSERT INTO roles (id,name,slug,description,permissions,is_system,is_active,color,created_at,updated_at) VALUES (?,?,?,?,?,1,1,?,?,?)")
    .run(roleId, 'Super Admin', 'super_admin', 'Full access', JSON.stringify([{ resource: '*', actions: ['read', 'create', 'update', 'delete', 'execute'] }]), '#dc3545', ts, ts);
  console.log('CREATED ROLE');
}
const ts = now();
const hash = bcrypt.hashSync('Verify@12345', 10);
const existing = db.prepare("SELECT id FROM users WHERE username='verifyadmin'").get();
let userId;
if (existing) {
  db.prepare("UPDATE users SET password=?, role_id=?, is_super_admin=1, updated_at=? WHERE id=?").run(hash, roleId, ts, existing.id);
  userId = existing.id;
  console.log('UPDATED existing verifyadmin, id=' + userId);
} else {
  userId = generateId();
  db.prepare("INSERT INTO users (id,username,email,password,role_id,is_super_admin,is_active,must_change_password,created_at,updated_at) VALUES (?,?,?,?,?,1,1,0,?,?)")
    .run(userId, 'verifyadmin', 'verifyadmin@test.local', hash, roleId, ts, ts);
  console.log('CREATED verifyadmin, id=' + userId);
}
const u = db.prepare("SELECT id, username, is_super_admin, role_id FROM users WHERE id=?").get(userId);
console.log('VERIFY:', JSON.stringify(u));
process.exit(0);
