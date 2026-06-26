import WafRule from '../../models/WafRule.js';
import { refreshWafCache } from '../../middleware/waf.middleware.js';

class WafService {
  async getRules() {
    return WafRule.find().sort({ createdAt: -1 }).lean();
  }

  async addRule(type, value, action, description) {
    // Validate IP if type is IP
    if (type === 'ip' && !/^(\d{1,3}\.){3}\d{1,3}$/.test(value)) {
      throw new Error('Invalid IP address');
    }

    const existing = await WafRule.findOne({ type, value });
    if (existing) throw new Error('Rule already exists for this value');

    const rule = new WafRule({ type, value, action, description });
    await rule.save();
    
    // Refresh the Node.js WAF middleware cache
    await refreshWafCache();

    // In a real scenario, you'd also write to an Nginx blocklist.conf and reload Nginx
    // e.g. `deny ${value};` -> /etc/nginx/conf.d/blocklist.conf
    return rule;
  }

  async deleteRule(id) {
    const rule = await WafRule.findById(id);
    if (!rule) throw new Error('Rule not found');
    
    await rule.deleteOne();
    await refreshWafCache();

    // Remove from Nginx blocklist as well
    return true;
  }
}

export default new WafService();
