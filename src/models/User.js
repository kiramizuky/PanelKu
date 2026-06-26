import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const sessionSchema = new mongoose.Schema({
  deviceInfo: String,
  ip: String,
  userAgent: String,
  lastActive: { type: Date, default: Date.now },
  token: String,
  isActive: { type: Boolean, default: true },
}, { _id: true });

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    minlength: 3,
    maxlength: 30,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
  },
  password: {
    type: String,
    required: true,
    select: false,
  },
  role: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Role',
    required: true,
  },
  firstName: { type: String, trim: true },
  lastName: { type: String, trim: true },
  avatar: String,

  // 2FA
  twoFactorEnabled: { type: Boolean, default: false },
  twoFactorSecret: { type: String, select: false },

  // API Key
  apiKey: { type: String, select: false },
  apiKeyEnabled: { type: Boolean, default: false },

  // Status
  isActive: { type: Boolean, default: true },
  isSuperAdmin: { type: Boolean, default: false },

  // Sessions
  sessions: [sessionSchema],

  // Login history
  lastLogin: Date,
  lastLoginIp: String,
  loginCount: { type: Number, default: 0 },

  // Password reset
  resetToken: { type: String, select: false },
  resetTokenExpiry: { type: Date, select: false },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Virtual: fullName
userSchema.virtual('fullName').get(function () {
  if (this.firstName && this.lastName) return `${this.firstName} ${this.lastName}`;
  return this.username;
});

// Hash password before save
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare password
userSchema.methods.comparePassword = async function (plain) {
  return bcrypt.compare(plain, this.password);
};

// Remove expired/inactive sessions
userSchema.methods.cleanSessions = function () {
  this.sessions = this.sessions.filter((s) => s.isActive);
};

const User = mongoose.model('User', userSchema);
export default User;
