/**
 * Unit tests for IoT Module:
 * - src/modules/iot/iot.service.js
 * - src/modules/iot/iot.controller.js
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

const mockExecHandlers = [];
let mockExecFileHandler = null;

jest.unstable_mockModule('child_process', () => ({
  exec: jest.fn((cmd, opts, cb) => {
    const callback = typeof opts === 'function' ? opts : cb;
    for (const handler of mockExecHandlers) {
      const match = handler(cmd);
      if (match !== undefined) {
        if (match instanceof Error) return callback(match);
        return callback(null, match);
      }
    }
    return callback(null, { stdout: '', stderr: '' });
  }),
  execFile: jest.fn((file, args, opts, cb) => {
    const callback = typeof opts === 'function' ? opts : cb;
    if (mockExecFileHandler) {
      const res = mockExecFileHandler(file, args);
      if (res instanceof Error) return callback(res);
      return callback(null, res || { stdout: '', stderr: '' });
    }
    return callback(null, { stdout: '', stderr: '' });
  }),
}));

const mockFs = {
  writeFile: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
};

jest.unstable_mockModule('fs/promises', () => ({
  default: mockFs,
  ...mockFs,
}));

const { default: iotService } = await import('../src/modules/iot/iot.service.js');
const { default: iotController } = await import('../src/modules/iot/iot.controller.js');

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

beforeEach(() => {
  mockExecHandlers.length = 0;
  mockExecFileHandler = null;
  jest.clearAllMocks();
});

describe('IotService — Validation Helpers', () => {
  test('_validatePort validates port range correctly', () => {
    expect(iotService._validatePort(1883)).toBe(1883);
    expect(iotService._validatePort('8080')).toBe(8080);
    expect(() => iotService._validatePort(0)).toThrow('Invalid port number');
    expect(() => iotService._validatePort(70000)).toThrow('Invalid port number');
    expect(() => iotService._validatePort('abc')).toThrow('Invalid port number');
  });

  test('_validateId validates alphanumeric, hyphens, and underscores', () => {
    expect(iotService._validateId('client-123_abc')).toBe('client-123_abc');
    expect(() => iotService._validateId('')).toThrow('Invalid ID format');
    expect(() => iotService._validateId('invalid id with spaces')).toThrow('Invalid ID format');
    expect(() => iotService._validateId('bad;command')).toThrow('Invalid ID format');
  });

  test('_validateTopic validates topic characters', () => {
    expect(iotService._validateTopic('sensors/livingroom/temp')).toBe('sensors/livingroom/temp');
    expect(iotService._validateTopic('home/#')).toBe('home/#');
    expect(iotService._validateTopic('home/+/status')).toBe('home/+/status');
    expect(() => iotService._validateTopic('')).toThrow('Invalid topic format');
    expect(() => iotService._validateTopic('bad topic with spaces')).toThrow('Invalid topic format');
    expect(() => iotService._validateTopic('topic;rm -rf')).toThrow('Invalid topic format');
  });
});

describe('IotService — Mosquitto Management', () => {
  test('getMqttStatus detects running Mosquitto with version, port, and client count', async () => {
    mockExecHandlers.push(cmd => {
      if (cmd.includes('systemctl is-active mosquitto')) return { stdout: 'active\n' };
      if (cmd.includes('mosquitto -h')) return { stdout: 'mosquitto version 2.0.18\n' };
      if (cmd.includes('grep 1883')) return { stdout: 'tcp 0 0 0.0.0.0:1883\n' };
      if (cmd.includes('$SYS/broker/clients/total')) return { stdout: '5\n' };
    });

    const status = await iotService.getMqttStatus();
    expect(status.installed).toBe(true);
    expect(status.active).toBe(true);
    expect(status.version).toContain('2.0.18');
    expect(status.port).toBe(1883);
    expect(status.clientCount).toBe(5);
  });

  test('getMqttStatus returns inactive defaults when service is down or command fails', async () => {
    mockExecHandlers.push(() => new Error('command failed'));

    const status = await iotService.getMqttStatus();
    expect(status.installed).toBe(false);
    expect(status.active).toBe(false);
    expect(status.clientCount).toBe(0);
  });

  test('installMosquitto installs packages, enables, and starts service', async () => {
    mockExecHandlers.push(cmd => {
      if (cmd.includes('apt-get install')) return { stdout: 'Setting up mosquitto\n' };
      return { stdout: '' };
    });

    const result = await iotService.installMosquitto();
    expect(result.success).toBe(true);
    expect(result.log).toContain('Setting up mosquitto');
  });

  test('controlMosquitto rejects invalid actions and executes valid systemctl commands', async () => {
    await expect(iotService.controlMosquitto('destroy')).rejects.toThrow('Invalid action');

    mockExecHandlers.push(() => ({ stdout: '' }));
    const res = await iotService.controlMosquitto('restart');
    expect(res.success).toBe(true);

    mockExecHandlers.length = 0;
    mockExecHandlers.push(() => new Error('service not found'));
    await expect(iotService.controlMosquitto('start')).rejects.toThrow('Failed to start Mosquitto');
  });

  test('getMosquittoConfig reads file and saveMosquittoConfig safely updates it', async () => {
    mockExecHandlers.push(cmd => {
      if (cmd.includes('cat /etc/mosquitto/mosquitto.conf')) return { stdout: 'listener 1883\n' };
    });

    const config = await iotService.getMosquittoConfig();
    expect(config).toBe('listener 1883\n');

    await expect(iotService.saveMosquittoConfig('')).rejects.toThrow('Config too large');
    await expect(iotService.saveMosquittoConfig('a'.repeat(100001))).rejects.toThrow('Config too large');

    const saveRes = await iotService.saveMosquittoConfig('listener 1883\nallow_anonymous true');
    expect(saveRes.success).toBe(true);
    expect(mockFs.writeFile).toHaveBeenCalled();
    expect(mockFs.unlink).toHaveBeenCalled();
  });
});

describe('IotService — MQTT Topics, Users, and ACLs', () => {
  test('getMqttTopics returns empty topics placeholder', async () => {
    const topics = await iotService.getMqttTopics();
    expect(topics).toEqual({ topics: [] });
  });

  test('publishMessage validates parameters and publishes via mosquitto_pub', async () => {
    await expect(iotService.publishMessage('bad topic', 'hello')).rejects.toThrow('Invalid topic format');
    await expect(iotService.publishMessage('test/topic', 'hello', 5)).rejects.toThrow('QoS must be 0, 1, or 2');
    await expect(iotService.publishMessage('test/topic', '')).rejects.toThrow('Invalid message');

    mockExecHandlers.push(cmd => {
      if (cmd.includes('mosquitto_pub')) return { stdout: '' };
    });

    const res = await iotService.publishMessage('test/temp', '23.5', 1);
    expect(res.success).toBe(true);
    expect(res.topic).toBe('test/temp');
    expect(res.qos).toBe(1);
  });

  test('getMqttUsers parses passwd entries', async () => {
    mockExecHandlers.push(cmd => {
      if (cmd.includes('cat /etc/mosquitto/passwd')) {
        return { stdout: 'sensor1:$7$101$...==\nadmin:$7$101$...==\n' };
      }
    });

    const users = await iotService.getMqttUsers();
    expect(users).toHaveLength(2);
    expect(users[0].username).toBe('sensor1');
    expect(users[0].hasPassword).toBe(true);
  });

  test('addMqttUser and deleteMqttUser execute safely', async () => {
    await expect(iotService.addMqttUser('user!', 'secret123')).rejects.toThrow('Invalid ID format');
    await expect(iotService.addMqttUser('user1', '12')).rejects.toThrow('Password must be at least 4 characters');

    const addRes = await iotService.addMqttUser('sensorNode', 'strongPass123');
    expect(addRes.success).toBe(true);
    expect(addRes.username).toBe('sensorNode');

    mockExecHandlers.push(() => ({ stdout: '' }));
    const delRes = await iotService.deleteMqttUser('sensorNode');
    expect(delRes.success).toBe(true);
    expect(delRes.username).toBe('sensorNode');
  });

  test('getMqttAcl and saveMqttAcl read and write ACL configurations', async () => {
    mockExecHandlers.push(cmd => {
      if (cmd.includes('cat /etc/mosquitto/acl')) return { stdout: 'user sensorNode\ntopic readwrite sensor/#\n' };
    });

    const acl = await iotService.getMqttAcl();
    expect(acl).toContain('user sensorNode');

    const saveRes = await iotService.saveMqttAcl('user admin\ntopic #');
    expect(saveRes.success).toBe(true);
    expect(mockFs.writeFile).toHaveBeenCalled();
  });
});

describe('IotService — Home Assistant, Node-RED, Discovery & Metrics', () => {
  test('getHomeAssistantStatus detects running instance and parses port and image', async () => {
    mockExecHandlers.push(cmd => {
      if (cmd.includes('home-assistant')) return { stdout: 'active\n' };
      if (cmd.includes('grep 8123')) return { stdout: 'tcp 0 0 0.0.0.0:8123\n' };
      if (cmd.includes('docker inspect homeassistant')) return { stdout: '"Image": "homeassistant:2024.1"\n' };
    });

    const status = await iotService.getHomeAssistantStatus();
    expect(status.installed).toBe(true);
    expect(status.active).toBe(true);
    expect(status.port).toBe(8123);
  });

  test('installHomeAssistant pulls and runs docker container', async () => {
    mockExecHandlers.push(cmd => {
      if (cmd.includes('docker pull ghcr.io/home-assistant')) return { stdout: 'Digest: sha256:12345\n' };
    });

    const res = await iotService.installHomeAssistant();
    expect(res.success).toBe(true);
  });

  test('getNodeRedStatus and installNodeRed manage Node-RED runtime', async () => {
    mockExecHandlers.push(cmd => {
      if (cmd.includes('nodered')) return { stdout: 'active\n' };
      if (cmd.includes('grep 1880')) return { stdout: 'tcp 0 0 0.0.0.0:1880\n' };
    });

    const status = await iotService.getNodeRedStatus();
    expect(status.installed).toBe(true);
    expect(status.active).toBe(true);
    expect(status.port).toBe(1880);

    mockExecHandlers.push(cmd => {
      if (cmd.includes('docker pull nodered/node-red')) return { stdout: 'Node-RED container created\n' };
    });

    const install = await iotService.installNodeRed();
    expect(install.success).toBe(true);
  });

  test('discoverDevices validates subnet and parses discovered IP and hostnames', async () => {
    await expect(iotService.discoverDevices('invalid_subnet')).rejects.toThrow('Invalid subnet format');

    mockExecHandlers.push(cmd => {
      if (cmd.includes('nmap')) {
        return { stdout: '192.168.1.1 router.local\n192.168.1.50 esp32-sensor\n' };
      }
    });

    const devices = await iotService.discoverDevices('192.168.1.0/24');
    expect(devices).toHaveLength(2);
    expect(devices[0].ip).toBe('192.168.1.1');
    expect(devices[0].hostname).toBe('router.local');
    expect(devices[1].ip).toBe('192.168.1.50');
  });

  test('getMetrics parses messages and bytes sent', async () => {
    mockExecHandlers.push(cmd => {
      if (cmd.includes('$SYS/broker/messages/sent')) {
        return { stdout: '450\n102400\n' };
      }
    });

    const metrics = await iotService.getMetrics();
    expect(metrics.messagesSent).toBe(450);
    expect(metrics.bytesSent).toBe(102400);
  });
});

describe('IotController — Endpoints', () => {
  test('getMqttStatus, installMosquitto, controlMosquitto, getMosquittoConfig, saveMosquittoConfig', async () => {
    jest.spyOn(iotService, 'getMqttStatus').mockResolvedValue({ active: true });
    jest.spyOn(iotService, 'installMosquitto').mockResolvedValue({ success: true });
    jest.spyOn(iotService, 'controlMosquitto').mockResolvedValue({ success: true });
    jest.spyOn(iotService, 'getMosquittoConfig').mockResolvedValue('listener 1883');
    jest.spyOn(iotService, 'saveMosquittoConfig').mockResolvedValue({ success: true });

    const res1 = mockRes();
    await iotController.getMqttStatus({}, res1);
    expect(res1.statusCode).toBe(200);

    const res2 = mockRes();
    await iotController.installMosquitto({}, res2);
    expect(res2.statusCode).toBe(200);

    const res3Err = mockRes();
    await iotController.controlMosquitto({ body: {} }, res3Err);
    expect(res3Err.statusCode).toBe(400);

    const res3 = mockRes();
    await iotController.controlMosquitto({ body: { action: 'restart' } }, res3);
    expect(res3.statusCode).toBe(200);

    const res4 = mockRes();
    await iotController.getMosquittoConfig({}, res4);
    expect(res4.statusCode).toBe(200);

    const res5Err = mockRes();
    await iotController.saveMosquittoConfig({ body: {} }, res5Err);
    expect(res5Err.statusCode).toBe(400);

    const res5 = mockRes();
    await iotController.saveMosquittoConfig({ body: { config: 'listener 1883' } }, res5);
    expect(res5.statusCode).toBe(200);
  });

  test('getMqttUsers, addMqttUser, deleteMqttUser, publishMessage', async () => {
    jest.spyOn(iotService, 'getMqttUsers').mockResolvedValue([{ username: 'u1' }]);
    jest.spyOn(iotService, 'addMqttUser').mockResolvedValue({ success: true });
    jest.spyOn(iotService, 'deleteMqttUser').mockResolvedValue({ success: true });
    jest.spyOn(iotService, 'publishMessage').mockResolvedValue({ success: true });

    const res1 = mockRes();
    await iotController.getMqttUsers({}, res1);
    expect(res1.statusCode).toBe(200);

    const res2Err = mockRes();
    await iotController.addMqttUser({ body: {} }, res2Err);
    expect(res2Err.statusCode).toBe(400);

    const res2 = mockRes();
    await iotController.addMqttUser({ body: { username: 'u1', password: 'p1' } }, res2);
    expect(res2.statusCode).toBe(200);

    const res3Err = mockRes();
    await iotController.deleteMqttUser({ body: {} }, res3Err);
    expect(res3Err.statusCode).toBe(400);

    const res3 = mockRes();
    await iotController.deleteMqttUser({ body: { username: 'u1' } }, res3);
    expect(res3.statusCode).toBe(200);

    const res4Err = mockRes();
    await iotController.publishMessage({ body: {} }, res4Err);
    expect(res4Err.statusCode).toBe(400);

    const res4 = mockRes();
    await iotController.publishMessage({ body: { topic: 'a', message: 'b' } }, res4);
    expect(res4.statusCode).toBe(200);
  });

  test('HomeAssistant, NodeRed, DeviceDiscovery, Metrics, ACL endpoints', async () => {
    jest.spyOn(iotService, 'getHomeAssistantStatus').mockResolvedValue({ active: true });
    jest.spyOn(iotService, 'installHomeAssistant').mockResolvedValue({ success: true });
    jest.spyOn(iotService, 'getNodeRedStatus').mockResolvedValue({ active: true });
    jest.spyOn(iotService, 'installNodeRed').mockResolvedValue({ success: true });
    jest.spyOn(iotService, 'discoverDevices').mockResolvedValue([{ ip: '192.168.1.1' }]);
    jest.spyOn(iotService, 'getMetrics').mockResolvedValue({ messagesSent: 10 });
    jest.spyOn(iotService, 'getMqttAcl').mockResolvedValue('user admin');
    jest.spyOn(iotService, 'saveMqttAcl').mockResolvedValue({ success: true });

    const res1 = mockRes();
    await iotController.getHomeAssistantStatus({}, res1);
    expect(res1.statusCode).toBe(200);

    const res2 = mockRes();
    await iotController.installHomeAssistant({}, res2);
    expect(res2.statusCode).toBe(200);

    const res3 = mockRes();
    await iotController.getNodeRedStatus({}, res3);
    expect(res3.statusCode).toBe(200);

    const res4 = mockRes();
    await iotController.installNodeRed({}, res4);
    expect(res4.statusCode).toBe(200);

    const res5 = mockRes();
    await iotController.discoverDevices({ body: { subnet: '192.168.1.0/24' } }, res5);
    expect(res5.statusCode).toBe(200);
    expect(res5.body.data.count).toBe(1);

    const res6 = mockRes();
    await iotController.getMetrics({}, res6);
    expect(res6.statusCode).toBe(200);

    const res7 = mockRes();
    await iotController.getMqttAcl({}, res7);
    expect(res7.statusCode).toBe(200);

    const res8Err = mockRes();
    await iotController.saveMqttAcl({ body: {} }, res8Err);
    expect(res8Err.statusCode).toBe(400);

    const res8 = mockRes();
    await iotController.saveMqttAcl({ body: { acl: 'user a' } }, res8);
    expect(res8.statusCode).toBe(200);
  });
});
