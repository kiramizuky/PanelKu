import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';
import Website from '../../models/Website.js';

const execAsync = util.promisify(exec);

// Vhost templates
const NGINX_TEMPLATE_STATIC = `
server {
    listen 80;
    server_name {{domain}} {{aliases}};
    root {{rootDirectory}};
    index index.html index.htm;

    access_log /var/log/nginx/{{domain}}.access.log;
    error_log /var/log/nginx/{{domain}}.error.log;

    location / {
        try_files $uri $uri/ =404;
    }
}
`;

const NGINX_TEMPLATE_PROXY = `
server {
    listen 80;
    server_name {{domain}} {{aliases}};

    access_log /var/log/nginx/{{domain}}.access.log;
    error_log /var/log/nginx/{{domain}}.error.log;

    location / {
        proxy_pass http://127.0.0.1:{{port}};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
`;

class WebsiteService {
  constructor() {
    // In Debian/Ubuntu typically /etc/nginx/sites-available
    // For simplicity, we'll write to conf.d assuming it's included
    this.nginxConfDir = '/etc/nginx/conf.d';
  }

  async reloadNginx() {
    try {
      await execAsync('systemctl reload nginx');
      return true;
    } catch (error) {
      // Don't crash if nginx isn't installed/running, just log it
      console.error('Failed to reload nginx:', error.message);
      return false;
    }
  }

  async generateNginxConfig(website) {
    let template = website.type === 'static' ? NGINX_TEMPLATE_STATIC : NGINX_TEMPLATE_PROXY;
    
    let conf = template
      .replace(/{{domain}}/g, website.domain)
      .replace(/{{aliases}}/g, website.aliases.join(' '))
      .replace(/{{rootDirectory}}/g, website.rootDirectory)
      .replace(/{{port}}/g, website.port || 8080);

    const confPath = path.join(this.nginxConfDir, `${website.domain}.conf`);
    
    try {
      await fs.writeFile(confPath, conf, 'utf8');
      await this.reloadNginx();
    } catch (error) {
      console.error(`Failed to write nginx config for ${website.domain}:`, error.message);
      // In a real scenario we might fail the website creation if we can't write the conf
      // but for testing locally where nginx might not be installed, we allow it.
    }
  }

  async removeNginxConfig(domain) {
    const confPath = path.join(this.nginxConfDir, `${domain}.conf`);
    try {
      await fs.unlink(confPath);
      await this.reloadNginx();
    } catch (error) {
      console.error(`Failed to remove nginx config for ${domain}:`, error.message);
    }
  }

  async listWebsites() {
    return Website.find({}).sort({ createdAt: -1 });
  }

  async createWebsite(data, userId) {
    // Check if domain exists
    const exists = await Website.findOne({ domain: data.domain });
    if (exists) throw new Error('Domain already configured');

    const website = new Website({
      domain: data.domain,
      aliases: data.aliases || [],
      type: data.type || 'static',
      rootDirectory: data.rootDirectory || `/var/www/${data.domain}`,
      port: data.port,
      owner: userId,
      webhookToken: Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
    });

    // Create root directory if it doesn't exist
    try {
      await fs.mkdir(website.rootDirectory, { recursive: true });
      // Write a default index.html
      if (website.type === 'static') {
        await fs.writeFile(path.join(website.rootDirectory, 'index.html'), `<h1>Welcome to ${website.domain}</h1><p>Created via Linux Panel</p>`, 'utf8');
      }
    } catch (error) {
      console.error('Failed to create document root:', error.message);
    }

    await website.save();
    await this.generateNginxConfig(website);
    
    return website;
  }

  async getWebsite(id) {
    const website = await Website.findById(id);
    if (!website) throw new Error('Website not found');
    return website;
  }

  async updateWebsite(id, data) {
    const website = await Website.findById(id);
    if (!website) throw new Error('Website not found');

    if (data.aliases) website.aliases = data.aliases;
    if (data.type) website.type = data.type;
    if (data.rootDirectory) website.rootDirectory = data.rootDirectory;
    if (data.port) website.port = data.port;
    if (data.status) website.status = data.status;
    if (data.gitRepo !== undefined) website.gitRepo = data.gitRepo;
    if (data.autoDeploy !== undefined) website.autoDeploy = data.autoDeploy;
    if (data.phpVersion) website.phpVersion = data.phpVersion;

    if (!website.webhookToken) {
      website.webhookToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    }

    await website.save();
    
    // Regenerate config if active
    if (website.status === 'active') {
      await this.generateNginxConfig(website);
    } else {
      await this.removeNginxConfig(website.domain);
    }

    return website;
  }

  async deployGit(id) {
    const website = await Website.findById(id);
    if (!website || !website.gitRepo) throw new Error('Website or Git Repo not found');
    
    try {
      // Check if .git exists
      const gitDir = path.join(website.rootDirectory, '.git');
      try {
        await fs.access(gitDir);
        // Exists, pull
        await execAsync(`cd ${website.rootDirectory} && git pull`, { timeout: 60000 });
      } catch {
        // Does not exist, clone
        // We might need to empty the directory first or clone into a temp and move
        await execAsync(`rm -rf ${website.rootDirectory}/*`);
        await execAsync(`git clone ${website.gitRepo} ${website.rootDirectory}`, { timeout: 60000 });
      }
      return { success: true, message: 'Deployment successful' };
    } catch (error) {
      console.error('Git deploy error:', error);
      throw new Error('Failed to deploy from Git: ' + error.message);
    }
  }

  async deleteWebsite(id) {
    const website = await Website.findById(id);
    if (!website) throw new Error('Website not found');

    await this.removeNginxConfig(website.domain);
    await website.deleteOne();
    return true;
  }
}

export default new WebsiteService();
