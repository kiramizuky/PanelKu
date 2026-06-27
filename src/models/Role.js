/**
 * Role model — SQLite adapter
 */
import { getDb, generateId, now, toJson, fromJson } from '../core/db/sqlite.js';

function rowToRole(row) {
  if (!row) return null;
  return {
    _id:         row.id,
    id:          row.id,
    name:        row.name,
    slug:        row.slug,
    description: row.description,
    permissions: fromJson(row.permissions, []),
    isSystem:    Boolean(row.is_system),
    isActive:    Boolean(row.is_active),
    color:       row.color,
    createdAt:   new Date(row.created_at),
    updatedAt:   new Date(row.updated_at),
    toJSON()  { return { ...this }; },
    toObject(){ return { ...this }; },
  };
}

const Role = {
  async findById(id) {
    const db = getDb();
    return rowToRole(db.prepare('SELECT * FROM roles WHERE id = ?').get(id));
  },

  async findOne(filter) {
    const db = getDb();
    if (filter.slug) return rowToRole(db.prepare('SELECT * FROM roles WHERE slug = ?').get(filter.slug));
    if (filter.name) return rowToRole(db.prepare('SELECT * FROM roles WHERE name = ?').get(filter.name));
    if (filter._id || filter.id) return this.findById(filter._id || filter.id);
    return null;
  },

  async find(filter = {}) {
    const db = getDb();
    let rows;
    if (filter.isActive !== undefined) {
      rows = db.prepare('SELECT * FROM roles WHERE is_active = ? ORDER BY name ASC').all(filter.isActive ? 1 : 0);
    } else {
      rows = db.prepare('SELECT * FROM roles ORDER BY name ASC').all();
    }
    return rows.map(rowToRole);
  },

  async countDocuments() {
    const db = getDb();
    return db.prepare('SELECT COUNT(*) as c FROM roles').get().c;
  },

  async create(data) {
    const db = getDb();
    const id = generateId();
    const ts = now();
    db.prepare(`
      INSERT INTO roles (id, name, slug, description, permissions, is_system, is_active, color, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, data.name, data.slug.toLowerCase(), data.description || null,
      toJson(data.permissions || []),
      data.isSystem ? 1 : 0, data.isActive !== false ? 1 : 0,
      data.color || '#6c757d', ts, ts
    );
    return this.findById(id);
  },

  async findOneAndUpdate(filter, data, options = {}) {
    const db = getDb();
    const ts = now();
    let existing = await this.findOne(filter);

    if (!existing && options.upsert) {
      return this.create({ ...data, slug: filter.slug || data.slug, name: data.name || filter.name });
    }
    if (!existing) return null;

    db.prepare(`
      UPDATE roles SET
        name = ?, slug = ?, description = ?, permissions = ?,
        is_system = ?, is_active = ?, color = ?, updated_at = ?
      WHERE id = ?
    `).run(
      data.name ?? existing.name,
      data.slug ?? existing.slug,
      data.description ?? existing.description,
      toJson(data.permissions ?? existing.permissions),
      data.isSystem !== undefined ? (data.isSystem ? 1 : 0) : (existing.isSystem ? 1 : 0),
      data.isActive !== undefined ? (data.isActive ? 1 : 0) : (existing.isActive ? 1 : 0),
      data.color ?? existing.color,
      ts, existing.id
    );
    return this.findById(existing.id);
  },

  async findByIdAndUpdate(id, data, options = {}) {
    return this.findOneAndUpdate({ _id: id }, data, options);
  },

  async findByIdAndDelete(id) {
    const db = getDb();
    const role = await this.findById(id);
    if (!role) return null;
    db.prepare('DELETE FROM roles WHERE id = ?').run(id);
    return role;
  },
};

export default Role;
