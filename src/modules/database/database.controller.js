import databaseService from './database.service.js';
import { success, error } from '../../helpers/response.js';

function cleanStr(str) {
  if (!str) return '';
  return String(str).replace(/^["']|["']$/g, '').trim();
}

class DatabaseController {
  async getDatabases(req, res) {
    try {
      const mysqlDbs = await databaseService.listMysqlDatabases();
      const pgDbs = await databaseService.listPgDatabases();
      const sqliteDbs = await databaseService.listSqliteDatabases();
      success(res, { mysql: mysqlDbs, postgres: pgDbs, sqlite: sqliteDbs });
    } catch (err) {
      error(res, err.message, 500);
    }
  }

  async createDatabase(req, res) {
    try {
      const type = cleanStr(req.body.type);
      const name = cleanStr(req.body.name);
      if (!name) return error(res, 'Database name is required', 400);
      if (type === 'mysql') await databaseService.createMysqlDatabase(name);
      else if (type === 'postgres') await databaseService.createPgDatabase(name);
      else if (type === 'sqlite') await databaseService.createSqliteDatabase(name);
      else return error(res, 'Invalid database type', 400);
      success(res, null, `Database ${name} created successfully`);
    } catch (err) {
      error(res, err.message, 500);
    }
  }

  async deleteDatabase(req, res) {
    try {
      const type = cleanStr(req.body.type);
      const name = cleanStr(req.body.name);
      if (!name) return error(res, 'Database name is required', 400);
      if (type === 'mysql') await databaseService.deleteMysqlDatabase(name);
      else if (type === 'postgres') await databaseService.deletePgDatabase(name);
      else if (type === 'sqlite') await databaseService.deleteSqliteDatabase(name);
      else return error(res, 'Invalid database type', 400);
      success(res, null, `Database ${name} deleted successfully`);
    } catch (err) {
      error(res, err.message, 500);
    }
  }

  async getTables(req, res) {
    try {
      const type = cleanStr(req.query.type);
      const name = cleanStr(req.query.name);
      if (!type || !name) return error(res, 'Type and name are required', 400);
      const tables = await databaseService.getTables(type, name);
      return success(res, { tables });
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async getTableInfo(req, res) {
    try {
      const type = cleanStr(req.query.type);
      const database = cleanStr(req.query.database);
      const table = cleanStr(req.query.table);
      if (!type || !database || !table) return error(res, 'Type, database, and table are required', 400);
      const info = await databaseService.getTableInfo(type, database, table);
      return success(res, info);
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async getTableData(req, res) {
    try {
      const type = cleanStr(req.query.type);
      const database = cleanStr(req.query.database);
      const table = cleanStr(req.query.table);
      const { page = 1, limit = 50, sortColumn, sortDir } = req.query;
      if (!type || !database || !table) return error(res, 'Type, database, and table are required', 400);
      const data = await databaseService.getTableData(type, database, table, parseInt(page), parseInt(limit), sortColumn || null, sortDir || 'ASC');
      return success(res, data);
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async getDatabaseStats(req, res) {
    try {
      const type = cleanStr(req.query.type);
      const database = cleanStr(req.query.database);
      if (!type || !database) return error(res, 'Type and database are required', 400);
      const stats = await databaseService.getDatabaseStats(type, database);
      return success(res, stats);
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async runQuery(req, res) {
    try {
      const type = cleanStr(req.body.type);
      const name = cleanStr(req.body.name);
      const query = req.body.query;
      if (!type || !name || !query) return error(res, 'Type, name, and query are required', 400);
      const result = await databaseService.runQuery(type, name, query);
      return success(res, result);
    } catch (err) {
      return error(res, err.message, 400);
    }
  }

  async getQueryHistory(req, res) {
    try {
      const history = databaseService.getQueryHistory();
      return success(res, { history });
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async clearQueryHistory(req, res) {
    try {
      databaseService.clearQueryHistory();
      return success(res, null, 'Query history cleared');
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async exportTable(req, res) {
    try {
      const { type, database, table, format = 'json' } = req.body;
      if (!type || !database || !table) return error(res, 'Type, database, and table are required', 400);
      const result = await databaseService.exportData(type, database, table, format);
      return success(res, result);
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async importSql(req, res) {
    try {
      const { type, database, sql } = req.body;
      if (!type || !database || !sql) return error(res, 'Type, database, and SQL are required', 400);
      const result = await databaseService.importSql(type, database, sql);
      return success(res, result, `${result.imported} statements imported`);
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async importCsv(req, res) {
    try {
      const { type, database, table, csv } = req.body;
      if (!type || !database || !table || !csv) return error(res, 'Type, database, table, and CSV are required', 400);
      const result = await databaseService.importCsv(type, database, table, csv);
      return success(res, result, `${result.imported} rows imported`);
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async getCredentials(req, res) {
    try {
      const creds = await databaseService.getCredentials();
      return success(res, creds);
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async updateCredentials(req, res) {
    try {
      const { type, host, port, user, password } = req.body;
      if (!type || !['mysql', 'postgres'].includes(type)) {
        return error(res, 'Invalid database type', 400);
      }
      await databaseService.saveCredentials(type, { host, port, user, password });
      return success(res, null, `${type.toUpperCase()} credentials updated & reconnected`);
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async getPgConfig(req, res) {
    try {
      const data = await databaseService.getPgConfigFiles();
      return success(res, data);
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async savePgConfig(req, res) {
    try {
      const { fileType, content } = req.body;
      if (!fileType || content === undefined) return error(res, 'File type and content are required', 400);
      await databaseService.savePgConfigFile(fileType, content);
      return success(res, null, `${fileType} saved & PostgreSQL restarted`);
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async enablePgRemoteAccess(req, res) {
    try {
      const result = await databaseService.enablePgRemoteAccess();
      return success(res, result, 'PostgreSQL remote & Docker access configured successfully!');
    } catch (err) {
      return error(res, err.message, 500);
    }
  }
}

export default new DatabaseController();
