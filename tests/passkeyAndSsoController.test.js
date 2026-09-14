/**
 * Passkey, SSO, and LDAP Controllers Unit Tests
 *
 * @jest-environment node
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import passkeyController from '../src/modules/auth/passkey.controller.js';
import ssoController from '../src/modules/auth/sso.controller.js';
import ldapController from '../src/modules/auth/ldap.controller.js';
import passkeyService from '../src/modules/auth/passkey.service.js';
import ssoService from '../src/modules/auth/sso.service.js';
import ldapService from '../src/modules/auth/ldap.service.js';
import authService from '../src/modules/auth/auth.service.js';

function mockRes() {
  const cookies = {};
  let redirectedTo = null;
  return {
    statusCode: 200,
    body: null,
    cookies,
    redirectedTo,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(d) {
      this.body = d;
      return this;
    },
    cookie(name, val, opts) {
      cookies[name] = { val, opts };
    },
    redirect(url) {
      this.redirectedTo = url;
    },
  };
}

const mockReq = {
  user: { _id: 'u-test-123' },
  protocol: 'http',
  get(h) {
    return 'localhost:3000';
  },
};

describe('PasskeyController', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('getRegistrationOptions returns generated options', async () => {
    jest.spyOn(passkeyService, 'getRegistrationOptions').mockResolvedValue({ challenge: 'test-challenge' });
    const res = mockRes();
    await passkeyController.getRegistrationOptions(mockReq, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.challenge).toBe('test-challenge');
  });

  test('verifyRegistration validates response presence', async () => {
    const badRes = mockRes();
    await passkeyController.verifyRegistration({ body: {}, user: mockReq.user }, badRes);
    expect(badRes.statusCode).toBe(400);

    jest.spyOn(passkeyService, 'verifyRegistration').mockResolvedValue({ verified: true });
    const goodRes = mockRes();
    await passkeyController.verifyRegistration({ body: { response: { id: 'cred-1' } }, user: mockReq.user }, goodRes);
    expect(goodRes.statusCode).toBe(200);
  });

  test('getAuthenticationOptions generates challenge', async () => {
    jest.spyOn(passkeyService, 'getAuthenticationOptions').mockResolvedValue({ challenge: 'auth-challenge' });
    const res = mockRes();
    await passkeyController.getAuthenticationOptions({ query: { username: 'admin' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.challenge).toBe('auth-challenge');
  });

  test('verifyAuthentication validates input and sets refresh token cookie', async () => {
    const badRes = mockRes();
    await passkeyController.verifyAuthentication({ body: {} }, badRes);
    expect(badRes.statusCode).toBe(400);

    jest.spyOn(passkeyService, 'verifyAuthentication').mockResolvedValue({
      accessToken: 'token-passkey-abc',
      refreshToken: 'refresh-passkey-xyz',
      user: { id: 'u-test-123' },
    });
    const goodRes = mockRes();
    await passkeyController.verifyAuthentication({ body: { response: {}, challengeKey: 'key-1' } }, goodRes);
    expect(goodRes.statusCode).toBe(200);
    expect(goodRes.body.data.accessToken).toBe('token-passkey-abc');
    expect(goodRes.cookies['refresh_token']).toBeDefined();
  });

  test('listPasskeys and deletePasskey manage user credentials', async () => {
    jest.spyOn(passkeyService, 'listPasskeys').mockResolvedValue([{ id: 'pk-1' }]);
    jest.spyOn(passkeyService, 'deletePasskey').mockResolvedValue(true);

    const listRes = mockRes();
    await passkeyController.listPasskeys(mockReq, listRes);
    expect(listRes.statusCode).toBe(200);
    expect(listRes.body.data.passkeys.length).toBe(1);

    const delRes = mockRes();
    await passkeyController.deletePasskey({ params: { id: 'pk-1' }, user: mockReq.user }, delRes);
    expect(delRes.statusCode).toBe(200);
  });
});

describe('SSOController', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('getConfig returns masked configuration without secrets', async () => {
    jest.spyOn(ssoService, 'getConfig').mockResolvedValue({
      google: { enabled: true, clientId: '1234567890abcdef', clientSecret: 'super-secret' },
    });
    const res = mockRes();
    await ssoController.getConfig({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.config.google.clientId).toContain('...');
    expect(res.body.data.config.google.clientSecret).toBeUndefined();
  });

  test('saveConfig saves provider settings', async () => {
    jest.spyOn(ssoService, 'saveConfig').mockResolvedValue({ message: 'SSO config saved' });
    const res = mockRes();
    await ssoController.saveConfig({ body: { google: { enabled: true } } }, res);
    expect(res.statusCode).toBe(200);
  });

  test('authorize redirects user to OAuth2 provider', async () => {
    jest.spyOn(ssoService, 'getAuthorizeUrl').mockResolvedValue({ url: 'https://accounts.google.com/o/oauth2/auth' });
    const res = mockRes();
    await ssoController.authorize({ params: { provider: 'google' } }, res);
    expect(res.redirectedTo).toBe('https://accounts.google.com/o/oauth2/auth');
  });

  test('callback validates code & state and completes login', async () => {
    const badRes1 = mockRes();
    await ssoController.callback({ params: { provider: 'google' }, query: {} }, badRes1);
    expect(badRes1.statusCode).toBe(400);

    const badRes2 = mockRes();
    await ssoController.callback({ params: { provider: 'google' }, query: { code: 'code123' } }, badRes2);
    expect(badRes2.statusCode).toBe(400);

    jest.spyOn(ssoService, 'handleCallback').mockResolvedValue({ id: 'u-sso-1', username: 'sso_user' });
    jest.spyOn(authService, 'completeLogin').mockResolvedValue({
      accessToken: 'sso-jwt-acc',
      refreshToken: 'sso-jwt-ref',
    });

    const goodRes = mockRes();
    await ssoController.callback({
      params: { provider: 'google' },
      query: { code: 'code123', state: 'state456' },
      protocol: 'http',
      get: () => 'localhost:3000',
    }, goodRes);
    expect(goodRes.redirectedTo).toContain('/dashboard#token=sso-jwt-acc');
    expect(goodRes.cookies['refresh_token']).toBeDefined();
  });
});

describe('LDAPController', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('getConfig masks bindPassword', async () => {
    jest.spyOn(ldapService, 'getConfig').mockResolvedValue({
      enabled: true,
      url: 'ldap://ldap.example.com',
      bindPassword: 'realPassword',
    });
    const res = mockRes();
    await ldapController.getConfig({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.config.bindPassword).toBe('••••••••');
  });

  test('saveConfig saves configuration', async () => {
    jest.spyOn(ldapService, 'saveConfig').mockResolvedValue({ message: 'LDAP saved' });
    const res = mockRes();
    await ldapController.saveConfig({ body: { enabled: true } }, res);
    expect(res.statusCode).toBe(200);
  });

  test('testConnection handles success and failure', async () => {
    jest.spyOn(ldapService, 'testConnection').mockResolvedValue({ success: true });
    const resSuccess = mockRes();
    await ldapController.testConnection({}, resSuccess);
    expect(resSuccess.statusCode).toBe(200);

    jest.spyOn(ldapService, 'testConnection').mockResolvedValue({ success: false });
    const resFail = mockRes();
    await ldapController.testConnection({}, resFail);
    expect(resFail.statusCode).toBe(500);
  });

  test('login authenticates user and issues JWT tokens', async () => {
    const badRes = mockRes();
    await ldapController.login({ body: {} }, badRes);
    expect(badRes.statusCode).toBe(400);

    jest.spyOn(ldapService, 'authenticate').mockResolvedValue({ username: 'ldapuser', email: 'ldap@org.test' });
    jest.spyOn(ldapService, 'findOrCreateUser').mockResolvedValue({ id: 'u-ldap-1', username: 'ldapuser' });
    jest.spyOn(authService, 'completeLogin').mockResolvedValue({
      accessToken: 'ldap-acc-jwt',
      refreshToken: 'ldap-ref-jwt',
      user: { username: 'ldapuser' },
    });

    const goodRes = mockRes();
    await ldapController.login({ body: { username: 'ldapuser', password: 'ldapPassword!' } }, goodRes);
    expect(goodRes.statusCode).toBe(200);
    expect(goodRes.body.data.accessToken).toBe('ldap-acc-jwt');
  });
});
