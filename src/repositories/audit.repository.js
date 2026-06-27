import BaseRepository from './base.repository.js';
import AuditLog from '../models/AuditLog.js';

class AuditRepository extends BaseRepository {
  constructor() {
    super(AuditLog);
  }

  async log({ userId, username, action, resource, resourceId, details, ip, userAgent, status = 'success', duration }) {
    return this.create({ userId, username, action, resource, resourceId, details, ip, userAgent, status, duration });
  }

  async getUserActivity(userId, limit = 50) {
    return AuditLog.find({ userId }, { limit });
  }

  async getRecent(limit = 100) {
    return AuditLog.findWithUser({}, limit);
  }
}

const auditRepository = new AuditRepository();
export default auditRepository;
