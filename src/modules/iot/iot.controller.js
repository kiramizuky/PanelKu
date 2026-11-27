import iotService from './iot.service.js';
import { success, error } from '../../helpers/response.js';
import { withLock } from '../../helpers/moduleGuard.js';
import processRunner from '../../services/processRunner.js';

class IotController {
  // MQTT Status
  async getMqttStatus(req, res) {
    try { return success(res, await iotService.getMqttStatus()); }
    catch (err) { return error(res, err.message, 500); }
  }

  async installMosquitto(req, res) {
    const proc = processRunner.create(req.app.get('io'), {
      title: 'Installing Mosquitto MQTT Broker',
      subtitle: 'Setting up MQTT broker and systemd service',
      steps: ['Install Mosquitto', 'Verify broker status']
    });
    try {
      const r = await withLock('iot:mosquitto', async () => {
        proc.startStep(0, 'Installing Mosquitto...');
        const resData = await iotService.installMosquitto();
        proc.completeStep(0, 'Installed');
        proc.startStep(1, 'Verifying...');
        return resData;
      });
      proc.completeStep(1, 'Active');
      proc.finish(r, 'Mosquitto installed.');
      return success(res, { ...r, processId: proc.id }, 'Mosquitto installed');
    } catch (err) {
      proc.fail(err.message);
      return error(res, err.message, 500);
    }
  }

  async controlMosquitto(req, res) {
    try {
      const { action } = req.body;
      if (!action) return error(res, 'Action is required', 400);
      return success(res, await iotService.controlMosquitto(action), `Mosquitto ${action}ed`);
    } catch (err) { return error(res, err.message, 500); }
  }

  async getMosquittoConfig(req, res) {
    try { return success(res, { config: await iotService.getMosquittoConfig() }); }
    catch (err) { return error(res, err.message, 500); }
  }

  async saveMosquittoConfig(req, res) {
    try {
      const { config } = req.body;
      if (!config) return error(res, 'Config is required', 400);
      return success(res, await iotService.saveMosquittoConfig(config), 'Config saved');
    } catch (err) { return error(res, err.message, 500); }
  }

  // MQTT Users
  async getMqttUsers(req, res) {
    try { return success(res, { users: await iotService.getMqttUsers() }); }
    catch (err) { return error(res, err.message, 500); }
  }

  async addMqttUser(req, res) {
    try {
      const { username, password } = req.body;
      if (!username || !password) return error(res, 'Username and password required', 400);
      return success(res, await iotService.addMqttUser(username, password), 'User added');
    } catch (err) { return error(res, err.message, 500); }
  }

  async deleteMqttUser(req, res) {
    try {
      const { username } = req.body;
      if (!username) return error(res, 'Username required', 400);
      return success(res, await iotService.deleteMqttUser(username), 'User deleted');
    } catch (err) { return error(res, err.message, 500); }
  }

  // MQTT Publish
  async publishMessage(req, res) {
    try {
      const { topic, message, qos = 0 } = req.body;
      if (!topic || !message) return error(res, 'Topic and message required', 400);
      return success(res, await iotService.publishMessage(topic, message, qos), 'Message published');
    } catch (err) { return error(res, err.message, 500); }
  }

  // Home Assistant
  async getHomeAssistantStatus(req, res) {
    try { return success(res, await iotService.getHomeAssistantStatus()); }
    catch (err) { return error(res, err.message, 500); }
  }

  async installHomeAssistant(req, res) {
    const proc = processRunner.create(req.app.get('io'), {
      title: 'Installing Home Assistant',
      subtitle: 'Deploying Home Assistant container/service',
      steps: ['Pull & configure Home Assistant', 'Verify service']
    });
    try {
      const r = await withLock('iot:homeassistant', async () => {
        proc.startStep(0, 'Installing Home Assistant...');
        const resData = await iotService.installHomeAssistant();
        proc.completeStep(0, 'Installed');
        proc.startStep(1, 'Verifying...');
        return resData;
      });
      proc.completeStep(1, 'Active');
      proc.finish(r, 'Home Assistant installed.');
      return success(res, { ...r, processId: proc.id }, 'Home Assistant installed');
    } catch (err) {
      proc.fail(err.message);
      return error(res, err.message, 500);
    }
  }

  // Node-RED
  async getNodeRedStatus(req, res) {
    try { return success(res, await iotService.getNodeRedStatus()); }
    catch (err) { return error(res, err.message, 500); }
  }

  async installNodeRed(req, res) {
    const proc = processRunner.create(req.app.get('io'), {
      title: 'Installing Node-RED',
      subtitle: 'Deploying Node-RED flow automation engine',
      steps: ['Install & start Node-RED', 'Verify service']
    });
    try {
      const r = await withLock('iot:nodered', async () => {
        proc.startStep(0, 'Installing Node-RED...');
        const resData = await iotService.installNodeRed();
        proc.completeStep(0, 'Installed');
        proc.startStep(1, 'Verifying...');
        return resData;
      });
      proc.completeStep(1, 'Active');
      proc.finish(r, 'Node-RED installed.');
      return success(res, { ...r, processId: proc.id }, 'Node-RED installed');
    } catch (err) {
      proc.fail(err.message);
      return error(res, err.message, 500);
    }
  }

  // Device Discovery
  async discoverDevices(req, res) {
    try {
      const { subnet } = req.body;
      const devices = await iotService.discoverDevices(subnet);
      return success(res, { devices, count: devices.length });
    } catch (err) { return error(res, err.message, 500); }
  }

  // Metrics
  async getMetrics(req, res) {
    try { return success(res, await iotService.getMetrics()); }
    catch (err) { return error(res, err.message, 500); }
  }

  // MQTT ACL
  async getMqttAcl(req, res) {
    try { return success(res, { acl: await iotService.getMqttAcl() }); }
    catch (err) { return error(res, err.message, 500); }
  }

  async saveMqttAcl(req, res) {
    try {
      const { acl } = req.body;
      if (!acl) return error(res, 'ACL content required', 400);
      return success(res, await iotService.saveMqttAcl(acl), 'ACL saved');
    } catch (err) { return error(res, err.message, 500); }
  }
}

export default new IotController();
