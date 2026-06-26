import mongoose from 'mongoose';

const permissionEntrySchema = new mongoose.Schema({
  resource: { type: String, required: true },
  actions: [{ type: String, enum: ['read', 'create', 'update', 'delete', 'execute'] }],
}, { _id: false });

const roleSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  description: String,
  permissions: [permissionEntrySchema],
  isSystem: { type: Boolean, default: false }, // system roles can't be deleted
  isActive: { type: Boolean, default: true },
  color: { type: String, default: '#6c757d' },
}, {
  timestamps: true,
});

const Role = mongoose.model('Role', roleSchema);
export default Role;
