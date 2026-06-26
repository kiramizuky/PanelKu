import BaseRepository from './base.repository.js';
import User from '../models/User.js';

class UserRepository extends BaseRepository {
  constructor() {
    super(User);
  }

  async findByUsername(username, withPassword = false) {
    const select = withPassword ? '+password +twoFactorSecret +apiKey' : undefined;
    return User.findOne({ username: username.toLowerCase() }, select).populate('role');
  }

  async findByEmail(email, withPassword = false) {
    const select = withPassword ? '+password +twoFactorSecret' : undefined;
    return User.findOne({ email: email.toLowerCase() }, select).populate('role');
  }

  async findByApiKey(apiKey) {
    return User.findOne({ apiKey, apiKeyEnabled: true, isActive: true }, '+apiKey').populate('role');
  }

  async findWithRole(filter = {}) {
    return User.find(filter).populate('role').sort({ createdAt: -1 });
  }

  async addSession(userId, sessionData) {
    return User.findByIdAndUpdate(
      userId,
      { $push: { sessions: sessionData } },
      { new: true }
    );
  }

  async removeSession(userId, sessionId) {
    return User.findByIdAndUpdate(
      userId,
      { $pull: { sessions: { _id: sessionId } } },
      { new: true }
    );
  }

  async deactivateAllSessions(userId) {
    return User.findByIdAndUpdate(
      userId,
      { $set: { 'sessions.$[].isActive': false } },
      { new: true }
    );
  }

  async updateLoginStats(userId, ip) {
    return User.findByIdAndUpdate(userId, {
      lastLogin: new Date(),
      lastLoginIp: ip,
      $inc: { loginCount: 1 },
    });
  }
}

const userRepository = new UserRepository();
export default userRepository;
