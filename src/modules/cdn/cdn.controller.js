import cdnService from './cdn.service.js';
import { success, error } from '../../helpers/response.js';

class CdnController {
  // Cloudflare
  async cfGetZones(req, res) {
    try {
      const { apiKey, email } = req.body;
      if (!apiKey || !email) return error(res, 'API key and email are required', 400);
      return success(res, await cdnService.getCloudflareZones(apiKey, email));
    } catch (err) { return error(res, err.message, 500); }
  }

  async cfPurgeAll(req, res) {
    try {
      const { apiKey, email, zoneId } = req.body;
      if (!apiKey || !email || !zoneId) return error(res, 'API key, email, and zone ID are required', 400);
      return success(res, await cdnService.purgeCloudflareCache(apiKey, email, zoneId), 'Cloudflare cache purged');
    } catch (err) { return error(res, err.message, 500); }
  }

  async cfPurgeUrls(req, res) {
    try {
      const { apiKey, email, zoneId, urls } = req.body;
      if (!apiKey || !email || !zoneId || !urls) return error(res, 'Missing parameters', 400);
      return success(res, await cdnService.purgeCloudflareUrls(apiKey, email, zoneId, urls), 'URLs purged');
    } catch (err) { return error(res, err.message, 500); }
  }

  async cfAnalytics(req, res) {
    try {
      const { apiKey, email, zoneId } = req.body;
      if (!apiKey || !email || !zoneId) return error(res, 'Missing parameters', 400);
      return success(res, await cdnService.getCloudflareAnalytics(apiKey, email, zoneId));
    } catch (err) { return error(res, err.message, 500); }
  }

  // Varnish
  async varnishStatus(req, res) {
    try { return success(res, await cdnService.getVarnishStatus()); }
    catch (err) { return error(res, err.message, 500); }
  }

  async varnishControl(req, res) {
    try {
      const { action } = req.body;
      if (!action) return error(res, 'Action is required', 400);
      return success(res, await cdnService.controlVarnish(action), `Varnish ${action}ed`);
    } catch (err) { return error(res, err.message, 500); }
  }

  async varnishConfig(req, res) {
    try { return success(res, { config: await cdnService.getVarnishConfig() }); }
    catch (err) { return error(res, err.message, 500); }
  }

  async varnishSaveConfig(req, res) {
    try {
      const { config } = req.body;
      if (!config) return error(res, 'Config is required', 400);
      return success(res, await cdnService.saveVarnishConfig(config), 'VCL saved');
    } catch (err) { return error(res, err.message, 500); }
  }

  async varnishPurge(req, res) {
    try { return success(res, await cdnService.purgeVarnish(), 'Varnish cache purged'); }
    catch (err) { return error(res, err.message, 500); }
  }

  // Redis
  async redisCacheInfo(req, res) {
    try { return success(res, await cdnService.getRedisCacheInfo()); }
    catch (err) { return error(res, err.message, 500); }
  }

  async redisFlush(req, res) {
    try { return success(res, await cdnService.flushRedisCache(), 'Redis cache flushed'); }
    catch (err) { return error(res, err.message, 500); }
  }

  // Full Page Cache
  async fpcStatus(req, res) {
    try { return success(res, await cdnService.getFpcStatus()); }
    catch (err) { return error(res, err.message, 500); }
  }

  async fpcFlush(req, res) {
    try { return success(res, await cdnService.flushFpc(), 'Full page cache flushed'); }
    catch (err) { return error(res, err.message, 500); }
  }
}

export default new CdnController();
