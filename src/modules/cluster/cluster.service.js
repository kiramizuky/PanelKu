import { getDb, generateId, now } from '../../core/db/sqlite.js';
import logger from '../../config/logger.js';

class ClusterService {
  async getNodes() {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM cluster_nodes ORDER BY created_at DESC').all();
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      ipAddress: r.ip_address,
      port: r.port,
      apiKey: r.api_key,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
  }

  async addNode(name, ipAddress, port, apiKey) {
    const db = getDb();
    const id = generateId();
    const timestamp = now();

    try {
      db.prepare(`
        INSERT INTO cluster_nodes (id, name, ip_address, port, api_key, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'offline', ?, ?)
      `).run(id, name, ipAddress, parseInt(port) || 23456, apiKey, timestamp, timestamp);

      // Perform background ping right after creation
      this.pingNode(id).catch(() => {});

      return { id, name, ipAddress, port, apiKey, status: 'offline' };
    } catch (err) {
      logger.error(`Failed to add cluster node: ${err.message}`);
      throw new Error(err.message.includes('UNIQUE') ? 'Node name must be unique' : 'Failed to add node');
    }
  }

  async deleteNode(id) {
    const db = getDb();
    const result = db.prepare('DELETE FROM cluster_nodes WHERE id = ?').run(id);
    if (result.changes === 0) throw new Error('Node not found');
    return true;
  }

  async pingNode(id) {
    const db = getDb();
    const node = db.prepare('SELECT * FROM cluster_nodes WHERE id = ?').get();
    if (!node) throw new Error('Node not found');

    let status = 'offline';
    try {
      const url = `http://${node.ip_address}:${node.port}/api/health`;
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'X-API-Key': node.api_key,
          'Accept': 'application/json'
        },
        timeout: 4000
      });

      if (res.ok) {
        status = 'online';
      }
    } catch (err) {
      status = 'offline';
    }

    db.prepare('UPDATE cluster_nodes SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, now(), id);

    return status;
  }

  async pingAllNodes() {
    const db = getDb();
    const nodes = db.prepare('SELECT id FROM cluster_nodes').all();
    for (const node of nodes) {
      try {
        await this.pingNode(node.id);
      } catch (_) {}
    }
  }
}

export default new ClusterService();
