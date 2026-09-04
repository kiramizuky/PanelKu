import { Router } from 'express';
import multer from 'multer';
import os from 'os';
import databaseController from './database.controller.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max dump size
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname.slice(file.originalname.lastIndexOf('.')).toLowerCase();
    if (['.sql', '.sqlite', '.db', '.dump', '.txt'].includes(ext)) {
      cb(null, true);
    } else {
      cb(Object.assign(new Error('Invalid backup file extension. Only .sql, .sqlite, and .db files are supported'), { statusCode: 400 }));
    }
  }
});

const router = Router();
router.use(requireAuth);

// Database CRUD
router.get('/', requirePermission('database:read'), databaseController.getDatabases);
router.post('/', requirePermission('database:create'), databaseController.createDatabase.bind(databaseController));
router.delete('/', requirePermission('database:delete'), databaseController.deleteDatabase.bind(databaseController));

// Database Backup & Restore
router.post('/backup', requirePermission('database:read'), databaseController.backupDatabase.bind(databaseController));
router.get('/backup/download/:filename', requirePermission('database:read'), databaseController.downloadBackup.bind(databaseController));
router.get('/backups', requirePermission('database:read'), databaseController.getBackups.bind(databaseController));
router.post('/restore', requirePermission('database:write'), upload.single('backupFile'), databaseController.restoreDatabase.bind(databaseController));
router.delete('/backup/:filename', requirePermission('database:write'), databaseController.deleteBackup.bind(databaseController));

// Database Auto-Backup
router.get('/autobackup', requirePermission('database:read'), databaseController.getAutoBackupConfig.bind(databaseController));
router.post('/autobackup', requirePermission('database:write'), databaseController.saveAutoBackupConfig.bind(databaseController));
router.post('/autobackup/run', requirePermission('database:write'), databaseController.triggerAutoBackupNow.bind(databaseController));

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
