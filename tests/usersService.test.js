/**
 * UsersService — Unit tests for CRUD operations, password policy, API key management
 *
 * Uses native ESM + jest.unstable_mockModule pattern.
 * Database (SQLite), repositories, bcrypt, eventBus are mocked.
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach, afterAll } from '@jest/globals';

// ── Mocks ──
jest.unstable_mockModule('../src/config/logger.js', () => ({
  default: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.unstable_mockModule('../src/repositories/user.repository.js', () => ({
  default: {
    findWithRole: jest.fn(async () => []),
    findById: jest.fn(async () => null),
    findByUsername: jest.fn(async () => null),
    findByApiKey: jest.fn(async () => null),
    create: jest.fn(async (data) => ({ _id: 'user-new', ...data })),
    updateById: jest.fn(async (id, data) => ({ _id: id, ...data })),
    deleteById: jest.fn(async () => true),
    updateLoginStats: jest.fn(async () => {}),
    _populateRole: jest.fn(async (user) => user ? { ...user, role: { slug: 'super_admin', name: 'Super Admin' } } : null),
  },
}));

jest.unstable_mockModule('../src/repositories/role.repository.js', () => ({
  default: {
    findBySlug: jest.fn(async (slug) => slug ? { _id: 'role-1', slug, name: slug } : null),
    findById: jest.fn(async (id) => id ? { _id: id, slug: 'read_only', name: 'Read Only' } : null),
  },
}));

jest.unstable_mockModule('../src/repositories/session.repository.js', () => ({
  default: {
    deactivateAll: jest.fn(async () => {}),
    deactivate: jest.fn(async () => {}),
    findUserSessions: jest.fn(async () => []),
    findById: jest.fn(async () => null),
  },
}));

jest.unstable_mockModule('../src/repositories/audit.repository.js', () => ({
  default: {
    log: jest.fn(async () => {}),
  },
}));

jest.unstable_mockModule('../src/helpers/crypto.js', () => ({
  generateApiKey: jest.fn(() => 'lp_test_api_key_12345'),
}));

jest.unstable_mockModule('../src/helpers/validate.js', () => ({
  isStrongPassword: jest.fn((pw) => pw && pw.length >= 12 && /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw)),
  passwordRequirements: jest.fn(() => 'Password must be at least 12 characters with uppercase, lowercase, number, and special character.'),
}));

jest.unstable_mockModule('../src/modules/system/password-policy.service.js', () => ({
  default: {
    validatePassword: jest.fn(async (pw) => {
      if (!pw || pw.length < 12) return { valid: false, errors: ['Too short'] };
      return { valid: true, errors: [] };
    }),
    getPolicy: jest.fn(async () => ({ expiryEnabled: false, expiryDays: 90, minLength: 12 })),
  },
}));

jest.unstable_mockModule('../src/core/events/EventBus.js', () => {
  const bus = { publish: jest.fn(), subscribe: jest.fn() };
  return {
    default: bus,
    EVENTS: {
      USER_CREATED: 'user.created',
      USER_UPDATED: 'user.updated',
      USER_DELETED: 'user.deleted',
    },
  };
});

jest.unstable_mockModule('bcryptjs', () => ({
  default: {
    hash: jest.fn(async () => 'hashed-password'),
    compare: jest.fn(async (plain, hashed) => plain === 'correct-password'),
  },
}));

// Mock SQLite getDb — configurable per test
const mockDb = {
  prepare: jest.fn((sql) => ({
    get: jest.fn(() => {
      if (sql.includes('COUNT(*) as count FROM users WHERE is_super_admin')) return { count: 5 };
      if (sql.includes('COUNT(*) as count FROM users WHERE is_active')) return { count: 5 };
      if (sql.includes('COUNT(*) as count FROM users')) return { count: 5 };
      return null;
    }),
    run: jest.fn(),
    all: jest.fn(() => []),
  })),
};
jest.unstable_mockModule('../src/core/db/sqlite.js', () => ({
  getDb: jest.fn(() => mockDb),
}));

// ── Dynamic imports ──
const { default: usersService } = await import('../src/modules/users/users.service.js');
const userRepository = (await import('../src/repositories/user.repository.js')).default;
const roleRepository = (await import('../src/repositories/role.repository.js')).default;
const sessionRepository = (await import('../src/repositories/session.repository.js')).default;
const auditRepository = (await import('../src/repositories/audit.repository.js')).default;
const { generateApiKey } = await import('../src/helpers/crypto.js');
const { isStrongPassword } = await import('../src/helpers/validate.js');
const bcrypt = (await import('bcryptjs')).default;
const { EVENTS } = await import('../src/core/events/EventBus.js');
const eventBus = (await import('../src/core/events/EventBus.js')).default;

beforeEach(() => {
  jest.clearAllMocks();
  // Reset the mock DB to default behavior (return count:5 for COUNT queries)
  mockDb.prepare.mockImplementation((sql) => ({
    get: jest.fn(() => {
      if (sql.includes('COUNT(*) as count FROM users WHERE is_super_admin')) return { count: 5 };
      if (sql.includes('COUNT(*) as count FROM users WHERE is_active')) return { count: 5 };
      if (sql.includes('COUNT(*) as count FROM users')) return { count: 5 };
      return null;
    }),
    run: jest.fn(),
    all: jest.fn(() => []),
  }));
});

// ═══════════════════════════════════════════════════════════
//  LIST USERS
// ═══════════════════════════════════════════════════════════

describe('UsersService — List', () => {
  test('list returns paginated users', async () => {
    userRepository.findWithRole.mockResolvedValue([
      { _id: 'u1', username: 'admin', email: 'admin@test.com', isSuperAdmin: true },
      { _id: 'u2', username: 'user1', email: 'user1@test.com', isSuperAdmin: false },
    ]);

    const result = await usersService.list(1, 10);
    expect(result.data).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.page).toBe(1);
  });

  test('list filters by search term', async () => {
    userRepository.findWithRole.mockResolvedValue([
      { _id: 'u1', username: 'admin', email: 'admin@test.com', isSuperAdmin: true },
      { _id: 'u2', username: 'user1', email: 'user1@test.com', isSuperAdmin: false },
    ]);

    const result = await usersService.list(1, 10, 'admin');
    expect(result.data).toHaveLength(1);
    expect(result.data[0].username).toBe('admin');
  });

  test('list prioritizes super admin first', async () => {
    userRepository.findWithRole.mockResolvedValue([
      { _id: 'u2', username: 'user1', isSuperAdmin: false, createdAt: '2026-09-01' },
      { _id: 'u1', username: 'admin', isSuperAdmin: true, createdAt: '2026-08-01' },
    ]);

    const result = await usersService.list(1, 10);
    expect(result.data[0].isSuperAdmin).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
//  CREATE USER
// ═══════════════════════════════════════════════════════════

describe('UsersService — Create', () => {
  test('create creates a new user with valid data', async () => {
    // Mock DB to return null (no existing user)
    mockDb.prepare.mockReturnValue({
      get: jest.fn(() => null),
      run: jest.fn(),
      all: jest.fn(() => []),
    });
    userRepository.findById.mockResolvedValue(null);
    userRepository.create.mockImplementation(async (data) => ({ _id: 'new-user', ...data }));
    roleRepository.findBySlug.mockResolvedValue({ _id: 'role-1', slug: 'operator' });

    const result = await usersService.create({
      username: 'newuser',
      email: 'new@test.com',
      password: 'StrongP@ss1234',
      role: 'operator',
    });

    expect(result._id).toBe('new-user');
    expect(userRepository.create).toHaveBeenCalled();
    expect(eventBus.publish).toHaveBeenCalledWith(EVENTS.USER_CREATED, expect.any(Object));
  });

  test('create rejects duplicate username', async () => {
    // The service checks via SQLite directly
    const { getDb } = await import('../src/core/db/sqlite.js');
    getDb.mockReturnValue({
      prepare: jest.fn(() => ({
        get: jest.fn(() => ({ id: 'existing' })), // Simulate existing user
      })),
    });

    await expect(usersService.create({
      username: 'existing',
      email: 'new@test.com',
      password: 'StrongP@ss1234',
    })).rejects.toThrow(/already exists/);
  });

  test('create enforces password policy', async () => {
    const { getDb } = await import('../src/core/db/sqlite.js');
    getDb.mockReturnValue({
      prepare: jest.fn(() => ({
        get: jest.fn(() => null), // No existing user
      })),
    });

    await expect(usersService.create({
      username: 'newuser',
      email: 'new@test.com',
      password: 'weak',
    })).rejects.toThrow();
  });

  test('create rejects invalid role', async () => {
    const { getDb } = await import('../src/core/db/sqlite.js');
    getDb.mockReturnValue({
      prepare: jest.fn(() => ({
        get: jest.fn(() => null),
      })),
    });
    roleRepository.findBySlug.mockResolvedValue(null);
    roleRepository.findById.mockResolvedValue(null);

    await expect(usersService.create({
      username: 'newuser',
      email: 'new@test.com',
      password: 'StrongP@ss1234',
      role: 'nonexistent',
    })).rejects.toThrow(/Role not found/);
  });
});

// ═══════════════════════════════════════════════════════════
//  UPDATE USER
// ═══════════════════════════════════════════════════════════

describe('UsersService — Update', () => {
  test('update updates user data', async () => {
    userRepository.findById.mockResolvedValue({
      _id: 'u1', username: 'admin', email: 'admin@test.com', isActive: true, isSuperAdmin: true,
    });
    userRepository.updateById.mockImplementation(async (id, data) => ({ _id: id, ...data }));

    const result = await usersService.update('u1', { email: 'new@test.com' });
    expect(result).toBeDefined();
    expect(eventBus.publish).toHaveBeenCalledWith(EVENTS.USER_UPDATED, expect.any(Object));
  });

  test('update rejects if user not found', async () => {
    userRepository.findById.mockResolvedValue(null);
    await expect(usersService.update('nonexistent', { email: 'x@test.com' }))
      .rejects.toThrow(/not found/);
  });

  test('update validates new username uniqueness', async () => {
    const { getDb } = await import('../src/core/db/sqlite.js');
    getDb.mockReturnValue({
      prepare: jest.fn(() => ({
        get: jest.fn(() => ({ id: 'other-user' })), // Existing different user
      })),
    });
    userRepository.findById.mockResolvedValue({
      _id: 'u1', username: 'admin', email: 'admin@test.com', isActive: true,
    });

    await expect(usersService.update('u1', { username: 'taken' }))
      .rejects.toThrow(/already taken/);
  });

  test('update hashes password when provided', async () => {
    userRepository.findById.mockResolvedValue({
      _id: 'u1', username: 'admin', email: 'admin@test.com', isActive: true,
    });
    userRepository.updateById.mockImplementation(async (id, data) => ({ _id: id, ...data }));

    await usersService.update('u1', { password: 'NewStr0ng!Pass' });
    expect(bcrypt.hash).toHaveBeenCalled();
  });

  test('update clears mustChangePassword on password change', async () => {
    userRepository.findById.mockResolvedValue({
      _id: 'u1', username: 'admin', email: 'admin@test.com', isActive: true, mustChangePassword: true,
    });
    userRepository.updateById.mockImplementation(async (id, data) => ({ _id: id, ...data }));

    const result = await usersService.update('u1', { password: 'NewStr0ng!Pass' });
    expect(result.mustChangePassword).toBe(false);
  });

  test('update deactivates sessions when deactivating user', async () => {
    userRepository.findById.mockResolvedValue({
      _id: 'u1', username: 'admin', email: 'admin@test.com', isActive: true, isSuperAdmin: false,
    });
    userRepository.updateById.mockImplementation(async (id, data) => ({ _id: id, ...data }));

    await usersService.update('u1', { status: 'inactive' });
    expect(sessionRepository.deactivateAll).toHaveBeenCalledWith('u1');
  });

  test('update prevents deactivating last active user', async () => {
    const { getDb } = await import('../src/core/db/sqlite.js');
    getDb.mockReturnValue({
      prepare: jest.fn(() => ({
        get: jest.fn(() => ({ count: 1 })), // Only 1 active user
      })),
    });
    userRepository.findById.mockResolvedValue({
      _id: 'u1', username: 'admin', isActive: true, isSuperAdmin: false,
    });

    await expect(usersService.update('u1', { status: 'inactive' }))
      .rejects.toThrow(/Cannot deactivate/);
  });
});

// ═══════════════════════════════════════════════════════════
//  CHANGE PASSWORD
// ═══════════════════════════════════════════════════════════

describe('UsersService — Change Password', () => {
  test('changePassword succeeds with correct current password', async () => {
    const { getDb } = await import('../src/core/db/sqlite.js');
    getDb.mockReturnValue({
      prepare: jest.fn(() => ({
        get: jest.fn(() => ({ id: 'u1', username: 'admin', password: 'hashed-password' })),
        run: jest.fn(),
      })),
    });

    await usersService.changePassword('u1', 'correct-password', 'NewStr0ng!Pass');
    expect(bcrypt.compare).toHaveBeenCalledWith('correct-password', 'hashed-password');
    expect(bcrypt.hash).toHaveBeenCalled();
    expect(sessionRepository.deactivateAll).toHaveBeenCalledWith('u1');
  });

  test('changePassword fails with wrong current password', async () => {
    const { getDb } = await import('../src/core/db/sqlite.js');
    getDb.mockReturnValue({
      prepare: jest.fn(() => ({
        get: jest.fn(() => ({ id: 'u1', username: 'admin', password: 'hashed-password' })),
        run: jest.fn(),
      })),
    });

    await expect(usersService.changePassword('u1', 'wrong-password', 'NewStr0ng!Pass'))
      .rejects.toThrow(/incorrect/);
    expect(auditRepository.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PASSWORD_CHANGE_FAILED', status: 'failure' })
    );
  });

  test('changePassword rejects weak new password', async () => {
    await expect(usersService.changePassword('u1', 'correct-password', 'weak'))
      .rejects.toThrow();
  });

  test('changePassword fails if user not found', async () => {
    const { getDb } = await import('../src/core/db/sqlite.js');
    getDb.mockReturnValue({
      prepare: jest.fn(() => ({
        get: jest.fn(() => null),
        run: jest.fn(),
      })),
    });

    await expect(usersService.changePassword('nonexistent', 'pw', 'NewStr0ng!Pass'))
      .rejects.toThrow(/not found/);
  });
});

// ═══════════════════════════════════════════════════════════
//  DELETE USER
// ═══════════════════════════════════════════════════════════

describe('UsersService — Delete', () => {
  test('delete removes a user', async () => {
    // Mock DB to return count > 1 (not last user)
    const { getDb } = await import('../src/core/db/sqlite.js');
    getDb.mockReturnValue({
      prepare: jest.fn(() => ({
        get: jest.fn(() => ({ count: 5 })),
        run: jest.fn(),
        all: jest.fn(() => []),
      })),
    });
    userRepository.findById.mockResolvedValue({ _id: 'u2', isSuperAdmin: false, isActive: true });

    await usersService.delete('u2', 'u1');
    expect(userRepository.deleteById).toHaveBeenCalledWith('u2');
    expect(eventBus.publish).toHaveBeenCalledWith(EVENTS.USER_DELETED, { userId: 'u2' });
  });

  test('delete prevents self-deletion', async () => {
    await expect(usersService.delete('u1', 'u1'))
      .rejects.toThrow(/Cannot delete your own/);
  });

  test('delete prevents deleting last account', async () => {
    const { getDb } = await import('../src/core/db/sqlite.js');
    getDb.mockReturnValue({
      prepare: jest.fn(() => ({
        get: jest.fn(() => ({ count: 1 })),
      })),
    });

    await expect(usersService.delete('u2', 'u1'))
      .rejects.toThrow(/Cannot delete the only account/);
  });

  test('delete prevents deleting last active super admin', async () => {
    // Mock DB: totalUsers > 1 but activeSuperAdmins <= 1
    const { getDb } = await import('../src/core/db/sqlite.js');
    let callCount = 0;
    getDb.mockReturnValue({
      prepare: jest.fn(() => ({
        get: jest.fn(() => {
          callCount++;
          if (callCount === 2) return { count: 1 }; // activeSuperAdmins = 1
          return { count: 5 }; // totalUsers > 1
        }),
        run: jest.fn(),
        all: jest.fn(() => []),
      })),
    });
    userRepository.findById.mockResolvedValue({ _id: 'u1', isSuperAdmin: true, isActive: true });

    await expect(usersService.delete('u1', 'u2'))
      .rejects.toThrow(/Cannot delete the only active super admin/);
  });
});

// ═══════════════════════════════════════════════════════════
//  TOGGLE STATUS
// ═══════════════════════════════════════════════════════════

describe('UsersService — Toggle Status', () => {
  test('toggleStatus toggles user active state', async () => {
    // Mock DB to return activeUsers > 1
    const { getDb } = await import('../src/core/db/sqlite.js');
    getDb.mockReturnValue({
      prepare: jest.fn(() => ({
        get: jest.fn(() => ({ count: 5 })),
        run: jest.fn(),
        all: jest.fn(() => []),
      })),
    });
    userRepository.findById.mockResolvedValue({ _id: 'u1', isActive: true, isSuperAdmin: false });
    userRepository.updateById.mockImplementation(async (id, data) => ({ _id: id, ...data }));

    const result = await usersService.toggleStatus('u1');
    expect(result.isActive).toBe(false);
    expect(sessionRepository.deactivateAll).toHaveBeenCalledWith('u1');
  });

  test('toggleStatus fails if user not found', async () => {
    userRepository.findById.mockResolvedValue(null);
    await expect(usersService.toggleStatus('nonexistent'))
      .rejects.toThrow(/not found/);
  });
});

// ═══════════════════════════════════════════════════════════
//  API KEY MANAGEMENT
// ═══════════════════════════════════════════════════════════

describe('UsersService — API Key Management', () => {
  test('regenerateApiKey generates and stores new key', async () => {
    userRepository.updateById.mockImplementation(async (id, data) => ({ _id: id, ...data }));

    const key = await usersService.regenerateApiKey('u1');
    expect(key).toBe('lp_test_api_key_12345');
    expect(generateApiKey).toHaveBeenCalled();
    expect(userRepository.updateById).toHaveBeenCalledWith('u1', expect.objectContaining({
      apiKey: key,
      apiKeyEnabled: true,
    }));
  });

  test('revokeApiKey disables API key', async () => {
    userRepository.updateById.mockImplementation(async (id, data) => ({ _id: id, ...data }));

    await usersService.revokeApiKey('u1');
    expect(userRepository.updateById).toHaveBeenCalledWith('u1', { apiKeyEnabled: false });
  });
});

// ═══════════════════════════════════════════════════════════
//  ACTIVE SESSIONS MANAGEMENT
// ═══════════════════════════════════════════════════════════

describe('UsersService — Active Sessions Management', () => {
  test('getUserSessions returns formatted session list', async () => {
    sessionRepository.findUserSessions.mockResolvedValue([
      {
        id: 'sess-1',
        userId: 'u1',
        deviceInfo: 'Chrome on Windows',
        userAgent: 'Mozilla/5.0',
        ip: '192.168.1.50',
        isActive: true,
        lastActive: new Date('2026-09-25T10:00:00Z'),
        createdAt: new Date('2026-09-25T08:00:00Z'),
      },
    ]);

    const sessions = await usersService.getUserSessions('u1');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].deviceInfo).toBe('Chrome on Windows');
    expect(sessions[0].ip).toBe('192.168.1.50');
  });

  test('revokeSession deactivates session when valid', async () => {
    sessionRepository.findById.mockResolvedValue({
      id: 'sess-1',
      userId: 'u1',
    });

    const result = await usersService.revokeSession('u1', 'sess-1', { id: 'u1' });
    expect(result).toBe(true);
    expect(sessionRepository.deactivate).toHaveBeenCalledWith('sess-1');
  });

  test('revokeSession rejects if session does not exist', async () => {
    sessionRepository.findById.mockResolvedValue(null);

    await expect(usersService.revokeSession('u1', 'sess-nonexistent', { id: 'u1' })).rejects.toThrow('Session not found');
  });

  test('revokeAllUserSessions deactivates all sessions', async () => {
    const result = await usersService.revokeAllUserSessions('u1');
    expect(result).toBe(true);
    expect(sessionRepository.deactivateAll).toHaveBeenCalledWith('u1');
  });
});
