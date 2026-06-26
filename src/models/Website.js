import mongoose from 'mongoose';

const websiteSchema = new mongoose.Schema({
  domain: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  aliases: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  type: {
    type: String,
    enum: ['static', 'node', 'php', 'proxy'],
    default: 'static'
  },
  rootDirectory: {
    type: String,
    required: true
  },
  gitRepo: {
    type: String,
    default: ''
  },
  webhookToken: {
    type: String,
    default: ''
  },
  autoDeploy: {
    type: Boolean,
    default: false
  },
  phpVersion: {
    type: String,
    default: '8.2'
  },
  port: {
    // Port to proxy to for node/proxy types
    type: Number,
    default: null
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'error'],
    default: 'active'
  },
  ssl: {
    enabled: { type: Boolean, default: false },
    provider: { type: String, enum: ['letsencrypt', 'zerossl', 'custom', 'none'], default: 'none' },
    certificate: String,
    privateKey: String,
    expiresAt: Date
  },
  settings: {
    forceHttps: { type: Boolean, default: false },
    http2: { type: Boolean, default: true },
    compression: { type: Boolean, default: true }
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

export default mongoose.model('Website', websiteSchema);
