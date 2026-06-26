import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true,
  },
  title: { type: String, required: true },
  message: { type: String, required: true },
  type: {
    type: String,
    enum: ['info', 'success', 'warning', 'error', 'alert'],
    default: 'info',
  },
  icon: String,
  link: String,
  isRead: { type: Boolean, default: false },
  isGlobal: { type: Boolean, default: false }, // broadcast to all users
  metadata: mongoose.Schema.Types.Mixed,
}, {
  timestamps: true,
});

notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });

const Notification = mongoose.model('Notification', notificationSchema);
export default Notification;
