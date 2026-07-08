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

  async getFail2BanLogs() {
    const isWindows = process.platform === 'win32';
    if (isWindows) {
      return [
        "2026-07-08 21:05:12,342 fail2ban.actions [123]: WARNING [sshd] Ban 192.168.1.150",
        "2026-07-08 21:12:45,901 fail2ban.actions [123]: WARNING [sshd] Unban 192.168.1.150",
        "2026-07-08 22:30:19,234 fail2ban.actions [123]: WARNING [sshd] Ban 203.0.113.88",
        "2026-07-08 22:45:00,111 fail2ban.actions [123]: WARNING [nginx-http-auth] Ban 198.51.100.4"
      ];
    }

    try {
      const fs = (await import('fs/promises')).default;
      const content = await fs.readFile('/var/log/fail2ban.log', 'utf8');
      const lines = content.split('\n')
        .map(line => line.trim())
        .filter(line => line.includes('Ban') || line.includes('Unban') || line.includes('WARNING') || line.includes('Found'));
      return lines.slice(-20).reverse(); // Last 20 relevant lines
    } catch (_) {
      return ["Fail2Ban log file not found or unreadable. Ensure Fail2Ban is installed and active."];
    }
  }
}

export default new WafService();
