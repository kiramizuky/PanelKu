/**
 * Unit Tests for Docker Controller:
 * - src/modules/docker/docker.controller.js
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

const mockDockerService = {
  getDashboardSummary: jest.fn(),
  listContainers: jest.fn(),
  getContainerInfo: jest.fn(),
  startContainer: jest.fn(),
  stopContainer: jest.fn(),
  restartContainer: jest.fn(),
  killContainer: jest.fn(),
  removeContainer: jest.fn(),
  listImages: jest.fn(),
  removeImage: jest.fn(),
  pruneImages: jest.fn(),
  searchImages: jest.fn(),
  createContainer: jest.fn(),
  deployCompose: jest.fn(),
  getAppStoreCatalog: jest.fn(),
  installAppStoreTemplate: jest.fn(),
  getContainerStats: jest.fn(),
  updateContainerResources: jest.fn(),
  listComposeProjects: jest.fn(),
  getComposeProject: jest.fn(),
  startComposeProject: jest.fn(),
  stopComposeProject: jest.fn(),
  restartComposeProject: jest.fn(),
  deleteComposeProject: jest.fn(),
  getComposeLogs: jest.fn(),
  createAutoProxy: jest.fn(),
};

jest.unstable_mockModule('../src/modules/docker/docker.service.js', () => ({
  default: mockDockerService,
  validateProjectName: (name) => /^[a-zA-Z0-9_-]{1,64}$/.test(name),
}));

const { default: dockerController } = await import('../src/modules/docker/docker.controller.js');

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

describe('DockerController — Summary & Container Lifecycle', () => {
  test('getSummary handles available summary and unreachable daemon (503)', async () => {
    mockDockerService.getDashboardSummary.mockResolvedValue({ containers: 5 });

    const res = mockRes();
    await dockerController.getSummary({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.containers).toBe(5);

    mockDockerService.getDashboardSummary.mockResolvedValue(null);
    const res503 = mockRes();
    await dockerController.getSummary({}, res503);
    expect(res503.statusCode).toBe(503);
  });

  test('listContainers, getContainer, start, stop, restart, kill, remove', async () => {
    mockDockerService.listContainers.mockResolvedValue([{ id: 'c1' }]);
    mockDockerService.getContainerInfo.mockResolvedValue({ id: 'c1', name: 'app' });
    mockDockerService.startContainer.mockResolvedValue(undefined);
    mockDockerService.stopContainer.mockResolvedValue(undefined);
    mockDockerService.restartContainer.mockResolvedValue(undefined);
    mockDockerService.killContainer.mockResolvedValue(undefined);
    mockDockerService.removeContainer.mockResolvedValue(undefined);

    const resList = mockRes();
    await dockerController.listContainers({ query: { all: 'true' } }, resList);
    expect(resList.statusCode).toBe(200);

    const resGet = mockRes();
    await dockerController.getContainer({ params: { id: 'c1' } }, resGet);
    expect(resGet.statusCode).toBe(200);
    expect(resGet.body.data.container.id).toBe('c1');

    mockDockerService.getContainerInfo.mockRejectedValue(new Error('not found'));
    const res404 = mockRes();
    await dockerController.getContainer({ params: { id: 'c_none' } }, res404);
    expect(res404.statusCode).toBe(404);

    const resStart = mockRes();
    await dockerController.startContainer({ params: { id: 'c1' } }, resStart);
    expect(resStart.statusCode).toBe(200);

    const resStop = mockRes();
    await dockerController.stopContainer({ params: { id: 'c1' } }, resStop);
    expect(resStop.statusCode).toBe(200);

    const resRestart = mockRes();
    await dockerController.restartContainer({ params: { id: 'c1' } }, resRestart);
    expect(resRestart.statusCode).toBe(200);

    const resKill = mockRes();
    await dockerController.killContainer({ params: { id: 'c1' } }, resKill);
    expect(resKill.statusCode).toBe(200);

    const resRemove = mockRes();
    await dockerController.removeContainer({ params: { id: 'c1' }, query: { force: 'true' } }, resRemove);
    expect(resRemove.statusCode).toBe(200);
  });
});

describe('DockerController — Images, App Store, and Container Stats', () => {
  test('listImages, removeImage, pruneImages, searchImages', async () => {
    mockDockerService.listImages.mockResolvedValue([{ repoTags: ['nginx:latest'] }]);
    mockDockerService.removeImage.mockResolvedValue(undefined);
    mockDockerService.pruneImages.mockResolvedValue({ ImagesDeleted: [{ Deleted: 'img1' }], SpaceReclaimed: 1024 });
    mockDockerService.searchImages.mockResolvedValue([{ name: 'redis' }]);

    const resList = mockRes();
    await dockerController.listImages({}, resList);
    expect(resList.statusCode).toBe(200);

    const resRem = mockRes();
    await dockerController.removeImage({ params: { id: 'img1' }, query: {} }, resRem);
    expect(resRem.statusCode).toBe(200);

    const resPrune = mockRes();
    await dockerController.pruneImages({}, resPrune);
    expect(resPrune.statusCode).toBe(200);
    expect(resPrune.body.data.count).toBe(1);

    const resSearchErr = mockRes();
    await dockerController.searchImages({ query: {} }, resSearchErr);
    expect(resSearchErr.statusCode).toBe(400);

    const resSearch = mockRes();
    await dockerController.searchImages({ query: { term: 'redis' } }, resSearch);
    expect(resSearch.statusCode).toBe(200);
  });

  test('createContainer and deployCompose', async () => {
    mockDockerService.createContainer.mockResolvedValue({ id: 'new_c' });
    mockDockerService.deployCompose.mockResolvedValue({ success: true });

    const resCreate = mockRes();
    await dockerController.createContainer({ body: { Image: 'alpine' } }, resCreate);
    expect(resCreate.statusCode).toBe(200);

    // deployCompose validations
    const resDepErr1 = mockRes();
    await dockerController.deployCompose({ body: {} }, resDepErr1);
    expect(resDepErr1.statusCode).toBe(400);

    const resDepErr2 = mockRes();
    await dockerController.deployCompose({ body: { projectName: 'invalid name with space!', yaml: 'version: "3"' } }, resDepErr2);
    expect(resDepErr2.statusCode).toBe(400);

    const resDep = mockRes();
    await dockerController.deployCompose({ body: { projectName: 'my_stack', yaml: 'services: { web: { image: "nginx" } }' } }, resDep);
    expect(resDep.statusCode).toBe(200);
  });

  test('getAppStore, installAppTemplate, getContainerStats, updateContainerResources', async () => {
    mockDockerService.getAppStoreCatalog.mockReturnValue([{ id: 'wordpress', name: 'WordPress' }]);
    mockDockerService.installAppStoreTemplate.mockResolvedValue({ success: true });
    mockDockerService.getContainerStats.mockResolvedValue({ cpuPercent: 12.5 });
    mockDockerService.updateContainerResources.mockResolvedValue({ success: true });

    const resStore = mockRes();
    await dockerController.getAppStore({}, resStore);
    expect(resStore.statusCode).toBe(200);
    expect(resStore.body.data.catalog).toHaveLength(1);

    const resInstErr = mockRes();
    await dockerController.installAppTemplate({ body: {} }, resInstErr);
    expect(resInstErr.statusCode).toBe(400);

    const resInst = mockRes();
    await dockerController.installAppTemplate({ body: { templateId: 'wordpress', projectName: 'wp-blog' } }, resInst);
    expect(resInst.statusCode).toBe(200);

    const resStats = mockRes();
    await dockerController.getContainerStats({ params: { id: 'c1' } }, resStats);
    expect(resStats.statusCode).toBe(200);

    const resUpd = mockRes();
    await dockerController.updateContainerResources({ params: { id: 'c1' }, body: { memory: 512 } }, resUpd);
    expect(resUpd.statusCode).toBe(200);
  });
});

describe('DockerController — Compose Stacks & Auto Proxy', () => {
  test('list, get, start, stop, restart, delete compose stack, and get logs', async () => {
    mockDockerService.listComposeProjects.mockResolvedValue([{ name: 'stack1' }]);
    mockDockerService.getComposeProject.mockResolvedValue({ name: 'stack1', yaml: 'version: "3"' });
    mockDockerService.startComposeProject.mockResolvedValue({ success: true });
    mockDockerService.stopComposeProject.mockResolvedValue({ success: true });
    mockDockerService.restartComposeProject.mockResolvedValue({ success: true });
    mockDockerService.deleteComposeProject.mockResolvedValue({ success: true });
    mockDockerService.getComposeLogs.mockResolvedValue(['log1', 'log2']);

    const resList = mockRes();
    await dockerController.listComposeStacks({}, resList);
    expect(resList.statusCode).toBe(200);

    const resGet = mockRes();
    await dockerController.getComposeStack({ params: { name: 'stack1' } }, resGet);
    expect(resGet.statusCode).toBe(200);

    mockDockerService.getComposeProject.mockRejectedValue(new Error('stack not found'));
    const resGet404 = mockRes();
    await dockerController.getComposeStack({ params: { name: 'stack_none' } }, resGet404);
    expect(resGet404.statusCode).toBe(404);

    const resStart = mockRes();
    await dockerController.startComposeStack({ params: { name: 'stack1' } }, resStart);
    expect(resStart.statusCode).toBe(200);

    const resStop = mockRes();
    await dockerController.stopComposeStack({ params: { name: 'stack1' } }, resStop);
    expect(resStop.statusCode).toBe(200);

    const resRestart = mockRes();
    await dockerController.restartComposeStack({ params: { name: 'stack1' } }, resRestart);
    expect(resRestart.statusCode).toBe(200);

    const resDel = mockRes();
    await dockerController.deleteComposeStack({ params: { name: 'stack1' }, query: { removeVolumes: 'true' } }, resDel);
    expect(resDel.statusCode).toBe(200);

    const resLogs = mockRes();
    await dockerController.getComposeLogs({ params: { name: 'stack1' }, query: { lines: '100' } }, resLogs);
    expect(resLogs.statusCode).toBe(200);
    expect(resLogs.body.data.logs).toHaveLength(2);
  });

  test('createAutoProxy creates website proxy configuration', async () => {
    mockDockerService.createAutoProxy.mockResolvedValue({ domain: 'app.local', port: 3000 });

    const res = mockRes();
    await dockerController.createAutoProxy({ body: { domain: 'app.local', port: 3000 }, user: { id: 1 } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.website.domain).toBe('app.local');
  });
});
