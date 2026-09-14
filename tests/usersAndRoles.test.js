/**
 * Unit tests for Users & Roles Modules:
 * - src/modules/roles/roles.service.js
 * - src/modules/roles/roles.controller.js
 * - src/modules/users/users.service.js
 * - src/modules/users/users.controller.js
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

const mockDb = {
  prepare: jest.fn(),
};

const mockUserRepo = {
  findWithRole: jest.fn(),
  findById: jest.fn(),
  findByUsername: jest.fn(),
  findByEmail: jest.fn(),
  create: jest.fn(),
  updateById: jest.fn(),
  deleteById: jest.fn(),
  removeSession: jest.fn(),
  deactivateAllSessions: jest.fn(),
};

const mockRoleRepo = {
  findActive: jest.fn(),
  findById: jest.fn(),
  findBySlug: jest.fn(),
  create: jest.fn(),
  updateById: jest.fn(),
  deleteById: jest.fn(),
};

const mockAuditRepo = {
  log: jest.fn(),
};

const mockPermissionManager = {
  invalidate: jest.fn(),
  loadRole: jest.fn(),
};

jest.unstable_mockModule('../src/core/db/sqlite.js', () => ({
  getDb: () => mockDb,
  now: () => '2026-09-14 12:00:00',
  generateId: () => 'mock-gen-id',
}));

jest.unstable_mockModule('../src/repositories/user.repository.js', () => ({
  default: mockUserRepo,
}));

jest.unstable_mockModule('../src/repositories/role.repository.js', () => ({
  default: mockRoleRepo,
}));

jest.unstable_mockModule('../src/repositories/audit.repository.js', () => ({
  default: mockAuditRepo,
}));

jest.unstable_mockModule('../src/core/permissions/PermissionManager.js', () => ({
  default: mockPermissionManager,
}));

const { default: rolesService } = await import('../src/modules/roles/roles.service.js');
const { default: rolesController } = await import('../src/modules/roles/roles.controller.js');
const { default: usersService } = await import('../src/modules/users/users.service.js');
const { default: usersController } = await import('../src/modules/users/users.controller.js');

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
});

describe('RolesService', () => {
  test('list returns active roles', async () => {
    mockRoleRepo.findActive.mockResolvedValue([{ id: 'r1', name: 'Admin' }]);
    const roles = await rolesService.list();
    expect(roles).toHaveLength(1);
    expect(mockRoleRepo.findActive).toHaveBeenCalled();
  });

  test('getById throws 404 for missing role', async () => {
    mockRoleRepo.findById.mockResolvedValue(null);
    await expect(rolesService.getById('nonexistent')).rejects.toThrow('Role not found');
  });

  test('create throws 409 if role slug already exists', async () => {
    mockRoleRepo.findBySlug.mockResolvedValue({ id: 'r1', slug: 'editor' });
    await expect(rolesService.create({ name: 'Editor' })).rejects.toThrow('Role already exists');
  });

  test('create generates slug and saves role', async () => {
    mockRoleRepo.findBySlug.mockResolvedValue(null);
    mockRoleRepo.create.mockResolvedValue({ id: 'r2', name: 'Support Agent', slug: 'support_agent' });

    const created = await rolesService.create({ name: 'Support Agent' });
    expect(created.slug).toBe('support_agent');
    expect(mockRoleRepo.create).toHaveBeenCalledWith(expect.objectContaining({ slug: 'support_agent' }));
  });

  test('update blocks changing slug of system role', async () => {
    mockRoleRepo.findById.mockResolvedValue({ id: 'r_sys', isSystem: true });
    await expect(rolesService.update('r_sys', { slug: 'new-slug' })).rejects.toThrow(
      'Cannot change system role slug'
    );
  });

  test('delete blocks deleting system role', async () => {
    mockRoleRepo.findById.mockResolvedValue({ id: 'r_sys', isSystem: true });
    await expect(rolesService.delete('r_sys')).rejects.toThrow('Cannot delete system role');
  });

  test('delete removes non-system role and invalidates cache', async () => {
    mockRoleRepo.findById.mockResolvedValue({ id: 'r_custom', isSystem: false });
    mockRoleRepo.deleteById.mockResolvedValue(true);

    await rolesService.delete('r_custom');
    expect(mockRoleRepo.deleteById).toHaveBeenCalledWith('r_custom');
    expect(mockPermissionManager.invalidate).toHaveBeenCalledWith('r_custom');
  });

  test('getAvailableResources returns mapped system resources', () => {
    const resources = rolesService.getAvailableResources();
    expect(Array.isArray(resources)).toBe(true);
    expect(resources.length).toBeGreaterThan(0);
    expect(resources[0]).toHaveProperty('key');
    expect(resources[0]).toHaveProperty('resource');
  });
});

describe('RolesController', () => {
  test('list returns 200 with roles list', async () => {
    mockRoleRepo.findActive.mockResolvedValue([{ id: 'r1', name: 'Admin' }]);
    const req = {};
    const res = createMockRes();

    await rolesController.list(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.roles).toHaveLength(1);
  });

  test('getAvailableResources returns resource list', async () => {
    const req = {};
    const res = createMockRes();

    await rolesController.getAvailableResources(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.resources).toBeDefined();
  });
});

describe('UsersService', () => {
  test('list filters users by search keyword and applies pagination', async () => {
    mockUserRepo.findWithRole.mockResolvedValue([
      { id: '1', username: 'alice', email: 'alice@example.com', createdAt: '2026-01-01' },
      { id: '2', username: 'bob', email: 'bob@example.com', createdAt: '2026-01-02' },
      { id: '3', username: 'charlie', email: 'charlie@other.com', createdAt: '2026-01-03' },
    ]);

    const result = await usersService.list(1, 10, 'alice');
    expect(result.data).toHaveLength(1);
    expect(result.data[0].username).toBe('alice');
    expect(result.total).toBe(1);
  });

  test('getById throws 404 when user not in database', async () => {
    mockDb.prepare.mockReturnValue({ get: jest.fn().mockReturnValue(null) });
    await expect(usersService.getById('nonexistent')).rejects.toThrow('User not found');
  });

  test('toggleStatus prevents disabling the only active super admin account', async () => {
    mockUserRepo.findById.mockResolvedValue({ id: 'u_super', isSuperAdmin: true, isActive: true });
    mockDb.prepare
      .mockReturnValueOnce({ get: jest.fn().mockReturnValue({ count: 5 }) })
      .mockReturnValueOnce({ get: jest.fn().mockReturnValue({ count: 1 }) });

    await expect(usersService.toggleStatus('u_super')).rejects.toThrow(
      'Cannot deactivate the only active super admin account'
    );
  });

  test('toggleStatus inverts isActive for standard user', async () => {
    mockUserRepo.findById.mockResolvedValue({ id: 'u_std', isSuperAdmin: false, isActive: true });
    mockDb.prepare.mockReturnValue({
      get: jest.fn().mockReturnValue({ count: 5 }),
    });
    mockUserRepo.updateById.mockResolvedValue({ id: 'u_std', isActive: false });

    const toggled = await usersService.toggleStatus('u_std');
    expect(mockUserRepo.updateById).toHaveBeenCalledWith('u_std', { isActive: false });
    expect(toggled.isActive).toBe(false);
  });

  test('regenerateApiKey and revokeApiKey update database and return key', async () => {
    mockUserRepo.updateById.mockResolvedValue({ id: 'u1' });

    const apiKey = await usersService.regenerateApiKey('u1');
    expect(apiKey).toBeDefined();
    expect(mockUserRepo.updateById).toHaveBeenCalledWith('u1', expect.objectContaining({ apiKeyEnabled: true }));

    await usersService.revokeApiKey('u1');
    expect(mockUserRepo.updateById).toHaveBeenCalledWith('u1', { apiKeyEnabled: false });
  });
});

describe('UsersController', () => {
  test('list returns paginated users', async () => {
    mockUserRepo.findWithRole.mockResolvedValue([{ id: '1', username: 'user1' }]);
    const req = { query: { page: 1, limit: 10 } };
    const res = createMockRes();

    await usersController.list(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
  });

  test('toggleStatus returns 200 with toggled user', async () => {
    mockUserRepo.findById.mockResolvedValue({ id: 'u_std', isSuperAdmin: false, isActive: true });
    mockDb.prepare.mockReturnValue({
      get: jest.fn().mockReturnValue({ count: 5 }),
    });
    mockUserRepo.updateById.mockResolvedValue({ id: 'u_std', isActive: false });

    const req = { params: { id: 'u_std' } };
    const res = createMockRes();

    await usersController.toggleStatus(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('regenerateApiKey returns 200 with new apiKey', async () => {
    mockUserRepo.updateById.mockResolvedValue({ id: 'u1' });

    const req = { user: { _id: 'u1' } };
    const res = createMockRes();

    await usersController.regenerateApiKey(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.apiKey).toBeDefined();
  });
});
