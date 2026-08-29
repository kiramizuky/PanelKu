/**
 * Passkey / WebAuthn Service (FIDO2)
 * Handles hardware token, biometrics (Touch ID, Face ID, Windows Hello), and YubiKey ceremonies.
 */
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { getDb, generateId, now, toJson, fromJson } from '../../core/db/sqlite.js';
import userRepository from '../../repositories/user.repository.js';
import authService from './auth.service.js';
import logger from '../../config/logger.js';
import auditRepository from '../../repositories/audit.repository.js';
import { getDeviceInfo } from '../../helpers/system.js';

class PasskeyService {
  constructor() {
    // In-memory challenge store with auto cleanup
    this._challenges = new Map();
    setInterval(() => this._cleanupChallenges(), 60000).unref?.();
  }

  _cleanupChallenges() {
    const curr = Date.now();
    for (const [key, val] of this._challenges.entries()) {
      if (val.expiresAt <= curr) {
        this._challenges.delete(key);
      }
    }
  }

  _getRpID(req) {
    const host = req?.hostname || 'localhost';
    // Remove port if present
    return host.split(':')[0];
  }

  _getOrigin(req) {
    const proto = req?.headers?.['x-forwarded-proto'] || req?.protocol || 'http';
    const host = req?.get('host') || `${req?.hostname || 'localhost'}:3000`;
    return `${proto}://${host}`;
  }

  /**
   * 1. Generate Registration Options
   */
  async getRegistrationOptions(userId, req) {
    const user = await userRepository.findById(userId);
    if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });

    const db = getDb();
    const existing = db.prepare('SELECT credential_id, transports FROM passkeys WHERE user_id = ?').all(userId);

    const rpID = this._getRpID(req);
    const excludeCredentials = existing.map(k => ({
      id: k.credential_id,
      transports: fromJson(k.transports, []),
    }));

    const options = await generateRegistrationOptions({
      rpName: 'Panelku Server Control',
      rpID,
      userID: new TextEncoder().encode(user._id),
      userName: user.username,
      userDisplayName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username,
      attestationType: 'none',
      excludeCredentials,
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    // Save challenge
    this._challenges.set(`reg_${userId}`, {
      challenge: options.challenge,
      rpID,
      expiresAt: Date.now() + 300000, // 5 min
    });

    return options;
  }

  /**
   * 2. Verify Registration Response
   */
  async verifyRegistration(userId, body, deviceName = null, req) {
    const user = await userRepository.findById(userId);
    if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });

    const challengeData = this._challenges.get(`reg_${userId}`);
    if (!challengeData) {
      throw Object.assign(new Error('Registration challenge expired or invalid. Please try again.'), { statusCode: 400 });
    }
    this._challenges.delete(`reg_${userId}`);

    const origin = this._getOrigin(req);
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body,
        expectedChallenge: challengeData.challenge,
        expectedOrigin: origin,
        expectedRPID: challengeData.rpID,
      });
    } catch (err) {
      logger.warn(`[WebAuthn] Registration verification failed: ${err.message}`);
      throw Object.assign(new Error(`Passkey verification failed: ${err.message}`), { statusCode: 400 });
    }

    if (!verification.verified || !verification.registrationInfo) {
      throw Object.assign(new Error('Passkey verification could not be completed'), { statusCode: 400 });
    }

    const { credential, aaguid } = verification.registrationInfo;
    const db = getDb();

    const passkeyId = generateId();
    const credId = credential.id;
    // SimpleWebAuthn v13: credential.publicKey is a Uint8Array
    const publicKeyBase64 = Buffer.from(credential.publicKey).toString('base64');
    const transports = toJson(body.response?.transports || ['internal']);

    const finalDeviceName = deviceName?.trim() || req?.headers?.['user-agent']?.substring(0, 50) || 'Passkey Device';

    db.prepare(`
      INSERT INTO passkeys (id, user_id, credential_id, public_key, counter, device_name, transports, aaguid, created_at, last_used_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      passkeyId,
      userId,
      credId,
      publicKeyBase64,
      credential.counter || 0,
      finalDeviceName,
      transports,
      aaguid || null,
      now(),
      now()
    );

    auditRepository.log({
      userId: user._id,
      username: user.username,
      action: 'PASSKEY_REGISTERED',
      resource: 'auth',
      resourceId: passkeyId,
      details: `Registered passkey device: ${finalDeviceName}`,
      ip: req?.ip,
      userAgent: req?.headers?.['user-agent'],
      status: 'success',
    }).catch(() => {});

    return {
      success: true,
      passkey: {
        id: passkeyId,
        deviceName: finalDeviceName,
        createdAt: now(),
      },
    };
  }

  /**
   * 3. Generate Authentication Options (Discoverable Passkeys / 1-Click Login)
   */
  async getAuthenticationOptions(username = null, req) {
    const rpID = this._getRpID(req);
    let allowCredentials = undefined;

    if (username) {
      const user = await userRepository.findByUsername(username);
      if (user) {
        const db = getDb();
        const existing = db.prepare('SELECT credential_id, transports FROM passkeys WHERE user_id = ?').all(user._id);
        if (existing.length > 0) {
          allowCredentials = existing.map(k => ({
            id: k.credential_id,
            transports: fromJson(k.transports, []),
          }));
        }
      }
    }

    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials,
      userVerification: 'preferred',
    });

    const challengeKey = `auth_${options.challenge}`;
    this._challenges.set(challengeKey, {
      challenge: options.challenge,
      rpID,
      expiresAt: Date.now() + 300000, // 5 min
    });

    return { options, challengeKey };
  }

  /**
   * 4. Verify Authentication Response and Complete Login
   */
  async verifyAuthentication(body, challengeKey, req) {
    const challengeData = this._challenges.get(challengeKey);
    if (!challengeData) {
      throw Object.assign(new Error('Authentication challenge expired or invalid. Please try again.'), { statusCode: 400 });
    }
    this._challenges.delete(challengeKey);

    const credId = body.id;
    if (!credId) {
      throw Object.assign(new Error('Missing credential identifier'), { statusCode: 400 });
    }

    const db = getDb();
    const passkey = db.prepare('SELECT * FROM passkeys WHERE credential_id = ?').get(credId);
    if (!passkey) {
      throw Object.assign(new Error('Passkey credential not recognized on this server'), { statusCode: 401 });
    }

    const user = await userRepository.findById(passkey.user_id);
    if (!user || !user.isActive) {
      throw Object.assign(new Error('Account is disabled or does not exist'), { statusCode: 403 });
    }

    const origin = this._getOrigin(req);
    const pubKeyUint8 = new Uint8Array(Buffer.from(passkey.public_key, 'base64'));

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: body,
        expectedChallenge: challengeData.challenge,
        expectedOrigin: origin,
        expectedRPID: challengeData.rpID,
        credential: {
          id: passkey.credential_id,
          publicKey: pubKeyUint8,
          counter: passkey.counter || 0,
          transports: fromJson(passkey.transports, []),
        },
      });
    } catch (err) {
      logger.warn(`[WebAuthn] Auth verification error: ${err.message}`);
      throw Object.assign(new Error(`Passkey authentication failed: ${err.message}`), { statusCode: 401 });
    }

    if (!verification.verified || !verification.authenticationInfo) {
      throw Object.assign(new Error('Passkey authentication could not be verified'), { statusCode: 401 });
    }

    // Update counter & last_used_at
    const newCounter = verification.authenticationInfo.newCounter || 0;
    db.prepare('UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?').run(newCounter, now(), passkey.id);

    // Audit success
    const deviceInfo = getDeviceInfo(req);
    auditRepository.log({
      userId: user._id,
      username: user.username,
      action: 'LOGIN_PASSKEY',
      resource: 'auth',
      resourceId: passkey.id,
      details: `Logged in via Passkey: ${passkey.device_name || 'Hardware Key'}`,
      ip: deviceInfo?.ip || req?.ip,
      userAgent: req?.headers?.['user-agent'],
      status: 'success',
    }).catch(() => {});

    // Complete login session and issue JWT tokens
    const loginResult = await authService._completeLogin(user, req);
    return loginResult;
  }

  /**
   * List passkeys for user
   */
  async listPasskeys(userId) {
    const db = getDb();
    const rows = db.prepare('SELECT id, credential_id, device_name, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at DESC').all(userId);
    return rows.map(r => ({
      id: r.id,
      credentialId: r.credential_id,
      deviceName: r.device_name || 'Passkey Device',
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
    }));
  }

  /**
   * Delete passkey
   */
  async deletePasskey(userId, passkeyId) {
    const db = getDb();
    const res = db.prepare('DELETE FROM passkeys WHERE id = ? AND user_id = ?').run(passkeyId, userId);
    if (res.changes === 0) {
      throw Object.assign(new Error('Passkey not found'), { statusCode: 404 });
    }
    return { success: true };
  }
}

export default new PasskeyService();
