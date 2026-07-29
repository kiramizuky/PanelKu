import { Router } from 'express';
import lvmManagerController from './lvm-manager.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { RESOURCES, ACTIONS } from '../../config/constants.js';

const router = Router();

// All LVM & RAID management endpoints require authentication
router.use(authenticate);

// Disks & SMART Status
router.get('/disks', rbac(RESOURCES.SYSTEM, ACTIONS.READ), lvmManagerController.getDisks.bind(lvmManagerController));
router.get('/smart', rbac(RESOURCES.SYSTEM, ACTIONS.READ), lvmManagerController.getSmartStatus.bind(lvmManagerController));

// RAID (mdadm)
router.get('/raid', rbac(RESOURCES.SYSTEM, ACTIONS.READ), lvmManagerController.getRaidArrays.bind(lvmManagerController));
router.post('/raid/create', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), lvmManagerController.createRaid.bind(lvmManagerController));
router.post('/raid/manage', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), lvmManagerController.manageRaidDisk.bind(lvmManagerController));
router.post('/raid/stop', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), lvmManagerController.stopRaid.bind(lvmManagerController));

// LVM Physical Volumes (PV)
router.get('/pvs', rbac(RESOURCES.SYSTEM, ACTIONS.READ), lvmManagerController.getPVs.bind(lvmManagerController));
router.post('/pv/create', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), lvmManagerController.createPV.bind(lvmManagerController));
router.post('/pv/remove', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), lvmManagerController.removePV.bind(lvmManagerController));

// LVM Volume Groups (VG)
router.get('/vgs', rbac(RESOURCES.SYSTEM, ACTIONS.READ), lvmManagerController.getVGs.bind(lvmManagerController));
router.post('/vg/create', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), lvmManagerController.createVG.bind(lvmManagerController));
router.post('/vg/extend', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), lvmManagerController.extendVG.bind(lvmManagerController));
router.post('/vg/remove', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), lvmManagerController.removeVG.bind(lvmManagerController));

// LVM Logical Volumes (LV)
router.get('/lvs', rbac(RESOURCES.SYSTEM, ACTIONS.READ), lvmManagerController.getLVs.bind(lvmManagerController));
router.post('/lv/create', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), lvmManagerController.createLV.bind(lvmManagerController));
router.post('/lv/extend', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), lvmManagerController.extendLV.bind(lvmManagerController));
router.post('/lv/remove', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), lvmManagerController.removeLV.bind(lvmManagerController));

// Format, Mount & Unmount
router.post('/volume/format', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), lvmManagerController.formatVolume.bind(lvmManagerController));
router.post('/volume/mount', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), lvmManagerController.mountVolume.bind(lvmManagerController));
router.post('/volume/unmount', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), lvmManagerController.unmountVolume.bind(lvmManagerController));

export default router;
