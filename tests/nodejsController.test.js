/**
 * Unit Tests for NodeJS Controller:
 * - src/modules/nodejs/nodejs.controller.js
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

const mockNodejsService = {
  getStatus: jest.fn(),
  getNodeInfo: jest.fn(),
  installNvm: jest.fn(),
  listRemote: jest.fn(),
  installVersion: jest.fn(),
  uninstallVersion: jest.fn(),
  setDefault: jest.fn(),
  useVersion: jest.fn(),
  listGlobalPackages: jest.fn(),
  installGlobalPackage: jest.fn(),
  uninstallGlobalPackage: jest.fn(),
  getPm2List: jest.fn(),
  pm2Action: jest.fn(),
  getPm2Logs: jest.fn(),
  pm2Start: jest.fn(),
};

jest.unstable_mockModule('../src/modules/nodejs/nodejs.service.js', () => ({
  default: mockNodejsService,
}));

const { default: nodejsController } = await import('../src/modules/nodejs/nodejs.controller.js');

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(d) {
      this.body = d;
      return this;
    },
  };
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('NodeJSController — Status & Versions', () => {
  test('getStatus returns combined status and environment info', async () => {
    mockNodejsService.getStatus.mockResolvedValue({ currentVersion: 'v20.18.0' });
    mockNodejsService.getNodeInfo.mockResolvedValue({ arch: 'x64' });

    const res = mockRes();
    await nodejsController.getStatus({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.status.currentVersion).toBe('v20.18.0');
    expect(res.body.data.nodeInfo.arch).toBe('x64');

    mockNodejsService.getStatus.mockRejectedValue(new Error('fail'));
    const resErr = mockRes();
    await nodejsController.getStatus({}, resErr);
    expect(resErr.statusCode).toBe(500);
  });

  test('installNvm delegates to nodejsService', async () => {
    mockNodejsService.installNvm.mockResolvedValue({ message: 'NVM installed' });

    const res = mockRes();
    await nodejsController.installNvm({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe('NVM installed');
  });

  test('getLocalVersions and getRemoteVersions', async () => {
    mockNodejsService.getStatus.mockResolvedValue({
      currentVersion: 'v20.18.0',
      defaultVersion: 'v20.18.0',
      installedVersions: ['v20.18.0', 'v22.0.0'],
      nvmInstalled: true,
    });
    mockNodejsService.listRemote.mockResolvedValue(['v20.18.0', 'v22.11.0']);

    const resLocal = mockRes();
    await nodejsController.getLocalVersions({}, resLocal);
    expect(resLocal.statusCode).toBe(200);
    expect(resLocal.body.data.installed).toHaveLength(2);

    const resRemote = mockRes();
    await nodejsController.getRemoteVersions({ query: { filter: 'lts' } }, resRemote);
    expect(resRemote.statusCode).toBe(200);
    expect(resRemote.body.data.versions).toHaveLength(2);
  });

  test('installVersion, uninstallVersion, setDefaultVersion, useVersion validate version', async () => {
    mockNodejsService.installVersion.mockResolvedValue({ message: 'Installed' });
    mockNodejsService.uninstallVersion.mockResolvedValue({ message: 'Uninstalled' });
    mockNodejsService.setDefault.mockResolvedValue({ message: 'Default set' });
    mockNodejsService.useVersion.mockResolvedValue({ message: 'Version switched' });

    // Missing version -> 400
    const resErr1 = mockRes();
    await nodejsController.installVersion({ body: {} }, resErr1);
    expect(resErr1.statusCode).toBe(400);

    const resErr2 = mockRes();
    await nodejsController.uninstallVersion({ body: {} }, resErr2);
    expect(resErr2.statusCode).toBe(400);

    const resErr3 = mockRes();
    await nodejsController.setDefaultVersion({ body: {} }, resErr3);
    expect(resErr3.statusCode).toBe(400);

    const resErr4 = mockRes();
    await nodejsController.useVersion({ body: {} }, resErr4);
    expect(resErr4.statusCode).toBe(400);

    // Valid calls
    const res1 = mockRes();
    await nodejsController.installVersion({ body: { version: '22' } }, res1);
    expect(res1.statusCode).toBe(200);

    const res2 = mockRes();
    await nodejsController.uninstallVersion({ body: { version: '18' } }, res2);
    expect(res2.statusCode).toBe(200);

    const res3 = mockRes();
    await nodejsController.setDefaultVersion({ body: { version: '20' } }, res3);
    expect(res3.statusCode).toBe(200);

    const res4 = mockRes();
    await nodejsController.useVersion({ body: { version: '22' } }, res4);
    expect(res4.statusCode).toBe(200);
  });
});

describe('NodeJSController — Global Packages, PM2, and Info', () => {
  test('listGlobalPackages, installGlobalPackage, uninstallGlobalPackage', async () => {
    mockNodejsService.listGlobalPackages.mockResolvedValue(['pm2', 'yarn']);
    mockNodejsService.installGlobalPackage.mockResolvedValue({ message: 'Package installed' });
    mockNodejsService.uninstallGlobalPackage.mockResolvedValue({ message: 'Package uninstalled' });

    const resList = mockRes();
    await nodejsController.listGlobalPackages({}, resList);
    expect(resList.statusCode).toBe(200);
    expect(resList.body.data.packages).toEqual(['pm2', 'yarn']);

    const resInsErr = mockRes();
    await nodejsController.installGlobalPackage({ body: {} }, resInsErr);
    expect(resInsErr.statusCode).toBe(400);

    const resIns = mockRes();
    await nodejsController.installGlobalPackage({ body: { name: 'pnpm' } }, resIns);
    expect(resIns.statusCode).toBe(200);

    const resUnErr = mockRes();
    await nodejsController.uninstallGlobalPackage({ body: {} }, resUnErr);
    expect(resUnErr.statusCode).toBe(400);

    const resUn = mockRes();
    await nodejsController.uninstallGlobalPackage({ body: { name: 'yarn' } }, resUn);
    expect(resUn.statusCode).toBe(200);
  });

  test('getPm2List, pm2Action, getPm2Logs, pm2Start', async () => {
    mockNodejsService.getPm2List.mockResolvedValue([{ name: 'app1', status: 'online' }]);
    mockNodejsService.pm2Action.mockResolvedValue({ message: 'Process restarted' });
    mockNodejsService.getPm2Logs.mockResolvedValue(['log line 1']);
    mockNodejsService.pm2Start.mockResolvedValue({ message: 'Process started' });

    const resList = mockRes();
    await nodejsController.getPm2List({}, resList);
    expect(resList.statusCode).toBe(200);

    // pm2Action validations
    const resActErr1 = mockRes();
    await nodejsController.pm2Action({ body: {} }, resActErr1);
    expect(resActErr1.statusCode).toBe(400);

    const resActErr2 = mockRes();
    await nodejsController.pm2Action({ body: { name: 'app1' } }, resActErr2);
    expect(resActErr2.statusCode).toBe(400);

    const resAct = mockRes();
    await nodejsController.pm2Action({ body: { name: 'app1', action: 'restart' } }, resAct);
    expect(resAct.statusCode).toBe(200);

    // pm2Logs validation
    const resLogErr = mockRes();
    await nodejsController.getPm2Logs({ query: {} }, resLogErr);
    expect(resLogErr.statusCode).toBe(400);

    const resLog = mockRes();
    await nodejsController.getPm2Logs({ query: { name: 'app1', lines: '50' } }, resLog);
    expect(resLog.statusCode).toBe(200);
    expect(resLog.body.data.logs).toEqual(['log line 1']);

    // pm2Start validation
    const resStartErr = mockRes();
    await nodejsController.pm2Start({ body: {} }, resStartErr);
    expect(resStartErr.statusCode).toBe(400);

    const resStart = mockRes();
    await nodejsController.pm2Start({ body: { script: 'app.js', name: 'app2' } }, resStart);
    expect(resStart.statusCode).toBe(200);
  });

  test('getNodeInfo returns environment information', async () => {
    mockNodejsService.getNodeInfo.mockResolvedValue({ nodeVersion: 'v20.18.0' });

    const res = mockRes();
    await nodejsController.getNodeInfo({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.info.nodeVersion).toBe('v20.18.0');
  });
});
