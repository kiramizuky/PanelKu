import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';

const execAsync = promisify(exec);

class CdnService {
  // ── Cloudflare API Integration ────────────────────────────

  async getCloudflareZones(apiKey, email) {
    if (!apiKey || !email) throw new Error('Cloudflare API key and email are required');
    if (!/^[a-zA-Z0-9_-]+$/.test(apiKey)) throw new Error('Invalid API key format');

    try {
      const res = await fetch('https://api.cloudflare.com/client/v4/zones?per_page=50', {
        headers: {
          'X-Auth-Key': apiKey,
          'X-Auth-Email': email,
          'Content-Type': 'application/json',
        },
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.errors?.[0]?.message || 'Cloudflare API error');
      return { zones: data.result.map(z => ({ id: z.id, name: z.name, status: z.status, plan: z.plan?.name })) };
    } catch (err) {
      throw new Error('Cloudflare API error: ' + err.message);
    }
  }

  async purgeCloudflareCache(apiKey, email, zoneId) {
    if (!apiKey || !email || !zoneId) throw new Error('API key, email, and zone ID are required');
    if (!/^[a-zA-Z0-9_-]+$/.test(apiKey)) throw new Error('Invalid API key');

    try {
      const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
        method: 'POST',
        headers: {
          'X-Auth-Key': apiKey,
          'X-Auth-Email': email,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ purge_everything: true }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.errors?.[0]?.message || 'Purge failed');
      return { success: true, zoneId, zoneName: data.result?.id || zoneId };
    } catch (err) {
      throw new Error('Purge failed: ' + err.message);
    }
  }

  async purgeCloudflareUrls(apiKey, email, zoneId, urls) {
    if (!apiKey || !email || !zoneId || !urls?.length) throw new Error('Missing parameters');
    if (!/^[a-zA-Z0-9_-]+$/.test(apiKey)) throw new Error('Invalid API key');

    try {
      const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
        method: 'POST',
        headers: {
          'X-Auth-Key': apiKey,
          'X-Auth-Email': email,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ files: Array.isArray(urls) ? urls : [urls] }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.errors?.[0]?.message || 'Purge failed');
      return { success: true, files: urls.length };
    } catch (err) {
      throw new Error('Purge failed: ' + err.message);
    }
  }

  async getCloudflareAnalytics(apiKey, email, zoneId) {
    if (!apiKey || !email || !zoneId) throw new Error('Missing parameters');
    if (!/^[a-zA-Z0-9_-]+$/.test(apiKey)) throw new Error('Invalid API key');

    try {
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${zoneId}/analytics/dashboard?since=-86400&continuous=true`,
        { headers: { 'X-Auth-Key': apiKey, 'X-Auth-Email': email, 'Content-Type': 'application/json' } }
      );
      const data = await res.json();
      if (!data.success) throw new Error(data.errors?.[0]?.message || 'Analytics error');
      return data.result?.totals;
    } catch (err) {
      throw new Error('Analytics error: ' + err.message);
    }
  }

  // ── Varnish Cache ────────────────────────────────────────

  async getVarnishStatus() {
    try {
      const { stdout } = await execAsync('systemctl is-active varnish 2>/dev/null || echo "inactive"');
      const active = stdout.trim() === 'active';
      let version = null, stats = null;

      if (active) {
        try {
          const { stdout: ver } = await execAsync('varnishd -V 2>&1 | head -1');
          version = ver.trim();
        } catch {}
        try {
          const { stdout: st } = await execAsync('varnishstat -1 2>/dev/null | head -20');
          const lines = st.split('\n').filter(l => l.trim());
          stats = {};
          for (const line of lines.slice(0, 15)) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 3) stats[parts[0]] = parts[1];
          }
        } catch {}
      }

      return { active, version, stats };
    } catch { return { active: false, version: null, stats: null }; }
  }

  async controlVarnish(action) {
    if (!['start', 'stop', 'restart', 'reload'].includes(action)) throw new Error('Invalid action');
    try {
      const { stdout } = await execAsync(`sudo systemctl ${action} varnish 2>&1`);
      return { success: true, output: stdout.trim() };
    } catch (err) {
      throw new Error(`Failed to ${action} Varnish: ${err.message}`);
    }
  }

  async getVarnishConfig() {
    try {
      const { stdout } = await execAsync('cat /etc/varnish/default.vcl 2>/dev/null || echo ""');
      return stdout;
    } catch { return ''; }
  }

  async saveVarnishConfig(content) {
    if (!content || content.length > 100000) throw new Error('Config content too large');
    const tmpPath = '/tmp/panelku-vcl.tmp';
    try {
      // [SECURITY] Write to temp file using fs (NO shell interpolation)
      await fs.writeFile(tmpPath, content, 'utf8');

      // Validate VCL syntax using execFile with args array (no shell)
      await new Promise((resolve, reject) => {
        execFile('varnishd', ['-C', '-f', tmpPath], { timeout: 10000 }, (err) => {
          if (err) reject(new Error('VCL syntax error'));
          else resolve();
        });
      });

      // Copy to config directory using execFile
      await new Promise((resolve, reject) => {
        execFile('sudo', ['cp', tmpPath, '/etc/varnish/default.vcl'], { timeout: 10000 }, (err) => {
          if (err) reject(new Error('Failed to copy VCL'));
          else resolve();
        });
      });

      // Reload Varnish
      await execFile('sudo', ['systemctl', 'reload', 'varnish']);
      await fs.unlink(tmpPath).catch(() => {});
      return { success: true };
    } catch (err) {
      await fs.unlink(tmpPath).catch(() => {});
      throw new Error('Invalid VCL or save failed: ' + err.message);
    }
  }

  async purgeVarnish() {
    try {
      await execAsync('sudo varnishadm ban req.url "~" . 2>/dev/null || echo "ban req.url ~ /" | varnishadm -S /etc/varnish/secret -T 127.0.0.1:6082 2>/dev/null');
      return { success: true };
    } catch (err) {
      throw new Error('Varnish purge failed: ' + err.message);
    }
  }

  // ── Redis Cache ──────────────────────────────────────────

  async getRedisCacheInfo() {
    try {
      const { stdout } = await execAsync('redis-cli -h 127.0.0.1 -p 6379 INFO stats 2>/dev/null || redis-cli INFO stats 2>/dev/null || echo ""');
      const info = {};
      const lines = stdout.split('\n');
      for (const line of lines) {
        if (line.includes('keyspace_hits')) info.hits = parseInt(line.split(':')[1]);
        if (line.includes('keyspace_misses')) info.misses = parseInt(line.split(':')[1]);
        if (line.includes('expired_keys')) info.expired = parseInt(line.split(':')[1]);
        if (line.includes('evicted_keys')) info.evicted = parseInt(line.split(':')[1]);
      }
      if (info.hits !== undefined || info.misses !== undefined) {
        const total = (info.hits || 0) + (info.misses || 0);
        info.hitRate = total > 0 ? ((info.hits / total) * 100).toFixed(1) + '%' : '0%';
      }
      return info;
    } catch { return {}; }
  }

  async flushRedisCache() {
    try {
      await execAsync('redis-cli -h 127.0.0.1 -p 6379 FLUSHALL 2>/dev/null || redis-cli FLUSHALL 2>/dev/null');
      return { success: true };
    } catch (err) {
      throw new Error('Redis flush failed: ' + err.message);
    }
  }

  // ── Full Page Cache ──────────────────────────────────────

  async getFpcStatus() {
    try {
      const { stdout } = await execAsync('ls /tmp/panelku-page-cache 2>/dev/null | wc -l || echo "0"');
      const count = parseInt(stdout.trim()) || 0;
      let size = '0';
      try {
        const { stdout: sz } = await execAsync('du -sh /tmp/panelku-page-cache 2>/dev/null | cut -f1');
        size = sz.trim() || '0';
      } catch {}

      // Check nginx FPC config
      let nginxFpcEnabled = false;
      try {
        const { stdout: nginx } = await execAsync('grep -r "panelku-page-cache" /etc/nginx/ 2>/dev/null | head -1');
        nginxFpcEnabled = !!nginx.trim();
      } catch {}

      return { cachedPages: count, cacheSize: size, nginxFpcEnabled };
    } catch { return { cachedPages: 0, cacheSize: '0', nginxFpcEnabled: false }; }
  }

  async flushFpc() {
    try {
      // [SECURITY] Validate that the path exists and is a directory before running rm
      const cacheDir = '/tmp/panelku-page-cache';
      try {
        const stat = await fs.stat(cacheDir);
        if (!stat.isDirectory()) {
          throw new Error('Cache path is not a directory');
        }
      } catch (e) {
        if (e.message.includes('not a directory')) throw e;
        // Directory doesn't exist, nothing to flush
        return { success: true, message: 'Cache directory does not exist' };
      }
      await execAsync('rm -rf ' + cacheDir + '/* 2>/dev/null');
      return { success: true };
    } catch (err) {
      throw new Error('FPC flush failed: ' + err.message);
    }
  }
}

export default new CdnService();
