import { getDb, generateId, now } from '../../core/db/sqlite.js';
import logger from '../../config/logger.js';

class ClusterService {
  async getNodes() {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM cluster_nodes ORDER BY created_at DESC').all();
    return rows.map(r => ({
      id:        r.id,
      name:      r.name,
      ipAddress: r.ip_address,
      port:      r.port,
      apiKey:    r.api_key,
      status:    r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  /**
   * Build the base URL for a node.
   * If port is 0 / null / falsy → use domain directly (HTTPS assumed).
   * If port is 443 or 80, the protocol is chosen automatically.
   */
  _buildBaseUrl(node) {
    const host = node.ip_address;
    const port = parseInt(node.port);

    // No port (or 0) → domain-only access (user has a reverse-proxy with domain)
    if (!port) return `https://${host}`;
    if (port === 443) return `https://${host}`;
    if (port === 80)  return `http://${host}`;
    // Fallback: plain http with port (local network / direct access)
    return `http://${host}:${port}`;
  }

  async addNode(name, ipAddress, port, apiKey) {
    const db = getDb();
    const id = generateId();
    const timestamp = now();

    // port = 0 means "no port / domain-only mode"
    const portVal = port ? (parseInt(port) || 0) : 0;

    try {
      db.prepare(`
        INSERT INTO cluster_nodes (id, name, ip_address, port, api_key, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'offline', ?, ?)
      `).run(id, name, ipAddress, portVal, apiKey, timestamp, timestamp);

      this.pingNode(id).catch(() => {});
      return { id, name, ipAddress, port: portVal, apiKey, status: 'offline' };
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
    const node = db.prepare('SELECT * FROM cluster_nodes WHERE id = ?').get(id);
    if (!node) throw new Error('Node not found');

    let status = 'offline';
    try {
      const baseUrl = this._buildBaseUrl(node);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      // Use dedicated /api/agent/health endpoint (requires X-API-Key, no RBAC)
      const res = await fetch(`${baseUrl}/api/agent/health`, {
        method: 'GET',
        headers: { 'X-API-Key': node.api_key, 'Accept': 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        // Accept both {status:'online'} and {status:'ok'} for compatibility
        if (data.success || data.status === 'online' || data.status === 'ok') {
          status = 'online';
        }
      }
    } catch {
      status = 'offline';
    }

    db.prepare('UPDATE cluster_nodes SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, now(), id);

    return status;
  }

  /**
   * Fetch resource metrics (CPU / RAM / Disk) from a node.
   * Returns null if the node is offline or metrics endpoint not available.
   */
  async getNodeMetrics(id) {
    const db = getDb();
    const node = db.prepare('SELECT * FROM cluster_nodes WHERE id = ?').get(id);
    if (!node) throw new Error('Node not found');

    try {
      const baseUrl = this._buildBaseUrl(node);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      // Use dedicated /api/agent/metrics endpoint (requires X-API-Key, no RBAC dependency)
      const res = await fetch(`${baseUrl}/api/agent/metrics`, {
        method: 'GET',
        headers: { 'X-API-Key': node.api_key, 'Accept': 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) return null;
      const data = await res.json();
      return data?.data || null;
    } catch {
      return null;
    }
  }

  async pingAllNodes() {
    const db = getDb();
    const nodes = db.prepare('SELECT id FROM cluster_nodes').all();
    for (const node of nodes) {
      try { await this.pingNode(node.id); } catch (_) {}
    }
  }
}

export default new ClusterService();
