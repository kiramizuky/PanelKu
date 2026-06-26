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
    return AuditLog.find({ userId }).sort({ createdAt: -1 }).limit(limit);
  }

  async getRecent(limit = 100) {
    return AuditLog.find().sort({ createdAt: -1 }).limit(limit).populate('userId', 'username');
  }
}

const auditRepository = new AuditRepository();
export default auditRepository;
