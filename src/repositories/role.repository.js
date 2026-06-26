import BaseRepository from './base.repository.js';
import Role from '../models/Role.js';

class RoleRepository extends BaseRepository {
  constructor() {
    super(Role);
  }

  async findBySlug(slug) {
    return Role.findOne({ slug: slug.toLowerCase() });
  }

  async findActive() {
    return Role.find({ isActive: true }).sort({ name: 1 });
  }

  async findWithPermissions(roleId) {
    return Role.findById(roleId);
  }
}

const roleRepository = new RoleRepository();
export default roleRepository;
