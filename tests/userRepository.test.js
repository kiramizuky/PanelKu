/**
 * Unit tests for domain repositories:
 * - src/repositories/user.repository.js
 * - src/repositories/role.repository.js
 * - src/repositories/session.repository.js
 * - src/repositories/audit.repository.js
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

const mockDb = {
  prepare: jest.fn(),
};

const mockUser = {
  findOne: jest.fn(),
  find: jest.fn(),
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  create: jest.fn(),
};

const mockRole = {
  findOne: jest.fn(),
  find: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
};

const mockSession = {
  findOne: jest.fn(),
  find: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  updateMany: jest.fn(),
  deleteMany: jest.fn(),
  create: jest.fn(),
};

const mockAuditLog = {
  find: jest.fn(),
  findWithUser: jest.fn(),
  create: jest.fn(),
};

jest.unstable_mockModule('../src/core/db/sqlite.js', () => ({
  getDb: () => mockDb,
  now: () => '2026-09-14 12:00:00',
}));

jest.unstable_mockModule('../src/models/User.js', () => ({
  default: mockUser,
}));

jest.unstable_mockModule('../src/models/Role.js', () => ({
  default: mockRole,
}));

jest.unstable_mockModule('../src/models/Session.js', () => ({
  default: mockSession,
}));

jest.unstable_mockModule('../src/models/AuditLog.js', () => ({
  default: mockAuditLog,
}));

const { default: userRepository } = await import('../src/repositories/user.repository.js');
const { default: roleRepository } = await import('../src/repositories/role.repository.js');
const { default: sessionRepository } = await import('../src/repositories/session.repository.js');
const { default: auditRepository } = await import('../src/repositories/audit.repository.js');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('UserRepository', () => {
  test('findByUsername populates role if role ID string is present', async () => {
    const userDoc = { id: 'u1', username: 'admin', role: 'r1' };
    mockUser.findOne.mockResolvedValue(userDoc);

    const mockGetRole = jest.fn().mockReturnValue({
      id: 'r1',
      name: 'Superadmin',
      slug: 'superadmin',
      permissions: JSON.stringify(['users:read', 'users:write']),
      color: '#ff0000',
      is_system: 1,
      is_active: 1,
    });
    mockDb.prepare.mockReturnValue({ get: mockGetRole });

    const result = await userRepository.findByUsername('Admin');
    expect(mockUser.findOne).toHaveBeenCalledWith({ username: 'admin' });
    expect(result.role.slug).toBe('superadmin');
    expect(result.role.permissions).toContain('users:read');
    expect(result.role.isSystem).toBe(true);
  });

  test('findByUsername returns null when user is not found', async () => {
    mockUser.findOne.mockResolvedValue(null);
    const result = await userRepository.findByUsername('unknown');
    expect(result).toBeNull();
  });

  test('findByEmail finds user by lowercase email', async () => {
    const userDoc = { id: 'u2', email: 'test@example.com', role: null };
    mockUser.findOne.mockResolvedValue(userDoc);

    const result = await userRepository.findByEmail('Test@Example.COM');
    expect(mockUser.findOne).toHaveBeenCalledWith({ email: 'test@example.com' });
    expect(result.id).toBe('u2');
  });

  test('findByEmail returns null when not found', async () => {
    mockUser.findOne.mockResolvedValue(null);
    const result = await userRepository.findByEmail('notfound@example.com');
    expect(result).toBeNull();
  });

  test('findByApiKey retrieves active user via sqlite api_key lookup', async () => {
    const mockGetApiKey = jest.fn().mockReturnValue({ id: 'u3' });
    mockDb.prepare.mockReturnValue({ get: mockGetApiKey });
    mockUser.findById.mockResolvedValue({ id: 'u3', username: 'apiuser', role: null });

    const result = await userRepository.findByApiKey('secret_key_123');
    expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('api_key = ?'));
    expect(mockGetApiKey).toHaveBeenCalledWith('secret_key_123');
    expect(mockUser.findById).toHaveBeenCalledWith('u3');
    expect(result.username).toBe('apiuser');
  });

  test('findByApiKey returns null when no matching active user', async () => {
    mockDb.prepare.mockReturnValue({ get: jest.fn().mockReturnValue(null) });
    const result = await userRepository.findByApiKey('invalid_key');
    expect(result).toBeNull();
  });

  test('findWithRole fetches users and maps roles', async () => {
    mockUser.find.mockResolvedValue([
      { id: 'u1', username: 'user1', role: 'r1' },
      { id: 'u2', username: 'user2', role: { id: 'r2', name: 'Existing' } },
    ]);
    mockDb.prepare.mockReturnValue({
      get: jest.fn().mockReturnValue({
        id: 'r1',
        name: 'Role 1',
        slug: 'role-1',
        permissions: '["read"]',
      }),
    });

    const results = await userRepository.findWithRole({ is_active: 1 });
    expect(mockUser.find).toHaveBeenCalledWith({ is_active: 1 });
    expect(results).toHaveLength(2);
    expect(results[0].role.slug).toBe('role-1');
  });

  test('addSession appends session and updates database', async () => {
    const existingSessions = [{ id: 's1', userAgent: 'Chrome' }];
    const mockGet = jest.fn().mockReturnValue({ sessions: JSON.stringify(existingSessions) });
    const mockRun = jest.fn();
    mockDb.prepare.mockReturnValueOnce({ get: mockGet }).mockReturnValueOnce({ run: mockRun });
    mockUser.findById.mockResolvedValue({ id: 'u1', username: 'admin' });

    const newSession = { id: 's2', userAgent: 'Firefox' };
    const res = await userRepository.addSession('u1', newSession);

    expect(mockRun).toHaveBeenCalled();
    expect(mockUser.findById).toHaveBeenCalledWith('u1');
    expect(res.id).toBe('u1');
  });

  test('removeSession filters out target session id', async () => {
    const existingSessions = [{ id: 's1', userAgent: 'Chrome' }, { id: 's2', userAgent: 'Firefox' }];
    const mockGet = jest.fn().mockReturnValue({ sessions: JSON.stringify(existingSessions) });
    const mockRun = jest.fn();
    mockDb.prepare.mockReturnValueOnce({ get: mockGet }).mockReturnValueOnce({ run: mockRun });
    mockUser.findById.mockResolvedValue({ id: 'u1', username: 'admin' });

    await userRepository.removeSession('u1', 's1');
    expect(mockRun).toHaveBeenCalledWith(
      JSON.stringify([{ id: 's2', userAgent: 'Firefox' }]),
      '2026-09-14 12:00:00',
      'u1'
    );
  });

  test('deactivateAllSessions sets isActive to false for all user sessions', async () => {
    const existingSessions = [{ id: 's1', isActive: true }, { id: 's2', isActive: true }];
    const mockGet = jest.fn().mockReturnValue({ sessions: JSON.stringify(existingSessions) });
    const mockRun = jest.fn();
    mockDb.prepare.mockReturnValueOnce({ get: mockGet }).mockReturnValueOnce({ run: mockRun });
    mockUser.findById.mockResolvedValue({ id: 'u1' });

    await userRepository.deactivateAllSessions('u1');
    expect(mockRun).toHaveBeenCalledWith(
      JSON.stringify([{ id: 's1', isActive: false }, { id: 's2', isActive: false }]),
      '2026-09-14 12:00:00',
      'u1'
    );
  });

  test('updateLoginStats updates login timestamps and increments count', async () => {
    mockUser.findByIdAndUpdate.mockResolvedValue({ id: 'u1', loginCount: 5 });
    const res = await userRepository.updateLoginStats('u1', '192.168.1.50');
    expect(mockUser.findByIdAndUpdate).toHaveBeenCalledWith('u1', {
      $set: { lastLogin: expect.any(Date), lastLoginIp: '192.168.1.50' },
      $inc: { loginCount: 1 },
    });
    expect(res.loginCount).toBe(5);
  });
});

describe('RoleRepository', () => {
  test('findBySlug searches with lowercase slug', async () => {
    mockRole.findOne.mockResolvedValue({ id: 'r1', slug: 'admin' });
    const role = await roleRepository.findBySlug('ADMIN');
    expect(mockRole.findOne).toHaveBeenCalledWith({ slug: 'admin' });
    expect(role.id).toBe('r1');
  });

  test('findActive fetches roles with isActive = true', async () => {
    mockRole.find.mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]);
    const active = await roleRepository.findActive();
    expect(mockRole.find).toHaveBeenCalledWith({ isActive: true });
    expect(active).toHaveLength(2);
  });

  test('findWithPermissions fetches role by id', async () => {
    mockRole.findById.mockResolvedValue({ id: 'r1', name: 'Editor' });
    const role = await roleRepository.findWithPermissions('r1');
    expect(mockRole.findById).toHaveBeenCalledWith('r1');
    expect(role.name).toBe('Editor');
  });
});

describe('SessionRepository', () => {
  test('findByRefreshToken looks up session token', async () => {
    mockSession.findOne.mockResolvedValue({ id: 's1', refreshToken: 'tok123' });
    const session = await sessionRepository.findByRefreshToken('tok123');
    expect(mockSession.findOne).toHaveBeenCalledWith({ refreshToken: 'tok123' });
    expect(session.id).toBe('s1');
  });

  test('findUserSessions retrieves active sessions for user', async () => {
    mockSession.find.mockResolvedValue([{ id: 's1' }]);
    const sessions = await sessionRepository.findUserSessions('u1');
    expect(mockSession.find).toHaveBeenCalledWith({ userId: 'u1', isActive: true });
    expect(sessions).toHaveLength(1);
  });

  test('deactivate and deactivateAll update isActive flags', async () => {
    mockSession.findByIdAndUpdate.mockResolvedValue({ id: 's1', isActive: false });
    mockSession.updateMany.mockResolvedValue({ modifiedCount: 3 });

    await sessionRepository.deactivate('s1');
    expect(mockSession.findByIdAndUpdate).toHaveBeenCalledWith('s1', { isActive: false });

    await sessionRepository.deactivateAll('u1');
    expect(mockSession.updateMany).toHaveBeenCalledWith({ userId: 'u1' }, { isActive: false });
  });

  test('touch updates lastActive timestamp', async () => {
    mockSession.findByIdAndUpdate.mockResolvedValue({ id: 's1' });
    await sessionRepository.touch('s1');
    expect(mockSession.findByIdAndUpdate).toHaveBeenCalledWith('s1', { lastActive: expect.any(Date) });
  });

  test('cleanExpired deletes sessions with expiresAt less than now', async () => {
    mockSession.deleteMany.mockResolvedValue({ deletedCount: 5 });
    await sessionRepository.cleanExpired();
    expect(mockSession.deleteMany).toHaveBeenCalledWith({ expiresAt: { $lt: expect.any(Date) } });
  });
});

describe('AuditRepository', () => {
  test('log creates audit record with default status', async () => {
    mockAuditLog.create.mockResolvedValue({ id: 'a1', action: 'login' });
    const log = await auditRepository.log({
      userId: 'u1',
      username: 'admin',
      action: 'LOGIN',
      resource: 'auth',
      ip: '127.0.0.1',
    });
    expect(mockAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        username: 'admin',
        action: 'LOGIN',
        status: 'success',
      })
    );
    expect(log.id).toBe('a1');
  });

  test('getUserActivity and getRecent query logs', async () => {
    mockAuditLog.find.mockResolvedValue([{ id: 'a1' }]);
    mockAuditLog.findWithUser.mockResolvedValue([{ id: 'a1', username: 'admin' }]);

    const userActivity = await auditRepository.getUserActivity('u1', 25);
    expect(mockAuditLog.find).toHaveBeenCalledWith({ userId: 'u1' }, { limit: 25 });
    expect(userActivity).toHaveLength(1);

    const recent = await auditRepository.getRecent(50);
    expect(mockAuditLog.findWithUser).toHaveBeenCalledWith({}, 50);
    expect(recent).toHaveLength(1);
  });
});
