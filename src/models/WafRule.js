import mongoose from 'mongoose';

const wafRuleSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['ip', 'country', 'user_agent'],
    required: true
  },
  value: {
    type: String, // IP address, Country Code, or Regex string
    required: true
  },
  action: {
    type: String,
    enum: ['block', 'allow'],
    required: true
  },
  description: {
    type: String
  }
}, {
  timestamps: true
});

export default mongoose.model('WafRule', wafRuleSchema);
