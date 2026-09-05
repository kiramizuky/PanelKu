import fs from 'fs/promises';
import path from 'path';
import { exec, execFile } from 'child_process';
import crypto from 'crypto';
import util from 'util';
import Website from '../../models/Website.js';

const execAsync = util.promisify(exec);
const execFileAsync = util.promisify(execFile);

/**
 * [CRIT-4 FIX] Generate a cryptographically secure random token instead of Math.random().
 */
function secureToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('hex');
}

export const ACME_CHALLENGE_DIR = process.platform === 'win32'
  ? path.join(process.cwd(), 'data', 'acme-challenge')
  : '/var/www/acme-challenge';

// Vhost templates
const NGINX_TEMPLATE_STATIC = `
server {
    listen 80;
    server_name {{domain}} {{aliases}};
    root {{rootDirectory}};
    index index.html index.htm;

    access_log /var/log/nginx/{{domain}}.access.log;
    error_log /var/log/nginx/{{domain}}.error.log;

    location ^~ /.well-known/acme-challenge/ {
        root {{acmeRoot}};
        default_type "text/plain";
        try_files $uri =404;
    }

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

    location ^~ /.well-known/acme-challenge/ {
        root {{acmeRoot}};
        default_type "text/plain";
        try_files $uri =404;
    }

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

    location ^~ /.well-known/acme-challenge/ {
        root {{acmeRoot}};
        default_type "text/plain";
        try_files $uri =404;
    }

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

  /**
   * Auto-detect and bridge Nginx environment:
   * Works on both standard Ubuntu/Debian (/etc/nginx/) and aaPanel legacy (/www/server/nginx/)
   */
  async ensureNginxIntegration() {
    if (process.platform === 'win32') return;

    try {
      // 1. Ensure all standard and legacy log / conf directories exist
      await fs.mkdir('/var/log/nginx', { recursive: true }).catch(() => {});
      await fs.mkdir('/www/wwwlogs', { recursive: true }).catch(() => {});
      await fs.mkdir(this.nginxConfDir, { recursive: true }).catch(() => {});

      // 2. Check if aaPanel Nginx is active
      const aapanelConf = '/www/server/nginx/conf/nginx.conf';
      try {
        await fs.access(aapanelConf);
        const aapanelRaw = await fs.readFile(aapanelConf, 'utf8');
        if (!aapanelRaw.includes('/etc/nginx/conf.d/*.conf')) {
          // Inject our vhost include into aaPanel http block
          const injected = aapanelRaw.replace(
            /(http\s*\{)/,
            '$1\n    include /etc/nginx/conf.d/*.conf;'
          );
          await fs.writeFile(aapanelConf, injected, 'utf8');
          console.log('[WebsiteService] Integrated /etc/nginx/conf.d/*.conf into aaPanel Nginx configuration.');
        }
      } catch (_) {
        // Not aaPanel, proceed with standard check
      }

      // 3. Check if standard OS Nginx is active
      const standardConf = '/etc/nginx/nginx.conf';
      try {
        await fs.access(standardConf);
        const standardRaw = await fs.readFile(standardConf, 'utf8');
        if (!standardRaw.includes('/etc/nginx/conf.d/*.conf') && !standardRaw.includes('conf.d/*.conf')) {
          const injected = standardRaw.replace(
            /(http\s*\{)/,
            '$1\n    include /etc/nginx/conf.d/*.conf;'
          );
          await fs.writeFile(standardConf, injected, 'utf8');
          console.log('[WebsiteService] Ensured /etc/nginx/conf.d/*.conf in standard Nginx configuration.');
        }
      } catch (_) {}
    } catch (e) {
      console.warn('[WebsiteService] ensureNginxIntegration warning:', e.message);
    }
  }

  /**
   * Adaptively get FastCGI location block for PHP based on server environment
   */
  async getPhpFastcgiDirective(phpVersion = '8.2') {
    if (process.platform === 'win32') {
      return `location ~ \\.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/var/run/php/php${phpVersion}-fpm.sock;
    }`;
    }

    const cleanVer = (phpVersion || '8.2').replace('.', '');
    const aapanelSock = `/tmp/php-cgi-${cleanVer}.sock`;
    const standardSock = `/var/run/php/php${phpVersion || '8.2'}-fpm.sock`;

    let sock = standardSock;
    let includeFile = 'include snippets/fastcgi-php.conf;';

    // Check if aaPanel PHP socket exists
    try {
      await fs.access(aapanelSock);
      sock = aapanelSock;
      includeFile = 'include fastcgi.conf;';
    } catch {
      // Check standard Ubuntu PHP socket
      try {
        await fs.access(standardSock);
        sock = standardSock;
      } catch {}
    }

    return `location ~ \\.php$ {
        ${includeFile}
        fastcgi_pass unix:${sock};
    }`;
  }

  async reloadNginx(portToCheck = null) {
    if (process.platform === 'win32') return { success: true, portListening: false };

    try {
      // 1. Syntax test
      await execAsync('sudo nginx -t 2>/dev/null || nginx -t');

      // 2. Restart using comprehensive fallbacks:
      // Works for both aaPanel (/etc/init.d/nginx) and standard Ubuntu (systemctl)
      const restartCmd = [
        '([ -x /etc/init.d/nginx ] && sudo /etc/init.d/nginx restart 2>/dev/null)',
        'sudo systemctl restart nginx 2>/dev/null',
        'sudo service nginx restart 2>/dev/null',
        '([ -x /www/server/nginx/sbin/nginx ] && sudo /www/server/nginx/sbin/nginx -s reload 2>/dev/null)',
        'sudo nginx -s reload 2>/dev/null'
      ].join(' || ');

      await execAsync(restartCmd);

      // 3. Verify listening port if specified
      let portListening = false;
      if (portToCheck) {
        try {
          const { stdout } = await execAsync(`sudo ss -tulpn | grep -E '(:${portToCheck}\\b|LISTEN.*${portToCheck})' || true`);
          portListening = stdout.includes(String(portToCheck));
        } catch (_) {}
      }

      return { success: true, portListening };
    } catch (error) {
      console.error('Failed to restart nginx:', error.message);
      return { success: false, error: error.message };
    }
  }

  async generateNginxConfig(website) {
    await this.ensureNginxIntegration();
    const isSsl = Boolean(
      website.ssl &&
      website.ssl.enabled &&
      website.ssl.certificate &&
      website.ssl.privateKey
    );

    let conf = '';
    const aliases = (website.aliases || []).filter(Boolean).join(' ');

    if (isSsl) {
      // 1. Port 80 redirect block + ACME challenge pass-through
      conf += `server {
    listen 80;
    server_name ${website.domain}${aliases ? ' ' + aliases : ''};

    location ^~ /.well-known/acme-challenge/ {
        root ${ACME_CHALLENGE_DIR};
        default_type "text/plain";
        try_files $uri =404;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}
`;

      // 2. Port 443 SSL block
      if (website.type === 'proxy') {
        conf += `server {
    listen 443 ssl http2;
    server_name ${website.domain}${aliases ? ' ' + aliases : ''};

    ssl_certificate ${website.ssl.certificate};
    ssl_certificate_key ${website.ssl.privateKey};
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    access_log /var/log/nginx/${website.domain}.access.log;
    error_log /var/log/nginx/${website.domain}.error.log;

    location / {
        proxy_pass http://127.0.0.1:${website.port || 8080};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
`;
      } else if (website.type === 'php') {
        conf += `server {
    listen 443 ssl http2;
    server_name ${website.domain}${aliases ? ' ' + aliases : ''};
    root ${website.rootDirectory};
    index index.php index.html index.htm;

    ssl_certificate ${website.ssl.certificate};
    ssl_certificate_key ${website.ssl.privateKey};
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    access_log /var/log/nginx/${website.domain}.access.log;
    error_log /var/log/nginx/${website.domain}.error.log;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \\.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/var/run/php/php${website.phpVersion || '8.2'}-fpm.sock;
    }
}
`;
      } else {
        // Static
        conf += `server {
    listen 443 ssl http2;
    server_name ${website.domain}${aliases ? ' ' + aliases : ''};
    root ${website.rootDirectory};
    index index.html index.htm;

    ssl_certificate ${website.ssl.certificate};
    ssl_certificate_key ${website.ssl.privateKey};
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    access_log /var/log/nginx/${website.domain}.access.log;
    error_log /var/log/nginx/${website.domain}.error.log;

    location / {
        try_files $uri $uri/ =404;
    }
}
`;
      }
    } else {
      let template = NGINX_TEMPLATE_STATIC;
      if (website.type === 'proxy') template = NGINX_TEMPLATE_PROXY;
      else if (website.type === 'php') template = NGINX_TEMPLATE_PHP;
      
      conf = template
        .replace(/{{domain}}/g, website.domain)
        .replace(/{{aliases}}/g, aliases)
        .replace(/{{rootDirectory}}/g, website.rootDirectory || `/var/www/${website.domain}`)
        .replace(/{{acmeRoot}}/g, ACME_CHALLENGE_DIR)
        .replace(/{{port}}/g, website.port || 8080)
        .replace(/{{phpVersion}}/g, website.phpVersion || '8.2');
    }

    const confPath = path.join(this.nginxConfDir, `${website.domain}.conf`);
    
    try {
      await fs.mkdir(ACME_CHALLENGE_DIR, { recursive: true });
      await fs.mkdir(this.nginxConfDir, { recursive: true });
      await fs.mkdir('/var/log/nginx', { recursive: true }).catch(() => {});
      await fs.mkdir('/www/wwwlogs', { recursive: true }).catch(() => {});
      if (process.platform !== 'win32') {
        await execAsync('mkdir -p /var/log/nginx /www/wwwlogs 2>/dev/null || true').catch(() => {});
      }
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

  /**
   * [R3-H1 FIX] Validate a git repository URL to prevent command injection
   * in `git clone ${gitRepo}`.
   *
   * Only URL-safe characters are allowed (no shell metacharacters), and the
   * value must start with a known scheme: https/http/git/ssh/file, or a
   * scp-like SSH URL (git@host:path or user@host:path — e.g. deploy keys).
   * Empty string is allowed (means "no repo"). Strict by design: unusual
   * but valid URLs (query strings, IPv6 literals) are rejected (fail-closed)
   * because git clone does not need them.
   */
  _validateGitRepo(repo) {
    if (repo === undefined || repo === null) return '';
    if (typeof repo !== 'string') throw new Error('Git repository URL must be a string');

    const value = repo.trim();
    if (value === '') return ''; // clearing the repo is allowed

    if (value.length > 512) throw new Error('Git repository URL is too long');

    // Must start with a known scheme — including scp-like user@host:path
    // (self-hosted git with deploy keys, non-`git` usernames).
    if (!/^(https?:\/\/|git:\/\/|ssh:\/\/|git@|file:\/\/|[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+:)/i.test(value)) {
      throw new Error('Git repository must be a valid https/http/ssh/git URL');
    }

    // Allow only URL-safe characters — blocks all shell metacharacters
    // (;, |, &, $, `, quotes, parentheses, whitespace, etc.)
    if (!/^[a-zA-Z0-9._:@%/+~#-]+$/.test(value)) {
      throw new Error('Git repository URL contains invalid characters');
    }

    return value;
  }

  async createWebsite(data, userId) {
    const exists = await Website.findOne({ domain: data.domain });
    if (exists) throw new Error('Domain already configured');

    // [SECURITY] Validate rootDirectory to prevent path traversal and shell injection
    const rootDirectory = data.rootDirectory ? this._validateRootDirectory(data.rootDirectory) : `/var/www/${data.domain}`;

    // [CRIT-4 FIX] Use cryptographically secure token instead of Math.random()
    const webhookToken = secureToken();

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

    // [R3-H1 FIX] Validate gitRepo before persisting (defense in depth —
    // deployGit also re-validates, but reject bad values at the write point).
    // Only validate when the field is actually being changed, so unrelated
    // updates never fail on a pre-existing value.
    let safeGitRepo = website.gitRepo;
    if (data.gitRepo !== undefined) {
      safeGitRepo = this._validateGitRepo(data.gitRepo);
    }

    const oldDomain = website.domain;
    const newDomain = data.domain && data.domain !== oldDomain ? data.domain : oldDomain;

    const updated = await Website.findByIdAndUpdate(id, {
      domain:        newDomain,
      aliases:       data.aliases       ?? website.aliases,
      type:          data.type          ?? website.type,
      rootDirectory: data.rootDirectory ?? website.rootDirectory,
      port:          data.port          ?? website.port,
      status:        data.status        ?? website.status,
      gitRepo:       safeGitRepo,
      gitBranch:     data.gitBranch     ?? website.gitBranch,
      autoDeploy:    data.autoDeploy    !== undefined ? data.autoDeploy    : website.autoDeploy,
      phpVersion:    data.phpVersion    ?? website.phpVersion,
      webhookToken:  website.webhookToken || secureToken(),
    }, { new: true });

    // If domain changed, remove old nginx config and regenerate
    if (newDomain !== oldDomain) {
      await this.removeNginxConfig(oldDomain);
      if (updated.status === 'active') {
        await this.generateNginxConfig(updated);
      }
    } else {
      const isCustomNginx = Boolean(updated.settings && updated.settings.customNginx);
      if (updated.status === 'active') {
        // Do NOT overwrite user's custom Nginx edits when updating general settings
        if (!isCustomNginx) {
          await this.generateNginxConfig(updated);
        }
      } else {
        await this.removeNginxConfig(updated.domain);
      }
    }

    return updated;
  }

  async deployGit(id) {
    const website = await Website.findById(id);
    if (!website || !website.gitRepo) throw new Error('Website or Git Repo not found');

    // [R3-H1 FIX] Validate before execution — even if a bad value was stored
    // previously (e.g. before this fix), the clone is blocked here.
    const safeGitRepo = this._validateGitRepo(website.gitRepo);
    
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
        // [R3-H1 FIX] execFile + args array (NO shell) + validated URL.
        // NEVER revert to `execAsync('git clone ' + repo)`: the URL may
        // legally contain '%' sequences or '#' a shell would interpret.
        await execFileAsync('git', ['clone', safeGitRepo, '.'], { cwd: website.rootDirectory, timeout: 120000 });
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

  async getNginxConfig(id) {
    const website = await Website.findById(id);
    if (!website) throw new Error('Website not found');

    const confPath = path.join(this.nginxConfDir, `${website.domain}.conf`);
    try {
      await fs.access(confPath);
    } catch {
      // If config doesn't exist yet on disk, write from saved custom content or generate
      if (website.settings?.customNginx && website.settings?.customNginxContent) {
        await fs.mkdir(this.nginxConfDir, { recursive: true });
        await fs.writeFile(confPath, website.settings.customNginxContent, 'utf8');
      } else {
        await this.generateNginxConfig(website);
      }
    }

    let content = '';
    try {
      content = await fs.readFile(confPath, 'utf8');
    } catch (err) {
      throw new Error(`Failed to read Nginx configuration file: ${err.message}`);
    }

    return {
      domain: website.domain,
      confPath,
      content,
      isCustom: Boolean(website.settings?.customNginx),
    };
  }

  async saveNginxConfig(id, content) {
    const website = await Website.findById(id);
    if (!website) throw new Error('Website not found');
    if (typeof content !== 'string') throw new Error('Configuration content must be a string');

    const confPath = path.join(this.nginxConfDir, `${website.domain}.conf`);
    const backupPath = `${confPath}.bak`;

    // Ensure environment is bridged & directories exist
    await this.ensureNginxIntegration();
    await fs.mkdir(this.nginxConfDir, { recursive: true });
    await fs.mkdir('/var/log/nginx', { recursive: true }).catch(() => {});
    await fs.mkdir('/www/wwwlogs', { recursive: true }).catch(() => {});
    if (process.platform !== 'win32') {
      await execAsync('mkdir -p /var/log/nginx /www/wwwlogs 2>/dev/null || true').catch(() => {});
    }

    let existing = null;
    try {
      existing = await fs.readFile(confPath, 'utf8');
      await fs.writeFile(backupPath, existing, 'utf8');
    } catch {
      // File didn't exist before, no backup needed
    }

    try {
      await fs.writeFile(confPath, content, 'utf8');

      // Test nginx syntax if on Linux
      if (process.platform !== 'win32') {
        try {
          await execAsync('nginx -t');
        } catch (testErr) {
          // Revert to backup if nginx -t fails
          if (existing !== null) {
            await fs.writeFile(confPath, existing, 'utf8');
            await fs.unlink(backupPath).catch(() => {});
          } else {
            await fs.unlink(confPath).catch(() => {});
          }
          const stderr = testErr.stderr || testErr.message;
          throw new Error(`Nginx syntax test failed (reverted): ${stderr}`);
        }
      }

      // Cleanup backup
      if (existing !== null) {
        await fs.unlink(backupPath).catch(() => {});
      }

      // Save custom status & content in DB settings so updates don't overwrite it
      const settings = { ...(website.settings || {}), customNginx: true, customNginxContent: content };
      await Website.findByIdAndUpdate(id, { settings });

      // Extract listen port to verify after restart
      const listenMatch = content.match(/listen\s+(\d+)/);
      const portToCheck = listenMatch ? parseInt(listenMatch[1], 10) : (website.port || 80);

      const reloadResult = await this.reloadNginx(portToCheck);
      let message = 'Nginx configuration saved and reloaded successfully';
      if (reloadResult?.portListening) {
        message += ` (Port ${portToCheck} is active & listening)`;
      }

      return {
        success: true,
        message,
        portListening: Boolean(reloadResult?.portListening),
      };
    } catch (err) {
      throw err;
    }
  }

  async resetNginxConfig(id) {
    const website = await Website.findById(id);
    if (!website) throw new Error('Website not found');

    const settings = { ...(website.settings || {}) };
    delete settings.customNginx;
    delete settings.customNginxContent;
    await Website.findByIdAndUpdate(id, { settings });

    // Regenerate from default template
    await this.generateNginxConfig(website);
    return this.getNginxConfig(id);
  }
}

export default new WebsiteService();
