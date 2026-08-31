import { Router } from 'express';
import databaseController from './database.controller.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';

const router = Router();
router.use(requireAuth);

// Database CRUD
router.get('/', requirePermission('database:read'), databaseController.getDatabases);
router.post('/', requirePermission('database:create'), databaseController.createDatabase.bind(databaseController));
router.delete('/', requirePermission('database:delete'), databaseController.deleteDatabase.bind(databaseController));

// Table explorer
router.get('/explore', requirePermission('database:read'), databaseController.getTables.bind(databaseController));
router.post('/explore', requirePermission('database:read'), databaseController.runQuery.bind(databaseController));
router.get('/schemas', requirePermission('database:read'), databaseController.getSchemas.bind(databaseController));

// Table info & data
router.get('/table-info', requirePermission('database:read'), databaseController.getTableInfo.bind(databaseController));
router.get('/table-data', requirePermission('database:read'), databaseController.getTableData.bind(databaseController));
router.get('/stats', requirePermission('database:read'), databaseController.getDatabaseStats.bind(databaseController));

// Row CRUD
router.post('/row/insert', requirePermission('database:write'), databaseController.insertRow.bind(databaseController));
router.post('/row/update', requirePermission('database:write'), databaseController.updateRow.bind(databaseController));
router.post('/row/delete', requirePermission('database:write'), databaseController.deleteRow.bind(databaseController));

// Query & Explain
router.post('/query/explain', requirePermission('database:read'), databaseController.explainQuery.bind(databaseController));

// Query history
router.get('/query-history', requirePermission('database:read'), databaseController.getQueryHistory.bind(databaseController));
router.post('/query-history/clear', requirePermission('database:write'), databaseController.clearQueryHistory.bind(databaseController));

// Export / Import
router.post('/export', requirePermission('database:read'), databaseController.exportTable.bind(databaseController));
router.post('/import/sql', requirePermission('database:write'), databaseController.importSql.bind(databaseController));
router.post('/import/csv', requirePermission('database:write'), databaseController.importCsv.bind(databaseController));
// Credentials Settings
router.get('/credentials', requirePermission('database:read'), databaseController.getCredentials.bind(databaseController));
router.post('/credentials', requirePermission('database:write'), databaseController.updateCredentials.bind(databaseController));

// PostgreSQL Server Config Management
router.get('/pg-config', requirePermission('database:read'), databaseController.getPgConfig.bind(databaseController));
router.post('/pg-config/save', requirePermission('database:write'), databaseController.savePgConfig.bind(databaseController));
router.post('/pg-config/enable-remote', requirePermission('database:write'), databaseController.enablePgRemoteAccess.bind(databaseController));

export default router;
