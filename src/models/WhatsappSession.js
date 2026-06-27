import { getDb, generateId, now } from '../core/db/sqlite.js';

const WhatsappSession = {
  async findById(id) {
    const db = getDb();
    return db.prepare('SELECT * FROM whatsapp_sessions WHERE id = ?').get(id);
  },

  async findOne(filter) {
    const db = getDb();
    if (filter.sessionName) {
      return db.prepare('SELECT * FROM whatsapp_sessions WHERE session_name = ?').get(filter.sessionName);
    }
    if (filter.id) return this.findById(filter.id);
    return null;
  },

  async find() {
    const db = getDb();
    return db.prepare('SELECT * FROM whatsapp_sessions ORDER BY created_at DESC').all();
  },

  async create(data) {
    const db = getDb();
    const id = generateId();
    const ts = now();
    db.prepare(`
      INSERT INTO whatsapp_sessions (id, session_name, status, webhook_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, data.sessionName, data.status || 'disconnected', data.webhookUrl || null, ts, ts);
    return this.findById(id);
  },

  async findByIdAndUpdate(id, data) {
    const db = getDb();
    const ts = now();
    const existing = await this.findById(id);
    if (!existing) return null;

    db.prepare(`
      UPDATE whatsapp_sessions SET
        status = ?,
        webhook_url = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      data.status ?? existing.status,
      data.webhookUrl !== undefined ? data.webhookUrl : existing.webhook_url,
      ts,
      id
    );
    return this.findById(id);
  },

  async findByIdAndDelete(id) {
    const db = getDb();
    const existing = await this.findById(id);
    if (!existing) return null;
    db.prepare('DELETE FROM whatsapp_sessions WHERE id = ?').run(id);
    return existing;
  }
};

export default WhatsappSession;
