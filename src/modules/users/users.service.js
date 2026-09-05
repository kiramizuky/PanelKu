import userRepository from '../../repositories/user.repository.js';
import roleRepository from '../../repositories/role.repository.js';
import { generateApiKey } from '../../helpers/crypto.js';
import { isStrongPassword, passwordRequirements } from '../../helpers/validate.js';
import passwordPolicyService from '../../modules/system/password-policy.service.js';
import auditRepository from '../../repositories/audit.repository.js';
import eventBus, { EVENTS } from '../../core/events/EventBus.js';
import bcrypt from 'bcryptjs';
import { getDb } from '../../core/db/sqlite.js';
import sessionRepository from '../../repositories/session.repository.js';
import logger from '../../config/logger.js';

class UsersService {
  /**
   * Helper: enforce password policy using DB config with static fallback.
   * Throws 400 error if password doesn't meet requirements.
   */
  async _enforcePasswordPolicy(password) {
    if (!password) {
      throw Object.assign(new Error('Password is required'), { statusCode: 400 });
    }
    const policyResult = await passwordPolicyService.validatePassword(password).catch(() => null);
    if (policyResult && !policyResult.valid) {
      throw Object.assign(new Error(policyResult.errors.join('. ')), { statusCode: 400 });
    }
    // Fallback: static validation if DB policy load fails
    if (!policyResult && !isStrongPassword(password)) {
      throw Object.assign(new Error(passwordRequirements()), { statusCode: 400 });
    }
  }

  async list(page = 1, limit = 50, search = '') {
    // SQLite doesn't support $or, do filtering manually
    const all = await userRepository.findWithRole({});
    let filtered = all;
    if (search) {
      const q = search.toLowerCase();
      filtered = all.filter(u =>
        (u.username || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q)
      );
    }

    // Prioritize super admin, then sort newest users first
    filtered.sort((a, b) => {
      if (a.isSuperAdmin && !b.isSuperAdmin) return -1;
      if (!a.isSuperAdmin && b.isSuperAdmin) return 1;
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });

    const total = filtered.length;
    page  = parseInt(page);
    limit = parseInt(limit);
    const data = filtered.slice((page - 1) * limit, page * limit);
    return { data, total, page, limit };
  }

  async getById(id) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!row) throw Object.assign(new Error('User not found'), { statusCode: 404 });

    const User = (await import('../../models/User.js')).default;
    const user = await User.findById(id);
    return userRepository._populateRole(user);
  }

  async create(data) {
    // [LOW-1 FIX] Enforce strong password policy on user creation
    if (data.password) {
      await this._enforcePasswordPolicy(data.password);
    }

    const db = getDb();
    const existingUsername = db.prepare('SELECT id FROM users WHERE username = ?').get(data.username?.toLowerCase());
    const existingEmail    = db.prepare('SELECT id FROM users WHERE email = ?').get(data.email?.toLowerCase());
    if (existingUsername || existingEmail) {
      throw Object.assign(new Error('Username or email already exists'), { statusCode: 409 });
    }

    let role = await roleRepository.findBySlug(data.role || 'read_only');
    if (!role) {
      role = await roleRepository.findById(data.role);
    }
    if (!role) throw Object.assign(new Error('Role not found'), { statusCode: 400 });

    const isActive = data.isActive !== undefined 
      ? Boolean(data.isActive) 
      : (data.status !== undefined ? (data.status === 'active') : true);

    // [PASSWORD EXPIRY] Start the expiry clock from creation time
    const user = await userRepository.create({
      ...data,
      isActive,
      role: role._id,
      passwordChangedAt: new Date().toISOString()
    });
    eventBus.publish(EVENTS.USER_CREATED, { userId: user._id, username: user.username });
    return userRepository._populateRole(user);
  }

  async update(id, data) {
    const { password, role: roleName, status, username, ...rest } = data;
    const db = getDb();

    const user = await userRepository.findById(id);
    if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });

    if (username && username.trim()) {
      const lowerUsername = username.trim().toLowerCase();
      const existing = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(lowerUsername, id);
      if (existing) {
        throw Object.assign(new Error('Username is already taken by another user'), { statusCode: 409 });
      }
      rest.username = lowerUsername;
    }

    if (data.email && data.email.trim()) {
      const lowerEmail = data.email.trim().toLowerCase();
      const existing = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(lowerEmail, id);
      if (existing) {
        throw Object.assign(new Error('Email is already taken by another user'), { statusCode: 409 });
      }
      rest.email = lowerEmail;
    }

    // [LOW-1 FIX] Enforce strong password policy on password update
    if (password && String(password).trim()) {
      await this._enforcePasswordPolicy(String(password).trim());
      rest.password = await bcrypt.hash(String(password).trim(), 10);
      // [LOW-2 FIX] Clear mustChangePassword flag when user voluntarily changes their password
      // [PASSWORD EXPIRY] Reset password_changed_at so the 90-day expiry clock starts fresh
      rest.mustChangePassword = false;
      rest.passwordChangedAt = new Date().toISOString();

      // [AUDIT] Log admin-initiated password reset
      // This runs async — non-blocking so it doesn't slow down the response
      auditRepository.log({
        userId:     id,
        username:   user.username,
        action:     'PASSWORD_RESET_BY_ADMIN',
        resource:   'users',
        resourceId: id,
        details:    `Password was reset by another user (admin/manager)`,
        ip:         '',
        userAgent:  '',
        status:     'success',
      }).catch((e) => logger.error('Failed to write audit log: ' + e.message));
    }

    if (roleName) {
      let role = await roleRepository.findBySlug(roleName);
      if (!role) {
        role = await roleRepository.findById(roleName);
      }
      if (role) rest.role = role._id;
    }

    if (status !== undefined) {
      const newActive = status === 'active';
      if (user.isActive && !newActive) {
        const activeUsers = db.prepare('SELECT COUNT(*) as count FROM users WHERE is_active = 1').get().count;
        if (activeUsers <= 1) {
          throw Object.assign(new Error('Cannot deactivate the only active account in the system'), { statusCode: 400 });
        }

        if (user.isSuperAdmin) {
          const activeSuperAdmins = db.prepare('SELECT COUNT(*) as count FROM users WHERE is_super_admin = 1 AND is_active = 1').get().count;
          if (activeSuperAdmins <= 1) {
            throw Object.assign(new Error('Cannot deactivate the only active super admin account'), { statusCode: 400 });
          }
        }
      }
      rest.isActive = newActive;
    }

    // [SECURITY] If deactivating user, invalidate all their sessions
    if (rest.isActive === false) {
      try {
        await sessionRepository.deactivateAll(id);
      } catch (e) {
        logger.error('Failed to deactivate sessions for user ' + id + ': ' + e.message);
      }
    }

    const updatedUser = await userRepository.updateById(id, rest);
    if (!updatedUser) throw Object.assign(new Error('User not found'), { statusCode: 404 });

    eventBus.publish(EVENTS.USER_UPDATED, { userId: id });
    return userRepository._populateRole(updatedUser);
  }

  async changePassword(id, currentPassword, newPassword) {
    // [LOW-1 FIX] Enforce strong password policy using dynamic config
    await this._enforcePasswordPolicy(newPassword);

    const db = getDb();
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!row) throw Object.assign(new Error('User not found'), { statusCode: 404 });

    // [AUDIT] Log failed password change attempt (wrong current password)
    const valid = await bcrypt.compare(currentPassword, row.password);
    if (!valid) {
      auditRepository.log({
        userId:     id,
        username:   row.username,
        action:     'PASSWORD_CHANGE_FAILED',
        resource:   'users',
        resourceId: id,
        details:    'Failed password change attempt — incorrect current password',
        ip:         '',
        userAgent:  '',
        status:     'failure',
      }).catch((e) => logger.error('Failed to write audit log: ' + e.message));
      throw Object.assign(new Error('Current password is incorrect'), { statusCode: 400 });
    }

    const hashed = await bcrypt.hash(newPassword, 12);
    // [LOW-2 FIX] Clear mustChangePassword flag and record password change timestamp
    db.prepare('UPDATE users SET password = ?, must_change_password = 0, password_changed_at = ?, updated_at = ? WHERE id = ?').run(
      hashed, new Date().toISOString(), new Date().toISOString(), id
    );

    // [SECURITY] Invalidate all sessions so attacker can't use stolen refresh tokens
    try {
      await sessionRepository.deactivateAll(id);
    } catch (e) {
      logger.error('Failed to deactivate sessions after password change: ' + e.message);
    }
  }

  async delete(id, requestingUserId) {
    if (String(id) === String(requestingUserId)) {
      throw Object.assign(new Error('Cannot delete your own account'), { statusCode: 400 });
    }
    const db = getDb();
    
    // Check total accounts count
    const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    if (totalUsers <= 1) {
      throw Object.assign(new Error('Cannot delete the only account in the system'), { statusCode: 400 });
    }

    const user = await userRepository.findById(id);
    if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });

    if (user.isSuperAdmin) {
      const activeSuperAdmins = db.prepare('SELECT COUNT(*) as count FROM users WHERE is_super_admin = 1 AND is_active = 1').get().count;
      if (activeSuperAdmins <= 1 && user.isActive) {
        throw Object.assign(new Error('Cannot delete the only active super admin account'), { statusCode: 400 });
      }
    }

    await userRepository.deleteById(id);
    eventBus.publish(EVENTS.USER_DELETED, { userId: id });
  }

  async toggleStatus(id) {
    const user = await userRepository.findById(id);
    if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });

    const db = getDb();
    const newActive = !user.isActive;

    if (!newActive) {
      const activeUsers = db.prepare('SELECT COUNT(*) as count FROM users WHERE is_active = 1').get().count;
      if (activeUsers <= 1) {
        throw Object.assign(new Error('Cannot deactivate the only active account in the system'), { statusCode: 400 });
      }

      if (user.isSuperAdmin) {
        const activeSuperAdmins = db.prepare('SELECT COUNT(*) as count FROM users WHERE is_super_admin = 1 AND is_active = 1').get().count;
        if (activeSuperAdmins <= 1) {
          throw Object.assign(new Error('Cannot deactivate the only active super admin account'), { statusCode: 400 });
        }
      }
    }

    const updatedUser = await userRepository.updateById(id, { isActive: newActive });

    // [SECURITY] If deactivating user, invalidate all their sessions
    if (!newActive && updatedUser) {
      try {
        await sessionRepository.deactivateAll(id);
      } catch (e) {
        logger.error('Failed to deactivate sessions for user ' + id + ': ' + e.message);
      }
    }

    return updatedUser;
  }

  async regenerateApiKey(userId) {
    const apiKey = generateApiKey();
    await userRepository.updateById(userId, { apiKey, apiKeyEnabled: true });
    return apiKey;
  }

  async revokeApiKey(userId) {
    await userRepository.updateById(userId, { apiKeyEnabled: false });
  }
}

const usersService = new UsersService();
export default usersService;
