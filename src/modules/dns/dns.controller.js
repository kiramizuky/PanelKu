import dnsService from './dns.service.js';
import { success, errorResponse } from '../../helpers/response.js';

class DnsController {
  // ── Providers ────────────────────────────────────────────────────

  async getProviders(req, res) {
    try {
      const providers = await dnsService.getProviders();
      return success(res, providers);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async saveProviderConfig(req, res) {
    try {
      const { provider } = req.params;
      const result = await dnsService.saveProviderConfig(provider, req.body);
      return success(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 400);
    }
  }

  async testProvider(req, res) {
    try {
      const { provider } = req.params;
      const result = await dnsService.testProvider(provider);
      return success(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Zones ────────────────────────────────────────────────────────

  async getZones(req, res) {
    try {
      const { provider } = req.params;
      const zones = await dnsService.getZones(provider);
      return success(res, zones);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Records ──────────────────────────────────────────────────────

  async getRecords(req, res) {
    try {
      const { provider, zoneId } = req.params;
      const records = await dnsService.getRecords(provider, zoneId);
      return success(res, records);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async createRecord(req, res) {
    try {
      const { provider, zoneId } = req.params;
      dnsService.validateRecord(req.body);
      const record = await dnsService.createRecord(provider, zoneId, req.body);
      return success(res, record, 'DNS Record created');
    } catch (error) {
      return errorResponse(res, error.message, 400);
    }
  }

  async updateRecord(req, res) {
    try {
      const { provider, zoneId, recordId } = req.params;
      const record = await dnsService.updateRecord(provider, zoneId, recordId, req.body);
      return success(res, record, 'DNS Record updated');
    } catch (error) {
      return errorResponse(res, error.message, 400);
    }
  }

  async deleteRecord(req, res) {
    try {
      const { provider, zoneId, recordId } = req.params;
      await dnsService.deleteRecord(provider, zoneId, recordId);
      return success(res, null, 'DNS Record deleted');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async bulkUpdateRecords(req, res) {
    try {
      const { provider, zoneId } = req.params;
      const { operations } = req.body;
      if (!operations || !Array.isArray(operations)) {
        return errorResponse(res, 'Operations array is required', 400);
      }
      const results = await dnsService.bulkUpdateRecords(provider, zoneId, operations);
      return success(res, { results }, `Processed ${results.length} operations`);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── DNSSEC ───────────────────────────────────────────────────────

  async getDNSSECStatus(req, res) {
    try {
      const { provider, zoneId } = req.params;
      const status = await dnsService.getDNSSECStatus(provider, zoneId);
      return success(res, status);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async enableDNSSEC(req, res) {
    try {
      const { provider, zoneId } = req.params;
      const result = await dnsService.enableDNSSEC(provider, zoneId);
      return success(res, result, 'DNSSEC enabled');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async disableDNSSEC(req, res) {
    try {
      const { provider, zoneId } = req.params;
      const result = await dnsService.disableDNSSEC(provider, zoneId);
      return success(res, result, 'DNSSEC disabled');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── DuckDNS / No-IP ─────────────────────────────────────────────

  async updateDynamicDNS(req, res) {
    try {
      const { provider } = req.params;
      const { domain, ip, ipv6, hostname } = req.body;

      if (provider === 'duckdns') {
        const result = await dnsService.updateDuckDNS(domain, ip, ipv6);
        return success(res, result, result.message);
      } else if (provider === 'noip') {
        const result = await dnsService.updateNoIP(hostname || domain, ip);
        return success(res, result, result.message);
      }
      return errorResponse(res, `Dynamic DNS not supported for ${provider}`, 400);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Record Types Info ────────────────────────────────────────────

  async getRecordTypes(req, res) {
    return success(res, [
      { type: 'A', description: 'IPv4 address record', fields: ['name', 'content', 'ttl', 'proxied'] },
      { type: 'AAAA', description: 'IPv6 address record', fields: ['name', 'content', 'ttl', 'proxied'] },
      { type: 'CNAME', description: 'Canonical name record (alias)', fields: ['name', 'content', 'ttl'] },
      { type: 'TXT', description: 'Text record (SPF, DKIM, verification)', fields: ['name', 'content', 'ttl'] },
      { type: 'MX', description: 'Mail exchange record', fields: ['name', 'content', 'priority', 'ttl'] },
      { type: 'NS', description: 'Name server record', fields: ['name', 'content', 'ttl'] },
      { type: 'SRV', description: 'Service locator', fields: ['name', 'content', 'priority', 'weight', 'port', 'ttl'] },
      { type: 'CAA', description: 'Certificate Authority Authorization', fields: ['name', 'content', 'ttl'] },
    ]);
  }
}

export default new DnsController();
