import BaseRepository from './base.repository.js';
import Session from '../models/Session.js';

class SessionRepository extends BaseRepository {
  constructor() {
    super(Session);
  }

  async findByRefreshToken(token) {
    return Session.findOne({ refreshToken: token, isActive: true })
      .populate('userId');
  }

  async findUserSessions(userId) {
    return Session.find({ userId, isActive: true }).sort({ lastActive: -1 });
  }

  async deactivate(sessionId) {
    return Session.findByIdAndUpdate(sessionId, { isActive: false });
  }

  async deactivateAll(userId) {
    return Session.updateMany({ userId }, { isActive: false });
  }

  async touch(sessionId) {
    return Session.findByIdAndUpdate(sessionId, { lastActive: new Date() });
  }

  async cleanExpired() {
    return Session.deleteMany({ expiresAt: { $lt: new Date() } });
  }
}

const sessionRepository = new SessionRepository();
export default sessionRepository;
