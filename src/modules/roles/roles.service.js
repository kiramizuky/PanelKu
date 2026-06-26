import roleRepository from '../../repositories/role.repository.js';
import permissionManager from '../../core/permissions/PermissionManager.js';
import { toSlug } from '../../helpers/validate.js';
import { RESOURCES } from '../../config/constants.js';

class RolesService {
  async list() {
    return roleRepository.findActive();
  }

  async getById(id) {
    const role = await roleRepository.findById(id);
    if (!role) throw Object.assign(new Error('Role not found'), { statusCode: 404 });
    return role;
  }

  async create(data) {
    const slug = toSlug(data.name);
    const existing = await roleRepository.findBySlug(slug);
    if (existing) throw Object.assign(new Error('Role already exists'), { statusCode: 409 });

    return roleRepository.create({ ...data, slug });
  }

  async update(id, data) {
    const role = await roleRepository.findById(id);
    if (!role) throw Object.assign(new Error('Role not found'), { statusCode: 404 });
    if (role.isSystem && data.slug) throw Object.assign(new Error('Cannot change system role slug'), { statusCode: 403 });

    const updated = await roleRepository.updateById(id, data);

    // Invalidate permission cache for this role
    permissionManager.invalidate(id);

    return updated;
  }

  async updatePermissions(id, permissions) {
    const role = await roleRepository.findById(id);
    if (!role) throw Object.assign(new Error('Role not found'), { statusCode: 404 });

    const updated = await roleRepository.updateById(id, { permissions });

    // Reload cache
    permissionManager.loadRole(id, permissions);

    return updated;
  }

  async delete(id) {
    const role = await roleRepository.findById(id);
    if (!role) throw Object.assign(new Error('Role not found'), { statusCode: 404 });
    if (role.isSystem) throw Object.assign(new Error('Cannot delete system role'), { statusCode: 403 });

    await roleRepository.deleteById(id);
    permissionManager.invalidate(id);
  }

  /**
   * Return all available resources and actions for permission building.
   */
  getAvailableResources() {
    return Object.entries(RESOURCES).map(([key, value]) => ({
      key,
      resource: value,
    }));
  }
}

const rolesService = new RolesService();
export default rolesService;
