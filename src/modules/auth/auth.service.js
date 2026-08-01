import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import qrcode from 'qrcode';
import appConfig from '../../config/app.js';
import userRepository from '../../repositories/user.repository.js';
import sessionRepository from '../../repositories/session.repository.js';
import { getDeviceInfo } from '../../helpers/system.js';
import eventBus, { EVENTS } from '../../core/events/EventBus.js';
import logger from '../../config/logger.js';
import auditRepository from '../../repositories/audit.repository.js';
import passwordPolicyService from '../system/password-policy.service.js';

class AuthService {
  /**
   * In-memory cache for recently rotated tokens.
   * Prevents race condition when two concurrent refresh requests both
   * attempt to use the same old refresh token within a short window.
   * TTL: 60 seconds. Cleans up stale entries automatically.
   */
  static _recentlyRotated = new Map();
  static _rotationCleanupTimer = null;

  static _startRotationCleanup() {
    if (AuthService._rotationCleanupTimer) return;
    AuthService._rotationCleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [token, entry] of AuthService._recentlyRotated) {
        if (entry.expiresAt <= now) {
          AuthService._recentlyRotated.delete(token);
        }
      }
    }, 30000); // Clean every 30s
    // Allow process to exit even if timer is active
    if (AuthService._rotationCleanupTimer.unref) {
      AuthService._rotationCleanupTimer.unref();
    }
  }

  /**
   * Login with username/password
   */
  async login(username, password, req) {
    const deviceInfo = getDeviceInfo(req);
    const ip = deviceInfo?.ip || req?.ip || 'unknown';
    const user = await userRepository.findByUsername(username, true);

    if (!user || !(await user.comparePassword(password))) {
      // [MED-5 FIX] Audit failed login attempts for forensics & brute-force detection
      auditRepository.log({
        userId:   user?._id || null,
        username: username,
        action:   'LOGIN_FAILED',
        resource: 'auth',
        details:  user ? 'Invalid password' : 'User not found',
        ip,
        userAgent: req?.headers?.['user-agent'] || '',
        status:   'failure',
      }).catch((e) => logger.error('Failed to write audit log: ' + e.message));

      throw Object.assign(new Error('Invalid credentials'), { statusCode: 401 });
    }

    if (!user.isActive) {
      auditRepository.log({
        userId:   user._id,
        username: user.username,
        action:   'LOGIN_BLOCKED',
        resource: 'auth',
        details:  'Account is disabled',
        ip,
        userAgent: req?.headers?.['user-agent'] || '',
        status:   'failure',
      }).catch((e) => logger.error('Failed to write audit log: ' + e.message));

      throw Object.assign(new Error('Account is disabled'), { statusCode: 403 });
    }

    // 2FA check
    if (user.twoFactorEnabled) {
      return {
        requiresTwoFactor: true,
        tempToken: this._generateTempToken(user._id),
        userId: user._id,
      };
    }

    return this._completeLogin(user, req);
  }

  /**
   * Complete login after optional 2FA verify
   * Made public so SSO/LDAP controllers can use it.
   */
  async completeLogin(user, req) {
    return this._completeLogin(user, req);
  }

  async _completeLogin(user, req) {
    const deviceInfo = getDeviceInfo(req);
    const { accessToken, refreshToken } = this._generateTokens(user);

    // Create session
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await sessionRepository.create({
      userId: user._id,
      refreshToken,
      deviceInfo: deviceInfo.deviceInfo,
      userAgent: deviceInfo.userAgent,
      ip: deviceInfo.ip,
      expiresAt,
    });

    await userRepository.updateLoginStats(user._id, deviceInfo.ip);
    eventBus.publish(EVENTS.USER_LOGGED_IN, { userId: user._id, username: user.username, ip: deviceInfo.ip });

    // [LOW-2 FIX] Notify frontend if user must change their default password
    // The frontend will redirect to settings page to enforce new password.
    const sanitizedUser = this._sanitizeUser(user);

    // [PASSWORD EXPIRY] Check if password has expired based on password_changed_at + configurable days.
    // If expired, force user to change password (same flow as mustChangePassword).
    // Loads policy from DB settings, falls back to appConfig defaults.
    let passwordExpired = false;
    let forceChangeReason = null;

    const policy = await passwordPolicyService.getPolicy().catch(() => null);
    const expiryEnabled = policy ? policy.expiryEnabled : appConfig.passwordExpiry.enabled;
    const expiryDays = policy ? policy.expiryDays : appConfig.passwordExpiry.days;

    if (expiryEnabled && user.passwordChangedAt) {
      const maxAge = expiryDays * 24 * 60 * 60 * 1000;
      const age = Date.now() - new Date(user.passwordChangedAt).getTime();
      if (age > maxAge) {
        passwordExpired = true;
        forceChangeReason = `Password is older than ${expiryDays} days — please change it.`;
      }
    }

    // Combine both flags: mustChangePassword from DB (default admin) OR password expiry
    const needsPasswordChange = user.mustChangePassword || passwordExpired;

    // [AUDIT] Log login event when password change is required
    if (needsPasswordChange) {
      const auditDetails = passwordExpired
        ? `Password expired (${expiryDays} day policy) — must change before continuing`
        : 'User logged in with default password — must change before accessing the panel';

      auditRepository.log({
        userId:    user._id,
        username:  user.username,
        action:    'PASSWORD_CHANGE_REQUIRED',
        resource:  'auth',
        details:   auditDetails,
        ip:        deviceInfo.ip,
        userAgent: deviceInfo.userAgent,
        status:    'warning',
      }).catch((e) => logger.error('Failed to write audit log: ' + e.message));
    }

    return {
      accessToken,
      refreshToken,
      user: sanitizedUser,
      mustChangePassword: user.mustChangePassword || false,
      passwordExpired,
      forceChangeReason,
    };
  }

  /**
   * Verify 2FA OTP and complete login
   */
  async verifyTwoFactor(tempToken, otp, req) {
    const deviceInfo = getDeviceInfo(req);
    const ip = deviceInfo?.ip || req?.ip || 'unknown';

    let payload;
    try {
      payload = jwt.verify(tempToken, appConfig.appSecret);
    } catch {
      // Don't audit log for invalid temp tokens — they are untrusted
      throw Object.assign(new Error('Invalid or expired temp token'), { statusCode: 401 });
    }

    const user = await userRepository.findById(payload.sub, { select: '+twoFactorSecret' });
    if (!user) {
      auditRepository.log({
        userId:   null,
        username: 'unknown',
        action:   '2FA_FAILED',
        resource: 'auth',
        details:  'User not found for temp token',
        ip,
        userAgent: req?.headers?.['user-agent'] || '',
        status:   'failure',
      }).catch((e) => logger.error('Failed to write audit log: ' + e.message));
      throw Object.assign(new Error('User not found'), { statusCode: 404 });
    }

    const valid = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: otp,
      window: 1,
    });

    if (!valid) {
      auditRepository.log({
        userId:   user._id,
        username: user.username,
        action:   '2FA_FAILED',
        resource: 'auth',
        details:  'Invalid OTP',
        ip,
        userAgent: req?.headers?.['user-agent'] || '',
        status:   'failure',
      }).catch((e) => logger.error('Failed to write audit log: ' + e.message));
      throw Object.assign(new Error('Invalid OTP'), { statusCode: 401 });
    }

    // Fetch fresh user with role
    const fullUser = await userRepository.findByUsername(user.username);
    return this._completeLogin(fullUser, req);
  }

  /**
   * Refresh access token using refresh token
   * [SECURITY FIX] Token rotation: old session deactivated, new session created
   * [RACE CONDITION FIX] In-memory grace cache prevents race condition when two
   * concurrent requests attempt to refresh using the same old token.
   */
  async refreshToken(token) {
    // [RACE CONDITION FIX] Check grace cache first — if this token was recently
    // rotated by a concurrent request, return the new tokens without throwing 401.
    AuthService._startRotationCleanup();
    const cached = AuthService._recentlyRotated.get(token);
    if (cached && cached.expiresAt > Date.now()) {
      logger.debug('Token rotation grace cache hit — concurrent refresh detected');
      return { accessToken: cached.accessToken, refreshToken: cached.newRefreshToken };
    }

    const session = await sessionRepository.findByRefreshToken(token);

    if (!session || !session.isActive) {
      throw Object.assign(new Error('Invalid or expired refresh token'), { statusCode: 401 });
    }

    let payload;
    try {
      payload = jwt.verify(token, appConfig.jwt.refreshSecret);
    } catch {
      await sessionRepository.deactivate(session._id);
      throw Object.assign(new Error('Refresh token expired'), { statusCode: 401 });
    }

    const user = await userRepository.findById(payload.sub, { populate: 'role' });
    if (!user || !user.isActive) {
      await sessionRepository.deactivate(session._id);
      throw Object.assign(new Error('User not found or inactive'), { statusCode: 401 });
    }

    // [ROTATION] Deactivate old session, create new one with fresh refresh token
    await sessionRepository.deactivate(session._id);

    const deviceInfo = session.deviceInfo || {};
    const { accessToken, refreshToken } = this._generateTokens(user);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await sessionRepository.create({
      userId: user._id,
      refreshToken,
      deviceInfo: typeof deviceInfo === 'object' ? deviceInfo : {},
      userAgent: session.userAgent || '',
      ip: session.ip || '',
      expiresAt,
    });

    // [RACE CONDITION FIX] Cache old token for 60s grace period so concurrent
    // requests using the same old token don't fail with 401.
    AuthService._recentlyRotated.set(token, {
      accessToken,
      newRefreshToken: refreshToken,
      expiresAt: Date.now() + 60000,
    });
    // Remove from cache after 60s to free memory.
    // [TEST FIX] unref() agar timer tidak menahan proses/Jest worker tetap hidup.
    const cleanupTimer = setTimeout(() => AuthService._recentlyRotated.delete(token), 60000);
    if (cleanupTimer.unref) cleanupTimer.unref();

    return { accessToken, refreshToken };
  }

  /**
   * Logout — invalidate a session
   */
  async logout(refreshToken) {
    if (!refreshToken) return;
    const session = await sessionRepository.findByRefreshToken(refreshToken);
    if (session) await sessionRepository.deactivate(session._id);
  }

  /**
   * Logout all sessions for a user
   */
  async logoutAll(userId) {
    await sessionRepository.deactivateAll(userId);
    eventBus.publish(EVENTS.USER_LOGGED_OUT, { userId, all: true });
  }

  /**
   * Logout a specific session by ID
   */
  async logoutSession(userId, sessionId) {
    const session = await sessionRepository.findById(sessionId);
    // [FIX] session.userId is a plain string (SQLite), not an object with _id
    if (!session || String(session.userId) !== String(userId)) {
      throw Object.assign(new Error('Session not found'), { statusCode: 404 });
    }
    await sessionRepository.deactivate(sessionId);
  }

  /**
   * Get all active sessions for user
   */
  async getSessions(userId) {
    return sessionRepository.findUserSessions(userId);
  }

  /**
   * Setup 2FA — generate secret and QR code
   */
  async setup2FA(userId) {
    const user = await userRepository.findById(userId);
    const secret = speakeasy.generateSecret({
      name: `${appConfig.appName}:${user.username}`,
      issuer: appConfig.totp.issuer,
    });

    await userRepository.updateById(userId, { twoFactorSecret: secret.base32 });

    const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url);
    return { secret: secret.base32, qrCode: qrCodeUrl };
  }

  /**
   * Enable 2FA after verifying OTP
   */
  async enable2FA(userId, otp) {
    const user = await userRepository.findById(userId, { select: '+twoFactorSecret' });

    const valid = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: otp,
      window: 2,
    });

    if (!valid) throw Object.assign(new Error('Invalid OTP'), { statusCode: 400 });

    await userRepository.updateById(userId, { twoFactorEnabled: true });
    return { message: '2FA enabled successfully' };
  }

  /**
   * Disable 2FA
   */
  async disable2FA(userId, password) {
    const user = await userRepository.findById(userId, { select: '+password' });
    if (!(await user.comparePassword(password))) {
      throw Object.assign(new Error('Invalid password'), { statusCode: 401 });
    }
    await userRepository.updateById(userId, { twoFactorEnabled: false, twoFactorSecret: null });
  }

  // --- Private helpers ---

  _generateTokens(user) {
    const payload = {
      sub: user._id,
    };

    const accessToken = jwt.sign(payload, appConfig.jwt.secret, {
      expiresIn: appConfig.jwt.expiresIn,
    });

    // [TEST FIX] Add `nonce` with millisecond precision to prevent refresh token collisions.
    // JWT `iat` has second resolution — two calls within the same second produce identical
    // tokens for the same user. The `nonce` claim ensures each token is unique.
    const refreshToken = jwt.sign(
      { sub: user._id, nonce: Date.now() },
      appConfig.jwt.refreshSecret,
      { expiresIn: appConfig.jwt.refreshExpiresIn }
    );

    return { accessToken, refreshToken };
  }

  _generateTempToken(userId) {
    return jwt.sign({ sub: userId, type: 'temp_2fa' }, appConfig.appSecret, { expiresIn: '5m' });
  }

  _sanitizeUser(user) {
    const u = user.toObject ? user.toObject() : { ...user };
    delete u.password;
    delete u.twoFactorSecret;
    delete u.apiKey;
    delete u.resetToken;
    return u;
  }
}

const authService = new AuthService();
export default authService;
