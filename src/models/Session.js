import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  refreshToken: {
    type: String,
    required: true,
    index: true,
  },
  deviceInfo: String,
  userAgent: String,
  ip: String,
  isActive: { type: Boolean, default: true },
  lastActive: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true, index: true },
}, {
  timestamps: true,
});

// Auto-expire
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const Session = mongoose.model('Session', sessionSchema);
export default Session;
