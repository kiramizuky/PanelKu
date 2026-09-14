/**
 * Unit tests for MongoDB Module:
 * - src/modules/mongodb/mongodb.service.js
 * - src/modules/mongodb/mongodb.controller.js
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

let mockExecFileHandler = jest.fn();
let mockExecHandler = jest.fn();

jest.unstable_mockModule('child_process', () => ({
  execFile: jest.fn((file, ...rest) => {
    const cb = rest.pop();
    const args = Array.isArray(rest[0]) ? rest[0] : [];
    const opts = typeof rest[0] === 'object' && !Array.isArray(rest[0]) ? rest[0] : (rest[1] || {});
    mockExecFileHandler(file, args, opts, cb);
  }),
  exec: jest.fn((cmd, ...rest) => {
    const cb = rest.pop();
    const opts = typeof rest[0] === 'object' ? rest[0] : {};
    mockExecHandler(cmd, opts, cb);
  }),
}));

const mockMkdir = jest.fn().mockResolvedValue(undefined);
const mockAccess = jest.fn().mockResolvedValue(undefined);

jest.unstable_mockModule('fs/promises', () => ({
  default: {
    mkdir: mockMkdir,
    access: mockAccess,
  },
  mkdir: mockMkdir,
  access: mockAccess,
}));

const { default: mongodbService } = await import('../src/modules/mongodb/mongodb.service.js');
const { default: mongodbController } = await import('../src/modules/mongodb/mongodb.controller.js');

function createMockRes() {
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
  jest.clearAllMocks();
  // Default mock behavior for execFile
  mockExecFileHandler.mockImplementation((file, args, opts, cb) => {
    cb(null, { stdout: JSON.stringify({ ok: 1 }), stderr: '' });
  });
  // Default mock behavior for exec
  mockExecHandler.mockImplementation((cmd, opts, cb) => {
    cb(null, { stdout: 'ubuntu', stderr: '' });
  });
});

describe('MongoDBService — Validation & URI', () => {
  test('rejects invalid names', async () => {
    await expect(mongodbService.createDatabase('')).rejects.toThrow('Name is required');
    await expect(mongodbService.createDatabase('123bad')).rejects.toThrow('Name must start with a letter');
    await expect(mongodbService.createDatabase('bad-name-with-dash')).rejects.toThrow();
    await expect(mongodbService.createDatabase('a'.repeat(65))).rejects.toThrow();
  });

  test('validates user creation credentials and characters', async () => {
    await expect(mongodbService.createUser('', 'secret123')).rejects.toThrow('Invalid username');
    await expect(mongodbService.createUser('123user', 'secret123')).rejects.toThrow('Invalid username');
    await expect(mongodbService.createUser('user1', 'short')).rejects.toThrow('Password must be at least 6 characters');
    await expect(mongodbService.createUser('user1', 'pass with space')).rejects.toThrow('Password contains invalid characters');
    await expect(mongodbService.createUser('user1', "pass'quote")).rejects.toThrow('Password contains invalid characters');
  });

  test('dropUser validates username', async () => {
    await expect(mongodbService.dropUser('')).rejects.toThrow('Invalid username');
    await expect(mongodbService.dropUser('999bad')).rejects.toThrow('Invalid username');
  });
});

describe('MongoDBService — Shell & Status Execution', () => {
  test('getStatus reports uninstalled when binaries are missing', async () => {
    mockExecFileHandler.mockImplementation((file, args, opts, cb) => {
      cb(new Error('command not found'));
    });

    const status = await mongodbService.getStatus();
    expect(status.installed).toBe(false);
    expect(status.running).toBe(false);
  });

  test('getStatus reports running when mongosh succeeds', async () => {
    mockExecFileHandler.mockImplementation((file, args, opts, cb) => {
      if (args.includes('--version')) {
        cb(null, { stdout: '2.0.0', stderr: '' });
        return;
      }
      cb(null, {
        stdout: JSON.stringify({
          version: '7.0.5',
          serverStatus: { uptime: 3600, connections: { current: 5 }, ok: 1 },
        }),
        stderr: '',
      });
    });

    const status = await mongodbService.getStatus();
    expect(status.installed).toBe(true);
    expect(status.running).toBe(true);
    expect(status.version).toBe('7.0.5');
    expect(status.uptime).toBe(3600);
  });

  test('getStatus handles installed but stopped daemon', async () => {
    mockExecFileHandler.mockImplementation((file, args, opts, cb) => {
      if (args.includes('--version')) {
        cb(null, { stdout: '2.0.0', stderr: '' });
        return;
      }
      cb(new Error('Connection refused'));
    });

    const status = await mongodbService.getStatus();
    expect(status.installed).toBe(true);
    expect(status.running).toBe(false);
  });

  test('fallback to legacy mongo shell when mongosh fails', async () => {
    mockExecFileHandler.mockImplementation((file, args, opts, cb) => {
      if (file === 'mongosh') {
        cb(new Error('mongosh failed'));
        return;
      }
      if (file === 'mongo') {
        cb(null, { stdout: JSON.stringify({ legacy: true }), stderr: '' });
        return;
      }
      cb(null, { stdout: '{}', stderr: '' });
    });

    const result = await mongodbService._runMongoCommand('test');
    expect(result).toEqual({ legacy: true });
  });

  test('throws combined error when both mongosh and mongo fail', async () => {
    mockExecFileHandler.mockImplementation((file, args, opts, cb) => {
      cb(new Error('failed execution'));
    });

    await expect(mongodbService._runMongoCommand('test')).rejects.toThrow('MongoDB command failed');
  });
});

describe('MongoDBService — Server Info & Database Operations', () => {
  test('getServerInfo returns server details and database list', async () => {
    mockExecFileHandler.mockImplementation((file, args, opts, cb) => {
      if (file === 'mongosh' && args.includes('--version')) {
        cb(null, { stdout: '2.0.0', stderr: '' });
        return;
      }
      // Return list of databases or server info
      cb(null, {
        stdout: JSON.stringify({
          version: '7.0.0',
          databases: [{ name: 'test_db', sizeOnDisk: 1024, empty: false }],
        }),
        stderr: '',
      });
    });

    const info = await mongodbService.getServerInfo();
    expect(info).toHaveProperty('server');
    expect(info).toHaveProperty('databases');
  });

  test('listDatabases returns databases array', async () => {
    mockExecFileHandler.mockImplementation((file, args, opts, cb) => {
      cb(null, {
        stdout: JSON.stringify([
          { name: 'app_db', sizeOnDisk: 4096, empty: false },
        ]),
        stderr: '',
      });
    });

    const dbs = await mongodbService.listDatabases();
    expect(Array.isArray(dbs)).toBe(true);
    expect(dbs[0].name).toBe('app_db');
  });

  test('createDatabase creates db placeholder and drops it', async () => {
    mockExecFileHandler.mockImplementation((file, args, opts, cb) => {
      cb(null, { stdout: '{"ok": 1}', stderr: '' });
    });

    const res = await mongodbService.createDatabase('new_app_db');
    expect(res.message).toContain('created');
  });

  test('dropDatabase prevents dropping system databases', async () => {
    await expect(mongodbService.dropDatabase('admin')).rejects.toThrow('Cannot drop system database');
    await expect(mongodbService.dropDatabase('config')).rejects.toThrow('Cannot drop system database');
    await expect(mongodbService.dropDatabase('local')).rejects.toThrow('Cannot drop system database');
  });

  test('dropDatabase drops user database', async () => {
    mockExecFileHandler.mockImplementation((file, args, opts, cb) => {
      cb(null, { stdout: '{"dropped": "old_db", "ok": 1}', stderr: '' });
    });

    const res = await mongodbService.dropDatabase('old_db');
    expect(res.message).toContain('dropped');
  });

  test('getDatabaseStats returns db stats', async () => {
    mockExecFileHandler.mockImplementation((file, args, opts, cb) => {
      cb(null, { stdout: JSON.stringify({ db: 'app_db', collections: 5, objects: 120 }), stderr: '' });
    });

    const stats = await mongodbService.getDatabaseStats('app_db');
    expect(stats.collections).toBe(5);
  });
});

describe('MongoDBService — Collections & Documents', () => {
  test('listCollections returns collection info', async () => {
    mockExecFileHandler.mockImplementation((file, args, opts, cb) => {
      cb(null, {
        stdout: JSON.stringify([
          { name: 'users', type: 'collection', count: 42 },
        ]),
        stderr: '',
      });
    });

    const cols = await mongodbService.listCollections('app_db');
    expect(cols.length).toBe(1);
    expect(cols[0].name).toBe('users');
  });

  test('dropCollection drops specified collection', async () => {
    mockExecFileHandler.mockImplementation((file, args, opts, cb) => {
      cb(null, { stdout: 'true', stderr: '' });
    });

    const res = await mongodbService.dropCollection('app_db', 'temp_records');
    expect(res.message).toContain('dropped');
  });

  test('findDocuments limits and skips documents properly', async () => {
    mockExecFileHandler.mockImplementation((file, args, opts, cb) => {
      cb(null, {
        stdout: JSON.stringify({
          documents: [{ _id: 'doc1', name: 'alice' }],
          totalCount: 1,
        }),
        stderr: '',
      });
    });

    const result = await mongodbService.findDocuments('app_db', 'users', { role: 'admin' }, 10, 5);
    expect(result.documents.length).toBe(1);
    expect(result.totalCount).toBe(1);
    expect(result.limit).toBe(10);
    expect(result.skip).toBe(5);
  });
});

describe('MongoDBService — User Management & Queries', () => {
  test('listUsers returns formatted users', async () => {
    mockExecFileHandler.mockImplementation((file, args, opts, cb) => {
      cb(null, {
        stdout: JSON.stringify([
          { id: 'admin.appUser', user: 'appUser', db: 'admin', roles: [{ role: 'readWrite', db: 'app_db' }] },
        ]),
        stderr: '',
      });
    });

    const users = await mongodbService.listUsers();
    expect(users.length).toBe(1);
    expect(users[0].user).toBe('appUser');
  });

  test('createUser adds user with roles', async () => {
    mockExecFileHandler.mockImplementation((file, args, opts, cb) => {
      cb(null, { stdout: '{"ok": 1}', stderr: '' });
    });

    const res = await mongodbService.createUser('web_user', 'Str0ngP@ss!', [{ role: 'read', db: 'app_db' }]);
    expect(res.message).toContain('created');
  });

  test('dropUser removes user', async () => {
    mockExecFileHandler.mockImplementation((file, args, opts, cb) => {
      cb(null, { stdout: '{"ok": 1}', stderr: '' });
    });

    const res = await mongodbService.dropUser('web_user');
    expect(res.message).toContain('dropped');
  });

  test('runQuery restricts DROP DATABASE and DROP ADMIN', async () => {
    await expect(mongodbService.runQuery('app_db', 'db.dropDatabase()')).rejects.toThrow('restricted');
    await expect(mongodbService.runQuery('app_db', 'db.getSiblingDB("admin").dropDatabase()')).rejects.toThrow('restricted');
  });

  test('runQuery executes valid expressions', async () => {
    mockExecFileHandler.mockImplementation((file, args, opts, cb) => {
      cb(null, { stdout: JSON.stringify({ count: 100 }), stderr: '' });
    });

    const result = await mongodbService.runQuery('app_db', 'db.users.countDocuments()');
    expect(result).toEqual({ count: 100 });
  });
});

describe('MongoDBService — Backup & Restore & Install', () => {
  test('backupDatabase invokes mongodump', async () => {
    mockExecFileHandler.mockImplementation((file, args, opts, cb) => {
      cb(null, { stdout: 'done', stderr: '' });
    });

    const res = await mongodbService.backupDatabase('app_db');
    expect(res.message).toContain('Backup completed');
    expect(mockMkdir).toHaveBeenCalled();
  });

  test('restoreDatabase checks path and runs mongorestore', async () => {
    mockExecFileHandler.mockImplementation((file, args, opts, cb) => {
      cb(null, { stdout: 'done', stderr: '' });
    });

    const res = await mongodbService.restoreDatabase('/tmp/mongo_backup', 'app_db');
    expect(res.message).toContain('Restore completed');
    expect(mockAccess).toHaveBeenCalledWith('/tmp/mongo_backup');
  });

  test('installMongoDB checks platform and prevents install on Windows', async () => {
    if (process.platform === 'win32') {
      await expect(mongodbService.installMongoDB()).rejects.toThrow('only supported on Linux');
    }
  });
});

describe('MongoDBController — API Endpoints', () => {
  test('getStatus endpoint returns 200', async () => {
    mockExecFileHandler.mockImplementation((file, args, opts, cb) => {
      cb(null, { stdout: JSON.stringify({ version: '7.0.0', serverStatus: { uptime: 100, ok: 1 } }), stderr: '' });
    });

    const req = {};
    const res = createMockRes();
    await mongodbController.getStatus(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('createDatabase endpoint validates name', async () => {
    const reqEmpty = { body: {} };
    const resEmpty = createMockRes();
    await mongodbController.createDatabase(reqEmpty, resEmpty);
    expect(resEmpty.statusCode).toBe(400);

    const reqValid = { body: { name: 'test_db' } };
    const resValid = createMockRes();
    await mongodbController.createDatabase(reqValid, resValid);
    expect(resValid.statusCode).toBe(200);
  });

  test('dropDatabase endpoint validates name', async () => {
    const reqEmpty = { params: {} };
    const resEmpty = createMockRes();
    await mongodbController.dropDatabase(reqEmpty, resEmpty);
    expect(resEmpty.statusCode).toBe(400);

    const reqValid = { params: { name: 'test_db' } };
    const resValid = createMockRes();
    await mongodbController.dropDatabase(reqValid, resValid);
    expect(resValid.statusCode).toBe(200);
  });

  test('findDocuments endpoint handles valid/invalid filter query', async () => {
    const req = {
      params: { db: 'app_db', collection: 'users' },
      query: { filter: '{"active":true}', limit: '20', skip: '0' },
    };
    const res = createMockRes();
    await mongodbController.findDocuments(req, res);
    expect(res.statusCode).toBe(200);
  });

  test('createUser endpoint validates missing username or password', async () => {
    const reqNoUser = { body: { password: 'secretpassword' } };
    const resNoUser = createMockRes();
    await mongodbController.createUser(reqNoUser, resNoUser);
    expect(resNoUser.statusCode).toBe(400);

    const reqNoPass = { body: { username: 'testuser' } };
    const resNoPass = createMockRes();
    await mongodbController.createUser(reqNoPass, resNoPass);
    expect(resNoPass.statusCode).toBe(400);
  });

  test('runQuery endpoint validates database and query', async () => {
    const reqNoDb = { body: { query: 'db.stats()' } };
    const resNoDb = createMockRes();
    await mongodbController.runQuery(reqNoDb, resNoDb);
    expect(resNoDb.statusCode).toBe(400);

    const reqNoQ = { body: { database: 'app_db' } };
    const resNoQ = createMockRes();
    await mongodbController.runQuery(reqNoQ, resNoQ);
    expect(resNoQ.statusCode).toBe(400);
  });

  test('restore endpoint requires path', async () => {
    const req = { body: {} };
    const res = createMockRes();
    await mongodbController.restore(req, res);
    expect(res.statusCode).toBe(400);
  });
});
