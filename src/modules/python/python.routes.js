import { Router } from 'express';
import pythonController from './python.controller.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { RESOURCES, ACTIONS } from '../../config/constants.js';

const router = Router();

router.use(requireAuth);
router.use(requirePermission(RESOURCES.PYTHON, ACTIONS.EXECUTE));

// ---- Python Environment ----
router.get('/status',          pythonController.getStatus.bind(pythonController));
router.get('/info',            pythonController.getPythonInfo.bind(pythonController));

// ---- Pyenv Management ----
router.post('/pyenv/install',  pythonController.installPyenv.bind(pythonController));

// ---- Version Management ----
router.get('/versions/local',    pythonController.getLocalVersions.bind(pythonController));
router.get('/versions/remote',   pythonController.getRemoteVersions.bind(pythonController));
router.post('/versions/install',  pythonController.installVersion.bind(pythonController));
router.post('/versions/uninstall', pythonController.uninstallVersion.bind(pythonController));
router.post('/versions/global',  pythonController.setGlobalVersion.bind(pythonController));

// ---- Virtual Environments ----
router.get('/venvs',             pythonController.listVirtualEnvs.bind(pythonController));
router.post('/venvs',            pythonController.createVirtualEnv.bind(pythonController));
router.delete('/venvs/:name',    pythonController.deleteVirtualEnv.bind(pythonController));

// ---- Pip Packages ----
router.get('/packages',           pythonController.listPipPackages.bind(pythonController));
router.post('/packages/install',  pythonController.installPipPackage.bind(pythonController));
router.post('/packages/uninstall', pythonController.uninstallPipPackage.bind(pythonController));

// ---- Gunicorn/Uvicorn ----
router.get('/wsgi',          pythonController.getWsgiServers.bind(pythonController));
router.post('/wsgi/start',   pythonController.startWsgi.bind(pythonController));
router.post('/wsgi/stop',    pythonController.stopWsgi.bind(pythonController));

// ---- Supervisor ----
router.get('/supervisor',            pythonController.getSupervisorStatus.bind(pythonController));
router.post('/supervisor/config',    pythonController.createSupervisorConfig.bind(pythonController));
router.post('/supervisor/action',    pythonController.supervisorAction.bind(pythonController));

export default router;
