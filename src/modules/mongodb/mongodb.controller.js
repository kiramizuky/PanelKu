import mongodbService from './mongodb.service.js';
import { successResponse, errorResponse } from '../../helpers/response.js';

class MongoDBController {
  /**
   * GET /api/mongodb/status
   */
  async getStatus(req, res) {
    try {
      const status = await mongodbService.getStatus();
      return successResponse(res, status);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * POST /api/mongodb/install
   */
  async install(req, res) {
    try {
      const result = await mongodbService.installMongoDB();
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * GET /api/mongodb/server-info
   */
  async getServerInfo(req, res) {
    try {
      const info = await mongodbService.getServerInfo();
      return successResponse(res, info);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Databases ────────────────────────────────────────

  /**
   * GET /api/mongodb/databases
   */
  async listDatabases(req, res) {
    try {
      const dbs = await mongodbService.listDatabases();
      return successResponse(res, { databases: dbs });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * POST /api/mongodb/databases
   */
  async createDatabase(req, res) {
    try {
      const { name } = req.body;
      if (!name) return errorResponse(res, 'Database name is required', 400);

      const result = await mongodbService.createDatabase(name);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * DELETE /api/mongodb/databases/:name
   */
  async dropDatabase(req, res) {
    try {
      const { name } = req.params;
      if (!name) return errorResponse(res, 'Database name is required', 400);

      const result = await mongodbService.dropDatabase(name);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * GET /api/mongodb/databases/:name/stats
   */
  async getDatabaseStats(req, res) {
    try {
      const { name } = req.params;
      const stats = await mongodbService.getDatabaseStats(name);
      return successResponse(res, stats);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Collections ──────────────────────────────────────

  /**
   * GET /api/mongodb/databases/:name/collections
   */
  async listCollections(req, res) {
    try {
      const { name } = req.params;
      const collections = await mongodbService.listCollections(name);
      return successResponse(res, { collections });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * DELETE /api/mongodb/databases/:db/collections/:collection
   */
  async dropCollection(req, res) {
    try {
      const { db, collection } = req.params;
      const result = await mongodbService.dropCollection(db, collection);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * GET /api/mongodb/databases/:db/collections/:collection/documents
   */
  async findDocuments(req, res) {
    try {
      const { db, collection } = req.params;
      const { filter, limit, skip } = req.query;

      const filterObj = filter ? JSON.parse(filter) : {};
      const result = await mongodbService.findDocuments(db, collection, filterObj, limit, skip);
      return successResponse(res, result);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Users ────────────────────────────────────────────

  /**
   * GET /api/mongodb/users
   */
  async listUsers(req, res) {
    try {
      const users = await mongodbService.listUsers();
      return successResponse(res, { users });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * POST /api/mongodb/users
   */
  async createUser(req, res) {
    try {
      const { username, password, roles } = req.body;
      if (!username) return errorResponse(res, 'Username is required', 400);
      if (!password) return errorResponse(res, 'Password is required', 400);

      const result = await mongodbService.createUser(username, password, roles);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * DELETE /api/mongodb/users/:username
   */
  async dropUser(req, res) {
    try {
      const { username } = req.params;
      const result = await mongodbService.dropUser(username);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Query ────────────────────────────────────────────

  /**
   * POST /api/mongodb/query
   */
  async runQuery(req, res) {
    try {
      const { database, query } = req.body;
      if (!database) return errorResponse(res, 'Database name is required', 400);
      if (!query) return errorResponse(res, 'Query is required', 400);

      const result = await mongodbService.runQuery(database, query);
      return successResponse(res, { result });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Backup ───────────────────────────────────────────

  /**
   * POST /api/mongodb/backup
   */
  async backup(req, res) {
    try {
      const { database, path } = req.body;
      const result = await mongodbService.backupDatabase(database || '', path || '');
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * POST /api/mongodb/restore
   */
  async restore(req, res) {
    try {
      const { path, database } = req.body;
      if (!path) return errorResponse(res, 'Backup path is required', 400);

      const result = await mongodbService.restoreDatabase(path, database || '');
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }
}

export default new MongoDBController();
