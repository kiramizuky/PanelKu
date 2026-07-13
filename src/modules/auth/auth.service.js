import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import qrcode from 'qrcode';
import appConfig from '../../config/app.js';
import userRepository from '../../repositories/user.repository.js';
import sessionRepository from '../../repositories/session.repository.js';
import roleRepository from '../../repositories/role.repository.js';
import { generateToken } from '../../helpers/crypto.js';
import { getDeviceInfo } from '../../helpers/system.js';
import eventBus, { EVENTS } from '../../core/events/EventBus.js';
import logger from '../../config/logger.js';
import auditRepository from '../../repositories/audit.repository.js';

class AuthService {
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
   */
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

    return { accessToken, refreshToken, user: this._sanitizeUser(user) };
  }

  /**
   * Verify 2FA OTP and complete login
   */
  async verifyTwoFactor(tempToken, otp, req) {
    let payload;
    try {
      payload = jwt.verify(tempToken, appConfig.appSecret);
    } catch {
      throw Object.assign(new Error('Invalid or expired temp token'), { statusCode: 401 });
    }

    const user = await userRepository.findById(payload.sub, { select: '+twoFactorSecret' });
    if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });

    const valid = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: otp,
      window: 2,
    });

    if (!valid) throw Object.assign(new Error('Invalid OTP'), { statusCode: 401 });

    // Fetch fresh user with role
    const fullUser = await userRepository.findByUsername(user.username);
    return this._completeLogin(fullUser, req);
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshToken(token) {
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
      throw Object.assign(new Error('User not found or inactive'), { statusCode: 401 });
    }

    const { accessToken } = this._generateTokens(user);
    await sessionRepository.touch(session._id);

    return { accessToken };
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
    if (!session || String(session.userId._id) !== String(userId)) {
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
      username: user.username,
      role: user.role?.slug,
    };

    const accessToken = jwt.sign(payload, appConfig.jwt.secret, {
      expiresIn: appConfig.jwt.expiresIn,
    });

    const refreshToken = jwt.sign(
      { sub: user._id },
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
