/**
 * Redis & MongoDB Controllers Unit Tests
 *
 * @jest-environment node
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import redisController from '../src/modules/redis/redis.controller.js';
import mongodbController from '../src/modules/mongodb/mongodb.controller.js';
import redisService from '../src/modules/redis/redis.service.js';
import mongodbService from '../src/modules/mongodb/mongodb.service.js';

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

describe('RedisController', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('getInfo and getStats return redis statistics', async () => {
    jest.spyOn(redisService, 'getInfo').mockResolvedValue({ version: '7.0.0' });
    jest.spyOn(redisService, 'getStats').mockResolvedValue({ ops_per_sec: 150 });

    const resInfo = mockRes();
    await redisController.getInfo({}, resInfo);
    expect(resInfo.statusCode).toBe(200);
    expect(resInfo.body.data.version).toBe('7.0.0');

    const resStats = mockRes();
    await redisController.getStats({}, resStats);
    expect(resStats.statusCode).toBe(200);
    expect(resStats.body.data.ops_per_sec).toBe(150);
  });

  test('getConfig and setConfig validate parameters', async () => {
    jest.spyOn(redisService, 'getConfig').mockResolvedValue({ maxmemory: '2gb' });
    jest.spyOn(redisService, 'setConfig').mockResolvedValue({ success: true, message: 'Saved' });

    const resGet = mockRes();
    await redisController.getConfig({ query: {} }, resGet);
    expect(resGet.statusCode).toBe(200);
    expect(resGet.body.data.configs.maxmemory).toBe('2gb');

    const badSet = mockRes();
    await redisController.setConfig({ body: {} }, badSet);
    expect(badSet.statusCode).toBe(400);

    const goodSet = mockRes();
    await redisController.setConfig({ body: { key: 'maxmemory', value: '4gb' } }, goodSet);
    expect(goodSet.statusCode).toBe(200);
  });

  test('scanKeys, getKeyValue, deleteKey, setKeyTtl', async () => {
    jest.spyOn(redisService, 'scanKeys').mockResolvedValue({ keys: ['k1', 'k2'], cursor: 0 });
    jest.spyOn(redisService, 'getKeyValue').mockResolvedValue({ type: 'string', value: 'hello' });
    jest.spyOn(redisService, 'deleteKey').mockResolvedValue({ success: true });
    jest.spyOn(redisService, 'setKeyTtl').mockResolvedValue({ success: true });

    const resScan = mockRes();
    await redisController.scanKeys({ query: {} }, resScan);
    expect(resScan.statusCode).toBe(200);
    expect(resScan.body.data.keys.length).toBe(2);

    const resVal = mockRes();
    await redisController.getKeyValue({ params: { key: 'k1' } }, resVal);
    expect(resVal.statusCode).toBe(200);

    const resDel = mockRes();
    await redisController.deleteKey({ params: { key: 'k1' } }, resDel);
    expect(resDel.statusCode).toBe(200);

    const resTtl = mockRes();
    await redisController.setKeyTtl({ params: { key: 'k1' }, body: { seconds: 3600 } }, resTtl);
    expect(resTtl.statusCode).toBe(200);
  });

  test('operations: flushDb, flushAll, save, bgsave, clients, slowlog', async () => {
    jest.spyOn(redisService, 'flushDb').mockResolvedValue({ success: true });
    jest.spyOn(redisService, 'flushAll').mockResolvedValue({ success: true });
    jest.spyOn(redisService, 'save').mockResolvedValue({ success: true });
    jest.spyOn(redisService, 'bgsave').mockResolvedValue({ success: true });
    jest.spyOn(redisService, 'getClients').mockResolvedValue([{ addr: '127.0.0.1:1234' }]);
    jest.spyOn(redisService, 'killClient').mockResolvedValue({ success: true });
    jest.spyOn(redisService, 'getSlowLog').mockResolvedValue([]);

    const res1 = mockRes();
    await redisController.flushDb({}, res1);
    expect(res1.statusCode).toBe(200);

    const res2 = mockRes();
    await redisController.flushAll({}, res2);
    expect(res2.statusCode).toBe(200);

    const res3 = mockRes();
    await redisController.save({}, res3);
    expect(res3.statusCode).toBe(200);

    const res4 = mockRes();
    await redisController.bgsave({}, res4);
    expect(res4.statusCode).toBe(200);

    const res5 = mockRes();
    await redisController.getClients({}, res5);
    expect(res5.statusCode).toBe(200);

    const badKill = mockRes();
    await redisController.killClient({ body: {} }, badKill);
    expect(badKill.statusCode).toBe(400);

    const goodKill = mockRes();
    await redisController.killClient({ body: { addr: '127.0.0.1:1234' } }, goodKill);
    expect(goodKill.statusCode).toBe(200);

    const res6 = mockRes();
    await redisController.getSlowLog({ query: {} }, res6);
    expect(res6.statusCode).toBe(200);
  });
});

describe('MongoDBController', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('getStatus, install, and getServerInfo', async () => {
    jest.spyOn(mongodbService, 'getStatus').mockResolvedValue({ installed: true, running: true });
    jest.spyOn(mongodbService, 'installMongoDB').mockResolvedValue({ success: true });
    jest.spyOn(mongodbService, 'getServerInfo').mockResolvedValue({ version: '6.0.4' });

    const resStatus = mockRes();
    await mongodbController.getStatus({}, resStatus);
    expect(resStatus.statusCode).toBe(200);

    const resInstall = mockRes();
    await mongodbController.install({}, resInstall);
    expect(resInstall.statusCode).toBe(200);

    const resInfo = mockRes();
    await mongodbController.getServerInfo({}, resInfo);
    expect(resInfo.statusCode).toBe(200);
  });

  test('databases and collections management', async () => {
    jest.spyOn(mongodbService, 'listDatabases').mockResolvedValue(['test_db']);
    jest.spyOn(mongodbService, 'createDatabase').mockResolvedValue({ success: true });
    jest.spyOn(mongodbService, 'dropDatabase').mockResolvedValue({ success: true });
    jest.spyOn(mongodbService, 'getDatabaseStats').mockResolvedValue({ dataSize: 1024 });
    jest.spyOn(mongodbService, 'listCollections').mockResolvedValue(['users']);
    jest.spyOn(mongodbService, 'dropCollection').mockResolvedValue({ success: true });

    const resList = mockRes();
    await mongodbController.listDatabases({}, resList);
    expect(resList.statusCode).toBe(200);

    const badDb = mockRes();
    await mongodbController.createDatabase({ body: {} }, badDb);
    expect(badDb.statusCode).toBe(400);

    const goodDb = mockRes();
    await mongodbController.createDatabase({ body: { name: 'analytics' } }, goodDb);
    expect(goodDb.statusCode).toBe(200);

    const resStats = mockRes();
    await mongodbController.getDatabaseStats({ params: { name: 'analytics' } }, resStats);
    expect(resStats.statusCode).toBe(200);

    const resDropDb = mockRes();
    await mongodbController.dropDatabase({ params: { name: 'analytics' } }, resDropDb);
    expect(resDropDb.statusCode).toBe(200);

    const resListCol = mockRes();
    await mongodbController.listCollections({ params: { name: 'analytics' } }, resListCol);
    expect(resListCol.statusCode).toBe(200);

    const resDropCol = mockRes();
    await mongodbController.dropCollection({ params: { db: 'analytics', collection: 'logs' } }, resDropCol);
    expect(resDropCol.statusCode).toBe(200);
  });

  test('documents findDocuments and runQuery', async () => {
    jest.spyOn(mongodbService, 'findDocuments').mockResolvedValue({ documents: [], total: 0 });
    jest.spyOn(mongodbService, 'runQuery').mockResolvedValue({ ok: 1 });

    const resQuery = mockRes();
    await mongodbController.findDocuments({ params: { db: 'analytics', collection: 'users' }, query: {} }, resQuery);
    expect(resQuery.statusCode).toBe(200);

    const badRun = mockRes();
    await mongodbController.runQuery({ body: {} }, badRun);
    expect(badRun.statusCode).toBe(400);

    const goodRun = mockRes();
    await mongodbController.runQuery({ body: { database: 'analytics', query: 'db.users.find()' } }, goodRun);
    expect(goodRun.statusCode).toBe(200);
  });

  test('users list, create, and drop', async () => {
    jest.spyOn(mongodbService, 'listUsers').mockResolvedValue([{ user: 'appUser' }]);
    jest.spyOn(mongodbService, 'createUser').mockResolvedValue({ success: true });
    jest.spyOn(mongodbService, 'dropUser').mockResolvedValue({ success: true });

    const resList = mockRes();
    await mongodbController.listUsers({}, resList);
    expect(resList.statusCode).toBe(200);

    const badUser = mockRes();
    await mongodbController.createUser({ body: {} }, badUser);
    expect(badUser.statusCode).toBe(400);

    const goodUser = mockRes();
    await mongodbController.createUser({ body: { username: 'appUser', password: 'secretPassword' } }, goodUser);
    expect(goodUser.statusCode).toBe(200);

    const resDrop = mockRes();
    await mongodbController.dropUser({ params: { username: 'appUser' } }, resDrop);
    expect(resDrop.statusCode).toBe(200);
  });
});
