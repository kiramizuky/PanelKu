/**
 * DNS Service — Advanced Multi-Provider DNS Manager
 *
 * Fase 14: Multi-Provider DNS with DNSSEC support
 * Providers: Cloudflare, DuckDNS, No-IP, DigitalOcean, Generic (RFC 2136)
 * Record Types: A, AAAA, CNAME, TXT, MX, NS, SRV, CAA
 */

import Setting from '../../models/Setting.js';

class DnsService {
  constructor() {
    this.providers = {
      cloudflare: { name: 'Cloudflare', apiBase: 'https://api.cloudflare.com/client/v4' },
      digitalocean: { name: 'DigitalOcean', apiBase: 'https://api.digitalocean.com/v2' },
      duckdns: { name: 'DuckDNS', apiBase: 'https://www.duckdns.org' },
      noip: { name: 'No-IP', apiBase: 'https://api.noip.com/v1' },
      generic: { name: 'Generic DNS', apiBase: '' },
    };
  }

  // ── Provider Config ──────────────────────────────────────────────

  async _getProviderConfig(provider) {
    const cfgStr = await Setting.get('dns_provider_configs') || '{}';
    const configs = JSON.parse(typeof cfgStr === 'string' ? cfgStr : JSON.stringify(cfgStr));
    return configs[provider] || {};
  }

  async _saveProviderConfig(provider, config) {
    const cfgStr = await Setting.get('dns_provider_configs') || '{}';
    const configs = JSON.parse(typeof cfgStr === 'string' ? cfgStr : JSON.stringify(cfgStr));
    configs[provider] = config;
    await Setting.set('dns_provider_configs', JSON.stringify(configs), 'json');
  }

  async getProviders() {
    const cfgStr = await Setting.get('dns_provider_configs') || '{}';
    const configs = JSON.parse(typeof cfgStr === 'string' ? cfgStr : JSON.stringify(cfgStr));
    return Object.entries(this.providers).map(([id, info]) => ({
      id,
      name: info.name,
      configured: !!configs[id]?.apiKey || !!configs[id]?.token,
      hasToken: !!configs[id]?.apiKey || !!configs[id]?.token,
    }));
  }

  async saveProviderConfig(provider, config) {
    if (!this.providers[provider]) throw new Error(`Unknown provider: ${provider}`);
    // Mask sensitive fields (only save non-empty values)
    const existing = await this._getProviderConfig(provider);
    const merged = { ...existing };

    if (config.apiKey !== undefined) merged.apiKey = config.apiKey || existing.apiKey || '';
    if (config.token !== undefined) merged.token = config.token || existing.token || '';
    if (config.username !== undefined) merged.username = config.username;
    if (config.password !== undefined) merged.password = config.password;
    if (config.email !== undefined) merged.email = config.email;

    await this._saveProviderConfig(provider, merged);
    return { message: `Provider ${this.providers[provider].name} configured successfully` };
  }

  async testProvider(provider) {
    try {
      switch (provider) {
        case 'cloudflare':
          return await this._testCloudflare();
        case 'digitalocean':
          return await this._testDigitalOcean();
        case 'duckdns':
          return await this._testDuckDNS();
        default:
          return { success: true, message: 'Provider test not implemented for this provider' };
      }
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  // ── Cloudflare ────────────────────────────────────────────────────

  async _getCloudflareHeaders() {
    const cfg = await this._getProviderConfig('cloudflare');
    const token = cfg.apiKey || cfg.token;
    if (!token) throw new Error('Cloudflare API Token not configured');
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  async _cfApi(method, path, body = null) {
    const headers = await this._getCloudflareHeaders();
    const opts = { method, headers, signal: AbortSignal.timeout(10000) };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, opts);
    const data = await res.json();
    if (!data.success) {
      throw new Error(data.errors?.[0]?.message || 'Cloudflare API Error');
    }
    return data.result;
  }

  async _testCloudflare() {
    const zones = await this._cfApi('GET', '/zones?per_page=1');
    return { success: true, message: `Connected! Found ${zones.length} zones.` };
  }

  async getZones(provider) {
    switch (provider) {
      case 'cloudflare': {
        const zones = await this._cfApi('GET', '/zones?per_page=50');
        return zones.map(z => ({
          id: z.id,
          name: z.name,
          status: z.status,
          plan: z.plan?.name || 'Free',
          nameServers: z.name_servers || [],
          paused: z.paused,
          type: 'cloudflare',
        }));
      }
      case 'digitalocean': {
        const cfg = await this._getProviderConfig('digitalocean');
        const token = cfg.token || cfg.apiKey;
        if (!token) throw new Error('DigitalOcean token not configured');
        const res = await fetch('https://api.digitalocean.com/v2/domains', {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(10000),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'DigitalOcean API Error');
        return (data.domains || []).map(d => ({
          id: d.name,
          name: d.name,
          status: 'active',
          type: 'digitalocean',
          ttl: d.ttl,
          zoneFile: d.zone_file,
        }));
      }
      default:
        throw new Error(`Provider ${provider} not supported for zone listing`);
    }
  }

  async getRecords(provider, zoneId) {
    switch (provider) {
      case 'cloudflare': {
        const records = await this._cfApi('GET', `/zones/${zoneId}/dns_records?per_page=100`);
        return records.map(r => ({
          id: r.id,
          type: r.type,
          name: r.name,
          content: r.content,
          ttl: r.ttl,
          proxied: r.proxied,
          priority: r.priority || null,
          comment: r.comment || '',
          createdOn: r.created_on,
          modifiedOn: r.modified_on,
        }));
      }
      case 'digitalocean': {
        const cfg = await this._getProviderConfig('digitalocean');
        const token = cfg.token || cfg.apiKey;
        const res = await fetch(`https://api.digitalocean.com/v2/domains/${zoneId}/records`, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(10000),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'DigitalOcean API Error');
        return (data.domain_records || []).map(r => ({
          id: r.id,
          type: r.type,
          name: r.name,
          content: r.data,
          ttl: r.ttl,
          priority: r.priority || null,
          port: r.port || null,
          weight: r.weight || null,
        }));
      }
      default:
        throw new Error(`Provider ${provider} not supported for record listing`);
    }
  }

  async createRecord(provider, zoneId, record) {
    switch (provider) {
      case 'cloudflare': {
        const body = {
          type: record.type,
          name: record.name,
          content: record.content,
          ttl: record.ttl || 1,
          proxied: record.proxied ?? false,
        };
        if (record.priority && ['MX', 'SRV'].includes(record.type)) body.priority = parseInt(record.priority);
        const result = await this._cfApi('POST', `/zones/${zoneId}/dns_records`, body);
        return result;
      }
      case 'digitalocean': {
        const cfg = await this._getProviderConfig('digitalocean');
        const token = cfg.token || cfg.apiKey;
        const body = {
          type: record.type,
          name: record.name,
          data: record.content,
          ttl: record.ttl || 3600,
        };
        if (record.priority) body.priority = parseInt(record.priority);
        if (record.port) body.port = parseInt(record.port);
        if (record.weight) body.weight = parseInt(record.weight);
        const res = await fetch(`https://api.digitalocean.com/v2/domains/${zoneId}/records`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10000),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'DigitalOcean API Error');
        return data.domain_record;
      }
      default:
        throw new Error(`Provider ${provider} not supported for record creation`);
    }
  }

  async updateRecord(provider, zoneId, recordId, record) {
    switch (provider) {
      case 'cloudflare': {
        const body = {
          type: record.type,
          name: record.name,
          content: record.content,
          ttl: record.ttl || 1,
          proxied: record.proxied ?? false,
        };
        if (record.priority) body.priority = parseInt(record.priority);
        return await this._cfApi('PUT', `/zones/${zoneId}/dns_records/${recordId}`, body);
      }
      case 'digitalocean': {
        const cfg = await this._getProviderConfig('digitalocean');
        const token = cfg.token || cfg.apiKey;
        const body = {
          type: record.type,
          name: record.name,
          data: record.content,
          ttl: record.ttl || 3600,
        };
        if (record.priority) body.priority = parseInt(record.priority);
        const res = await fetch(`https://api.digitalocean.com/v2/domains/${zoneId}/records/${recordId}`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10000),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'DigitalOcean API Error');
        return data.domain_record;
      }
      default:
        throw new Error(`Provider ${provider} not supported for record update`);
    }
  }

  async deleteRecord(provider, zoneId, recordId) {
    switch (provider) {
      case 'cloudflare':
        return await this._cfApi('DELETE', `/zones/${zoneId}/dns_records/${recordId}`);
      case 'digitalocean': {
        const cfg = await this._getProviderConfig('digitalocean');
        const token = cfg.token || cfg.apiKey;
        const res = await fetch(`https://api.digitalocean.com/v2/domains/${zoneId}/records/${recordId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.message || 'DigitalOcean API Error');
        }
        return true;
      }
      default:
        throw new Error(`Provider ${provider} not supported for record deletion`);
    }
  }

  async bulkUpdateRecords(provider, zoneId, operations) {
    // operations: [{ action: 'create'|'update'|'delete', record }]
    const results = [];
    for (const op of operations) {
      try {
        if (op.action === 'create') {
          results.push(await this.createRecord(provider, zoneId, op.record));
        } else if (op.action === 'update') {
          results.push(await this.updateRecord(provider, zoneId, op.record.id, op.record));
        } else if (op.action === 'delete') {
          results.push(await this.deleteRecord(provider, zoneId, op.record.id));
        }
      } catch (err) {
        results.push({ error: err.message, record: op.record });
      }
    }
    return results;
  }

  // ── DNSSEC ────────────────────────────────────────────────────────

  async getDNSSECStatus(provider, zoneId) {
    switch (provider) {
      case 'cloudflare': {
        const dnssec = await this._cfApi('GET', `/zones/${zoneId}/dnssec`);
        return {
          enabled: dnssec.status === 'active',
          status: dnssec.status,
          algorithm: dnssec.algorithm,
          digestType: dnssec.digest_type,
          digest: dnssec.digest,
          ds: dnssec.ds,
          flags: dnssec.flags,
          keyTag: dnssec.key_tag,
          publicKey: dnssec.public_key,
        };
      }
      default:
        return { enabled: false, status: 'unsupported', message: 'DNSSEC not supported for this provider' };
    }
  }

  async enableDNSSEC(provider, zoneId) {
    switch (provider) {
      case 'cloudflare': {
        return await this._cfApi('POST', `/zones/${zoneId}/dnssec`, { status: 'active' });
      }
      default:
        throw new Error('DNSSEC not supported for this provider');
    }
  }

  async disableDNSSEC(provider, zoneId) {
    switch (provider) {
      case 'cloudflare': {
        return await this._cfApi('DELETE', `/zones/${zoneId}/dnssec`);
      }
      default:
        throw new Error('DNSSEC not supported for this provider');
    }
  }

  // ── DuckDNS ───────────────────────────────────────────────────────

  async _testDuckDNS() {
    const cfg = await this._getProviderConfig('duckdns');
    if (!cfg.token) throw new Error('DuckDNS token not configured');
    return { success: true, message: 'DuckDNS token configured' };
  }

  async updateDuckDNS(domain, ip, ipv6) {
    const cfg = await this._getProviderConfig('duckdns');
    const token = cfg.token;
    if (!token) throw new Error('DuckDNS token not configured');
    if (!domain) throw new Error('DuckDNS domain is required');

    let url = `https://www.duckdns.org/update?domains=${domain}&token=${token}`;
    if (ip) url += `&ip=${ip}`;
    if (ipv6) url += `&ipv6=${ipv6}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const text = await res.text();
    if (text === 'OK') return { success: true, message: 'DuckDNS updated successfully' };
    throw new Error(`DuckDNS update failed: ${text}`);
  }

  // ── No-IP ─────────────────────────────────────────────────────────

  async updateNoIP(hostname, ip) {
    const cfg = await this._getProviderConfig('noip');
    const { username, password } = cfg;
    if (!username || !password) throw new Error('No-IP credentials not configured');

    const auth = Buffer.from(`${username}:${password}`).toString('base64');
    let url = `https://dynupdate.no-ip.com/nic/update?hostname=${hostname}`;
    if (ip) url += `&myip=${ip}`;

    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(10000),
    });
    const text = await res.text();
    if (text.includes('good') || text.includes('nochg')) {
      return { success: true, message: `No-IP update: ${text}` };
    }
    throw new Error(`No-IP update failed: ${text}`);
  }

  // ── DigitalOcean ──────────────────────────────────────────────────

  async _testDigitalOcean() {
    const cfg = await this._getProviderConfig('digitalocean');
    const token = cfg.token || cfg.apiKey;
    if (!token) throw new Error('DigitalOcean token not configured');
    const res = await fetch('https://api.digitalocean.com/v2/account', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'DigitalOcean API Error');
    return { success: true, message: `Connected as ${data.account?.email || 'user'}` };
  }

  // ── Validate DNS Record ──────────────────────────────────────────

  validateRecord(record) {
    if (!record.type) throw new Error('Record type is required');
    if (!record.name) throw new Error('Record name is required');
    if (!record.content && !['SRV'].includes(record.type)) throw new Error('Record content is required');

    const validTypes = ['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'SRV', 'CAA'];
    if (!validTypes.includes(record.type)) throw new Error(`Invalid record type: ${record.type}`);

    // Validate TTL
    if (record.ttl !== undefined) {
      const ttl = parseInt(record.ttl);
      if (isNaN(ttl) || ttl < 1 || ttl > 86400) throw new Error('TTL must be between 1 and 86400');
    }

    return true;
  }
}

export default new DnsService();
