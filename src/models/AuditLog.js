import mongoose from 'mongoose';

const auditSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true,
  },
  username: String,
  action: { type: String, required: true },
  resource: String,
  resourceId: String,
  details: mongoose.Schema.Types.Mixed,
  ip: String,
  userAgent: String,
  status: { type: String, enum: ['success', 'failure', 'warning'], default: 'success' },
  duration: Number, // ms
}, {
  timestamps: { createdAt: true, updatedAt: false },
});

auditSchema.index({ createdAt: -1 });
auditSchema.index({ userId: 1, createdAt: -1 });
auditSchema.index({ action: 1 });

const AuditLog = mongoose.model('AuditLog', auditSchema);
export default AuditLog;
