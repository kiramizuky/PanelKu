import { exec } from 'child_process';
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
    if (process.platform === 'win32' && process.env.NODE_ENV !== 'test') {
      return {
        postfix: false,
        dovecot: false,
        spamassassin: false,
        roundcube: false,
        installed: false,
        queueSize: 0,
        version: null,
      };
    }

    const services = {
      postfix: false,
      dovecot: false,
      spamassassin: false,
      roundcube: false,
      installed: false,
      queueSize: 0,
      version: null,
    };

    // 1. Check services in parallel with strict timeout (max 2.5s)
    const serviceChecks = [
      { key: 'postfix', cmd: 'systemctl is-active postfix 2>/dev/null || echo "inactive"' },
      { key: 'dovecot', cmd: 'systemctl is-active dovecot 2>/dev/null || echo "inactive"' },
      { key: 'spamassassin', cmd: '(systemctl is-active --quiet spamassassin 2>/dev/null || systemctl is-active --quiet spamd 2>/dev/null || pgrep -x spamd >/dev/null 2>&1) && echo "active" || echo "inactive"' },
      { key: 'roundcube', cmd: 'systemctl is-active roundcube 2>/dev/null || echo "inactive"' },
    ];
    await Promise.allSettled(
      serviceChecks.map(async ({ key, cmd }) => {
        try {
          const { stdout } = await execAsync(cmd, { timeout: 2500 });
          services[key] = stdout.trim() === 'active';
        } catch {
          services[key] = false;
        }
      })
    );

    // 2. Check if postfix binary is installed
    try {
      const { stdout } = await execAsync('which postfix 2>/dev/null || command -v postfix 2>/dev/null || true', { timeout: 2500 });
      services.installed = stdout.trim().length > 0;
    } catch {
      services.installed = false;
    }

    // 3. Get mail queue size (only if postfix is installed and responsive, with timeout)
    if (services.installed) {
      try {
        const { stdout } = await execAsync('mailq 2>/dev/null | tail -1', { timeout: 2500 });
        const match = stdout.match(/(\d+)\s+request/);
        services.queueSize = match ? parseInt(match[1]) : 0;
      } catch {
        services.queueSize = 0;
      }
    }

    // 4. Get Postfix version with timeout
    if (services.installed) {
      try {
        const { stdout } = await execAsync('postconf mail_version 2>/dev/null || postconf -d mail_version 2>/dev/null || postfix --version 2>/dev/null | head -1', { timeout: 2500 });
        services.version = stdout.replace('mail_version = ', '').trim() || null;
      } catch {
        services.version = null;
      }
    }

    return services;
  }

  async install() {
    try {
      // Pre-seed debconf so Postfix creates /etc/postfix/main.cf properly during install
      await execAsync('echo "postfix postfix/main_mailer_type select Internet Site" | sudo debconf-set-selections 2>/dev/null || true');
      await execAsync('echo "postfix postfix/mailname string $(hostname -f 2>/dev/null || hostname)" | sudo debconf-set-selections 2>/dev/null || true');

      const { stdout } = await execAsync('sudo apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y postfix postfix-mysql dovecot-core dovecot-imapd dovecot-pop3d dovecot-mysql spamassassin roundcube roundcube-mysql 2>&1 | tail -5');

      // Ensure basic main.cf and virtual directories exist if not created by package
      await execAsync('sudo mkdir -p /etc/postfix /var/mail/vhosts 2>/dev/null');
      await execAsync('test -f /etc/postfix/main.cf || sudo cp /usr/share/postfix/main.cf.dist /etc/postfix/main.cf 2>/dev/null || sudo touch /etc/postfix/main.cf');
      await execAsync('test -f /etc/postfix/virtual_mailbox || sudo touch /etc/postfix/virtual_mailbox');
      await execAsync('sudo postmap /etc/postfix/virtual_mailbox 2>/dev/null || true');

      await execAsync('sudo sed -i "s/^ENABLED=0/ENABLED=1/" /etc/default/spamassassin 2>/dev/null || true');
      await execAsync('sudo systemctl unmask spamassassin spamd 2>/dev/null || true');
      await execAsync('sudo systemctl enable postfix dovecot spamassassin spamd 2>/dev/null').catch(() => {});
      await execAsync('sudo systemctl start postfix dovecot spamassassin 2>/dev/null || sudo systemctl start spamd 2>/dev/null || true').catch(() => {});
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
      if (service === 'spamassassin') {
        // Ensure ENABLED=1 in /etc/default/spamassassin so Debian/Ubuntu sysv/systemd allows spamd to run
        if (action === 'start' || action === 'restart') {
          await execAsync('if [ -f /etc/default/spamassassin ]; then sudo sed -i "s/^ENABLED=0/ENABLED=1/" /etc/default/spamassassin; fi 2>/dev/null || true');
          await execAsync('sudo systemctl unmask spamassassin spamd 2>/dev/null || true');
          await execAsync('sudo systemctl daemon-reload 2>/dev/null || true');
        }

        const svcCmd = (action === 'stop')
          ? 'sudo systemctl stop spamassassin 2>/dev/null || sudo systemctl stop spamd 2>/dev/null || sudo service spamassassin stop 2>/dev/null || sudo pkill -9 spamd 2>/dev/null || true'
          : `sudo systemctl ${action} spamassassin 2>/dev/null || sudo systemctl ${action} spamd 2>/dev/null || sudo service spamassassin ${action} 2>/dev/null || sudo service spamd ${action} 2>/dev/null`;

        const { stdout } = await execAsync(svcCmd, { timeout: 10000 });

        // Verify if it actually became active on start/restart
        if (process.env.NODE_ENV !== 'test' && (action === 'start' || action === 'restart')) {
          const { stdout: checkOut } = await execAsync('(systemctl is-active --quiet spamassassin 2>/dev/null || systemctl is-active --quiet spamd 2>/dev/null || pgrep -x spamd >/dev/null 2>&1) && echo "active" || echo "inactive"', { timeout: 3000 });
          if (checkOut.trim() !== 'active') {
            const { stdout: binCheck } = await execAsync('which spamassassin 2>/dev/null || command -v spamd 2>/dev/null || echo ""', { timeout: 2000 });
            if (!binCheck.trim()) {
              throw new Error('SpamAssassin is not installed on this system. Please run: sudo apt-get install -y spamassassin');
            }
            throw new Error('SpamAssassin failed to activate. Check /etc/default/spamassassin (ENABLED=1) or run: sudo journalctl -u spamassassin -n 20');
          }
        }

        return { success: true, output: stdout.trim() };
      }

      const svcCmd = `sudo systemctl ${action} ${service} 2>&1`;
      const { stdout } = await execAsync(svcCmd, { timeout: 10000 });
      return { success: true, output: stdout.trim() };
    } catch (err) {
      throw new Error(`Failed to ${action} ${service}: ${err.message}`);
    }
  }

  // ── Email Accounts (virtual mail users) ───────────────────

  async getAccounts() {
    try {
      // Read virtual mailbox map
      const { stdout } = await execAsync('sudo cat /etc/postfix/virtual_mailbox 2>/dev/null || echo ""', { timeout: 3000 });
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
      await execAsync(`sudo sed -i "/^${email.replace(/\./g, '\\.')} /d" /etc/postfix/virtual_mailbox 2>/dev/null`);
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
      const domainList = new Set();

      // 1. Virtual mailbox domains (primary virtual domains managed by panel)
      const { stdout: vStdout } = await execAsync('sudo postconf virtual_mailbox_domains 2>/dev/null || echo ""', { timeout: 3000 });
      const rawVDomains = vStdout.replace(/^virtual_mailbox_domains\s*=\s*/, '').trim();
      const vTokens = rawVDomains.split(/[,\s]+/).map(d => d.trim().replace(/^,+|,+$/g, '')).filter(Boolean);
      for (const d of vTokens) {
        if (d && !d.startsWith('$') && !d.includes('localhost') && d.includes('.')) {
          domainList.add(d);
        }
      }

      // 2. Also check mydestination (legacy or system domains with valid FQDN)
      const { stdout: mStdout } = await execAsync('sudo postconf mydestination 2>/dev/null || echo ""', { timeout: 3000 });
      const rawMDomains = mStdout.replace(/^mydestination\s*=\s*/, '').trim();
      const mTokens = rawMDomains.split(/[,\s]+/).map(d => d.trim().replace(/^,+|,+$/g, '')).filter(Boolean);
      for (const d of mTokens) {
        if (d && !d.startsWith('$') && !d.includes('localhost') && d.includes('.')) {
          domainList.add(d);
        }
      }

      return Array.from(domainList);
    } catch { return []; }
  }

  async addDomain(domain) {
    this._validateDomain(domain);
    try {
      await execAsync(`sudo mkdir -p /var/mail/vhosts/${domain} /etc/postfix 2>/dev/null`);
      await execAsync('test -f /etc/postfix/main.cf || sudo cp /usr/share/postfix/main.cf.dist /etc/postfix/main.cf 2>/dev/null || sudo touch /etc/postfix/main.cf');
      await execAsync('test -f /etc/postfix/virtual_mailbox || sudo touch /etc/postfix/virtual_mailbox');

      // Add to postfix virtual domains cleanly
      const { stdout: current } = await execAsync('sudo postconf virtual_mailbox_domains 2>/dev/null || echo ""', { timeout: 3000 });
      const rawDomains = current.replace(/^virtual_mailbox_domains\s*=\s*/, '').trim();
      const existing = rawDomains.split(/[,\s]+/).map(d => d.trim().replace(/^,+|,+$/g, '')).filter(d => d && d.includes('.'));

      if (!existing.includes(domain)) {
        existing.push(domain);
        const newDomainsStr = existing.join(' ');
        await execAsync(`sudo postconf -e "virtual_mailbox_domains=${newDomainsStr}"`);
      }
      await execAsync('sudo systemctl reload postfix 2>/dev/null || sudo systemctl restart postfix 2>/dev/null || true');
      return { success: true, domain };
    } catch (err) {
      throw new Error('Failed to add domain: ' + err.message);
    }
  }

  async removeDomain(domain) {
    const cleanDomain = String(domain || '').trim().replace(/^["']|["']$/g, '').replace(/^,+|,+$/g, '');
    if (!cleanDomain) {
      throw new Error('Domain is required');
    }
    try {
      // 1. Remove from virtual_mailbox_domains
      const { stdout: current } = await execAsync('sudo postconf virtual_mailbox_domains 2>/dev/null || echo ""', { timeout: 3000 });
      const rawVDomains = current.replace(/^virtual_mailbox_domains\s*=\s*/, '').trim();
      const existingV = rawVDomains.split(/[,\s]+/).map(d => d.trim().replace(/^,+|,+$/g, '')).filter(d => d && d !== cleanDomain);
      const newVDomainsStr = existingV.join(' ');
      await execAsync(`sudo postconf -e "virtual_mailbox_domains=${newVDomainsStr}"`);

      // 2. Also remove from mydestination if legacy/system domain
      const { stdout: mCurrent } = await execAsync('sudo postconf mydestination 2>/dev/null || echo ""', { timeout: 3000 });
      const rawMDomains = mCurrent.replace(/^mydestination\s*=\s*/, '').trim();
      if (rawMDomains.includes(cleanDomain)) {
        const existingM = rawMDomains.split(/[,\s]+/).map(d => d.trim().replace(/^,+|,+$/g, '')).filter(d => d && d !== cleanDomain);
        await execAsync(`sudo postconf -e "mydestination=${existingM.join(', ')}"`);
      }

      await execAsync('sudo systemctl reload postfix 2>/dev/null || sudo systemctl restart postfix 2>/dev/null || true');
      return { success: true, domain: cleanDomain };
    } catch (err) {
      throw new Error('Failed to remove domain: ' + err.message);
    }
  }

  // ── Mail Queue ────────────────────────────────────────────

  async getQueue() {
    try {
      const { stdout } = await execAsync('mailq 2>/dev/null || echo "Mail queue is empty"', { timeout: 4000 });
      const lines = stdout.split('\n');
      const queue = [];
      let current = null;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('-Queue ID-') || trimmed.includes('Mail queue is empty') || trimmed.startsWith('-- ')) continue;

        // Matches Postfix mailq entry line e.g. "4F8B31234567*    1234 Mon Jan 10 12:00:00  sender@example.com"
        const idMatch = line.match(/^([A-Za-z0-9]+)([*!])?\s+(\d+)\s+([A-Za-z]{3}\s+[A-Za-z]{3}\s+\d+\s+[\d:]+)\s+(\S+.*)$/);
        if (idMatch) {
          if (current) queue.push(current);
          const rawId = idMatch[1];
          const flag = idMatch[2] || '';
          const size = parseInt(idMatch[3]) || 0;
          const date = idMatch[4].trim();
          const sender = idMatch[5].trim();
          const status = flag === '*' ? 'active' : flag === '!' ? 'hold' : 'deferred';

          current = {
            id: rawId,
            status,
            size,
            date,
            sender,
            recipient: '',
            error: '',
            lines: [line]
          };
          continue;
        }

        // Generic fallback if spacing or date differs slightly
        if (!idMatch && /^[A-Za-z0-9]{6,}/.test(trimmed)) {
          if (current) queue.push(current);
          const parts = trimmed.split(/\s+/);
          const rawId = parts[0].replace(/[*!]$/, '');
          const flag = parts[0].endsWith('*') ? '*' : parts[0].endsWith('!') ? '!' : '';
          current = {
            id: rawId,
            status: flag === '*' ? 'active' : flag === '!' ? 'hold' : 'deferred',
            size: parseInt(parts[1]) || 0,
            date: parts.slice(2, 6).join(' ') || new Date().toISOString(),
            sender: parts[6] || 'unknown',
            recipient: '',
            error: '',
            lines: [line]
          };
          continue;
        }

        // Error message lines in parentheses: (host mx.example.com said: 554 ...)
        if (current && trimmed.startsWith('(') && trimmed.endsWith(')')) {
          current.error = trimmed.slice(1, -1);
          current.lines.push(line);
          continue;
        }

        // Recipient line: indented email address(es)
        if (current && !trimmed.startsWith('(')) {
          if (!current.recipient) {
            current.recipient = trimmed;
          } else {
            current.recipient += ', ' + trimmed;
          }
          current.lines.push(line);
        }
      }
      if (current) queue.push(current);

      return { queue, total: queue.length, raw: stdout };
    } catch { return { queue: [], total: 0, raw: '' }; }
  }

  async flushQueue() {
    try {
      await execAsync('sudo postfix flush 2>/dev/null || sudo postqueue -f 2>/dev/null');
      return { success: true };
    } catch (err) {
      throw new Error('Failed to flush queue: ' + err.message);
    }
  }

  async deleteFromQueue(queueId) {
    const cleanId = String(queueId || '').trim();
    if (cleanId !== 'ALL' && !/^[A-Za-z0-9]{6,}$/.test(cleanId)) {
      throw new Error('Invalid queue ID');
    }
    try {
      await execAsync(`sudo postsuper -d ${cleanId} 2>/dev/null`);
      return { success: true, queueId: cleanId };
    } catch (err) {
      throw new Error('Failed to delete from queue: ' + err.message);
    }
  }

  async requeue(queueId = 'ALL') {
    const cleanId = String(queueId || '').trim();
    if (cleanId !== 'ALL' && !/^[A-Za-z0-9]{6,}$/.test(cleanId)) {
      throw new Error('Invalid queue ID');
    }
    try {
      await execAsync(`sudo postsuper -r ${cleanId} 2>/dev/null`);
      return { success: true, queueId: cleanId };
    } catch (err) {
      throw new Error('Failed to requeue: ' + err.message);
    }
  }

  // ── SpamAssassin ──────────────────────────────────────────

  async getSpamConfig() {
    try {
      const { stdout } = await execAsync('sudo cat /etc/spamassassin/local.cf 2>/dev/null || echo ""', { timeout: 3000 });
      const config = { requiredScore: 5.0, rewriteSubject: false, reportSafe: true };
      const scoreMatch = stdout.match(/required_score\s+([\d.]+)/);
      if (scoreMatch) config.requiredScore = parseFloat(scoreMatch[1]);

      // Check if spamd or spamassassin is running
      const { stdout: status } = await execAsync('(systemctl is-active --quiet spamassassin 2>/dev/null || systemctl is-active --quiet spamd 2>/dev/null || pgrep -x spamd >/dev/null 2>&1) && echo "active" || echo "inactive"', { timeout: 2500 });
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
      await execAsync('sudo systemctl reload spamassassin 2>/dev/null || sudo systemctl reload spamd 2>/dev/null || sudo systemctl restart spamassassin 2>/dev/null || sudo systemctl restart spamd 2>/dev/null || true');
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
      const { stdout } = await execAsync(`sudo journalctl -u ${service} --no-pager -n ${count} 2>/dev/null || sudo tail -${count} /var/log/mail.log 2>/dev/null || echo "No logs found"`, { timeout: 5000 });
      return stdout.trim().split('\n').filter(l => l.trim());
    } catch { return []; }
  }

  // ── DNS & Deliverability Helper ───────────────────────────

  async getDnsHelper(domain) {
    const d = (domain && typeof domain === 'string' && domain.trim()) ? domain.trim() : 'example.com';
    let serverIp = 'YOUR_SERVER_IP';

    const isPrivateIp = (ip) => {
      if (!ip) return true;
      return /^(127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|169\.254\.|::1|fe80:)/i.test(ip.trim());
    };

    // 1. Try public IP resolver first (essential for cloud VPS behind NAT or homeservers)
    try {
      const { stdout } = await execAsync('curl -s --max-time 3 https://api.ipify.org 2>/dev/null || curl -s --max-time 3 https://ifconfig.me 2>/dev/null || curl -s --max-time 3 https://icanhazip.com 2>/dev/null', { timeout: 3500 });
      const pubIp = stdout.trim();
      if (pubIp && !isPrivateIp(pubIp) && /^[0-9a-fA-F:.]+$/.test(pubIp)) {
        serverIp = pubIp;
      }
    } catch {}

    // 2. Fallback to network interface IP if public IP lookup is unavailable
    if (serverIp === 'YOUR_SERVER_IP') {
      try {
        const { stdout } = await execAsync('hostname -I 2>/dev/null || echo ""', { timeout: 2500 });
        const ip = stdout.trim().split(/\s+/)[0];
        if (ip && !ip.startsWith('127.')) serverIp = ip;
      } catch {}
    }

    return {
      domain: d,
      serverIp,
      records: [
        { type: 'MX', host: '@', priority: 10, value: `mail.${d}`, note: 'Mail Exchange - routes incoming emails to your server' },
        { type: 'A', host: 'mail', priority: null, value: serverIp, note: 'Points mail host to your server public IP address' },
        { type: 'TXT (SPF)', host: '@', priority: null, value: `v=spf1 mx a ip4:${serverIp} ~all`, note: 'Sender Policy Framework - authorizes this public IP to send emails' },
        { type: 'TXT (DMARC)', host: '_dmarc', priority: null, value: `v=DMARC1; p=quarantine; rua=mailto:postmaster@${d}; pct=100`, note: 'Domain-based Message Authentication policy' },
        { type: 'TXT (DKIM)', host: 'default._domainkey', priority: null, value: 'v=DKIM1; k=rsa; p=<public-key>', note: 'Cryptographic signature validating email authenticity' },
        { type: 'PTR (rDNS)', host: serverIp, priority: null, value: `mail.${d}`, note: 'Reverse DNS - configure at VPS/Hosting provider dashboard' }
      ]
    };
  }
}

export default new MailService();
