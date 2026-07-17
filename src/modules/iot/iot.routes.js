import { Router } from 'express';
import iotController from './iot.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { RESOURCES, ACTIONS } from '../../config/constants.js';

const router = Router();
router.use(authenticate);

// MQTT Broker
router.get('/mqtt/status', rbac(RESOURCES.SYSTEM, ACTIONS.READ), iotController.getMqttStatus.bind(iotController));
router.post('/mqtt/install', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), iotController.installMosquitto.bind(iotController));
router.post('/mqtt/control', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), iotController.controlMosquitto.bind(iotController));
router.get('/mqtt/config', rbac(RESOURCES.SYSTEM, ACTIONS.READ), iotController.getMosquittoConfig.bind(iotController));
router.post('/mqtt/config', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), iotController.saveMosquittoConfig.bind(iotController));

// MQTT Users & ACL
router.get('/mqtt/users', rbac(RESOURCES.SYSTEM, ACTIONS.READ), iotController.getMqttUsers.bind(iotController));
router.post('/mqtt/users', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), iotController.addMqttUser.bind(iotController));
router.delete('/mqtt/users', rbac(RESOURCES.SYSTEM, ACTIONS.DELETE), iotController.deleteMqttUser.bind(iotController));
router.get('/mqtt/acl', rbac(RESOURCES.SYSTEM, ACTIONS.READ), iotController.getMqttAcl.bind(iotController));
router.post('/mqtt/acl', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), iotController.saveMqttAcl.bind(iotController));

// MQTT Publish
router.post('/mqtt/publish', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), iotController.publishMessage.bind(iotController));

// Home Assistant
router.get('/homeassistant', rbac(RESOURCES.SYSTEM, ACTIONS.READ), iotController.getHomeAssistantStatus.bind(iotController));
router.post('/homeassistant/install', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), iotController.installHomeAssistant.bind(iotController));

// Node-RED
router.get('/nodered', rbac(RESOURCES.SYSTEM, ACTIONS.READ), iotController.getNodeRedStatus.bind(iotController));
router.post('/nodered/install', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), iotController.installNodeRed.bind(iotController));

// Device Discovery
router.post('/discover', rbac(RESOURCES.SYSTEM, ACTIONS.EXECUTE), iotController.discoverDevices.bind(iotController));

// Metrics
router.get('/metrics', rbac(RESOURCES.SYSTEM, ACTIONS.READ), iotController.getMetrics.bind(iotController));

export default router;
