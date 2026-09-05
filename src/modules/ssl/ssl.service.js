import { execFile } from 'child_process';
import util from 'util';
import fs from 'fs/promises';
import path from 'path';
import Website from '../../models/Website.js';
import websiteService, { ACME_CHALLENGE_DIR } from '../websites/websites.service.js';

const execFileAsync = util.promisify(execFile);

function getCleanEnv() {
  const env = { ...process.env };
  // Remove LOG_LEVEL because acme.sh expects integer (0, 1, 2, 3), not string ('info', 'debug')
  delete env.LOG_LEVEL;
  return env;
}

const SSL_BASE_DIR = process.platform === 'win32'
  ? path.join(process.cwd(), 'data', 'ssl')
  : '/etc/nginx/ssl';

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
  if (!/^[a-zA-Z0-9_\-./\\:]+$/.test(p)) {
    throw new Error('Invalid path: contains unsafe characters');
  }
  return p;
}

class SSLService {
  constructor() {
    this.acmeShPath = '/root/.acme.sh/acme.sh';
  }

  /**
   * Find available acme.sh binary path
   */
  async getAcmeShPath() {
    if (process.env.ACME_SH_PATH) {
      try {
        await fs.access(process.env.ACME_SH_PATH);
        return process.env.ACME_SH_PATH;
      } catch {}
    }

    const homeAcme = process.env.HOME ? path.join(process.env.HOME, '.acme.sh', 'acme.sh') : null;
    const candidates = [
      homeAcme,
      '/root/.acme.sh/acme.sh',
      '/usr/local/bin/acme.sh',
      '/usr/bin/acme.sh'
    ].filter(Boolean);

    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
        this.acmeShPath = candidate;
        return candidate;
      } catch {}
    }

    return null;
  }

  async installAcmeSh() {
    const existing = await this.getAcmeShPath();
    if (existing) return existing;

    try {
      // Clean up empty or broken acme dir if exists
      const targetHome = process.env.HOME || '/root';
      const acmeDir = path.join(targetHome, '.acme.sh');
      try {
        await fs.access(acmeDir);
        await fs.rm(acmeDir, { recursive: true, force: true });
      } catch {}

      // Install acme.sh with an admin email account
      const { exec } = await import('child_process');
      const execAsync = util.promisify(exec);
      await execAsync('curl -fsSL https://get.acme.sh | sh -s email=admin@panelku.local', { timeout: 60000 });

      const resolved = await this.getAcmeShPath();
      if (resolved) {
        // Set default CA to Let's Encrypt
        try {
          await execFileAsync(resolved, ['--set-default-ca', '--server', 'letsencrypt'], { timeout: 15000, env: getCleanEnv() });
        } catch {}
        return resolved;
      }
      return null;
    } catch (error) {
      console.error('Failed to install acme.sh:', error.message || error);
      return null;
    }
  }

  /**
   * Generate an instant Self-Signed SSL Certificate using OpenSSL
   */
  async issueSelfSignedCertificate(domain) {
    validateDomain(domain);

    const certDir = path.join(SSL_BASE_DIR, domain);
    await fs.mkdir(certDir, { recursive: true });

    const keyPath = path.join(certDir, 'privkey.pem');
    const certPath = path.join(certDir, 'fullchain.pem');

    const args = [
      'req', '-x509', '-nodes',
      '-days', '365',
      '-newkey', 'rsa:2048',
      '-keyout', keyPath,
      '-out', certPath,
      '-subj', `/CN=${domain}`
    ];

    try {
      await execFileAsync('openssl', args, { timeout: 30000 });
      return {
        certificate: certPath,
        privateKey: keyPath,
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
      };
    } catch (error) {
      throw new Error(`Self-Signed SSL generation failed: ${error.message}`);
    }
  }

  /**
   * Issue certificate via Let's Encrypt (acme.sh webroot mode)
   */
  async issueCertificate(domain, rootDirectory = ACME_CHALLENGE_DIR) {
    validateDomain(domain);
    const challengeDir = rootDirectory || ACME_CHALLENGE_DIR;
    validatePath(challengeDir);
    await fs.mkdir(challengeDir, { recursive: true });

    const acmeSh = await this.installAcmeSh();
    if (!acmeSh) {
      throw new Error('acme.sh is not installed and auto-installation failed. Ensure curl and bash are available.');
    }

    const cleanEnv = getCleanEnv();

    try {
      // Run webroot challenge using dedicated ACME challenge webroot
      const issueArgs = [
        '--issue', '-d', domain,
        '-w', challengeDir,
        '--server', 'letsencrypt'
      ];
      await execFileAsync(acmeSh, issueArgs, { timeout: 120000, env: cleanEnv });

      // Install certificate to Nginx path
      const certPath = path.join(SSL_BASE_DIR, domain);
      await fs.mkdir(certPath, { recursive: true });

      const fullchainFile = path.join(certPath, 'fullchain.pem');
      const privkeyFile = path.join(certPath, 'privkey.pem');

      const installArgs = [
        '--install-cert', '-d', domain,
        '--key-file', privkeyFile,
        '--fullchain-file', fullchainFile,
        '--reloadcmd', 'systemctl reload nginx'
      ];
      await execFileAsync(acmeSh, installArgs, { timeout: 60000, env: cleanEnv });

      return {
        certificate: fullchainFile,
        privateKey: privkeyFile,
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
      };
    } catch (error) {
      const rawDetail = error.stderr || error.stdout || error.message || '';
      // Filter out noisy bash warnings (e.g. '[: info: integer expected')
      const cleanDetail = rawDetail
        .split('\n')
        .filter(line => !line.includes('integer expected') && line.trim().length > 0)
        .join('\n')
        .trim();
      throw new Error(`Let's Encrypt validation failed: ${cleanDetail || rawDetail}. Ensure domain "${domain}" points to this server's IP address and port 80 is publicly reachable.`);
    }
  }

  /**
   * Save custom SSL Certificate provided by user
   */
  async saveCustomCertificate(domain, certificateContent, privateKeyContent) {
    validateDomain(domain);

    if (!certificateContent || !privateKeyContent) {
      throw new Error('Both Certificate and Private Key content are required');
    }

    const certDir = path.join(SSL_BASE_DIR, domain);
    await fs.mkdir(certDir, { recursive: true });

    const certPath = path.join(certDir, 'fullchain.pem');
    const keyPath = path.join(certDir, 'privkey.pem');

    await fs.writeFile(certPath, certificateContent.trim(), 'utf8');
    await fs.writeFile(keyPath, privateKeyContent.trim(), 'utf8');

    return {
      certificate: certPath,
      privateKey: keyPath,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
    };
  }

  /**
   * Configure SSL for a website (Let's Encrypt, Self-Signed, or Custom)
   */
  async configureWebsiteSSL(websiteId, provider = 'letsencrypt', customData = null) {
    const website = await Website.findById(websiteId);
    if (!website) throw new Error('Website not found');

    // Ensure Nginx vhost is generated and loaded with ACME challenge location block BEFORE running acme.sh
    if (provider === 'letsencrypt') {
      await websiteService.generateNginxConfig(website);
    }

    let sslData;
    let effectiveProvider = provider;

    if (provider === 'selfsigned') {
      sslData = await this.issueSelfSignedCertificate(website.domain);
    } else if (provider === 'custom') {
      if (!customData || !customData.certificate || !customData.privateKey) {
        throw new Error('Certificate and private key are required for custom SSL');
      }
      sslData = await this.saveCustomCertificate(website.domain, customData.certificate, customData.privateKey);
    } else {
      // Default: letsencrypt
      effectiveProvider = 'letsencrypt';
      sslData = await this.issueCertificate(website.domain, ACME_CHALLENGE_DIR);
    }

    const updatedSsl = {
      enabled:     true,
      provider:    effectiveProvider,
      certificate: sslData.certificate,
      privateKey:  sslData.privateKey,
      expiresAt:   sslData.expiresAt || new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    };

    await Website.findByIdAndUpdate(websiteId, { ssl: updatedSsl });
    const updatedWebsite = await Website.findById(websiteId);

    // Immediately regenerate Nginx vhost with HTTPS & reload Nginx
    await websiteService.generateNginxConfig(updatedWebsite);

    return updatedWebsite;
  }

  /**
   * Disable SSL for a website and revert vhost back to HTTP port 80
   */
  async disableWebsiteSSL(websiteId) {
    const website = await Website.findById(websiteId);
    if (!website) throw new Error('Website not found');

    const updatedSsl = {
      ...(website.ssl || {}),
      enabled: false
    };

    await Website.findByIdAndUpdate(websiteId, { ssl: updatedSsl });
    const updatedWebsite = await Website.findById(websiteId);

    // Immediately regenerate Nginx vhost with HTTP only & reload Nginx
    await websiteService.generateNginxConfig(updatedWebsite);

    return updatedWebsite;
  }
}

export default new SSLService();
