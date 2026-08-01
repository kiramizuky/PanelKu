/**
 * Unit test: auth.service.js — POLA REFERENSI untuk test service layer (Phase 8.1)
 *
 * Strategi:
 * - Proyek memakai native ESM (--experimental-vm-modules) TANPA Babel, sehingga
 *   `jest.mock` tidak di-hoist. Wajib memakai `jest.unstable_mockModule` + dynamic
 *   `await import()` (lihat pola ini untuk modul lain).
 * - Dependensi eksternal (repository, audit, password policy, device info, qrcode,
 *   logger) di-mock → test fokus pada LOGIKA service tanpa SQLite/DB nyata.
 * - jsonwebtoken & speakeasy TIDAK di-mock → kriptografi asli teruji (sign/verify,
 *   TOTP generate/verify).
 * - Statis _recentlyRotated dibersihkan antar test agar tidak terjadi polusi state.
 *
 * @jest-environment node
 */

// ── Environment setup (MUST be before any dynamic import of app modules) ──
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'jest-auth-svc-secret-' + Date.now();
process.env.JWT_REFRESH_SECRET = 'jest-auth-svc-refresh-' + Date.now();
process.env.APP_SECRET = 'jest-auth-svc-app-' + Date.now();
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

// ── Module mocks (native-ESM style: unstable_mockModule) ──
jest.unstable_mockModule('../src/repositories/user.repository.js', () => ({
  default: {
    findByUsername: jest.fn(),
    findById: jest.fn(),
    updateLoginStats: jest.fn(),
    updateById: jest.fn(),
  },
}));

jest.unstable_mockModule('../src/repositories/session.repository.js', () => ({
  default: {
    create: jest.fn(),
    findByRefreshToken: jest.fn(),
    findById: jest.fn(),
    deactivate: jest.fn(),
    deactivateAll: jest.fn(),
    findUserSessions: jest.fn(),
  },
}));

jest.unstable_mockModule('../src/repositories/audit.repository.js', () => ({
  default: {
    log: jest.fn().mockResolvedValue({}),
  },
}));

jest.unstable_mockModule('../src/modules/system/password-policy.service.js', () => ({
  default: {
    getPolicy: jest.fn(),
  },
}));

jest.unstable_mockModule('../src/helpers/system.js', () => ({
  getDeviceInfo: jest.fn(() => ({
    ip: '127.0.0.1',
    userAgent: 'jest-test-agent',
    deviceInfo: 'jest',
  })),
}));

jest.unstable_mockModule('qrcode', () => ({
  default: {
    toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,QRCODE'),
  },
}));

jest.unstable_mockModule('../src/config/logger.js', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// ── Dynamic imports (wajib setelah mock — native ESM tidak meng-hoist jest.mock) ──
const { default: jwt } = await import('jsonwebtoken');
const { default: speakeasy } = await import('speakeasy');
const { default: qrcode } = await import('qrcode');
const { default: appConfig } = await import('../src/config/app.js');
const { default: authService } = await import('../src/modules/auth/auth.service.js');
const { default: userRepository } = await import('../src/repositories/user.repository.js');
const { default: sessionRepository } = await import('../src/repositories/session.repository.js');
const { default: auditRepository } = await import('../src/repositories/audit.repository.js');
const { default: passwordPolicyService } = await import('../src/modules/system/password-policy.service.js');
const { default: eventBus } = await import('../src/core/events/EventBus.js');

// ── Helpers ──

function makeUser(overrides = {}) {
  return {
    _id: 'user-1',
    username: 'admin',
    email: 'admin@test.local',
    password: 'hashed-password',
    isActive: true,
    twoFactorEnabled: false,
    twoFactorSecret: null,
    mustChangePassword: false,
    passwordChangedAt: new Date(),
    role: { slug: 'super_admin', name: 'Super Admin' },
    toObject() { return { ...this }; },
    async comparePassword(pw) { return pw === 'correct-password'; },
    ...overrides,
  };
}

function makeSession(overrides = {}) {
  return {
    _id: 'sess-1',
    userId: 'user-1',
    isActive: true,
    refreshToken: 'rt-token',
    deviceInfo: 'jest',
    userAgent: 'jest-test-agent',
    ip: '127.0.0.1',
    ...overrides,
  };
}

function validRefreshTokenFor(userId = 'user-1') {
  return jwt.sign({ sub: userId, nonce: Date.now() }, appConfig.jwt.refreshSecret);
}

function validTempTokenFor(userId = 'user-1') {
  return jwt.sign({ sub: userId, type: 'temp_2fa' }, appConfig.appSecret, { expiresIn: '5m' });
}

function validOtpFor(secret) {
  // speakeasy 2.0.0: `totp` adalah fungsi callable (bukan objek .generate)
  return speakeasy.totp({ secret, encoding: 'base32' });
}

const mockReq = () => ({
  ip: '127.0.0.1',
  get: () => 'jest-test-agent',
  headers: { 'user-agent': 'jest-test-agent' },
});

const publishSpy = jest.spyOn(eventBus, 'publish').mockImplementation(() => {});

beforeEach(() => {
  // clearAllMocks (BUKAN resetAllMocks) sengaja dipakai: factory default seperti
  // auditRepository.log.mockResolvedValue({}) bersifat load-bearing karena service
  // memanggil .catch() pada hasilnya — resetAllMocks akan menghapusnya dan crash.
  jest.clearAllMocks();
  // Reset static token-rotation cache antara test agar tidak ada polusi state
  authService.constructor._recentlyRotated.clear();
});

// ═══════════════════════════════════════════════════════════
//  LOGIN
// ═══════════════════════════════════════════════════════════

describe('AuthService.login', () => {
  test('success — returns tokens, creates session, publishes event', async () => {
    userRepository.findByUsername.mockResolvedValue(makeUser());
    sessionRepository.create.mockResolvedValue({ _id: 'sess-new' });
    userRepository.updateLoginStats.mockResolvedValue({});
    passwordPolicyService.getPolicy.mockResolvedValue(null);

    const result = await authService.login('admin', 'correct-password', mockReq());

    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.mustChangePassword).toBe(false);
    expect(result.passwordExpired).toBe(false);
    expect(result.user).toBeDefined();
    expect(result.user.password).toBeUndefined();
    expect(sessionRepository.create).toHaveBeenCalledTimes(1);
    expect(sessionRepository.create.mock.calls[0][0].userId).toBe('user-1');
    expect(userRepository.updateLoginStats).toHaveBeenCalledWith('user-1', '127.0.0.1');
    expect(publishSpy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ userId: 'user-1' }));

    // accessToken adalah JWT asli yang dapat diverifikasi
    const decoded = jwt.verify(result.accessToken, appConfig.jwt.secret);
    expect(decoded.sub).toBe('user-1');
  });

  test('wrong password → 401 and audit LOGIN_FAILED', async () => {
    userRepository.findByUsername.mockResolvedValue(makeUser());

    await expect(authService.login('admin', 'wrong-password', mockReq()))
      .rejects.toMatchObject({ message: 'Invalid credentials', statusCode: 401 });

    expect(auditRepository.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'LOGIN_FAILED', status: 'failure', username: 'admin', userId: 'user-1' })
    );
  });

  test('user not found → 401 and audit with userId null', async () => {
    userRepository.findByUsername.mockResolvedValue(null);

    await expect(authService.login('ghost', 'whatever1!', mockReq()))
      .rejects.toMatchObject({ message: 'Invalid credentials', statusCode: 401 });

    expect(auditRepository.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'LOGIN_FAILED', userId: null, username: 'ghost' })
    );
  });

  test('inactive account → 403 and audit LOGIN_BLOCKED', async () => {
    userRepository.findByUsername.mockResolvedValue(makeUser({ isActive: false }));

    await expect(authService.login('admin', 'correct-password', mockReq()))
      .rejects.toMatchObject({ message: 'Account is disabled', statusCode: 403 });

    expect(auditRepository.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'LOGIN_BLOCKED', status: 'failure' })
    );
  });

  test('2FA enabled → returns temp token, no session created', async () => {
    userRepository.findByUsername.mockResolvedValue(makeUser({ twoFactorEnabled: true }));

    const result = await authService.login('admin', 'correct-password', mockReq());

    expect(result.requiresTwoFactor).toBe(true);
    expect(result.tempToken).toBeTruthy();
    expect(result.accessToken).toBeUndefined();
    expect(sessionRepository.create).not.toHaveBeenCalled();
  });

  test('mustChangePassword=true → flag passed through', async () => {
    userRepository.findByUsername.mockResolvedValue(makeUser({ mustChangePassword: true }));
    sessionRepository.create.mockResolvedValue({});
    passwordPolicyService.getPolicy.mockResolvedValue(null);

    const result = await authService.login('admin', 'correct-password', mockReq());
    expect(result.mustChangePassword).toBe(true);
  });

  test('expired password (policy) → passwordExpired + audit PASSWORD_CHANGE_REQUIRED', async () => {
    const oldPasswordAt = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000); // 100 days ago
    userRepository.findByUsername.mockResolvedValue(makeUser({ passwordChangedAt: oldPasswordAt }));
    sessionRepository.create.mockResolvedValue({});
    passwordPolicyService.getPolicy.mockResolvedValue({ expiryEnabled: true, expiryDays: 90 });

    const result = await authService.login('admin', 'correct-password', mockReq());

    expect(result.passwordExpired).toBe(true);
    expect(result.forceChangeReason).toContain('90 days');
    expect(auditRepository.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PASSWORD_CHANGE_REQUIRED', status: 'warning' })
    );
  });
});

// ═══════════════════════════════════════════════════════════
//  VERIFY 2FA
// ═══════════════════════════════════════════════════════════

describe('AuthService.verifyTwoFactor', () => {
  test('invalid temp token → 401, no audit for untrusted tokens', async () => {
    await expect(authService.verifyTwoFactor('not-a-jwt', '123456', mockReq()))
      .rejects.toMatchObject({ message: 'Invalid or expired temp token', statusCode: 401 });

    expect(auditRepository.log).not.toHaveBeenCalled();
  });

  test('user not found for temp token → 404 + audit 2FA_FAILED', async () => {
    userRepository.findById.mockResolvedValue(null);

    await expect(authService.verifyTwoFactor(validTempTokenFor('nobody'), '123456', mockReq()))
      .rejects.toMatchObject({ message: 'User not found', statusCode: 404 });

    expect(auditRepository.log).toHaveBeenCalledWith(expect.objectContaining({ action: '2FA_FAILED' }));
  });

  test('invalid OTP → 401 + audit 2FA_FAILED', async () => {
    const secret = speakeasy.generateSecret().base32;
    userRepository.findById.mockResolvedValue(makeUser({ twoFactorSecret: secret }));

    await expect(authService.verifyTwoFactor(validTempTokenFor(), '000000', mockReq()))
      .rejects.toMatchObject({ message: 'Invalid OTP', statusCode: 401 });

    expect(auditRepository.log).toHaveBeenCalledWith(expect.objectContaining({ action: '2FA_FAILED', status: 'failure' }));
  });

  test('valid OTP → completes login with tokens + session', async () => {
    const secret = speakeasy.generateSecret().base32;
    userRepository.findById.mockResolvedValue(makeUser({ twoFactorSecret: secret }));
    userRepository.findByUsername.mockResolvedValue(makeUser());
    sessionRepository.create.mockResolvedValue({ _id: 'sess-2fa' });
    passwordPolicyService.getPolicy.mockResolvedValue(null);

    const result = await authService.verifyTwoFactor(validTempTokenFor(), validOtpFor(secret), mockReq());

    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(sessionRepository.create).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════
//  REFRESH TOKEN (rotation + race-condition grace cache)
// ═══════════════════════════════════════════════════════════

describe('AuthService.refreshToken', () => {
  test('session not found → 401', async () => {
    sessionRepository.findByRefreshToken.mockResolvedValue(null);

    await expect(authService.refreshToken('unknown-token'))
      .rejects.toMatchObject({ message: 'Invalid or expired refresh token', statusCode: 401 });
  });

  test('inactive session → 401', async () => {
    sessionRepository.findByRefreshToken.mockResolvedValue(makeSession({ isActive: false }));

    await expect(authService.refreshToken('rt'))
      .rejects.toMatchObject({ message: 'Invalid or expired refresh token', statusCode: 401 });
  });

  test('expired JWT → deactivates session + 401', async () => {
    sessionRepository.findByRefreshToken.mockResolvedValue(makeSession());

    await expect(authService.refreshToken('garbage-token'))
      .rejects.toMatchObject({ message: 'Refresh token expired', statusCode: 401 });

    expect(sessionRepository.deactivate).toHaveBeenCalledWith('sess-1');
  });

  test('inactive user → deactivates session + 401', async () => {
    const token = validRefreshTokenFor();
    sessionRepository.findByRefreshToken.mockResolvedValue(makeSession({ refreshToken: token }));
    userRepository.findById.mockResolvedValue(makeUser({ isActive: false }));

    await expect(authService.refreshToken(token))
      .rejects.toMatchObject({ message: 'User not found or inactive', statusCode: 401 });

    expect(sessionRepository.deactivate).toHaveBeenCalledWith('sess-1');
  });

  test('success → rotates session (old deactivated, new created) and returns fresh tokens', async () => {
    const token = validRefreshTokenFor();
    sessionRepository.findByRefreshToken.mockResolvedValue(makeSession({ refreshToken: token }));
    userRepository.findById.mockResolvedValue(makeUser());
    sessionRepository.create.mockResolvedValue({ _id: 'sess-2' });

    const result = await authService.refreshToken(token);

    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(sessionRepository.deactivate).toHaveBeenCalledWith('sess-1');
    expect(sessionRepository.create).toHaveBeenCalledTimes(1);
    expect(sessionRepository.findByRefreshToken).toHaveBeenCalledWith(token);
  });

  test('race condition — second call with same old token hits grace cache', async () => {
    const token = validRefreshTokenFor();
    sessionRepository.findByRefreshToken.mockResolvedValue(makeSession({ refreshToken: token }));
    userRepository.findById.mockResolvedValue(makeUser());
    sessionRepository.create.mockResolvedValue({ _id: 'sess-2' });

    const first = await authService.refreshToken(token);
    const second = await authService.refreshToken(token);

    // Cache hit → same tokens, no extra session mutation
    expect(second.accessToken).toBe(first.accessToken);
    expect(second.refreshToken).toBe(first.refreshToken);
    expect(sessionRepository.deactivate).toHaveBeenCalledTimes(1);
    expect(sessionRepository.create).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════
//  LOGOUT / SESSIONS
// ═══════════════════════════════════════════════════════════

describe('AuthService logout & sessions', () => {
  test('logout with valid refresh token → deactivates session', async () => {
    sessionRepository.findByRefreshToken.mockResolvedValue(makeSession());

    await authService.logout('rt-token');
    expect(sessionRepository.deactivate).toHaveBeenCalledWith('sess-1');
  });

  test('logout without token → no-op', async () => {
    await authService.logout(undefined);
    expect(sessionRepository.findByRefreshToken).not.toHaveBeenCalled();
  });

  test('logoutAll → deactivates all + publishes event', async () => {
    await authService.logoutAll('user-1');
    expect(sessionRepository.deactivateAll).toHaveBeenCalledWith('user-1');
    expect(publishSpy).toHaveBeenCalledWith(expect.any(String), { userId: 'user-1', all: true });
  });

  test('logoutSession — not found → 404', async () => {
    sessionRepository.findById.mockResolvedValue(null);
    await expect(authService.logoutSession('user-1', 'sess-x'))
      .rejects.toMatchObject({ message: 'Session not found', statusCode: 404 });
  });

  test('logoutSession — session of another user → 404', async () => {
    sessionRepository.findById.mockResolvedValue(makeSession({ userId: 'user-OTHER' }));
    await expect(authService.logoutSession('user-1', 'sess-1'))
      .rejects.toMatchObject({ message: 'Session not found', statusCode: 404 });
  });

  test('logoutSession — own session → deactivated', async () => {
    sessionRepository.findById.mockResolvedValue(makeSession());
    await authService.logoutSession('user-1', 'sess-1');
    expect(sessionRepository.deactivate).toHaveBeenCalledWith('sess-1');
  });

  test('getSessions → returns user sessions', async () => {
    sessionRepository.findUserSessions.mockResolvedValue([makeSession()]);
    const sessions = await authService.getSessions('user-1');
    expect(sessions).toHaveLength(1);
    expect(sessionRepository.findUserSessions).toHaveBeenCalledWith('user-1');
  });
});

// ═══════════════════════════════════════════════════════════
//  2FA SETUP / ENABLE / DISABLE
// ═══════════════════════════════════════════════════════════

describe('AuthService 2FA management', () => {
  test('setup2FA → generates base32 secret + QR data URL, persists secret', async () => {
    userRepository.findById.mockResolvedValue(makeUser());
    userRepository.updateById.mockResolvedValue({});

    const result = await authService.setup2FA('user-1');

    expect(result.secret).toMatch(/^[A-Z2-7]+=*$/); // base32
    expect(result.qrCode).toBe('data:image/png;base64,QRCODE');
    expect(qrcode.toDataURL).toHaveBeenCalledTimes(1);
    expect(userRepository.updateById).toHaveBeenCalledWith('user-1', expect.objectContaining({ twoFactorSecret: result.secret }));
  });

  test('enable2FA — invalid OTP → 400', async () => {
    const secret = speakeasy.generateSecret().base32;
    userRepository.findById.mockResolvedValue(makeUser({ twoFactorSecret: secret }));

    await expect(authService.enable2FA('user-1', '000000'))
      .rejects.toMatchObject({ message: 'Invalid OTP', statusCode: 400 });
  });

  test('enable2FA — valid OTP → enables 2FA', async () => {
    const secret = speakeasy.generateSecret().base32;
    userRepository.findById.mockResolvedValue(makeUser({ twoFactorSecret: secret }));
    userRepository.updateById.mockResolvedValue({});

    const result = await authService.enable2FA('user-1', validOtpFor(secret));

    expect(result.message).toBe('2FA enabled successfully');
    expect(userRepository.updateById).toHaveBeenCalledWith('user-1', { twoFactorEnabled: true });
  });

  test('disable2FA — wrong password → 401', async () => {
    userRepository.findById.mockResolvedValue(makeUser());

    await expect(authService.disable2FA('user-1', 'wrong-password'))
      .rejects.toMatchObject({ message: 'Invalid password', statusCode: 401 });
  });

  test('disable2FA — correct password → disables 2FA and clears secret', async () => {
    userRepository.findById.mockResolvedValue(makeUser());
    userRepository.updateById.mockResolvedValue({});

    await authService.disable2FA('user-1', 'correct-password');

    expect(userRepository.updateById).toHaveBeenCalledWith('user-1', {
      twoFactorEnabled: false,
      twoFactorSecret: null,
    });
  });
});
