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
}

export default new DatabaseController();
