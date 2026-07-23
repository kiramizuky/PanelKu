/**
 * User model — SQLite adapter
 * Provides Mongoose-compatible static methods and instance methods
 * so the repository/service layer needs minimal changes.
 */
import { getDb, generateId, now, toJson, fromJson } from '../core/db/sqlite.js';
import bcrypt from 'bcryptjs';

// ── Internal helpers ──────────────────────────────────────────────────────

function rowToUser(row) {
  if (!row) return null;
  const user = {
    _id:               row.id,
    id:                row.id,
    username:          row.username,
    email:             row.email,
    password:          row.password,
    role:              row.role_id,   // populated separately when needed
    firstName:         row.first_name,
    lastName:          row.last_name,
    avatar:            row.avatar,
    twoFactorEnabled:  Boolean(row.two_factor_enabled),
    twoFactorSecret:   row.two_factor_secret,
    apiKey:            row.api_key,
    apiKeyEnabled:     Boolean(row.api_key_enabled),
    isActive:          Boolean(row.is_active),
    isSuperAdmin:      Boolean(row.is_super_admin),
    isLdapUser:        Boolean(row.is_ldap_user),
    ssoLinks:          fromJson(row.sso_links, {}),
    sessions:          fromJson(row.sessions, []),
    aiSettings:        fromJson(row.ai_settings, { provider: 'openai', apiKey: '', model: 'gpt-4o-mini' }),
    lastLogin:         row.last_login ? new Date(row.last_login) : null,
    lastLoginIp:       row.last_login_ip,
    loginCount:        row.login_count,
    resetToken:        row.reset_token,
    resetTokenExpiry:  row.reset_token_expiry ? new Date(row.reset_token_expiry) : null,
    createdAt:         new Date(row.created_at),
    updatedAt:         new Date(row.updated_at),
  };

  // Computed fullName
  user.fullName = (user.firstName && user.lastName)
    ? `${user.firstName} ${user.lastName}`
    : user.username;

  // Instance methods
  user.comparePassword = async (plain) => bcrypt.compare(plain, user.password);
  user.cleanSessions   = () => { user.sessions = user.sessions.filter(s => s.isActive); };
  user.toJSON = () => { const u = { ...user }; delete u.password; delete u.twoFactorSecret; delete u.apiKey; return u; };
  user.toObject = () => user.toJSON();

  return user;
}

function populateRole(user) {
  if (!user || !user.role) return user;
  const db   = getDb();
  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(user.role);
  if (role) {
    user.role = {
      _id:         role.id,
      id:          role.id,
      name:        role.name,
      slug:        role.slug,
      description: role.description,
      permissions: fromJson(role.permissions, []),
      isSystem:    Boolean(role.is_system),
      isActive:    Boolean(role.is_active),
      color:       role.color,
    };
  }
  return user;
}

// ── Static API (mirrors Mongoose model statics) ───────────────────────────

const User = {
  async findById(id) {
    if (!id) return null;
    const db  = getDb();
    let row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!row && !isNaN(Number(id))) {
      row = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id));
    }
    const user = rowToUser(row);
    return populateRole(user);
  },

  async findOne(filter, _select) {
    const db = getDb();
    if (filter.username) {
      const row = db.prepare('SELECT * FROM users WHERE username = ?').get(filter.username.toLowerCase());
      return populateRole(rowToUser(row));
    }
    if (filter.email) {
      const row = db.prepare('SELECT * FROM users WHERE email = ?').get(filter.email.toLowerCase());
      return populateRole(rowToUser(row));
    }
    if (filter.apiKey) {
      const row = db.prepare('SELECT * FROM users WHERE api_key = ? AND api_key_enabled = 1 AND is_active = 1').get(filter.apiKey);
      return populateRole(rowToUser(row));
    }
    if (filter._id || filter.id) {
      return this.findById(filter._id || filter.id);
    }
    // Fallback: return first user
    const row = db.prepare('SELECT * FROM users LIMIT 1').get();
    return populateRole(rowToUser(row));
  },

  // Returns a chainable-like object (simplified populate support)
  findOne_chain(filter) {
    const self = this;
    let _user = null;
    const chain = {
      populate: async () => {
        _user = await self.findOne(filter);
        return chain;
      },
      exec: async () => {
        if (!_user) _user = await self.findOne(filter);
        return _user;
      },
      then: (resolve, reject) => chain.exec().then(resolve, reject),
    };
    return chain;
  },

  async find(filter = {}, _select) {
    const db = getDb();
    let sql  = 'SELECT * FROM users WHERE 1=1';
    const params = [];

    if (filter.isActive !== undefined) {
      sql += ' AND is_active = ?';
      params.push(filter.isActive ? 1 : 0);
    }
    if (filter.isSuperAdmin !== undefined) {
      sql += ' AND is_super_admin = ?';
      params.push(filter.isSuperAdmin ? 1 : 0);
    }
    if (filter.role) {
      sql += ' AND role_id = ?';
      params.push(filter.role);
    }

    sql += ' ORDER BY created_at ASC';
    const rows = db.prepare(sql).all(...params);
    return rows.map(r => populateRole(rowToUser(r)));
  },

  async countDocuments(_filter = {}) {
    const db = getDb();
    const row = db.prepare('SELECT COUNT(*) as c FROM users').get();
    return row.c;
  },

  async create(data) {
    const db = getDb();
    const id = data._id || data.id || generateId('usr');
    const ts = now();

    let passwordHash = data.password;
    if (passwordHash && !passwordHash.startsWith('$2')) {
      passwordHash = await bcrypt.hash(passwordHash, 10);
    }

    db.prepare(`
      INSERT INTO users (
        id, username, email, password, role_id, first_name, last_name, avatar,
        two_factor_enabled, two_factor_secret, api_key, api_key_enabled,
        is_active, is_super_admin, is_ldap_user, sso_links, sessions, ai_settings,
        login_count, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        0, ?, ?
      )
    `).run(
      id,
      data.username?.toLowerCase(),
      data.email?.toLowerCase() || null,
      passwordHash || '',
      data.role || null,
      data.firstName || null,
      data.lastName || null,
      data.avatar || null,
      data.twoFactorEnabled ? 1 : 0,
      data.twoFactorSecret || null,
      data.apiKey || null,
      data.apiKeyEnabled ? 1 : 0,
      data.isActive !== undefined ? (data.isActive ? 1 : 0) : 1,
      data.isSuperAdmin ? 1 : 0,
      data.isLdapUser ? 1 : 0,
      toJson(data.ssoLinks || {}),
      toJson(data.sessions || []),
      toJson(data.aiSettings || { provider: 'openai', apiKey: '', model: 'gpt-4o-mini' }),
      ts, ts
    );

    return this.findById(id);
  },

  async findByIdAndUpdate(id, update, _options = {}) {
    if (!id) return null;
    const db = getDb();
    let existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!existing && !isNaN(Number(id))) {
      existing = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id));
    }
    if (!existing) return null;

    const realId = existing.id;
    const sets = [];
    const vals = [];
    const ts = now();

    const fieldMap = {
      username: 'username', email: 'email', password: 'password',
      firstName: 'first_name', lastName: 'last_name', avatar: 'avatar',
      twoFactorEnabled: 'two_factor_enabled', twoFactorSecret: 'two_factor_secret',
      apiKey: 'api_key', apiKeyEnabled: 'api_key_enabled',
      isActive: 'is_active', isSuperAdmin: 'is_super_admin',
      isLdapUser: 'is_ldap_user', ssoLinks: 'sso_links',
      sessions: 'sessions', lastLogin: 'last_login', lastLoginIp: 'last_login_ip',
      loginCount: 'login_count', resetToken: 'reset_token',
      resetTokenExpiry: 'reset_token_expiry', role: 'role_id',
      aiSettings: 'ai_settings',
    };

    // Handle $set operator
    const setOps = update.$set || update;
    for (const [key, val] of Object.entries(setOps)) {
      if (key.startsWith('$')) continue;
      const col = fieldMap[key];
      if (!col) continue;
      sets.push(`${col} = ?`);
      if (key === 'twoFactorEnabled' || key === 'apiKeyEnabled' || key === 'isActive' || key === 'isSuperAdmin') {
        vals.push(val ? 1 : 0);
      } else if (key === 'sessions' || key === 'aiSettings') {
        vals.push(toJson(val));
      } else if (val instanceof Date) {
        vals.push(val.toISOString());
      } else {
        vals.push(val);
      }
    }

    // Handle $inc operator
    if (update.$inc) {
      for (const [key, val] of Object.entries(update.$inc)) {
        const col = fieldMap[key];
        if (col) { sets.push(`${col} = ${col} + ?`); vals.push(val); }
      }
    }

    // Handle $push (for sessions)
    if (update.$push?.sessions) {
      const current = fromJson(existing.sessions, []);
      current.push(update.$push.sessions);
      sets.push('sessions = ?');
      vals.push(toJson(current));
    }

    // Handle $pull (for sessions)
    if (update.$pull?.sessions) {
      const pullId = update.$pull.sessions._id;
      const current = fromJson(existing.sessions, []);
      const filtered = current.filter(s => s._id !== pullId && s.id !== pullId);
      sets.push('sessions = ?');
      vals.push(toJson(filtered));
    }

    if (sets.length === 0) return rowToUser(existing);

    sets.push('updated_at = ?');
    vals.push(ts);
    vals.push(realId);

    db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(realId);
    return populateRole(rowToUser(updated));
  },

  async findByIdAndDelete(id) {
    if (!id) return null;
    const db = getDb();
    let row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!row && !isNaN(Number(id))) {
      row = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id));
    }
    if (!row) return null;
    db.prepare('DELETE FROM users WHERE id = ?').run(row.id);
    return rowToUser(row);
  },
};

export default User;
