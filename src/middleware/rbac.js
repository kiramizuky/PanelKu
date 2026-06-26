import permissionManager from '../core/permissions/PermissionManager.js';
import roleRepository from '../repositories/role.repository.js';
import { forbidden } from '../helpers/response.js';
import logger from '../config/logger.js';

/**
 * RBAC middleware factory.
 * Usage: rbac('dashboard', 'read') or rbac('terminal', 'execute')
 */
export const rbac = (resource, action) => {
  return async (req, res, next) => {
    if (!req.user) return forbidden(res, 'Not authenticated');

    const user = req.user;
    const role = user.role;

    if (!role) return forbidden(res, 'No role assigned');

    // Super admin bypass
    if (role.slug === 'super_admin') return next();

    // Ensure role permissions are loaded in cache
    const roleId = String(role._id);
    if (permissionManager.getPermissions(roleId).length === 0) {
      try {
        const fullRole = await roleRepository.findWithPermissions(roleId);
        if (fullRole) {
          permissionManager.loadRole(roleId, fullRole.permissions || []);
        }
      } catch (err) {
        logger.error('RBAC cache load error:', err);
      }
    }

    const allowed = permissionManager.can(roleId, resource, action);

    if (!allowed) {
      logger.warn(`RBAC denied: user=${user.username} role=${role.slug} resource=${resource} action=${action}`);
      return forbidden(res, `Permission denied: ${resource}:${action}`);
    }

    next();
  };
};

/**
 * Check if user has permission (non-blocking helper for use in controllers).
 */
export const hasPermission = async (user, resource, action) => {
  if (!user?.role) return false;
  if (user.role.slug === 'super_admin') return true;

  const roleId = String(user.role._id || user.role);

  if (permissionManager.getPermissions(roleId).length === 0) {
    const fullRole = await roleRepository.findWithPermissions(roleId);
    if (fullRole) permissionManager.loadRole(roleId, fullRole.permissions || []);
  }

  return permissionManager.can(roleId, resource, action);
};

export const requirePermission = (resource, action) => {
  if (!action && resource.includes(':')) {
    [resource, action] = resource.split(':');
  }
  return rbac(resource, action);
};
