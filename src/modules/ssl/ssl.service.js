import { exec } from 'child_process';
import util from 'util';
import fs from 'fs/promises';
import path from 'path';
import Website from '../../models/Website.js';

const execAsync = util.promisify(exec);

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
        await execAsync('curl https://get.acme.sh | sh');
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

    try {
      // Issue certificate via Webroot mode
      const issueCmd = `${this.acmeShPath} --issue -d ${domain} -w ${rootDirectory} --server letsencrypt`;
      const { stdout, stderr } = await execAsync(issueCmd);

      // We should install the cert to Nginx path
      const certPath = `/etc/nginx/ssl/${domain}`;
      await fs.mkdir(certPath, { recursive: true });

      const installCmd = `${this.acmeShPath} --install-cert -d ${domain} \
        --key-file ${certPath}/privkey.pem \
        --fullchain-file ${certPath}/fullchain.pem \
        --reloadcmd "systemctl reload nginx"`;

      await execAsync(installCmd);

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
