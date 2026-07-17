import redisService from './redis.service.js';
import { successResponse, errorResponse } from '../../helpers/response.js';

class RedisController {
  /**
   * GET /api/redis/info
   */
  async getInfo(req, res) {
    try {
      const info = await redisService.getInfo();
      return successResponse(res, info);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * GET /api/redis/stats
   */
  async getStats(req, res) {
    try {
      const stats = await redisService.getStats();
      return successResponse(res, stats);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Config ───────────────────────────────────────────

  /**
   * GET /api/redis/config
   */
  async getConfig(req, res) {
    try {
      const pattern = req.query.pattern || '*';
      const configs = await redisService.getConfig(pattern);
      return successResponse(res, { configs });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * POST /api/redis/config
   */
  async setConfig(req, res) {
    try {
      const { key, value } = req.body;
      if (!key) return errorResponse(res, 'Config key is required', 400);
      if (!value) return errorResponse(res, 'Config value is required', 400);

      const result = await redisService.setConfig(key, value);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Keys ─────────────────────────────────────────────

  /**
   * GET /api/redis/keys
   */
  async scanKeys(req, res) {
    try {
      const { db, cursor, match, count } = req.query;
      const result = await redisService.scanKeys(db, cursor, match, count);
      return successResponse(res, result);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * GET /api/redis/keys/:key
   */
  async getKeyValue(req, res) {
    try {
      const { key } = req.params;
      const result = await redisService.getKeyValue(key);
      return successResponse(res, result);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * DELETE /api/redis/keys/:key
   */
  async deleteKey(req, res) {
    try {
      const { key } = req.params;
      const result = await redisService.deleteKey(key);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * POST /api/redis/keys/:key/ttl
   */
  async setKeyTtl(req, res) {
    try {
      const { key } = req.params;
      const { seconds } = req.body;
      const result = await redisService.setKeyTtl(key, seconds);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Operations ───────────────────────────────────────

  /**
   * POST /api/redis/flushdb
   */
  async flushDb(req, res) {
    try {
      const result = await redisService.flushDb();
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * POST /api/redis/flushall
   */
  async flushAll(req, res) {
    try {
      const result = await redisService.flushAll();
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * POST /api/redis/save
   */
  async save(req, res) {
    try {
      const result = await redisService.save();
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * POST /api/redis/bgsave
   */
  async bgsave(req, res) {
    try {
      const result = await redisService.bgsave();
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Clients ──────────────────────────────────────────

  /**
   * GET /api/redis/clients
   */
  async getClients(req, res) {
    try {
      const clients = await redisService.getClients();
      return successResponse(res, { clients });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * POST /api/redis/clients/kill
   */
  async killClient(req, res) {
    try {
      const { addr } = req.body;
      if (!addr) return errorResponse(res, 'Client address is required', 400);

      const result = await redisService.killClient(addr);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Slow Log ─────────────────────────────────────────

  /**
   * GET /api/redis/slowlog
   */
  async getSlowLog(req, res) {
    try {
      const count = req.query.count || 10;
      const entries = await redisService.getSlowLog(count);
      return successResponse(res, { entries });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }
}

export default new RedisController();
