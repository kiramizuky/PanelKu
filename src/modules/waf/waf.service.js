import WafRule from '../../models/WafRule.js';
import { refreshWafCache } from '../../middleware/waf.middleware.js';

class WafService {
  async getRules() {
    return WafRule.find();
  }

  async addRule(type, value, action, description) {
    if (type === 'ip' && !/^(\d{1,3}\.){3}\d{1,3}$/.test(value)) {
      throw new Error('Invalid IP address');
    }

    const existing = await WafRule.findOne({ type, value });
    if (existing) throw new Error('Rule already exists for this value');

    const rule = await WafRule.create({ type, value, action, description });
    await refreshWafCache();
    return rule;
  }

  async deleteRule(id) {
    const rule = await WafRule.findById(id);
    if (!rule) throw new Error('Rule not found');

    await WafRule.findByIdAndDelete(id);
    await refreshWafCache();
    return true;
  }
}

export default new WafService();
