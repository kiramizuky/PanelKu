import logger from '../../config/logger.js';
// Fetch is natively available in Node.js >= 18

class DnsService {
  constructor() {
    this.apiBase = 'https://api.cloudflare.com/client/v4';
  }

  getHeaders(token) {
    if (!token) throw new Error('Cloudflare API Token is missing');
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  }

  async fetchApi(url, token, options = {}) {
    const res = await fetch(`${this.apiBase}${url}`, {
      ...options,
      headers: this.getHeaders(token)
    });
    const data = await res.json();
    if (!data.success) {
      throw new Error(data.errors?.[0]?.message || 'Cloudflare API Error');
    }
    return data.result;
  }

  async getZones(token) {
    return this.fetchApi('/zones', token);
  }

  async getDnsRecords(token, zoneId) {
    return this.fetchApi(`/zones/${zoneId}/dns_records`, token);
  }

  async createDnsRecord(token, zoneId, record) {
    return this.fetchApi(`/zones/${zoneId}/dns_records`, token, {
      method: 'POST',
      body: JSON.stringify(record)
    });
  }

  async deleteDnsRecord(token, zoneId, recordId) {
    return this.fetchApi(`/zones/${zoneId}/dns_records/${recordId}`, token, {
      method: 'DELETE'
    });
  }
}

export default new DnsService();
