import dnsService from './dns.service.js';
import { success, errorResponse } from '../../helpers/response.js';
import AlertConfig from '../../models/AlertConfig.js';

// We can store the CF token in a settings document, or pass it via headers.
// For simplicity in this controller, we will store it in the same settings or expect it from the frontend.
// Let's assume the frontend sends `cf-token` in headers for now.

class DnsController {
  async getZones(req, res) {
    try {
      const token = req.headers['cf-token'];
      const zones = await dnsService.getZones(token);
      return success(res, zones);
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async getRecords(req, res) {
    try {
      const token = req.headers['cf-token'];
      const { zoneId } = req.params;
      const records = await dnsService.getDnsRecords(token, zoneId);
      return success(res, records);
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async createRecord(req, res) {
    try {
      const token = req.headers['cf-token'];
      const { zoneId } = req.params;
      const record = await dnsService.createDnsRecord(token, zoneId, req.body);
      return success(res, record, 'DNS Record created');
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async deleteRecord(req, res) {
    try {
      const token = req.headers['cf-token'];
      const { zoneId, recordId } = req.params;
      await dnsService.deleteDnsRecord(token, zoneId, recordId);
      return success(res, null, 'DNS Record deleted');
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }
}

export default new DnsController();
