import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import logger from '../../config/logger.js';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

/** Detect whether the OS uses apache2 (Debian/Ubuntu) or httpd (RHEL/CentOS) */
async function detectApacheBinary() {
  try {
    const { stdout } = await execAsync('which apache2 2>/dev/null || which httpd 2>/dev/null || echo ""');
    const bin = stdout.trim();
    if (bin.includes('apache2')) return { bin: 'apache2', svc: 'apache2', confDir: '/etc/apache2', pkg: 'apache2' };
    if (bin.includes('httpd')) return { bin: 'httpd', svc: 'httpd', confDir: '/etc/httpd', pkg: 'httpd' };
    return null;
  } catch {
    return null;
  }
}

/**
 * Validate a domain name or vhost name.
 */
function validateName(name) {
  if (!name || typeof name !== 'string') throw new Error('Name is required');
  if (!/^[a-zA-Z0-9._\-*]+$/.test(name)) throw new Error('Invalid name format');
  return name;
}

/**
 * Safe shell command runner with validated args.
 */
async function _runCmd(cmd, args = [], opts = {}) {
  if (process.platform === 'win32') return { stdout: '', stderr: '' };
  try {
    return await execFileAsync(cmd, args, { timeout: 30000, ...opts });
  } catch (err) {
    logger.warn(`Command failed: ${cmd} ${args.join(' ')} — ${err.message}`);
    throw err;
  }
}

// ── Vhost templates ──────────────────────────────────────────────

const APACHE_TEMPLATE_STATIC = `<VirtualHost *:80>
    ServerName {{domain}}
    {{aliases}}
    DocumentRoot {{rootDirectory}}

    <Directory {{rootDirectory}}>
        Options Indexes FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>

    ErrorLog \${APACHE_LOG_DIR}/{{safelog}}.error.log
    CustomLog \${APACHE_LOG_DIR}/{{safelog}}.access.log combined
</VirtualHost>
`;

const APACHE_TEMPLATE_PROXY = `<VirtualHost *:80>
    ServerName {{domain}}
    {{aliases}}

    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:{{port}}/
    ProxyPassReverse / http://127.0.0.1:{{port}}/

    <Location />
        Require all granted
    </Location>

    ErrorLog \${APACHE_LOG_DIR}/{{safelog}}.error.log
    CustomLog \${APACHE_LOG_DIR}/{{safelog}}.access.log combined
</VirtualHost>
`;

const APACHE_TEMPLATE_PHP = `<VirtualHost *:80>
    ServerName {{domain}}
    {{aliases}}
    DocumentRoot {{rootDirectory}}

    <Directory {{rootDirectory}}>
        Options Indexes FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>

    <FilesMatch \\.php$>
        SetHandler "proxy:unix:/var/run/php/php{{phpVersion}}-fpm.sock|fcgi://localhost/"
    </FilesMatch>

    ErrorLog \${APACHE_LOG_DIR}/{{safelog}}.error.log
    CustomLog \${APACHE_LOG_DIR}/{{safelog}}.access.log combined
</VirtualHost>
`;

const APACHE_TEMPLATE_SSL = `<VirtualHost *:443>
    ServerName {{domain}}
    {{aliases}}
    DocumentRoot {{rootDirectory}}

    SSLEngine on
    SSLCertificateFile {{sslCert}}
    SSLCertificateKeyFile {{sslKey}}

    <Directory {{rootDirectory}}>
        Options Indexes FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>

    ErrorLog \${APACHE_LOG_DIR}/{{safelog}}.error.log
    CustomLog \${APACHE_LOG_DIR}/{{safelog}}.access.log combined
</VirtualHost>
`;

class ApacheService {
  constructor() {
    this._binary = null;
  }

  async _getBinary() {
    if (this._binary) return this._binary;
    const info = await detectApacheBinary();
    if (!info) throw new Error('Apache is not installed on this system.');
    this._binary = info;
    return info;
  }

  // ── Install / Uninstall ────────────────────────────────────────

  async installApache() {
    if (process.platform === 'win32') {
      throw new Error('Apache installation is only supported on Linux.');
    }

    // Check if already installed
    const existing = await detectApacheBinary();
    if (existing) {
      return { message: 'Apache is already installed', binary: existing.bin };
    }

    try {
      // Detect package manager
      const pm = await this._detectPackageManager();
      let installCmd;
      if (pm === 'apt') {
        installCmd = 'DEBIAN_FRONTEND=noninteractive apt-get install -y apache2 apache2-utils';
      } else if (pm === 'yum') {
        installCmd = 'yum install -y httpd httpd-tools mod_ssl';
      } else if (pm === 'dnf') {
        installCmd = 'dnf install -y httpd httpd-tools mod_ssl';
      } else {
        throw new Error(`Unsupported package manager: ${pm}`);
      }

      const { stdout, stderr } = await execAsync(installCmd, { timeout: 180000 });
      this._binary = null; // Reset cache

      // Verify installation
      const info = await this._getBinary();

      // Enable necessary modules on Debian/Ubuntu
      if (info.pkg === 'apache2') {
        try {
          await execAsync('a2enmod rewrite proxy proxy_http ssl headers expires 2>/dev/null', { timeout: 15000 });
        } catch { /* non-critical */ }
      }

      // Start service
      try {
        await execAsync(`systemctl enable ${info.svc} 2>/dev/null && systemctl start ${info.svc} 2>/dev/null`, { timeout: 15000 });
      } catch { /* non-critical */ }

      return {
        message: 'Apache installed successfully',
        binary: info.bin,
        output: stdout + stderr,
      };
    } catch (err) {
      throw new Error(`Failed to install Apache: ${err.message}`);
    }
  }

  async uninstallApache() {
    const info = await this._getBinary();
    const pm = await this._detectPackageManager();

    try {
      // Stop service first
      await execAsync(`systemctl stop ${info.svc} 2>/dev/null`, { timeout: 10000 });

      let uninstallCmd;
      if (pm === 'apt') {
        uninstallCmd = `DEBIAN_FRONTEND=noninteractive apt-get remove -y --purge ${info.pkg} apache2-utils`;
      } else if (pm === 'yum' || pm === 'dnf') {
        uninstallCmd = `${pm} remove -y ${info.pkg} httpd-tools`;
      } else {
        throw new Error(`Unsupported package manager: ${pm}`);
      }

      const { stdout, stderr } = await execAsync(uninstallCmd, { timeout: 120000 });
      this._binary = null;

      return {
        message: 'Apache uninstalled successfully',
        output: stdout + stderr,
      };
    } catch (err) {
      throw new Error(`Failed to uninstall Apache: ${err.message}`);
    }
  }

  // ── Status ──────────────────────────────────────────────────────

  async getStatus() {
    let installed = true;
    let info = null;
    try {
      info = await this._getBinary();
    } catch {
      installed = false;
    }

    let running = false;
    let version = 'N/A';
    let uptime = null;
    let pid = null;
    let listeningPorts = [];

    if (info) {
      try {
        const { stdout: verOut } = await execAsync(`${info.bin} -v 2>/dev/null || echo ""`);
        const verMatch = verOut.match(/Apache\/([\d.]+)/);
        if (verMatch) version = verMatch[1];
      } catch { /* ignore */ }

      try {
        const { stdout: statusOut } = await execAsync(`systemctl is-active ${info.svc} 2>/dev/null`);
        running = statusOut.trim() === 'active';
      } catch { /* ignore */ }

      if (running) {
        try {
          const { stdout: pidOut } = await execAsync(`cat /var/run/${info.svc}/${info.svc}.pid 2>/dev/null || pgrep -x ${info.bin} 2>/dev/null | head -1`);
          pid = pidOut.trim() || null;
        } catch { /* ignore */ }

        try {
          const { stdout: ssOut } = await execAsync(`ss -tlnp 2>/dev/null | grep -i apache || netstat -tlnp 2>/dev/null | grep -i apache || echo ""`);
          listeningPorts = [...ssOut.matchAll(/:(\d+)\s/g)].map(m => parseInt(m[1])).filter(p => p);
        } catch { /* ignore */ }
      }
    }

    // Module count
    let loadedModules = [];
    if (info) {
      try {
        const { stdout: modOut } = await execAsync(`${info.bin} -t -D DUMP_MODULES 2>/dev/null || echo ""`);
        loadedModules = modOut.split('\n')
          .filter(l => l.includes('_module'))
          .map(l => l.trim().replace(/\s*\(shared\)\s*$/, '').replace('_module', ''));
      } catch { /* ignore */ }
    }

    return {
      installed,
      binary: info?.bin || null,
      service: info?.svc || null,
      version,
      running,
      pid,
      uptime,
      listeningPorts: [...new Set(listeningPorts)],
      loadedModulesCount: loadedModules.length,
      loadedModules,
    };
  }

  // ── Service Control ────────────────────────────────────────────

  async serviceAction(action) {
    if (!['start', 'stop', 'restart', 'reload'].includes(action)) {
      throw new Error(`Invalid action: ${action}`);
    }
    const info = await this._getBinary();
    try {
      const { stdout, stderr } = await execAsync(`systemctl ${action} ${info.svc} 2>&1`, { timeout: 30000 });
      return { message: `Apache ${action}ed successfully.`, output: stdout + stderr };
    } catch (err) {
      throw new Error(`Failed to ${action} Apache: ${err.message}`);
    }
  }

  async testConfig() {
    const info = await this._getBinary();
    try {
      const { stdout, stderr } = await execAsync(`${info.bin} configtest 2>&1`, { timeout: 10000 });
      const isOk = stdout.includes('Syntax OK') || stderr.includes('Syntax OK');
      return {
        valid: isOk,
        output: stdout + stderr,
        message: isOk ? 'Configuration syntax is valid' : 'Configuration has errors',
      };
    } catch (err) {
      return {
        valid: false,
        output: err.message,
        message: `Configuration test failed: ${err.message}`,
      };
    }
  }

  // ── Module Management ──────────────────────────────────────────

  async getModules() {
    const info = await this._getBinary();
    let enabled = [];
    let available = [];

    if (info.pkg === 'apache2') {
      // Debian/Ubuntu: use a2enmod/a2dismod system
      try {
        const { stdout: enabledOut } = await execAsync('ls /etc/apache2/mods-enabled/ 2>/dev/null | sed "s/\\.load$//" | sort -u || echo ""');
        enabled = enabledOut.split('\n').filter(l => l.trim() && l.endsWith('.load')).map(l => l.replace('.load', ''));
        // Actually simpler: just list .load files and strip suffix
        enabled = enabledOut.split('\n').filter(l => l.trim()).map(l => l.replace(/\.(load|conf)$/, ''));
        enabled = [...new Set(enabled)].filter(Boolean);
      } catch { /* ignore */ }

      try {
        const { stdout: availOut } = await execAsync('ls /etc/apache2/mods-available/ 2>/dev/null | sed "s/\\.load$//" | sort -u || echo ""');
        available = availOut.split('\n').filter(l => l.trim()).map(l => l.replace(/\.(load|conf)$/, ''));
        available = [...new Set(available)].filter(Boolean);
      } catch { /* ignore */ }
    } else {
      // RHEL/CentOS: modules are typically compiled in or loaded via LoadModule directives
      try {
        const { stdout: modOut } = await execAsync(`${info.bin} -t -D DUMP_MODULES 2>/dev/null || echo ""`);
        enabled = modOut.split('\n')
          .filter(l => l.includes('_module'))
          .map(l => l.trim().replace(/\s*\(shared\)\s*$/, '').replace('_module', ''));
      } catch { /* ignore */ }
      available = [...enabled];
    }

    return { enabled, available };
  }

  async enableModule(name) {
    if (!name || typeof name !== 'string') throw new Error('Module name is required');
    if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new Error('Invalid module name');

    const info = await this._getBinary();
    if (info.pkg === 'apache2') {
      try {
        await execAsync(`a2enmod ${name} 2>&1`, { timeout: 10000 });
        await this.serviceAction('reload');
        return { message: `Module "${name}" enabled and Apache reloaded.` };
      } catch (err) {
        throw new Error(`Failed to enable module "${name}": ${err.message}`);
      }
    } else {
      // RHEL: modules are usually loaded via conf files
      throw new Error('Module management via CLI is only supported on Debian/Ubuntu (a2enmod).');
    }
  }

  async disableModule(name) {
    if (!name || typeof name !== 'string') throw new Error('Module name is required');
    if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new Error('Invalid module name');

    const info = await this._getBinary();
    if (info.pkg === 'apache2') {
      try {
        await execAsync(`a2dismod ${name} 2>&1`, { timeout: 10000 });
        await this.serviceAction('reload');
        return { message: `Module "${name}" disabled and Apache reloaded.` };
      } catch (err) {
        throw new Error(`Failed to disable module "${name}": ${err.message}`);
      }
    } else {
      throw new Error('Module management via CLI is only supported on Debian/Ubuntu (a2dismod).');
    }
  }

  // ── Virtual Host Management ────────────────────────────────────

  async _getVhostDirs() {
    const info = await this._getBinary();
    let sitesAvailable, sitesEnabled;
    if (info.pkg === 'apache2') {
      sitesAvailable = '/etc/apache2/sites-available';
      sitesEnabled = '/etc/apache2/sites-enabled';
    } else {
      sitesAvailable = `${info.confDir}/conf.d`;
      sitesEnabled = `${info.confDir}/conf.d`;
    }
    return { sitesAvailable, sitesEnabled, info };
  }

  async getVhosts() {
    const { sitesAvailable, sitesEnabled, info } = await this._getVhostDirs();

    let vhosts = [];
    try {
      const files = await fs.readdir(sitesAvailable);
      const confFiles = files.filter(f => f.endsWith('.conf'));

      for (const file of confFiles) {
        try {
          const content = await fs.readFile(path.join(sitesAvailable, file), 'utf8');

          // Parse key info from the vhost
          const serverName = content.match(/ServerName\s+(\S+)/)?.[1] || file.replace('.conf', '');
          const aliases = content.match(/ServerAlias\s+(.+)/)?.[1]?.split(/\s+/) || [];
          const docRoot = content.match(/DocumentRoot\s+(\S+)/)?.[1] || '';
          const port443 = content.includes(':443>') || content.includes('SSLEngine on');
          const proxyPass = content.match(/ProxyPass\s+\/\s+(http:\/\/[^\s]+)/)?.[1] || '';
          const phpHandler = content.includes('proxy:unix:/var/run/php');
          const portMatch = content.match(/<VirtualHost\s+\*:(\d+)/);
          const port = portMatch ? parseInt(portMatch[1]) : 80;

          // Check if enabled
          let enabled = false;
          try {
            await fs.access(path.join(sitesEnabled, file));
            enabled = true;
          } catch {
            // RHEL/CentOS: conf.d files are automatically included
            if (info.pkg === 'httpd') enabled = true;
          }

          // Get SSL cert paths if any
          const sslCert = content.match(/SSLCertificateFile\s+(\S+)/)?.[1] || null;

          vhosts.push({
            file,
            serverName,
            aliases,
            documentRoot: docRoot,
            port,
            ssl: port443,
            sslCert,
            proxyTarget: proxyPass,
            php: phpHandler,
            enabled,
            rawContent: content,
          });
        } catch (e) {
          logger.warn(`Failed to read vhost file ${file}: ${e.message}`);
        }
      }
    } catch (err) {
      logger.warn(`Failed to list vhosts from ${sitesAvailable}: ${err.message}`);
    }

    return vhosts;
  }

  async getVhost(name) {
    validateName(name);
    const { sitesAvailable } = await this._getVhostDirs();
    const filePath = path.join(sitesAvailable, `${name}.conf`);

    try {
      const content = await fs.readFile(filePath, 'utf8');
      return {
        name,
        content,
        path: filePath,
      };
    } catch (err) {
      throw new Error(`Vhost "${name}" not found: ${err.message}`);
    }
  }

  async createVhost(data) {
    if (!data.serverName) throw new Error('ServerName is required');
    validateName(data.serverName);

    const { sitesAvailable } = await this._getVhostDirs();
    const safeName = data.serverName.replace(/[*]/g, '_wildcard_');
    const filePath = path.join(sitesAvailable, `${safeName}.conf`);

    // Check if already exists
    try {
      await fs.access(filePath);
      throw new Error(`Vhost for "${data.serverName}" already exists`);
    } catch (err) {
      if (err.message.includes('already exists')) throw err;
      // File doesn't exist, good to create
    }

    let template;
    if (data.type === 'proxy') {
      template = APACHE_TEMPLATE_PROXY;
    } else if (data.type === 'php') {
      template = APACHE_TEMPLATE_PHP;
    } else if (data.type === 'ssl') {
      template = APACHE_TEMPLATE_SSL;
    } else {
      template = APACHE_TEMPLATE_STATIC;
    }

    const aliasesStr = (data.aliases || []).map(a => `ServerAlias ${a}`).join('\n    ');
    const safeLogName = safeName.replace(/[^a-zA-Z0-9_-]/g, '_');

    let conf = template
      .replace(/{{domain}}/g, data.serverName)
      .replace(/{{aliases}}/g, aliasesStr)
      .replace(/{{rootDirectory}}/g, data.rootDirectory || `/var/www/${safeName}`)
      .replace(/{{port}}/g, data.port || 8080)
      .replace(/{{phpVersion}}/g, data.phpVersion || '8.2')
      .replace(/{{sslCert}}/g, data.sslCert || '/etc/ssl/certs/ssl-cert-snakeoil.pem')
      .replace(/{{sslKey}}/g, data.sslKey || '/etc/ssl/private/ssl-cert-snakeoil.key')
      .replace(/{{safelog}}/g, safeLogName);

    await fs.writeFile(filePath, conf, 'utf8');

    // Enable site (a2ensite on Debian/Ubuntu)
    const info = await this._getBinary();
    if (info.pkg === 'apache2') {
      try {
        await execAsync(`a2ensite ${safeName}.conf 2>&1`, { timeout: 10000 });
      } catch { /* non-critical, sites-enabled symlink may fail */ }
    }

    // Create document root if requested
    const rootDir = data.rootDirectory || `/var/www/${safeName}`;
    if (data.createRoot !== false) {
      try {
        await fs.mkdir(rootDir, { recursive: true });
        if (data.type !== 'proxy' && data.type !== 'ssl') {
          // Create a default index.html
          try {
            await fs.writeFile(
              path.join(rootDir, 'index.html'),
              `<h1>Welcome to ${data.serverName}</h1><p>Served by Apache via Panelku</p>`,
              'utf8'
            );
          } catch { /* ignore */ }
        }
      } catch (e) {
        logger.warn(`Failed to create document root ${rootDir}: ${e.message}`);
      }
    }

    // Test config then reload
    const test = await this.testConfig();
    if (test.valid) {
      await this.serviceAction('reload');
    } else {
      // Clean up on config test failure
      try { await fs.unlink(filePath); } catch { /* ignore */ }
      throw new Error(`Apache config test failed: ${test.output}`);
    }

    return {
      message: `Vhost "${data.serverName}" created and Apache reloaded.`,
      file: `${safeName}.conf`,
    };
  }

  async updateVhost(name, data) {
    validateName(name);
    const { sitesAvailable } = await this._getVhostDirs();
    const filePath = path.join(sitesAvailable, `${name}.conf`);

    try {
      await fs.access(filePath);
    } catch {
      throw new Error(`Vhost "${name}" not found`);
    }

    let existingContent = await fs.readFile(filePath, 'utf8');

    // Apply changes based on data
    if (data.documentRoot) {
      existingContent = existingContent.replace(
        /DocumentRoot\s+\S+/,
        `DocumentRoot ${data.documentRoot}`
      );
    }

    if (data.port) {
      existingContent = existingContent.replace(
        /<VirtualHost \*:\d+/,
        `<VirtualHost *:${data.port}`
      );
    }

    if (data.aliases !== undefined) {
      // Remove existing ServerAlias lines
      existingContent = existingContent.replace(/ServerAlias\s+.*\n?/g, '');
      // Add new aliases after ServerName
      if (data.aliases.length > 0) {
        const aliasStr = data.aliases.map(a => `    ServerAlias ${a}`).join('\n');
        existingContent = existingContent.replace(
          /(ServerName\s+\S+)/,
          `$1\n${aliasStr}`
        );
      }
    }

    await fs.writeFile(filePath, existingContent, 'utf8');

    const test = await this.testConfig();
    if (test.valid) {
      await this.serviceAction('reload');
    } else {
      // Restore original
      await fs.writeFile(filePath, existingContent, 'utf8');
      throw new Error(`Config test failed: ${test.output}`);
    }

    return { message: `Vhost "${name}" updated and Apache reloaded.` };
  }

  async deleteVhost(name) {
    validateName(name);
    const { sitesAvailable, sitesEnabled, info } = await this._getVhostDirs();
    const filePath = path.join(sitesAvailable, `${name}.conf`);

    try {
      await fs.access(filePath);
    } catch {
      throw new Error(`Vhost "${name}" not found`);
    }

    // Disable site first (a2dissite on Debian/Ubuntu)
    if (info.pkg === 'apache2') {
      try {
        await execAsync(`a2dissite ${name}.conf 2>&1`, { timeout: 10000 });
      } catch { /* ignore */ }
    }

    // Remove enabled symlink on RHEL
    try {
      await fs.unlink(path.join(sitesEnabled, `${name}.conf`));
    } catch { /* ignore */ }

    // Remove the config file
    await fs.unlink(filePath);

    await this.serviceAction('reload');
    return { message: `Vhost "${name}" deleted and Apache reloaded.` };
  }

  async toggleVhost(name, enable) {
    validateName(name);
    const info = await this._getBinary();

    if (info.pkg === 'apache2') {
      const action = enable ? 'a2ensite' : 'a2dissite';
      try {
        await execAsync(`${action} ${name}.conf 2>&1`, { timeout: 10000 });
        await this.serviceAction('reload');
        return { message: `Vhost "${name}" ${enable ? 'enabled' : 'disabled'}.` };
      } catch (err) {
        throw new Error(`Failed to ${enable ? 'enable' : 'disable'} vhost: ${err.message}`);
      }
    } else {
      // RHEL: manage symlink in conf.d
      const { sitesEnabled, sitesAvailable } = await this._getVhostDirs();
      const src = path.join(sitesAvailable, `${name}.conf`);
      const dst = path.join(sitesEnabled, `${name}.conf`);

      if (enable) {
        try {
          await fs.symlink(src, dst);
        } catch { /* might already exist */ }
      } else {
        try { await fs.unlink(dst); } catch { /* ignore */ }
      }

      await this.serviceAction('reload');
      return { message: `Vhost "${name}" ${enable ? 'enabled' : 'disabled'}.` };
    }
  }

  // ── Config File ────────────────────────────────────────────────

  async getMainConfig() {
    const info = await this._getBinary();
    let mainConfig;
    if (info.pkg === 'apache2') {
      mainConfig = '/etc/apache2/apache2.conf';
    } else {
      mainConfig = `${info.confDir}/conf/httpd.conf`;
    }

    try {
      const content = await fs.readFile(mainConfig, 'utf8');
      return { path: mainConfig, content };
    } catch (err) {
      throw new Error(`Failed to read main config: ${err.message}`);
    }
  }

  async saveMainConfig(content) {
    if (!content || typeof content !== 'string') throw new Error('Config content is required');

    const info = await this._getBinary();
    let mainConfig;
    if (info.pkg === 'apache2') {
      mainConfig = '/etc/apache2/apache2.conf';
    } else {
      mainConfig = `${info.confDir}/conf/httpd.conf`;
    }

    // Backup current config
    try {
      await fs.copyFile(mainConfig, `${mainConfig}.bak`);
    } catch { /* ignore */ }

    await fs.writeFile(mainConfig, content, 'utf8');

    const test = await this.testConfig();
    if (!test.valid) {
      // Restore from backup
      try {
        await fs.copyFile(`${mainConfig}.bak`, mainConfig);
      } catch { /* ignore */ }
      throw new Error(`Config test failed: ${test.output}`);
    }

    await this.serviceAction('reload');

    return { message: 'Main configuration saved and Apache reloaded.' };
  }

  // ── Logs ───────────────────────────────────────────────────────

  async getLogs(vhostName, type = 'access', lines = 100) {
    const safeLines = Math.min(Math.max(parseInt(lines) || 100, 10), 1000);
    const info = await this._getBinary();
    const logDir = info.pkg === 'apache2' ? '/var/log/apache2' : '/var/log/httpd';

    let logFile;
    if (vhostName) {
      const safeName = vhostName.replace(/[^a-zA-Z0-9._*-]/g, '_');
      logFile = path.join(logDir, `${safeName}.${type}.log`);
    } else {
      logFile = path.join(logDir, type === 'error' ? 'error.log' : 'access.log');
    }

    try {
      const { stdout } = await execAsync(`tail -n ${safeLines} "${logFile}" 2>&1`, { timeout: 10000 });
      return { logFile, lines: stdout.split('\n') };
    } catch (err) {
      // Try alternate log paths
      try {
        const altFile = path.join(logDir, `${info.svc}_${type}.log`);
        const { stdout } = await execAsync(`tail -n ${safeLines} "${altFile}" 2>&1`, { timeout: 10000 });
        return { logFile: altFile, lines: stdout.split('\n') };
      } catch {
        throw new Error(`Log file not found: ${logFile}`);
      }
    }
  }

  // ── Helpers ────────────────────────────────────────────────────

  async _detectPackageManager() {
    try {
      await execAsync('which apt-get 2>/dev/null');
      return 'apt';
    } catch { /* try next */ }
    try {
      await execAsync('which dnf 2>/dev/null');
      return 'dnf';
    } catch { /* try next */ }
    try {
      await execAsync('which yum 2>/dev/null');
      return 'yum';
    } catch {
      throw new Error('No supported package manager found (apt, yum, dnf)');
    }
  }
}

export default new ApacheService();
