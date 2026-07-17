import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

class MailService {
  /**
   * Validate an email address format.
   */
  _validateEmail(email) {
    if (!email || !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)) {
      throw new Error(`Invalid email address: "${email}"`);
    }
    return email;
  }

  /**
   * Validate a domain name.
   */
  _validateDomain(domain) {
    if (!domain || !/^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(domain)) {
      throw new Error(`Invalid domain: "${domain}"`);
    }
    return domain;
  }

  /**
   * Validate a local-part (username) for email.
   */
  _validateLocalPart(name) {
    if (!name || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(name)) {
      throw new Error(`Invalid email local part: "${name}"`);
    }
    return name;
  }

  // ── Install / Status ──────────────────────────────────────

  async getStatus() {
    const services = {};
    for (const svc of ['postfix', 'dovecot', 'spamassassin', 'roundcube']) {
      try {
        const { stdout } = await execAsync(`systemctl is-active ${svc} 2>/dev/null || echo "inactive"`);
        services[svc] = stdout.trim() === 'active';
      } catch { services[svc] = false; }
    }
    try {
      const { stdout } = await execAsync('command -v postfix 2>/dev/null && echo "yes" || echo "no"');
      services.installed = stdout.trim() === 'yes';
    } catch { services.installed = false; }

    // Get mail queue size
    try {
      const { stdout } = await execAsync('mailq 2>/dev/null | tail -1');
      const match = stdout.match(/(\d+)\s+request/);
      services.queueSize = match ? parseInt(match[1]) : 0;
    } catch { services.queueSize = 0; }

    // Get Postfix version
    try {
      const { stdout } = await execAsync('postconf mail_version 2>/dev/null || postfix --version 2>/dev/null | head -1');
      services.version = stdout.trim() || null;
    } catch { services.version = null; }

    return services;
  }

  async install() {
    try {
      const { stdout } = await execAsync('sudo apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y postfix postfix-mysql dovecot-core dovecot-imapd dovecot-pop3d dovecot-mysql spamassassin roundcube roundcube-mysql 2>&1 | tail -5');
      await execAsync('sudo systemctl enable postfix dovecot spamassassin 2>/dev/null').catch(() => {});
      await execAsync('sudo systemctl start postfix dovecot 2>/dev/null').catch(() => {});
      return { success: true, log: stdout.trim() };
    } catch (err) {
      throw new Error('Mail server install failed: ' + err.message);
    }
  }

  async uninstall() {
    try {
      const { stdout } = await execAsync('sudo DEBIAN_FRONTEND=noninteractive apt-get remove -y postfix dovecot-core spamassassin roundcube 2>&1 | tail -3');
      return { success: true, log: stdout.trim() };
    } catch (err) {
      throw new Error('Uninstall failed: ' + err.message);
    }
  }

  // ── Service Control ───────────────────────────────────────

  async controlService(service, action) {
    const validSvc = ['postfix', 'dovecot', 'spamassassin'];
    if (!validSvc.includes(service)) throw new Error('Invalid service name');
    if (!['start', 'stop', 'restart', 'reload'].includes(action)) throw new Error('Invalid action');

    try {
      const { stdout } = await execAsync(`sudo systemctl ${action} ${service} 2>&1`);
      return { success: true, output: stdout.trim() };
    } catch (err) {
      throw new Error(`Failed to ${action} ${service}: ${err.message}`);
    }
  }

  // ── Email Accounts (virtual mail users) ───────────────────

  async getAccounts() {
    try {
      // Read virtual mailbox map
      const { stdout } = await execAsync('sudo cat /etc/postfix/virtual_mailbox 2>/dev/null || echo ""');
      const accounts = [];
      const lines = stdout.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
      for (const line of lines) {
        const parts = line.split(/\s+/);
        if (parts.length >= 2) {
          accounts.push({ email: parts[0], mailbox: parts[1] });
        }
      }
      return accounts;
    } catch { return []; }
  }

  async addAccount(email, password) {
    this._validateEmail(email);
    if (!password || password.length < 6) throw new Error('Password must be at least 6 characters');

    try {
      // Add to virtual mailbox map
      const localPart = email.split('@')[0];
      const domain = email.split('@')[1];
      const mailboxPath = `/var/mail/vhosts/${domain}/${localPart}/`;

      await execAsync(`sudo mkdir -p ${mailboxPath} 2>/dev/null`);
      await execAsync(`echo "${email} ${mailboxPath}" | sudo tee -a /etc/postfix/virtual_mailbox 2>/dev/null`);

      // Create dovecot user
      const { stdout: hash } = await execAsync(`sudo doveadm pw -s SHA512-CRYPT -p '${password.replace(/'/g, "'\\''")}' 2>/dev/null`);
      const userLine = `${email}:${hash.trim()}:5000:5000::${mailboxPath}::`;
      await execAsync(`echo "${userLine}" | sudo tee -a /etc/dovecot/users 2>/dev/null`);

      // Apply ownership
      await execAsync(`sudo chown -R 5000:5000 ${mailboxPath} 2>/dev/null`);

      // Reload maps
      await execAsync('sudo postmap /etc/postfix/virtual_mailbox 2>/dev/null');
      await execAsync('sudo systemctl reload postfix dovecot 2>/dev/null');

      return { success: true, email };
    } catch (err) {
      throw new Error('Failed to add email account: ' + err.message);
    }
  }

  async deleteAccount(email) {
    this._validateEmail(email);

    try {
      // Remove from virtual mailbox
      const { stdout } = await execAsync(`sudo sed -i "/^${email.replace(/\./g, '\\.')} /d" /etc/postfix/virtual_mailbox 2>/dev/null`);
      // Remove from dovecot users
      await execAsync(`sudo sed -i "/^${email.replace(/\./g, '\\.')}:/d" /etc/dovecot/users 2>/dev/null`);
      // Reload
      await execAsync('sudo postmap /etc/postfix/virtual_mailbox 2>/dev/null');
      await execAsync('sudo systemctl reload postfix dovecot 2>/dev/null');
      return { success: true, email };
    } catch (err) {
      throw new Error('Failed to delete account: ' + err.message);
    }
  }

  async updatePassword(email, newPassword) {
    this._validateEmail(email);
    if (!newPassword || newPassword.length < 6) throw new Error('Password must be at least 6 characters');

    try {
      const { stdout: hash } = await execAsync(`sudo doveadm pw -s SHA512-CRYPT -p '${newPassword.replace(/'/g, "'\\''")}' 2>/dev/null`);
      const userLine = hash.trim();
      await execAsync(`sudo sed -i "s/^${email.replace(/\./g, '\\.')}:.*/${email.replace(/\./g, '\\.')}:${userLine.replace(/\$/g, '\\$')}/" /etc/dovecot/users 2>/dev/null`);
      return { success: true, email };
    } catch (err) {
      throw new Error('Failed to update password: ' + err.message);
    }
  }

  // ── Domains ───────────────────────────────────────────────

  async getDomains() {
    try {
      const { stdout } = await execAsync('sudo postconf mydestination 2>/dev/null || echo ""');
      const domains = stdout.replace('mydestination = ', '').trim().split(/\s+/);
      return domains.filter(d => d && !d.startsWith('$') && d !== 'localhost' && !d.includes('localhost'));
    } catch { return []; }
  }

  async addDomain(domain) {
    this._validateDomain(domain);
    try {
      await execAsync(`sudo mkdir -p /var/mail/vhosts/${domain} 2>/dev/null`);
      // Add to postfix virtual domains
      const { stdout: current } = await execAsync('sudo postconf virtual_mailbox_domains 2>/dev/null || echo ""');
      let domains = current.replace('virtual_mailbox_domains = ', '').trim();
      if (!domains.includes(domain)) {
        domains = domains ? `${domains} ${domain}` : domain;
        await execAsync(`sudo postconf -e "virtual_mailbox_domains=${domains}" 2>/dev/null`);
      }
      await execAsync('sudo systemctl reload postfix 2>/dev/null');
      return { success: true, domain };
    } catch (err) {
      throw new Error('Failed to add domain: ' + err.message);
    }
  }

  async removeDomain(domain) {
    this._validateDomain(domain);
    try {
      const { stdout: current } = await execAsync('sudo postconf virtual_mailbox_domains 2>/dev/null || echo ""');
      let domains = current.replace('virtual_mailbox_domains = ', '').trim();
      domains = domains.split(/\s+/).filter(d => d !== domain).join(' ');
      await execAsync(`sudo postconf -e "virtual_mailbox_domains=${domains}" 2>/dev/null`);
      await execAsync('sudo systemctl reload postfix 2>/dev/null');
      return { success: true, domain };
    } catch (err) {
      throw new Error('Failed to remove domain: ' + err.message);
    }
  }

  // ── Mail Queue ────────────────────────────────────────────

  async getQueue() {
    try {
      const { stdout } = await execAsync('mailq 2>/dev/null || echo "Mail queue is empty"');
      const lines = stdout.split('\n').filter(l => l.trim());
      const queue = [];
      let current = null;

      for (const line of lines) {
        if (/^[A-F0-9]{10,}/.test(line.trim())) {
          if (current) queue.push(current);
          current = { id: line.trim().split(/\s+/)[0], status: 'queued', lines: [line] };
        } else if (current) {
          current.lines.push(line);
        }
      }
      if (current) queue.push(current);

      return { queue, total: queue.length, raw: stdout };
    } catch { return { queue: [], total: 0, raw: '' }; }
  }

  async flushQueue() {
    try {
      await execAsync('sudo postfix flush 2>/dev/null');
      return { success: true };
    } catch (err) {
      throw new Error('Failed to flush queue: ' + err.message);
    }
  }

  async deleteFromQueue(queueId) {
    if (!/^[A-F0-9]{10,}$/.test(queueId)) throw new Error('Invalid queue ID');
    try {
      await execAsync(`sudo postsuper -d ${queueId} 2>/dev/null`);
      return { success: true };
    } catch (err) {
      throw new Error('Failed to delete from queue: ' + err.message);
    }
  }

  // ── SpamAssassin ──────────────────────────────────────────

  async getSpamConfig() {
    try {
      const { stdout } = await execAsync('sudo cat /etc/spamassassin/local.cf 2>/dev/null || echo ""');
      const config = { requiredScore: 5.0, rewriteSubject: false, reportSafe: true };
      const scoreMatch = stdout.match(/required_score\s+([\d.]+)/);
      if (scoreMatch) config.requiredScore = parseFloat(scoreMatch[1]);

      // Check if spamd is running
      const { stdout: status } = await execAsync('systemctl is-active spamassassin 2>/dev/null || echo "inactive"');
      config.active = status.trim() === 'active';
      return config;
    } catch { return { requiredScore: 5.0, active: false }; }
  }

  async updateSpamConfig(requiredScore) {
    const score = parseFloat(requiredScore);
    if (isNaN(score) || score < 1 || score > 20) throw new Error('Required score must be between 1 and 20');

    try {
      await execAsync(`sudo sed -i "s/^required_score.*/required_score ${score}/" /etc/spamassassin/local.cf 2>/dev/null`);
      // If not present, add it
      await execAsync(`grep -q "^required_score" /etc/spamassassin/local.cf 2>/dev/null || echo "required_score ${score}" | sudo tee -a /etc/spamassassin/local.cf 2>/dev/null`);
      await execAsync('sudo systemctl reload spamassassin 2>/dev/null || sudo systemctl restart spamassassin 2>/dev/null');
      return { success: true, requiredScore: score };
    } catch (err) {
      throw new Error('Failed to update SpamAssassin config: ' + err.message);
    }
  }

  // ── SSL / TLS ─────────────────────────────────────────────

  async getSslInfo() {
    const certs = [];
    const sslDirs = ['/etc/postfix', '/etc/dovecot'];
    for (const dir of sslDirs) {
      try {
        const files = await fs.readdir(dir);
        for (const file of files) {
          if (file.endsWith('.pem') || file.endsWith('.crt')) {
            const fullPath = path.join(dir, file);
            try {
              const { stdout } = await execAsync(`openssl x509 -in ${fullPath} -noout -subject -dates -issuer 2>/dev/null || echo ""`);
              certs.push({ path: fullPath, info: stdout.trim().split('\n').filter(l => l.trim()) });
            } catch {}
          }
        }
      } catch {}
    }
    return certs;
  }

  // ── Logs ──────────────────────────────────────────────────

  async getLogs(service = 'postfix', lines = 50) {
    if (!['postfix', 'dovecot', 'spamassassin'].includes(service)) throw new Error('Invalid service');
    try {
      const count = parseInt(lines) || 50;
      const { stdout } = await execAsync(`sudo journalctl -u ${service} --no-pager -n ${count} 2>/dev/null || sudo tail -${count} /var/log/mail.log 2>/dev/null || echo "No logs found"`);
      return stdout.trim().split('\n').filter(l => l.trim());
    } catch { return []; }
  }
}

export default new MailService();
