/**
 * Websites Controller Comprehensive Unit Tests
 *
 * @jest-environment node
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import websitesController from '../src/modules/websites/websites.controller.js';
import Website from '../src/models/Website.js';
import User from '../src/models/User.js';

let testUserId;

function mockRes() {
  return {
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
}

beforeAll(async () => {
  let user = await User.findOne({});
  if (!user) {
    user = await User.create({
      username: 'test_web_admin',
      email: 'webadmin@panelku.test',
      password: 'Password123!',
    });
  }
  testUserId = user.id || user._id;
});

afterAll(async () => {
  const { default: queueManager } = await import('../src/core/queue/QueueManager.js');
  await queueManager.closeAll();
});

describe('WebsitesController - CRUD Operations', () => {
  let createdWebsiteId;

  afterAll(async () => {
    if (createdWebsiteId) {
      try {
        await Website.findByIdAndDelete(createdWebsiteId);
      } catch {}
    }
  });

  test('listWebsites returns list of websites', async () => {
    const res = mockRes();
    await websitesController.listWebsites({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.websites)).toBe(true);
  });

  test('createWebsite rejects missing domain', async () => {
    const req = { body: {} };
    const res = mockRes();
    await websitesController.createWebsite(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('createWebsite creates new website record', async () => {
    const domain = `ctrl-test-${Date.now()}.local`;
    const req = {
      body: {
        domain,
        type: 'static',
        rootDirectory: '/var/www/ctrl-test',
      },
      user: { _id: testUserId },
    };
    const res = mockRes();
    await websitesController.createWebsite(req, res);
    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.website).toBeDefined();
    createdWebsiteId = res.body.data.website.id || res.body.data.website._id;
  });

  test('getWebsite returns website details', async () => {
    const req = { params: { id: createdWebsiteId } };
    const res = mockRes();
    await websitesController.getWebsite(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.website.id).toBe(createdWebsiteId);
  });

  test('getWebsite returns 404 for non-existent website', async () => {
    const req = { params: { id: 'non-existent-site-id' } };
    const res = mockRes();
    await websitesController.getWebsite(req, res);
    expect(res.statusCode).toBe(404);
  });

  test('updateWebsite modifies website configuration', async () => {
    const req = {
      params: { id: createdWebsiteId },
      body: {
        aliases: ['alias1.local', 'alias2.local'],
      },
    };
    const res = mockRes();
    await websitesController.updateWebsite(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('deleteWebsite deletes website', async () => {
    const tempSite = await Website.create({
      domain: `to-delete-${Date.now()}.local`,
      type: 'static',
      rootDirectory: '/var/www/to-delete',
      owner: testUserId,
    });
    const req = { params: { id: tempSite.id } };
    const res = mockRes();
    await websitesController.deleteWebsite(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe('Website deleted');
  });
});

describe('WebsitesController - Nginx Config & Logs', () => {
  let siteId;

  beforeAll(async () => {
    const site = await Website.create({
      domain: `nginx-test-${Date.now()}.local`,
      type: 'proxy',
      port: 8080,
      targetHost: '127.0.0.1',
      rootDirectory: '/var/www/nginx-test',
      owner: testUserId,
    });
    siteId = site.id;
  });

  afterAll(async () => {
    if (siteId) {
      try {
        await Website.findByIdAndDelete(siteId);
      } catch {}
    }
  });

  test('getNginxConfig retrieves configuration', async () => {
    const req = { params: { id: siteId } };
    const res = mockRes();
    await websitesController.getNginxConfig(req, res);
    expect([200, 400]).toContain(res.statusCode);
  });

  test('saveNginxConfig validates content string', async () => {
    const badReq = { params: { id: siteId }, body: { content: 123 } };
    const badRes = mockRes();
    await websitesController.saveNginxConfig(badReq, badRes);
    expect(badRes.statusCode).toBe(400);
  });

  test('resetNginxConfig resets configuration to default template', async () => {
    const req = { params: { id: siteId } };
    const res = mockRes();
    await websitesController.resetNginxConfig(req, res);
    expect([200, 400]).toContain(res.statusCode);
  });

  test('getWebsiteLogs and clearWebsiteLogs handle log operations', async () => {
    const logReq = { params: { id: siteId }, query: { type: 'access', lines: '50' } };
    const logRes = mockRes();
    await websitesController.getWebsiteLogs(logReq, logRes);
    expect([200, 400]).toContain(logRes.statusCode);

    const clearReq = { params: { id: siteId }, body: { type: 'access' } };
    const clearRes = mockRes();
    await websitesController.clearWebsiteLogs(clearReq, clearRes);
    expect([200, 400]).toContain(clearRes.statusCode);
  });
});

describe('WebsitesController - Git Deployments & Webhook', () => {
  let deploySiteId;
  const webhookSecret = 'test-token-sec-456';

  beforeAll(async () => {
    const site = await Website.create({
      domain: `deploy-test-${Date.now()}.local`,
      type: 'static',
      gitRepo: 'https://github.com/example/sample.git',
      webhookToken: webhookSecret,
      rootDirectory: '/var/www/deploy-test',
      owner: testUserId,
    });
    deploySiteId = site.id;
  });

  afterAll(async () => {
    if (deploySiteId) {
      try {
        await Website.findByIdAndDelete(deploySiteId);
      } catch {}
    }
  });

  test('deployGit async queues deployment job', async () => {
    const req = {
      params: { id: deploySiteId },
      query: { async: 'true' },
    };
    const res = mockRes();
    await websitesController.deployGit(req, res);
    expect(res.statusCode).toBe(202);
    expect(res.body.success).toBe(true);
  });

  test('webhookDeploy rejects invalid token', async () => {
    const req = {
      params: { id: deploySiteId, token: 'wrong-token' },
    };
    const res = mockRes();
    await websitesController.webhookDeploy(req, res);
    expect(res.statusCode).toBe(401);
  });

  test('webhookDeploy accepts valid token and queues job', async () => {
    const req = {
      params: { id: deploySiteId, token: webhookSecret },
    };
    const res = mockRes();
    await websitesController.webhookDeploy(req, res);
    expect(res.statusCode).toBe(202);
    expect(res.body.success).toBe(true);
  });

  test('getDeployJobStatus returns 404 for unknown job', async () => {
    const req = { params: { jobId: 'fake-deploy-job' } };
    const res = mockRes();
    await websitesController.getDeployJobStatus(req, res);
    expect(res.statusCode).toBe(404);
  });
});
