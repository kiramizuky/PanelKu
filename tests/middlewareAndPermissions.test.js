/**
 * Unit Tests for Middlewares & RBAC Permissions:
 * - src/core/permissions/PermissionManager.js
 * - src/middleware/rbac.js
 * - src/middleware/errorHandler.js
 * - src/middleware/auth.js
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import jwt from 'jsonwebtoken';

const mockUserRepository = {
  findById: jest.fn(),
  findByApiKey: jest.fn(),
};

const mockRoleRepository = {
  findWithPermissions: jest.fn(),
};

jest.unstable_mockModule('../src/repositories/user.repository.js', () => ({
  default: mockUserRepository,
}));

jest.unstable_mockModule('../src/repositories/role.repository.js', () => ({
  default: mockRoleRepository,
}));

const { default: permissionManager } = await import('../src/core/permissions/PermissionManager.js');
const { rbac, hasPermission, requirePermission } = await import('../src/middleware/rbac.js');
const { errorHandler, notFoundHandler, AppError } = await import('../src/middleware/errorHandler.js');
const { authenticate, optionalAuth } = await import('../src/middleware/auth.js');
const { default: appConfig } = await import('../src/config/app.js');

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
  permissionManager.invalidateAll();
  jest.clearAllMocks();
});

describe('PermissionManager — Core RBAC', () => {
  test('loads role permissions, checks wildcard and specific actions', () => {
    permissionManager.loadRole('role1', [
      { resource: 'websites', actions: ['read', 'create'] },
      { resource: 'terminal', actions: ['*'] },
    ]);

    expect(permissionManager.can('role1', 'websites', 'read')).toBe(true);
    expect(permissionManager.can('role1', 'websites', 'create')).toBe(true);
    expect(permissionManager.can('role1', 'websites', 'delete')).toBe(false);
    expect(permissionManager.can('role1', 'terminal', 'execute')).toBe(true);
    expect(permissionManager.can('role1', 'unknown', 'read')).toBe(false);
    expect(permissionManager.can('unloaded_role', 'websites', 'read')).toBe(false);

    expect(permissionManager.getPermissions('role1')).toHaveLength(3);
  });

  test('userCan handles super_admin bypass and regular role resolution', () => {
    expect(permissionManager.userCan(null, 'websites', 'read')).toBe(false);
    expect(permissionManager.userCan({ username: 'guest' }, 'websites', 'read')).toBe(false);

    const superAdmin = { username: 'root', role: { slug: 'super_admin' } };
    expect(permissionManager.userCan(superAdmin, 'websites', 'delete')).toBe(true);

    permissionManager.grant('role_op', 'docker', 'restart');
    const operator = { username: 'op', role: { _id: 'role_op', slug: 'operator' } };
    expect(permissionManager.userCan(operator, 'docker', 'restart')).toBe(true);
    expect(permissionManager.userCan(operator, 'docker', 'remove')).toBe(false);
  });

  test('grant, revoke, invalidate, and invalidateAll', () => {
    permissionManager.grant('role2', 'dns', 'update');
    expect(permissionManager.can('role2', 'dns', 'update')).toBe(true);

    permissionManager.revoke('role2', 'dns', 'update');
    expect(permissionManager.can('role2', 'dns', 'update')).toBe(false);

    permissionManager.grant('role2', 'dns', 'read');
    permissionManager.invalidate('role2');
    expect(permissionManager.getPermissions('role2')).toEqual([]);

    permissionManager.grant('role3', 'caddy', 'reload');
    permissionManager.invalidateAll();
    expect(permissionManager.getPermissions('role3')).toEqual([]);
  });
});

describe('RBAC Middleware & Helpers', () => {
  test('blocks unauthenticated requests or users without role', async () => {
    const middleware = rbac('database', 'create');

    const res1 = mockRes();
    const next1 = jest.fn();
    await middleware({}, res1, next1);
    expect(res1.statusCode).toBe(403);
    expect(next1).not.toHaveBeenCalled();

    const res2 = mockRes();
    const next2 = jest.fn();
    await middleware({ user: { username: 'norole' } }, res2, next2);
    expect(res2.statusCode).toBe(403);
    expect(next2).not.toHaveBeenCalled();
  });

  test('bypasses super_admin user', async () => {
    const middleware = rbac('system', 'reboot');
    const req = { user: { username: 'admin', role: { slug: 'super_admin' } } };
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('loads role permissions on-demand and allows or denies based on policy', async () => {
    const middleware = rbac('websites', 'create');
    mockRoleRepository.findWithPermissions.mockResolvedValue({
      id: 'r_web',
      permissions: [{ resource: 'websites', actions: ['create', 'read'] }],
    });

    const reqAllowed = {
      user: {
        username: 'dev',
        role: { _id: 'r_web', slug: 'developer' },
      },
    };
    const nextAllowed = jest.fn();
    await middleware(reqAllowed, mockRes(), nextAllowed);
    expect(nextAllowed).toHaveBeenCalled();

    // Check denied request
    const middlewareDenied = rbac('websites', 'delete');
    const resDenied = mockRes();
    const nextDenied = jest.fn();
    await middlewareDenied(reqAllowed, resDenied, nextDenied);
    expect(resDenied.statusCode).toBe(403);
    expect(nextDenied).not.toHaveBeenCalled();
  });

  test('hasPermission non-blocking helper and requirePermission split syntax', async () => {
    expect(await hasPermission(null, 'websites', 'read')).toBe(false);
    expect(await hasPermission({ role: { slug: 'super_admin' } }, 'any', 'action')).toBe(true);

    permissionManager.grant('r_test', 'cron', 'run');
    expect(await hasPermission({ role: { _id: 'r_test', slug: 'tester' } }, 'cron', 'run')).toBe(true);

    const mw = requirePermission('terminal:execute');
    expect(typeof mw).toBe('function');
  });
});

describe('ErrorHandler Middleware', () => {
  test('handles ValidationError with 422', () => {
    const err = new Error('Invalid schema');
    err.name = 'ValidationError';
    err.errors = { email: { path: 'email', message: 'Email is required' } };

    const res = mockRes();
    errorHandler(err, { path: '/api/users', method: 'POST' }, res, jest.fn());
    expect(res.statusCode).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].field).toBe('email');
  });

  test('handles SQLite constraint errors with 409', () => {
    const err = new Error('UNIQUE constraint failed: users.username');
    err.code = 'SQLITE_CONSTRAINT_UNIQUE';

    const res = mockRes();
    errorHandler(err, { path: '/api/users', method: 'POST' }, res, jest.fn());
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toContain('UNIQUE constraint failed');
  });

  test('handles JsonWebTokenError with 401', () => {
    const err = new Error('invalid signature');
    err.name = 'JsonWebTokenError';

    const res = mockRes();
    errorHandler(err, { path: '/api/dashboard', method: 'GET' }, res, jest.fn());
    expect(res.statusCode).toBe(401);
    expect(res.body.message).toBe('Invalid token');
  });

  test('handles LIMIT_FILE_SIZE with 400', () => {
    const err = new Error('File too large');
    err.code = 'LIMIT_FILE_SIZE';

    const res = mockRes();
    errorHandler(err, { path: '/api/upload', method: 'POST' }, res, jest.fn());
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe('File too large');
  });

  test('AppError sets custom statusCode', () => {
    const appErr = new AppError('Resource not found', 404);
    expect(appErr.statusCode).toBe(404);

    const res = mockRes();
    errorHandler(appErr, { path: '/api/data', method: 'GET' }, res, jest.fn());
    expect(res.statusCode).toBe(404);
    expect(res.body.message).toBe('Resource not found');
  });

  test('notFoundHandler returns 404', () => {
    const res = mockRes();
    notFoundHandler({ path: '/non-existent-route', method: 'GET' }, res);
    expect(res.statusCode).toBe(404);
    expect(res.body.message).toContain('Route not found');
  });
});

describe('Auth Middleware', () => {
  test('authenticate rejects requests with no token', async () => {
    const res = mockRes();
    await authenticate({ headers: {} }, res, jest.fn());
    expect(res.statusCode).toBe(401);
    expect(res.body.message).toBe('No authentication token provided');
  });

  test('authenticate rejects expired or invalid JWT tokens', async () => {
    const expiredToken = jwt.sign({ sub: 'user1' }, appConfig.jwt.secret, { expiresIn: '-10s' });
    const resExpired = mockRes();
    await authenticate({ headers: { authorization: `Bearer ${expiredToken}` } }, resExpired, jest.fn());
    expect(resExpired.statusCode).toBe(401);
    expect(resExpired.body.message).toBe('Token expired');

    const resInvalid = mockRes();
    await authenticate({ headers: { authorization: 'Bearer invalid_signature_token' } }, resInvalid, jest.fn());
    expect(resInvalid.statusCode).toBe(401);
    expect(resInvalid.body.message).toBe('Invalid token');
  });

  test('authenticate rejects inactive or non-existent user', async () => {
    const validToken = jwt.sign({ sub: 'user_404' }, appConfig.jwt.secret, { expiresIn: '1h' });
    mockUserRepository.findById.mockResolvedValue(null);

    const res = mockRes();
    await authenticate({ headers: { authorization: `Bearer ${validToken}` } }, res, jest.fn());
    expect(res.statusCode).toBe(401);
    expect(res.body.message).toBe('User not found or inactive');
  });

  test('authenticate attaches user and payload for valid JWT', async () => {
    const validToken = jwt.sign({ sub: 'user_ok' }, appConfig.jwt.secret, { expiresIn: '1h' });
    mockUserRepository.findById.mockResolvedValue({ id: 'user_ok', username: 'john', isActive: true, role: { slug: 'admin' } });

    const req = { headers: { authorization: `Bearer ${validToken}` } };
    const next = jest.fn();
    await authenticate(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
    expect(req.user.username).toBe('john');
    expect(req.tokenPayload.sub).toBe('user_ok');
  });

  test('authenticate supports X-API-Key header authentication', async () => {
    mockUserRepository.findByApiKey.mockResolvedValue({ id: 'api_user', username: 'ci_bot', isActive: true });

    const req = { headers: { 'x-api-key': 'valid_secret_key' } };
    const next = jest.fn();
    await authenticate(req, mockRes(), next);
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(next).toHaveBeenCalled();
    expect(req.user.username).toBe('ci_bot');
    expect(req.isApiKey).toBe(true);

    mockUserRepository.findByApiKey.mockResolvedValue(null);
    const reqBad = { headers: { 'x-api-key': 'invalid_key' } };
    const resBad = mockRes();
    await authenticate(reqBad, resBad, jest.fn());
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(resBad.statusCode).toBe(401);
  });

  test('optionalAuth attaches user if valid token present, otherwise continues without blocking', async () => {
    const reqNoAuth = { headers: {} };
    const nextNoAuth = jest.fn();
    await optionalAuth(reqNoAuth, mockRes(), nextNoAuth);
    expect(nextNoAuth).toHaveBeenCalled();
    expect(reqNoAuth.user).toBeUndefined();

    const validToken = jwt.sign({ sub: 'opt_user' }, appConfig.jwt.secret, { expiresIn: '1h' });
    mockUserRepository.findById.mockResolvedValue({ id: 'opt_user', username: 'alice', isActive: true });
    const reqAuth = { headers: { authorization: `Bearer ${validToken}` } };
    const nextAuth = jest.fn();
    await optionalAuth(reqAuth, mockRes(), nextAuth);
    expect(nextAuth).toHaveBeenCalled();
    expect(reqAuth.user.username).toBe('alice');
  });
});
