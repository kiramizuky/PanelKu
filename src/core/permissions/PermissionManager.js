import { ACTIONS } from '../../config/constants.js';
import logger from '../../config/logger.js';

/**
 * Dynamic RBAC Permission Manager.
 * Loads permissions from DB and caches them for fast resolution.
 */
class PermissionManager {
  constructor() {
    this._cache = new Map(); // roleId -> Set of "resource:action"
    this._superAdminBypass = true;
  }

  /**
   * Load permissions for a role into cache.
   * @param {string} roleId
   * @param {Array} permissions - [{resource, actions:[]}]
   */
  loadRole(roleId, permissions) {
    const set = new Set();
    for (const { resource, actions } of permissions) {
      for (const action of actions) {
        set.add(`${resource}:${action}`);
      }
    }
    this._cache.set(String(roleId), set);
    logger.debug(`PermissionManager: loaded ${set.size} permissions for role ${roleId}`);
  }

  /**
   * Check if a role has a specific permission.
   * @param {string} roleId
   * @param {string} resource
   * @param {string} action
   */
  can(roleId, resource, action) {
    const perms = this._cache.get(String(roleId));
    if (!perms) return false;
    return perms.has(`${resource}:${action}`) || perms.has(`${resource}:*`);
  }

  /**
   * Check permission for a user object (with populated role).
   * Super admin bypasses all checks.
   */
  userCan(user, resource, action) {
    if (!user || !user.role) return false;

    // Super admin bypass
    if (this._superAdminBypass && user.role.slug === 'super_admin') return true;

    return this.can(String(user.role._id || user.role), resource, action);
  }

  /**
   * Grant a permission to a cached role (in-memory only, persist separately).
   */
  grant(roleId, resource, action) {
    const set = this._cache.get(String(roleId)) || new Set();
    set.add(`${resource}:${action}`);
    this._cache.set(String(roleId), set);
  }

  /**
   * Revoke a permission from a cached role.
   */
  revoke(roleId, resource, action) {
    const set = this._cache.get(String(roleId));
    if (set) set.delete(`${resource}:${action}`);
  }

  /**
   * Invalidate cache for a role (force reload from DB on next request).
   */
  invalidate(roleId) {
    this._cache.delete(String(roleId));
    logger.debug(`PermissionManager: invalidated cache for role ${roleId}`);
  }

  /**
   * Invalidate all cached roles.
   */
  invalidateAll() {
    this._cache.clear();
    logger.info('PermissionManager: all caches invalidated');
  }

  /**
   * Get all cached permissions for a role.
   */
  getPermissions(roleId) {
    const set = this._cache.get(String(roleId));
    return set ? [...set] : [];
  }
}

const permissionManager = new PermissionManager();
export default permissionManager;
