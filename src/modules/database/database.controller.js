import databaseService from './database.service.js';
import { successResponse, errorResponse } from '../../helpers/response.js';

class DatabaseController {
  async getDatabases(req, res) {
    try {
      const mysqlDbs = await databaseService.listMysqlDatabases();
      const pgDbs = await databaseService.listPgDatabases();
      const sqliteDbs = await databaseService.listSqliteDatabases();
      
      successResponse(res, {
        mysql: mysqlDbs,
        postgres: pgDbs,
        sqlite: sqliteDbs
      });
    } catch (error) {
      errorResponse(res, error.message, 500);
    }
  }

  async createDatabase(req, res) {
    try {
      const { type, name } = req.body;
      if (!name) return errorResponse(res, 'Database name is required', 400);

      if (type === 'mysql') await databaseService.createMysqlDatabase(name);
      else if (type === 'postgres') await databaseService.createPgDatabase(name);
      else if (type === 'sqlite') await databaseService.createSqliteDatabase(name);
      else return errorResponse(res, 'Invalid database type', 400);

      successResponse(res, null, `Database ${name} created successfully`);
    } catch (error) {
      errorResponse(res, error.message, 500);
    }
  }

  async deleteDatabase(req, res) {
    try {
      const { type, name } = req.body;
      if (!name) return errorResponse(res, 'Database name is required', 400);

      if (type === 'mysql') await databaseService.deleteMysqlDatabase(name);
      else if (type === 'postgres') await databaseService.deletePgDatabase(name);
      else if (type === 'sqlite') await databaseService.deleteSqliteDatabase(name);
      else return errorResponse(res, 'Invalid database type', 400);

      successResponse(res, null, `Database ${name} deleted successfully`);
    } catch (error) {
      errorResponse(res, error.message, 500);
    }
  }

  async getTables(req, res) {
    try {
      const { type, name } = req.query;
      if (!type || !name) return errorResponse(res, 'Type and name are required', 400);
      const tables = await databaseService.getTables(type, name);
      return successResponse(res, { tables });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async runQuery(req, res) {
    try {
      const { type, name, query } = req.body;
      if (!type || !name || !query) return errorResponse(res, 'Type, name, and query are required', 400);
      const result = await databaseService.runQuery(type, name, query);
      return successResponse(res, { result });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }
}

export default new DatabaseController();
