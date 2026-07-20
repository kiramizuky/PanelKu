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

const NGINX_TEMPLATE_PHP = `
server {
    listen 80;
    server_name {{domain}} {{aliases}};
    root {{rootDirectory}};
    index index.php index.html index.htm;

    access_log /var/log/nginx/{{domain}}.access.log;
    error_log /var/log/nginx/{{domain}}.error.log;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \\.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/var/run/php/php{{phpVersion}}-fpm.sock;
    }
}
`;

class WebsiteService {
  constructor() {
    this.nginxConfDir = '/etc/nginx/conf.d';
  }

  async reloadNginx() {
    try {
      await execAsync('systemctl reload nginx');
      return true;
    } catch (error) {
      console.error('Failed to reload nginx:', error.message);
      return false;
    }
  }

  async generateNginxConfig(website) {
    let template = NGINX_TEMPLATE_STATIC;
    if (website.type === 'proxy') template = NGINX_TEMPLATE_PROXY;
    else if (website.type === 'php') template = NGINX_TEMPLATE_PHP;
    
    let conf = template
      .replace(/{{domain}}/g, website.domain)
      .replace(/{{aliases}}/g, (website.aliases || []).join(' '))
      .replace(/{{rootDirectory}}/g, website.rootDirectory)
      .replace(/{{port}}/g, website.port || 8080)
      .replace(/{{phpVersion}}/g, website.phpVersion || '8.2');

    const confPath = path.join(this.nginxConfDir, `${website.domain}.conf`);
    
    try {
      await fs.writeFile(confPath, conf, 'utf8');
      await this.reloadNginx();
    } catch (error) {
      console.error(`Failed to write nginx config for ${website.domain}:`, error.message);
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
    return Website.find({});
  }

  /**
   * [SECURITY] Validate a file path to prevent path traversal.
   * Only allow absolute paths starting with / and containing safe characters.
   */
  _validateRootDirectory(dir) {
    if (!dir || typeof dir !== 'string') {
      throw new Error('Root directory is required');
    }
    // Must be an absolute path
    if (!dir.startsWith('/')) {
      throw new Error('Root directory must be an absolute path');
    }
    // Block path traversal
    if (dir.includes('..')) {
      throw new Error('Path traversal detected in root directory');
    }
    // Block shell metacharacters
    if (/[;&|`$(){}]/.test(dir)) {
      throw new Error('Root directory contains invalid characters');
    }
    return dir;
  }

  async createWebsite(data, userId) {
    const exists = await Website.findOne({ domain: data.domain });
    if (exists) throw new Error('Domain already configured');

    // [SECURITY] Validate rootDirectory to prevent path traversal and shell injection
    const rootDirectory = data.rootDirectory ? this._validateRootDirectory(data.rootDirectory) : `/var/www/${data.domain}`;

    const webhookToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

    const website = await Website.create({
      domain:        data.domain,
      aliases:       data.aliases || [],
      type:          data.type || 'static',
      rootDirectory,
      port:          data.port || null,
      phpVersion:    data.phpVersion || '8.2',
      owner:         userId,
      webhookToken,
    });

    try {
      await fs.mkdir(website.rootDirectory, { recursive: true });
      if (website.type === 'static') {
        await fs.writeFile(
          path.join(website.rootDirectory, 'index.html'),
          `<h1>Welcome to ${website.domain}</h1><p>Created via Linux Panel</p>`,
          'utf8'
        );
      }
    } catch (error) {
      console.error('Failed to create document root:', error.message);
    }

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

    const updated = await Website.findByIdAndUpdate(id, {
      aliases:       data.aliases       ?? website.aliases,
      type:          data.type          ?? website.type,
      rootDirectory: data.rootDirectory ?? website.rootDirectory,
      port:          data.port          ?? website.port,
      status:        data.status        ?? website.status,
      gitRepo:       data.gitRepo       !== undefined ? data.gitRepo       : website.gitRepo,
      autoDeploy:    data.autoDeploy    !== undefined ? data.autoDeploy    : website.autoDeploy,
      phpVersion:    data.phpVersion    ?? website.phpVersion,
      webhookToken:  website.webhookToken || (Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)),
    });

    if (updated.status === 'active') {
      await this.generateNginxConfig(updated);
    } else {
      await this.removeNginxConfig(updated.domain);
    }

    return updated;
  }

  async deployGit(id) {
    const website = await Website.findById(id);
    if (!website || !website.gitRepo) throw new Error('Website or Git Repo not found');
    
    const logs = [];
    try {
      const gitDir = path.join(website.rootDirectory, '.git');
      logs.push('Starting deployment pipeline...');
      
      try {
        await fs.access(gitDir);
        logs.push('Pulling latest commits from git repository...');
        await execAsync(`git pull`, { cwd: website.rootDirectory, timeout: 60000 });
      } catch {
        logs.push('Target directory is not a git repository. Cloning fresh...');
        try {
          const files = await fs.readdir(website.rootDirectory);
          for (const f of files) {
            await fs.rm(path.join(website.rootDirectory, f), { recursive: true, force: true });
          }
        } catch {}
        await execAsync(`git clone ${website.gitRepo} .`, { cwd: website.rootDirectory, timeout: 120000 });
      }

      const filesInRoot = await fs.readdir(website.rootDirectory);
      
      if (filesInRoot.includes('package.json')) {
        logs.push('package.json found. Installing npm dependencies...');
        await execAsync(`npm install --no-audit --no-fund`, { cwd: website.rootDirectory, timeout: 180000 });
        
        try {
          const pkgData = JSON.parse(await fs.readFile(path.join(website.rootDirectory, 'package.json'), 'utf8'));
          if (pkgData.scripts && pkgData.scripts.build) {
            logs.push('Build script found. Executing npm run build...');
            await execAsync(`npm run build`, { cwd: website.rootDirectory, timeout: 180000 });
          }
        } catch (e) {
          logs.push(`npm build skipped or failed: ${e.message}`);
        }
      }

      if (filesInRoot.includes('composer.json')) {
        logs.push('composer.json found. Running composer install...');
        await execAsync(`composer install --no-interaction --optimize-autoloader`, { cwd: website.rootDirectory, timeout: 180000 }).catch(e => {
          logs.push(`composer install skipped or failed: ${e.message}`);
        });
      }

      if (filesInRoot.includes('deploy.sh')) {
        logs.push('deploy.sh found. Executing custom deployment script...');
        if (process.platform !== 'win32') {
          await execAsync(`chmod +x deploy.sh`, { cwd: website.rootDirectory });
          await execAsync(`./deploy.sh`, { cwd: website.rootDirectory, timeout: 300000 });
        } else {
          await execAsync(`bash deploy.sh`, { cwd: website.rootDirectory, timeout: 300000 });
        }
      }

      logs.push('Deployment completed successfully.');
      return { success: true, message: 'Deployment successful', logs };
    } catch (error) {
      console.error('Git deploy error:', error);
      logs.push(`Deployment failed: ${error.message}`);
      throw new Error(`Failed to deploy from Git: ${error.message}\nLogs:\n${logs.join('\n')}`);
    }
  }

  async deleteWebsite(id) {
    const website = await Website.findById(id);
    if (!website) throw new Error('Website not found');

    await this.removeNginxConfig(website.domain);
    await Website.findByIdAndDelete(id);
    return true;
  }
}

export default new WebsiteService();
