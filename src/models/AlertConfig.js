import mongoose from 'mongoose';

const alertConfigSchema = new mongoose.Schema({
  // Global identifier, we only need one document
  singleton: {
    type: String,
    default: 'global',
    unique: true
  },
  telegram: {
    enabled: { type: Boolean, default: false },
    botToken: { type: String, default: '' },
    chatId: { type: String, default: '' }
  },
  email: {
    enabled: { type: Boolean, default: false },
    smtpHost: { type: String, default: '' },
    smtpPort: { type: Number, default: 587 },
    smtpUser: { type: String, default: '' },
    smtpPass: { type: String, default: '' },
    fromAddress: { type: String, default: '' },
    toAddress: { type: String, default: '' }
  },
  discord: {
    enabled: { type: Boolean, default: false },
    webhookUrl: { type: String, default: '' }
  },
  slack: {
    enabled: { type: Boolean, default: false },
    webhookUrl: { type: String, default: '' }
  },
  webhook: {
    enabled: { type: Boolean, default: false },
    url: { type: String, default: '' }
  },
  thresholds: {
    cpuPercent: { type: Number, default: 90 },
    ramPercent: { type: Number, default: 90 },
    diskPercent: { type: Number, default: 90 }
  }
}, {
  timestamps: true
});

export default mongoose.model('AlertConfig', alertConfigSchema);
