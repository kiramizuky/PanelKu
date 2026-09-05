import sslService from './ssl.service.js';
import Website from '../../models/Website.js';
import { success, errorResponse } from '../../helpers/response.js';

class SSLController {
  async listCertificates(req, res) {
    try {
      const websites = await Website.find();
      const certs = websites
        .filter(w => w.ssl && w.ssl.enabled)
        .map(w => ({
          id: w._id,
          websiteId: w._id,
          domain: w.domain,
          provider: w.ssl.provider || 'letsencrypt',
          expiresAt: w.ssl.expiresAt,
          certificate: w.ssl.certificate,
          enabled: w.ssl.enabled
        }));
      return success(res, certs);
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async issueCertificate(req, res) {
    try {
      const { websiteId, provider = 'letsencrypt', certificate, privateKey, force = false } = req.body;
      if (!websiteId) return errorResponse(res, 'websiteId is required', 400);

      const customData = provider === 'custom' ? { certificate, privateKey } : null;
      const website = await sslService.configureWebsiteSSL(websiteId, provider, customData, Boolean(force));
      return success(res, website, 'Certificate issued and Nginx reloaded successfully');
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async renewCertificate(req, res) {
    try {
      const { websiteId } = req.params;
      const website = await Website.findById(websiteId);
      if (!website) return errorResponse(res, 'Website not found', 404);

      const provider = website.ssl?.provider || 'letsencrypt';
      const updated = await sslService.configureWebsiteSSL(websiteId, provider, null, true);
      return success(res, updated, 'Certificate renewed and Nginx reloaded successfully');
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async disableCertificate(req, res) {
    try {
      const websiteId = req.params.websiteId || req.body.websiteId;
      if (!websiteId) return errorResponse(res, 'websiteId is required', 400);

      const website = await sslService.disableWebsiteSSL(websiteId);
      return success(res, website, 'SSL disabled and Nginx reverted to HTTP port 80');
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async getCertificate(req, res) {
    try {
      const { websiteId } = req.params;
      const website = await Website.findById(websiteId);
      if (!website) return errorResponse(res, 'Website not found', 404);

      return success(res, {
        domain: website.domain,
        ssl: website.ssl || { enabled: false }
      });
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }
}

export default new SSLController();
