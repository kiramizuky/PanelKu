import sslService from './ssl.service.js';
import Website from '../../models/Website.js';
import { success, errorResponse } from '../../helpers/response.js';

class SSLController {
  async listCertificates(req, res) {
    try {
      const websites = await Website.find({ 'ssl.enabled': true }).lean();
      const certs = websites.map(w => ({
        id: w._id,
        domain: w.domain,
        provider: w.ssl.provider,
        expiresAt: w.ssl.expiresAt
      }));
      return success(res, certs);
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async issueCertificate(req, res) {
    try {
      const { websiteId } = req.body;
      if (!websiteId) return errorResponse(res, new Error('websiteId is required'), 400);

      const website = await sslService.configureWebsiteSSL(websiteId);
      return success(res, website, 'Certificate issued successfully');
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async renewCertificate(req, res) {
    try {
      const { websiteId } = req.params;
      const website = await sslService.configureWebsiteSSL(websiteId);
      return success(res, website, 'Certificate renewed successfully');
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }
}

export default new SSLController();
