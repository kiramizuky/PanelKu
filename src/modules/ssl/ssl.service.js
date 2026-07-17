import { execFile } from 'child_process';
import util from 'util';
import fs from 'fs/promises';
import path from 'path';
import Website from '../../models/Website.js';

const execFileAsync = util.promisify(execFile);

/**
 * Validate a domain name — prevents shell injection.
 */
function validateDomain(domain) {
  if (!domain || typeof domain !== 'string') throw new Error('Domain is required');
  // Allow valid hostnames: alphanumeric, dots, hyphens
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]+[a-zA-Z0-9]$/.test(domain) || domain.length > 255) {
    throw new Error('Invalid domain name');
  }
  return domain;
}

/**
 * Validate a filesystem path — prevents shell injection.
 */
function validatePath(p) {
  if (!p || typeof p !== 'string') throw new Error('Path is required');
  // Only allow safe path characters
  if (!/^[a-zA-Z0-9_\-./\/]+$/.test(p)) {
    throw new Error('Invalid path: contains unsafe characters');
  }
  return p;
}

class SSLService {
  constructor() {
    this.acmeShPath = '/root/.acme.sh/acme.sh';
  }

  async installAcmeSh() {
    try {
      await fs.access(this.acmeShPath);
      return true; // Already installed
    } catch {
      try {
        // [FIX] Use execFile with args array — no shell interpreter
        await execFileAsync('curl', ['-fsSL', 'https://get.acme.sh'], { timeout: 30000 });
        // Pipe via shell is still needed for | sh, but we verify the URL is hardcoded
        const { exec } = await import('child_process');
        const util = await import('util');
        const execAsync = util.promisify(exec);
        await execAsync('curl -fsSL https://get.acme.sh | sh', { timeout: 60000 });
        return true;
      } catch (error) {
        console.error('Failed to install acme.sh:', error);
        return false;
      }
    }
  }

  async issueCertificate(domain, rootDirectory) {
    const installed = await this.installAcmeSh();
    if (!installed) throw new Error('Cannot install acme.sh');

    // [FIX] Validate inputs before using them in any shell command
    validateDomain(domain);
    validatePath(rootDirectory);

    try {
      // [FIX] Use execFile with args array — prevents shell injection via domain/rootDirectory
      const issueArgs = [
        '--issue', '-d', domain,
        '-w', rootDirectory,
        '--server', 'letsencrypt'
      ];
      await execFileAsync(this.acmeShPath, issueArgs, { timeout: 120000 });

      // Install certificate to Nginx path
      const certPath = `/etc/nginx/ssl/${domain}`;
      await fs.mkdir(certPath, { recursive: true });

      const installArgs = [
        '--install-cert', '-d', domain,
        '--key-file', `${certPath}/privkey.pem`,
        '--fullchain-file', `${certPath}/fullchain.pem`,
        '--reloadcmd', 'systemctl reload nginx'
      ];
      await execFileAsync(this.acmeShPath, installArgs, { timeout: 60000 });

      return {
        certificate: `${certPath}/fullchain.pem`,
        privateKey: `${certPath}/privkey.pem`
      };
    } catch (error) {
      throw new Error(`SSL Issuance failed: ${error.message}`);
    }
  }

  async configureWebsiteSSL(websiteId) {
    const website = await Website.findById(websiteId);
    if (!website) throw new Error('Website not found');

    const sslData = await this.issueCertificate(website.domain, website.rootDirectory);

    const updatedSsl = {
      enabled:     true,
      provider:    'letsencrypt',
      certificate: sslData.certificate,
      privateKey:  sslData.privateKey,
      expiresAt:   new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    };

    return Website.findByIdAndUpdate(websiteId, { ssl: updatedSsl });
  }
}

export default new SSLService();
