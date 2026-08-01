/**
 * Unit test: auth.controller.js — POLA REFERENSI untuk test controller layer (Phase 8.1)
 *
 * Strategi:
 * - Proyek memakai native ESM (--experimental-vm-modules) TANPA Babel → wajib
 *   `jest.unstable_mockModule` + dynamic `await import()`.
 * - authService di-mock → controller diuji murni sebagai request/response layer.
 * - Response helpers (success/error/unauthorized) TIDAK di-mock → memastikan
 *   pemetaan status code & payload konsisten dengan helper standar.
 * - `res` berupa objek mock minimal (status/json/cookie/clearCookie).
 *
 * @jest-environment node
 */

// ── Environment setup (MUST be before any dynamic import of app modules) ──
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'jest-auth-ctrl-secret-' + Date.now();
process.env.JWT_REFRESH_SECRET = 'jest-auth-ctrl-refresh-' + Date.now();
process.env.APP_SECRET = 'jest-auth-ctrl-app-' + Date.now();
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

// ── Module mocks (native-ESM style) ──
jest.unstable_mockModule('../src/modules/auth/auth.service.js', () => ({
  default: {
    login: jest.fn(),
    verifyTwoFactor: jest.fn(),
    refreshToken: jest.fn(),
    logout: jest.fn(),
    logoutAll: jest.fn(),
    logoutSession: jest.fn(),
    getSessions: jest.fn(),
    setup2FA: jest.fn(),
    enable2FA: jest.fn(),
    disable2FA: jest.fn(),
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

// ── Dynamic imports ──
const { default: authController } = await import('../src/modules/auth/auth.controller.js');
const { default: authService } = await import('../src/modules/auth/auth.service.js');

// ── Helpers ──

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.cookie = jest.fn().mockReturnValue(res);
  res.clearCookie = jest.fn().mockReturnValue(res);
  return res;
}

function mockReq(overrides = {}) {
  return {
    body: {},
    cookies: {},
    params: {},
    user: { _id: 'user-1', username: 'admin' },
    ip: '127.0.0.1',
    ...overrides,
  };
}

function loginResult(overrides = {}) {
  return {
    accessToken: 'access-token-1',
    refreshToken: 'refresh-token-1',
    user: { _id: 'user-1', username: 'admin' },
    mustChangePassword: false,
    passwordExpired: false,
    forceChangeReason: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════
//  LOGIN
// ═══════════════════════════════════════════════════════════

describe('AuthController.login', () => {
  test('missing username/password → 400 without calling service', async () => {
    const res = mockRes();
    await authController.login(mockReq({ body: { username: 'admin' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: false, message: 'Username and password are required' });
    expect(authService.login).not.toHaveBeenCalled();
  });

  test('success → sets refresh cookie and returns access token', async () => {
    authService.login.mockResolvedValue(loginResult());
    const res = mockRes();
    const req = mockReq({ body: { username: 'admin', password: 'pass' } });

    await authController.login(req, res);

    expect(res.cookie).toHaveBeenCalledWith('refresh_token', 'refresh-token-1', expect.objectContaining({
      httpOnly: true,
      sameSite: 'strict',
    }));
    const payload = res.json.mock.calls[0][0];
    expect(payload).toMatchObject({ success: true, message: 'Login successful' });
    expect(payload.data.accessToken).toBe('access-token-1');
    expect(payload.data.mustChangePassword).toBe(false);
  });

  test('2FA required → returns temp token, does NOT set cookie', async () => {
    authService.login.mockResolvedValue({ requiresTwoFactor: true, tempToken: 'temp-1' });
    const res = mockRes();

    await authController.login(mockReq({ body: { username: 'admin', password: 'pass' } }), res);

    expect(res.cookie).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.data).toMatchObject({ requiresTwoFactor: true, tempToken: 'temp-1' });
  });

  test('service error → maps statusCode (401)', async () => {
    const err = Object.assign(new Error('Invalid credentials'), { statusCode: 401 });
    authService.login.mockRejectedValue(err);
    const res = mockRes();

    await authController.login(mockReq({ body: { username: 'admin', password: 'bad' } }), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: false, message: 'Invalid credentials' });
  });
});

// ═══════════════════════════════════════════════════════════
//  VERIFY 2FA
// ═══════════════════════════════════════════════════════════

describe('AuthController.verifyTwoFactor', () => {
  test('success → sets cookie + returns tokens', async () => {
    authService.verifyTwoFactor.mockResolvedValue(loginResult());
    const res = mockRes();

    await authController.verifyTwoFactor(mockReq({ body: { tempToken: 't', otp: '123456' } }), res);

    expect(res.cookie).toHaveBeenCalledWith('refresh_token', 'refresh-token-1', expect.anything());
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: true, message: '2FA verified' });
  });

  test('invalid OTP → 401', async () => {
    authService.verifyTwoFactor.mockRejectedValue(Object.assign(new Error('Invalid OTP'), { statusCode: 401 }));
    const res = mockRes();

    await authController.verifyTwoFactor(mockReq({ body: { tempToken: 't', otp: '000000' } }), res);

    expect(res.status).toHaveBeenCalledWith(401);
  });
});

// ═══════════════════════════════════════════════════════════
//  REFRESH
// ═══════════════════════════════════════════════════════════

describe('AuthController.refresh', () => {
  test('no token → 401 unauthorized', async () => {
    const res = mockRes();
    await authController.refresh(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json.mock.calls[0][0]).toMatchObject({ message: 'Refresh token required' });
    expect(authService.refreshToken).not.toHaveBeenCalled();
  });

  test('token from cookie → refreshes and sets new cookie', async () => {
    authService.refreshToken.mockResolvedValue({ accessToken: 'new-at', refreshToken: 'new-rt' });
    const res = mockRes();
    const req = mockReq({ cookies: { refresh_token: 'old-rt' } });

    await authController.refresh(req, res);

    expect(authService.refreshToken).toHaveBeenCalledWith('old-rt');
    expect(res.cookie).toHaveBeenCalledWith('refresh_token', 'new-rt', expect.anything());
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: true, message: 'Token refreshed' });
    expect(res.json.mock.calls[0][0].data.accessToken).toBe('new-at');
  });

  test('token from body fallback', async () => {
    authService.refreshToken.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' });
    const res = mockRes();

    await authController.refresh(mockReq({ body: { refreshToken: 'body-rt' } }), res);

    expect(authService.refreshToken).toHaveBeenCalledWith('body-rt');
  });

  test('service error → 401 (default)', async () => {
    authService.refreshToken.mockRejectedValue(Object.assign(new Error('Refresh token expired'), { statusCode: 401 }));
    const res = mockRes();

    await authController.refresh(mockReq({ cookies: { refresh_token: 'expired' } }), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: false });
  });
});

// ═══════════════════════════════════════════════════════════
//  LOGOUT
// ═══════════════════════════════════════════════════════════

describe('AuthController.logout', () => {
  test('clears cookie and returns success', async () => {
    authService.logout.mockResolvedValue();
    const res = mockRes();

    await authController.logout(mockReq({ cookies: { refresh_token: 'rt' } }), res);

    expect(authService.logout).toHaveBeenCalledWith('rt');
    expect(res.clearCookie).toHaveBeenCalledWith('refresh_token', { path: '/' });
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: true, message: 'Logged out successfully' });
  });
});

describe('AuthController.logoutAll', () => {
  test('deactivates all sessions for user', async () => {
    authService.logoutAll.mockResolvedValue();
    const res = mockRes();

    await authController.logoutAll(mockReq(), res);

    expect(authService.logoutAll).toHaveBeenCalledWith('user-1');
    expect(res.clearCookie).toHaveBeenCalled();
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: true });
  });
});

describe('AuthController.logoutSession', () => {
  test('deactivates specific session', async () => {
    authService.logoutSession.mockResolvedValue();
    const res = mockRes();

    await authController.logoutSession(mockReq({ params: { sessionId: 'sess-9' } }), res);

    expect(authService.logoutSession).toHaveBeenCalledWith('user-1', 'sess-9');
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: true, message: 'Session logged out' });
  });

  test('session not found → 404', async () => {
    authService.logoutSession.mockRejectedValue(Object.assign(new Error('Session not found'), { statusCode: 404 }));
    const res = mockRes();

    await authController.logoutSession(mockReq({ params: { sessionId: 'nope' } }), res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ═══════════════════════════════════════════════════════════
//  PROFILE & SESSIONS
// ═══════════════════════════════════════════════════════════

describe('AuthController profile & sessions', () => {
  test('getProfile → returns req.user directly', async () => {
    const res = mockRes();
    const user = { _id: 'user-1', username: 'admin' };

    await authController.getProfile(mockReq({ user }), res);

    expect(res.json.mock.calls[0][0].data.user).toBe(user);
  });

  test('getSessions → returns session list', async () => {
    // Service mengembalikan array; controller membungkusnya sebagai { sessions }
    authService.getSessions.mockResolvedValue([{ _id: 's1' }]);
    const res = mockRes();

    await authController.getSessions(mockReq(), res);

    expect(authService.getSessions).toHaveBeenCalledWith('user-1');
    expect(res.json.mock.calls[0][0].data.sessions).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════
//  2FA MANAGEMENT
// ═══════════════════════════════════════════════════════════

describe('AuthController 2FA management', () => {
  test('setup2FA → returns secret + qrCode', async () => {
    authService.setup2FA.mockResolvedValue({ secret: 'SECRET', qrCode: 'data:image/png;base64,x' });
    const res = mockRes();

    await authController.setup2FA(mockReq(), res);

    expect(authService.setup2FA).toHaveBeenCalledWith('user-1');
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: true, message: '2FA setup initiated' });
  });

  test('enable2FA success + error mapping', async () => {
    authService.enable2FA.mockResolvedValue({ message: '2FA enabled' });
    const res = mockRes();

    await authController.enable2FA(mockReq({ body: { otp: '123456' } }), res);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: true, message: '2FA enabled' });

    // Error path
    authService.enable2FA.mockRejectedValue(Object.assign(new Error('Invalid OTP'), { statusCode: 400 }));
    const res2 = mockRes();
    await authController.enable2FA(mockReq({ body: { otp: '000000' } }), res2);
    expect(res2.status).toHaveBeenCalledWith(400);
  });

  test('disable2FA success + error mapping', async () => {
    authService.disable2FA.mockResolvedValue({});
    const res = mockRes();

    await authController.disable2FA(mockReq({ body: { password: 'correct-password' } }), res);
    expect(authService.disable2FA).toHaveBeenCalledWith('user-1', 'correct-password');
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: true, message: '2FA disabled' });

    authService.disable2FA.mockRejectedValue(Object.assign(new Error('Invalid password'), { statusCode: 401 }));
    const res2 = mockRes();
    await authController.disable2FA(mockReq({ body: { password: 'wrong' } }), res2);
    expect(res2.status).toHaveBeenCalledWith(401);
  });
});
