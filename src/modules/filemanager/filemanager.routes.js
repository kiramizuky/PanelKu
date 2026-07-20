import { Router } from 'express';
import multer from 'multer';
import fileManagerController from './filemanager.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { uploadLimiter, downloadTokenLimiter } from '../../middleware/rateLimiter.js';
import { RESOURCES, ACTIONS } from '../../config/constants.js';
import appConfig from '../../config/app.js';

// [CRIT-3 FIX] Block dangerous file extensions regardless of MIME type.
// MIME type can be spoofed in Content-Type header; extension check provides defense-in-depth.
const BLOCKED_EXTENSIONS = new Set([
  '.php', '.php3', '.php4', '.php5', '.phtml', '.phar',
  '.sh', '.bash', '.zsh', '.fish',
  '.py', '.rb', '.pl', '.cgi',
  '.exe', '.bat', '.cmd', '.com', '.msi',
  '.htaccess', '.htpasswd',
]);

const upload = multer({
  dest: appConfig.upload.path,
  limits: { fileSize: appConfig.upload.maxSize },
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname.slice(file.originalname.lastIndexOf('.')).toLowerCase();
    if (BLOCKED_EXTENSIONS.has(ext)) {
      return cb(Object.assign(new Error(`File type '${ext}' is not allowed for security reasons`), { statusCode: 400 }));
    }
    cb(null, true);
  },
});

const router = Router();
router.use(authenticate);

// Read operations
router.get('/list', rbac(RESOURCES.FILEMANAGER, ACTIONS.READ), fileManagerController.list.bind(fileManagerController));
router.get('/info', rbac(RESOURCES.FILEMANAGER, ACTIONS.READ), fileManagerController.info.bind(fileManagerController));
router.get('/read', rbac(RESOURCES.FILEMANAGER, ACTIONS.READ), fileManagerController.readFile.bind(fileManagerController));
router.get('/download', rbac(RESOURCES.FILEMANAGER, ACTIONS.READ), fileManagerController.download.bind(fileManagerController));
router.post('/generate-download-token', downloadTokenLimiter, rbac(RESOURCES.FILEMANAGER, ACTIONS.READ), fileManagerController.generateDownloadToken.bind(fileManagerController));
// No JWT middleware — token is HMAC-signed, short-lived (60s), and self-authenticating
router.get('/download-token/:token', fileManagerController.downloadByToken.bind(fileManagerController));
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
