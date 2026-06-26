import { Router } from 'express';
import multer from 'multer';
import { join } from 'path';
import fileManagerController from './filemanager.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { uploadLimiter } from '../../middleware/rateLimiter.js';
import { RESOURCES, ACTIONS } from '../../config/constants.js';
import appConfig from '../../config/app.js';

const upload = multer({
  dest: appConfig.upload.path,
  limits: { fileSize: appConfig.upload.maxSize },
});

const router = Router();
router.use(authenticate);

// Read operations
router.get('/list', rbac(RESOURCES.FILEMANAGER, ACTIONS.READ), fileManagerController.list.bind(fileManagerController));
router.get('/info', rbac(RESOURCES.FILEMANAGER, ACTIONS.READ), fileManagerController.info.bind(fileManagerController));
router.get('/read', rbac(RESOURCES.FILEMANAGER, ACTIONS.READ), fileManagerController.readFile.bind(fileManagerController));
router.get('/download', rbac(RESOURCES.FILEMANAGER, ACTIONS.READ), fileManagerController.download.bind(fileManagerController));
router.get('/search', rbac(RESOURCES.FILEMANAGER, ACTIONS.READ), fileManagerController.search.bind(fileManagerController));

// Write operations
router.post('/write', rbac(RESOURCES.FILEMANAGER, ACTIONS.UPDATE), fileManagerController.writeFile.bind(fileManagerController));
router.post('/rename', rbac(RESOURCES.FILEMANAGER, ACTIONS.UPDATE), fileManagerController.rename.bind(fileManagerController));
router.post('/move', rbac(RESOURCES.FILEMANAGER, ACTIONS.UPDATE), fileManagerController.move.bind(fileManagerController));
router.post('/copy', rbac(RESOURCES.FILEMANAGER, ACTIONS.UPDATE), fileManagerController.copy.bind(fileManagerController));
router.post('/mkdir', rbac(RESOURCES.FILEMANAGER, ACTIONS.CREATE), fileManagerController.mkdir.bind(fileManagerController));
router.post('/upload', uploadLimiter, rbac(RESOURCES.FILEMANAGER, ACTIONS.CREATE), upload.array('files', 50), fileManagerController.upload.bind(fileManagerController));
router.post('/zip', rbac(RESOURCES.FILEMANAGER, ACTIONS.EXECUTE), fileManagerController.zip.bind(fileManagerController));
router.post('/unzip', rbac(RESOURCES.FILEMANAGER, ACTIONS.EXECUTE), fileManagerController.unzip.bind(fileManagerController));
router.delete('/delete', rbac(RESOURCES.FILEMANAGER, ACTIONS.DELETE), fileManagerController.delete.bind(fileManagerController));

export default router;
