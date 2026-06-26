import mongoose from 'mongoose';

const settingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: mongoose.Schema.Types.Mixed,
  type: { type: String, enum: ['string', 'number', 'boolean', 'json', 'secret'], default: 'string' },
  group: { type: String, default: 'general' },
  label: String,
  description: String,
  isPublic: { type: Boolean, default: false }, // expose to frontend without auth
}, {
  timestamps: true,
});

settingSchema.statics.get = async function (key, defaultValue = null) {
  const setting = await this.findOne({ key });
  return setting ? setting.value : defaultValue;
};

settingSchema.statics.set = async function (key, value, group = 'general') {
  return this.findOneAndUpdate(
    { key },
    { value, group },
    { upsert: true, new: true }
  );
};

const Setting = mongoose.model('Setting', settingSchema);
export default Setting;
