import BaseRepository from './base.repository.js';
import User from '../models/User.js';
import { getDb, now } from '../core/db/sqlite.js';

class UserRepository extends BaseRepository {
  constructor() {
    super(User);
  }

  async findByUsername(username, _withPassword = false) {
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) return null;
    // Populate role
    return this._populateRole(user);
  }

  async findByEmail(email, _withPassword = false) {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return null;
    return this._populateRole(user);
  }

  async findByApiKey(apiKey) {
    const db  = getDb();
    const row = db.prepare('SELECT * FROM users WHERE api_key = ? AND api_key_enabled = 1 AND is_active = 1').get(apiKey);
    if (!row) return null;
    const user = await User.findById(row.id);
    return this._populateRole(user);
  }

  async findWithRole(filter = {}) {
    const users = await User.find(filter);
    return users.map(u => this._populateRole(u));
  }

  _populateRole(user) {
    if (!user) return null;
    if (user.role && typeof user.role === 'string') {
      const db  = getDb();
      const row = db.prepare('SELECT * FROM roles WHERE id = ?').get(user.role);
      if (row) {
        let perms = [];
        try { perms = JSON.parse(row.permissions); } catch {}
        user.role = {
          _id: row.id, id: row.id, name: row.name, slug: row.slug,
          permissions: perms, color: row.color,
          isSystem: Boolean(row.is_system), isActive: Boolean(row.is_active),
        };
      }
    }
    return user;
  }

  async addSession(userId, sessionData) {
    const db  = getDb();
    const row = db.prepare('SELECT sessions FROM users WHERE id = ?').get(userId);
    if (!row) return null;
    const sessions = (() => { try { return JSON.parse(row.sessions); } catch { return []; } })();
    sessions.push(sessionData);
    db.prepare('UPDATE users SET sessions = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(sessions), now(), userId
    );
    return User.findById(userId);
  }

  async removeSession(userId, sessionId) {
    const db  = getDb();
    const row = db.prepare('SELECT sessions FROM users WHERE id = ?').get(userId);
    if (!row) return null;
    let sessions = (() => { try { return JSON.parse(row.sessions); } catch { return []; } })();
    sessions = sessions.filter(s => s._id !== sessionId && s.id !== sessionId);
    db.prepare('UPDATE users SET sessions = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(sessions), now(), userId
    );
    return User.findById(userId);
  }

  async deactivateAllSessions(userId) {
    const db  = getDb();
    const row = db.prepare('SELECT sessions FROM users WHERE id = ?').get(userId);
    if (!row) return null;
    let sessions = (() => { try { return JSON.parse(row.sessions); } catch { return []; } })();
    sessions = sessions.map(s => ({ ...s, isActive: false }));
    db.prepare('UPDATE users SET sessions = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(sessions), now(), userId
    );
    return User.findById(userId);
  }

  async updateLoginStats(userId, ip) {
    return User.findByIdAndUpdate(userId, {
      $set:  { lastLogin: new Date(), lastLoginIp: ip },
      $inc:  { loginCount: 1 },
    });
  }
}

const userRepository = new UserRepository();
export default userRepository;
