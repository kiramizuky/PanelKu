/**
 * Caddy Service — Caddy Server Reverse Proxy Manager
 *
 * Fase 13: Full management panel for Caddy server
 *   - Install/uninstall/detect Caddy
 *   - Caddyfile management (read/write/validate)
 *   - Site templates (static, proxy, php-fpm, file-server)
 *   - Automatic HTTPS via Caddy's built-in ACME
 *   - Admin API integration (Caddy v2 admin endpoint)
 *   - Service control (start/stop/restart/reload)
 *   - Config format (Caddyfile + JSON adapter)
 *   - Logs & metrics
 */

import { execFile, exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import logger from '../../config/logger.js';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

// ── Paths ──────────────────────────────────────────────────────────
const CADDYFILE_PATHS = [
  '/etc/caddy/Caddyfile',
  '/etc/caddy/Caddyfile.json',
  path.join(process.env.HOME || '/root', '.config/caddy/Caddyfile'),
];

const SITES_DIR = '/etc/caddy/sites';        // Include-able site configs
const CADDY_DATA_DIR = '/var/lib/caddy';
const CADDY_LOG_DIR = '/var/log/caddy';
const CADDY_BINARIES = ['/usr/bin/caddy', '/usr/local/bin/caddy', '/opt/caddy/caddy'];

/**
 * Validate a domain name — prevents shell injection.
 */
function validateDomain(name) {
  if (!name || typeof name !== 'string') throw new Error('Domain name is required');
  // Allow: example.com, sub.example.com, *.example.com, localhost
  if (!/^[a-zA-Z0-9.*_-]+(\.[a-zA-Z0-9.*_-]+)*$/.test(name)) {
    throw new Error('Invalid domain name format');
  }
  if (name.length > 253) throw new Error('Domain name too long');
  return name;
}

/**
 * Validate a site name (used as filename) — alphanumeric, hyphens, dots.
 */
function validateSiteName(name) {
  if (!name || typeof name !== 'string') throw new Error('Site name is required');
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) throw new Error('Invalid site name format');
  if (name.length > 100) throw new Error('Site name too long');
  return name;
}

/**
 * Validate port number.
 */
function validatePort(port) {
  const p = parseInt(port);
  if (isNaN(p) || p < 1 || p > 65535) throw new Error('Invalid port number (1-65535)');
  return p;
}

/**
 * Validate a file path for root directory.
 */
function validatePath(p) {
  if (!p || typeof p !== 'string') throw new Error('Path is required');
  // Block path traversal — only allow alphanumeric, /, _, -, ., and spaces
  if (!/^[a-zA-Z0-9_\-.\/\s]+$/.test(p)) throw new Error('Invalid path format');
  if (p.length > 4096) throw new Error('Path too long');
  return p;
}

// ── Site Templates (Caddyfile v2 format) ──────────────────────────

const TEMPLATE_STATIC = `{{domain}} {
    root * {{rootDir}}
    file_server
    encode gzip
    {{extraDirectives}}
}
`;

const TEMPLATE_PROXY = `{{domain}} {
    reverse_proxy 127.0.0.1:{{port}}
    encode gzip
    {{extraDirectives}}
}
`;

const TEMPLATE_PHP_FPM = `{{domain}} {
    root * {{rootDir}}
    php_fastcgi {{phpSocket}}
    file_server
    encode gzip
    {{extraDirectives}}
}
`;

const TEMPLATE_REDIRECT = `{{domain}} {
    redir {{redirectTarget}} {{redirectCode}}
}
`;

const TEMPLATE_FILE_SERVER = `{{domain}} {
    root * {{rootDir}}
    file_server browse
    encode gzip
    basicauth {{basicAuthUser}} {{basicAuthPass}}
    {{extraDirectives}}
}
`;

// ── Default Caddyfile base template ──────────────────────────────

const DEFAULT_CADDYFILE_BASE = `# Global Options
{
    admin localhost:2019
    email {{email}}
    acme_dirs {{dataDir}}/certificates
    storage {{dataDir}}/storage
}

# Import site-specific configs
import /etc/caddy/sites/*.conf
`;

class CaddyService {
  constructor() {
    this._binaryPath = null;
  }

  // ── Detect Caddy ────────────────────────────────────────────────

  async _findBinary() {
    if (this._binaryPath) return this._binaryPath;
    for (const bin of CADDY_BINARIES) {
      try {
        await fs.access(bin);
        this._binaryPath = bin;
        return bin;
      } catch { /* try next */ }
    }
    // Try `which` lookup
    try {
      const { stdout } = await execAsync('which caddy 2>/dev/null || echo ""');
      if (stdout.trim()) {
        this._binaryPath = stdout.trim();
        return this._binaryPath;
      }
    } catch { /* not found */ }
    return null;
  }

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
      try {
        await execAsync('which apk 2>/dev/null');
        return 'apk';
      } catch {
        throw new Error('No supported package manager found (apt, dnf, yum, apk)');
      }
    }
  }

  // ── Install / Uninstall ──────────────────────────────────────────

  async installCaddy() {
    if (process.platform === 'win32') {
      throw new Error('Caddy installation is only supported on Linux.');
    }

    const existingBin = await this._findBinary();
    if (existingBin) {
      const info = await this.getStatus();
      return { message: 'Caddy is already installed', version: info.version, binary: existingBin };
    }

    try {
      // Use official Caddy install script (most reliable)
      const { stdout, stderr } = await execAsync(
        'curl -fsSL https://getcaddy.com | bash -s personal 2>&1',
        { timeout: 120000 }
      );

      // Reset binary cache
      this._binaryPath = null;
      const bin = await this._findBinary();
      if (!bin) throw new Error('Caddy binary not found after installation');

      // Create required directories
      await fs.mkdir('/etc/caddy', { recursive: true }).catch(() => {});
      await fs.mkdir(SITES_DIR, { recursive: true }).catch(() => {});
      await fs.mkdir(CADDY_DATA_DIR, { recursive: true }).catch(() => {});
      await fs.mkdir(CADDY_LOG_DIR, { recursive: true }).catch(() => {});

      // Create default Caddyfile if not exists
      const caddyfile = CADDYFILE_PATHS[0];
      try {
        await fs.access(caddyfile);
      } catch {
        await this._writeDefaultCaddyfile();
      }

      // Try to set up systemd service
      try {
        await execAsync('sudo systemctl enable caddy 2>/dev/null').catch(() => {});
        await execAsync('sudo systemctl start caddy 2>/dev/null').catch(() => {});
      } catch { /* non-critical */ }

      const info = await this.getStatus();
      return {
        message: 'Caddy installed successfully',
        version: info.version,
        binary: bin,
        output: stdout + stderr,
      };
    } catch (err) {
      // Fallback: try package manager
      try {
        const pm = await this._detectPackageManager();
        let installCmd;
        if (pm === 'apt') {
          // Add official Caddy repository
          installCmd = `
            sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https 2>/dev/null
            curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null
            curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list 2>/dev/null
            sudo apt-get update 2>/dev/null
            sudo apt-get install -y caddy 2>&1
          `;
        } else if (pm === 'dnf') {
          installCmd = 'sudo dnf install -y caddy 2>&1';
        } else if (pm === 'yum') {
          installCmd = 'sudo yum install -y caddy 2>&1';
        } else {
          throw new Error(`Unsupported package manager: ${pm}. Try installing Caddy manually.`);
        }

        const { stdout, stderr } = await execAsync(installCmd, { timeout: 180000 });
        this._binaryPath = null;

        // Create directories
        await fs.mkdir(SITES_DIR, { recursive: true }).catch(() => {});

        const info = await this.getStatus();
        return {
          message: 'Caddy installed via package manager',
          version: info.version,
          binary: await this._findBinary(),
          output: stdout + stderr,
        };
      } catch (fallbackErr) {
        throw new Error(`Failed to install Caddy: ${fallbackErr.message}`);
      }
    }
  }

  async uninstallCaddy() {
    const bin = await this._findBinary();
    if (!bin) throw new Error('Caddy is not installed');

    try {
      // Stop service first
      await execAsync('sudo systemctl stop caddy 2>/dev/null').catch(() => {});

      const pm = await this._detectPackageManager();
      let uninstallCmd;
      if (pm === 'apt') {
        uninstallCmd = 'DEBIAN_FRONTEND=noninteractive apt-get remove -y --purge caddy libcaddy 2>/dev/null';
      } else if (pm === 'dnf' || pm === 'yum') {
        uninstallCmd = `${pm} remove -y caddy 2>/dev/null`;
      } else if (pm === 'apk') {
        uninstallCmd = 'apk del caddy 2>/dev/null';
      } else {
        // Fallback: remove binary directly
        uninstallCmd = `rm -f ${bin} 2>/dev/null`;
      }

      const { stdout, stderr } = await execAsync(uninstallCmd, { timeout: 60000 });
      this._binaryPath = null;

      return {
        message: 'Caddy uninstalled successfully',
        output: stdout + stderr,
      };
    } catch (err) {
      // Try direct binary removal as fallback
      try {
        await fs.unlink(bin);
        this._binaryPath = null;
        return { message: 'Caddy binary removed manually' };
      } catch {
        throw new Error(`Failed to uninstall Caddy: ${err.message}`);
      }
    }
  }

  // ── Status ──────────────────────────────────────────────────────

  async getStatus() {
    const bin = await this._findBinary();
    let installed = !!bin;
    let version = 'N/A';
    let running = false;
    let pid = null;
    let listeningPorts = [];
    let adminApiAvailable = false;
    let uptime = null;
    let modules = [];
    let loadedSites = 0;

    if (bin) {
      // Get version
      try {
        const { stdout } = await execFileAsync(bin, ['version'], { timeout: 5000 });
        version = stdout.trim();
      } catch {
        try {
          const { stdout } = await execAsync(`${bin} version 2>/dev/null || echo ""`);
          version = stdout.trim() || 'Caddy';
        } catch { /* ignore */ }
      }

      // Check if running via admin API
      try {
        const apiRes = await fetch('http://localhost:2019/config/', {
          signal: AbortSignal.timeout(2000),
        });
        if (apiRes.ok) {
          adminApiAvailable = true;
          running = true;

          // Get server info
          try {
            const infoRes = await fetch('http://localhost:2019/config/apps/http/servers', {
              signal: AbortSignal.timeout(2000),
            });
            if (infoRes.ok) {
              const servers = await infoRes.json();
              loadedSites = Object.keys(servers || {}).length;
            }
          } catch { /* ignore */ }
        }
      } catch { /* admin API not available */ }

      if (!running) {
        // Check via systemctl
        try {
          const { stdout: statusOut } = await execAsync('systemctl is-active caddy 2>/dev/null');
          running = statusOut.trim() === 'active';
        } catch { /* ignore */ }
      }

      if (running) {
        try {
          const { stdout: pidOut } = await execAsync('pgrep -x caddy 2>/dev/null | head -1');
          pid = pidOut.trim() || null;
        } catch { /* ignore */ }

        try {
          const { stdout: ssOut } = await execAsync('ss -tlnp 2>/dev/null | grep -i caddy || netstat -tlnp 2>/dev/null | grep -i caddy || echo ""');
          listeningPorts = [...ssOut.matchAll(/:(80|443|\d+)\s/g)].map(m => parseInt(m[1])).filter(p => p);
        } catch { /* ignore */ }
      }

      // Get modules list
      try {
        const { stdout: modOut } = await execAsync(`${bin} list-modules 2>/dev/null | head -30 || echo ""`);
        modules = modOut.split('\n').filter(l => l.trim()).slice(0, 30);
      } catch { /* ignore */ }
    }

    return {
      installed,
      version,
      running,
      pid,
      listeningPorts: [...new Set(listeningPorts)],
      binary: bin,
      adminApiAvailable,
      loadedSites,
      modules: modules.length > 0 ? modules : [],
      uptime,
    };
  }

  // ── Service Control ──────────────────────────────────────────────

  async serviceAction(action) {
    if (!['start', 'stop', 'restart', 'reload'].includes(action)) {
      throw new Error(`Invalid action: ${action}`);
    }

    // Try admin API for reload first
    if (action === 'reload' || action === 'restart') {
      try {
        const res = await fetch('http://localhost:2019/reload', {
          method: 'POST',
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          return { message: `Caddy configuration ${action}ed via admin API.`, method: 'api' };
        }
      } catch { /* fallback to systemctl */ }
    }

    try {
      const { stdout, stderr } = await execAsync(`sudo systemctl ${action} caddy 2>&1`, { timeout: 30000 });
      return { message: `Caddy ${action}ed successfully.`, output: stdout + stderr, method: 'systemctl' };
    } catch (err) {
      throw new Error(`Failed to ${action} Caddy: ${err.message}`);
    }
  }

  // ── Caddyfile Management ─────────────────────────────────────────

  async _getCaddyfilePath() {
    for (const p of CADDYFILE_PATHS) {
      try {
        const stat = await fs.stat(p);
        if (stat.isFile()) return p;
      } catch { /* try next */ }
    }
    // Default fallback
    return CADDYFILE_PATHS[0];
  }

  async getCaddyfile() {
    const caddyfilePath = await this._getCaddyfilePath();
    try {
      const content = await fs.readFile(caddyfilePath, 'utf8');
      return { path: caddyfilePath, content };
    } catch (err) {
      // Return a default template if no Caddyfile exists
      const defaultContent = await this._generateDefaultCaddyfileContent();
      return { path: caddyfilePath, content: defaultContent, isDefault: true };
    }
  }

  async saveCaddyfile(content) {
    if (!content || typeof content !== 'string') throw new Error('Caddyfile content is required');
    if (content.length > 100000) throw new Error('Caddyfile too large (max 100KB)');

    const caddyfilePath = await this._getCaddyfilePath();

    // Backup current Caddyfile
    try {
      await fs.copyFile(caddyfilePath, `${caddyfilePath}.bak`);
    } catch { /* ignore */ }

    await fs.writeFile(caddyfilePath, content, 'utf8');

    // Validate syntax
    const validation = await this.validateCaddyfile();
    if (!validation.valid) {
      // Restore from backup
      try {
        await fs.copyFile(`${caddyfilePath}.bak`, caddyfilePath);
      } catch { /* ignore */ }
      throw new Error(`Caddyfile validation failed: ${validation.output}`);
    }

    // Reload Caddy to apply changes
    try {
      await this.serviceAction('reload');
    } catch { /* non-critical */ }

    return { path: caddyfilePath, message: 'Caddyfile saved, validated, and Caddy reloaded.' };
  }

  async validateCaddyfile(content) {
    const bin = await this._findBinary();
    if (!bin) throw new Error('Caddy is not installed');

    try {
      let output;
      if (content) {
        // Validate content from memory
        const { stdout, stderr } = await execAsync(
          `cat << 'CADDYEOF' | ${bin} fmt 2>&1\n${content}\nCADDYEOF`,
          { timeout: 10000 }
        );
        output = stdout + stderr;
      } else {
        // Validate the actual Caddyfile on disk
        const caddyfilePath = await this._getCaddyfilePath();
        const { stdout, stderr } = await execFileAsync(bin, ['validate', '--config', caddyfilePath], { timeout: 15000 });
        output = stdout + stderr;
      }

      const isValid = !output.toLowerCase().includes('error') && !output.toLowerCase().includes('invalid');
      return { valid: isValid, output: output.trim() || 'Valid syntax' };
    } catch (err) {
      return { valid: false, output: err.stderr || err.message };
    }
  }

  async formatCaddyfile() {
    const bin = await this._findBinary();
    if (!bin) throw new Error('Caddy is not installed');

    const caddyfilePath = await this._getCaddyfilePath();

    try {
      await execFileAsync(bin, ['fmt', '--overwrite', caddyfilePath], { timeout: 10000 });
      const content = await fs.readFile(caddyfilePath, 'utf8');
      return { message: 'Caddyfile formatted successfully', content };
    } catch (err) {
      throw new Error(`Failed to format Caddyfile: ${err.message}`);
    }
  }

  // ── Site Management (via included configs) ──────────────────────

  async ensureSitesDir() {
    await fs.mkdir(SITES_DIR, { recursive: true });
  }

  async getSites() {
    await this.ensureSitesDir();
    let sites = [];

    try {
      const files = await fs.readdir(SITES_DIR);
      const confFiles = files.filter(f => f.endsWith('.conf'));

      for (const file of confFiles) {
        try {
          const filePath = path.join(SITES_DIR, file);
          const content = await fs.readFile(filePath, 'utf8');
          const siteName = file.replace(/\.conf$/, '');

          // Try to parse key information from the site block
          const domainMatch = content.match(/^([a-zA-Z0-9.*_-]+(\.[a-zA-Z0-9.*_-]+)*)\s*\{/m);
          const domain = domainMatch ? domainMatch[1] : siteName;

          const hasProxy = content.includes('reverse_proxy');
          const hasPHP = content.includes('php_fastcgi');
          const hasFileServer = content.includes('file_server');
          const hasRedir = content.includes('redir ');
          // Capture proxy target
          let proxyTarget = null;
          const proxyMatch = content.match(/reverse_proxy\s+([^\s]+)/);
          if (proxyMatch) proxyTarget = proxyMatch[1];

          // Capture root
          let rootDir = null;
          const rootMatch = content.match(/root\s+\*\s+([^\s]+)/);
          if (rootMatch) rootDir = rootMatch[1];

          // Determine type
          let type = 'static';
          if (hasRedir) type = 'redirect';
          else if (hasPHP) type = 'php';
          else if (hasProxy) type = 'proxy';
          else if (content.includes('file_server browse')) type = 'file-server';

          sites.push({
            file,
            name: siteName,
            domain,
            type,
            proxyTarget,
            rootDir,
            hasFileServer,
            hasPHP,
            hasProxy,
            lines: content.split('\n').length,
            content,
          });
        } catch (e) {
          logger.warn(`Failed to read site config ${file}: ${e.message}`);
        }
      }

      // Sort by domain name
      sites.sort((a, b) => a.domain.localeCompare(b.domain));
    } catch (err) {
      logger.warn(`Failed to list sites: ${err.message}`);
    }

    return sites;
  }

  async getSite(name) {
    const safeName = validateSiteName(name);
    const filePath = path.join(SITES_DIR, `${safeName}.conf`);

    try {
      await fs.access(filePath);
    } catch {
      throw new Error(`Site "${name}" not found`);
    }

    const content = await fs.readFile(filePath, 'utf8');
    return { name, content, path: filePath };
  }

  async createSite(data) {
    if (!data.domain) throw new Error('Domain is required');
    validateDomain(data.domain);

    const safeName = data.name || data.domain.replace(/[*]/g, 'wildcard').replace(/[^a-zA-Z0-9._-]/g, '_');
    validateSiteName(safeName);

    await this.ensureSitesDir();
    const filePath = path.join(SITES_DIR, `${safeName}.conf`);

    // Check if already exists
    try {
      await fs.access(filePath);
      throw new Error(`Site "${safeName}" already exists`);
    } catch (err) {
      if (err.message.includes('already exists')) throw err;
    }

    const type = data.type || 'static';
    const rootDir = data.rootDir || `/var/www/${safeName}`;

    let template;
    let extraDirectives = '';

    if (data.extraDirectives) {
      extraDirectives = data.extraDirectives;
    }

    // Add TLS directives
    if (data.ssl !== false) {
      extraDirectives += '\n    # Automatic HTTPS via Caddy';
    }

    switch (type) {
      case 'proxy':
        template = TEMPLATE_PROXY;
        break;
      case 'php':
        template = TEMPLATE_PHP_FPM;
        break;
      case 'redirect':
        template = TEMPLATE_REDIRECT;
        break;
      case 'file-server':
        template = TEMPLATE_FILE_SERVER;
        break;
      default:
        template = TEMPLATE_STATIC;
    }

    let conf = template
      .replace(/{{domain}}/g, data.domain)
      .replace(/{{rootDir}}/g, rootDir)
      .replace(/{{port}}/g, validatePort(data.port || 8080))
      .replace(/{{phpSocket}}/g, data.phpSocket || '/var/run/php/php8.2-fpm.sock')
      .replace(/{{redirectTarget}}/g, data.redirectTarget || 'https://{http.request.host}{http.request.uri}')
      .replace(/{{redirectCode}}/g, data.redirectCode || '301')
      .replace(/{{basicAuthUser}}/g, data.basicAuthUser || '')
      .replace(/{{basicAuthPass}}/g, data.basicAuthPass || '')
      .replace(/{{extraDirectives}}/g, extraDirectives);

    // Clean up empty basicauth directive
    if (type !== 'file-server' || !data.basicAuthUser) {
      conf = conf.replace(/basicauth\s+\S+\s+\S+\n/, '');
    }

    await fs.writeFile(filePath, conf, 'utf8');

    // Create document root if needed
    if (type !== 'proxy' && type !== 'redirect' && data.createRoot !== false) {
      try {
        await fs.mkdir(rootDir, { recursive: true });
        // Create a simple index page
        const indexPath = path.join(rootDir, 'index.html');
        try {
          await fs.access(indexPath);
        } catch {
          await fs.writeFile(
            indexPath,
            `<h1>Welcome to ${data.domain}</h1><p>Served by Caddy via Panelku</p>`,
            'utf8'
          );
        }
      } catch (e) {
        logger.warn(`Failed to create root dir ${rootDir}: ${e.message}`);
      }
    }

    // Validate the config
    const validation = await this.validateAllConfigs();
    if (!validation.valid) {
      // Rollback
      try { await fs.unlink(filePath); } catch { /* ignore */ }
      throw new Error(`Config validation failed: ${validation.output}`);
    }

    // Reload Caddy to apply changes
    try {
      await this.serviceAction('reload');
    } catch { /* ignore, will be applied on next restart */ }

    return {
      message: `Site "${data.domain}" created successfully.`,
      file: `${safeName}.conf`,
      type,
    };
  }

  async updateSite(name, data) {
    const safeName = validateSiteName(name);
    const filePath = path.join(SITES_DIR, `${safeName}.conf`);

    try {
      await fs.access(filePath);
    } catch {
      throw new Error(`Site "${name}" not found`);
    }

    let content = await fs.readFile(filePath, 'utf8');

    // Update domain if provided
    if (data.domain) {
      validateDomain(data.domain);
      content = content.replace(/^[a-zA-Z0-9.*_-]+\s*\{/m, `${data.domain} {`);
    }

    // Update root directory
    if (data.rootDir) {
      validatePath(data.rootDir);
      content = content.replace(/root\s+\*\s+\S+/g, `root * ${data.rootDir}`);
    }

    // Update proxy target
    if (data.proxyTarget) {
      content = content.replace(/reverse_proxy\s+\S+/g, `reverse_proxy ${data.proxyTarget}`);
    }

    // Update php socket
    if (data.phpSocket) {
      content = content.replace(/php_fastcgi\s+\S+/g, `php_fastcgi ${data.phpSocket}`);
    }

    // Update redirect
    if (data.redirectTarget) {
      content = content.replace(/redir\s+\S+/g, `redir ${data.redirectTarget}`);
    }
    if (data.redirectCode) {
      content = content.replace(/redir\s+\S+\s+\S+/g, `redir ${data.redirectTarget || ''} ${data.redirectCode}`);
    }

    // Add or replace extra directives
    if (data.extraDirectives !== undefined) {
      // Remove existing extra directives section (lines after the opening block before closing)
      // Simple approach: append after the opening line
      const firstLineEnd = content.indexOf('\n');
      const rest = content.substring(firstLineEnd);
      // Find closing brace
      const closingBrace = rest.lastIndexOf('}');
      const bodyBefore = rest.substring(0, closingBrace);
      const bodyAfter = rest.substring(closingBrace);

      // Clean up and rebuild
      let newBody = bodyBefore;
      // Only add non-empty extra directives
      if (data.extraDirectives.trim()) {
        newBody = '\n' + data.extraDirectives.split('\n').map(l => `    ${l}`).join('\n');
      }

      content = content.substring(0, firstLineEnd + 1) + newBody + '\n' + bodyAfter;
    }

    await fs.writeFile(filePath, content, 'utf8');

    // Validate
    const validation = await this.validateAllConfigs();
    if (!validation.valid) {
      // Restore from content in memory?
      throw new Error(`Config validation failed: ${validation.output}`);
    }

    try { await this.serviceAction('reload'); } catch { /* ignore */ }

    return { message: `Site "${safeName}" updated successfully.` };
  }

  async deleteSite(name) {
    const safeName = validateSiteName(name);
    const filePath = path.join(SITES_DIR, `${safeName}.conf`);

    try {
      await fs.access(filePath);
    } catch {
      throw new Error(`Site "${name}" not found`);
    }

    await fs.unlink(filePath);
    try { await this.serviceAction('reload'); } catch { /* ignore */ }

    return { message: `Site "${name}" deleted successfully.` };
  }

  async toggleSite(name, enable) {
    const safeName = validateSiteName(name);
    const filePath = path.join(SITES_DIR, `${safeName}.conf`);

    if (enable) {
      // Site already exists, just make sure it's .conf (not .conf.disabled)
      const disabledPath = path.join(SITES_DIR, `${safeName}.conf.disabled`);
      try {
        await fs.rename(disabledPath, filePath);
      } catch {
        // Already enabled
        try { await fs.access(filePath); } catch {
          throw new Error(`Site "${name}" not found`);
        }
      }
    } else {
      // Rename to .conf.disabled
      try {
        await fs.rename(filePath, path.join(SITES_DIR, `${safeName}.conf.disabled`));
      } catch {
        throw new Error(`Site "${name}" not found`);
      }
    }

    try { await this.serviceAction('reload'); } catch { /* ignore */ }

    return { message: `Site "${name}" ${enable ? 'enabled' : 'disabled'}.` };
  }

  // ── Config Validation (All Configs) ─────────────────────────────

  async validateAllConfigs() {
    const bin = await this._findBinary();
    if (!bin) throw new Error('Caddy is not installed');

    const caddyfilePath = await this._getCaddyfilePath();

    try {
      const { stdout, stderr } = await execFileAsync(bin, ['validate', '--config', caddyfilePath], { timeout: 15000 });
      const output = stdout + stderr;
      const isValid = !output.toLowerCase().includes('error');
      return { valid: isValid, output: output.trim() || 'Configuration is valid' };
    } catch (err) {
      return { valid: false, output: err.stderr || err.message };
    }
  }

  // ── Admin API ────────────────────────────────────────────────────

  async callAdminApi(method = 'GET', path = '/config/', body = null) {
    try {
      const options = {
        method,
        signal: AbortSignal.timeout(5000),
        headers: {},
      };
      if (body) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
      }

      const res = await fetch(`http://localhost:2019${path}`, options);

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Admin API error (${res.status}): ${text}`);
      }

      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    } catch (err) {
      if (err.message.includes('Admin API')) throw err;
      throw new Error(`Caddy Admin API unavailable: ${err.message}`);
    }
  }

  async getAdminConfig() {
    try {
      const config = await this.callAdminApi('GET', '/config/');
      return config;
    } catch (err) {
      throw new Error(`Failed to get admin config: ${err.message}`);
    }
  }

  async getAdminStats() {
    try {
      const stats = await this.callAdminApi('GET', '/stats/');
      return stats;
    } catch {
      // Stats endpoint might not be available
      return null;
    }
  }

  async getAdminReverseProxy() {
    try {
      const upstreams = await this.callAdminApi('GET', '/reverse_proxy/upstreams');
      return upstreams;
    } catch {
      return [];
    }
  }

  // ── Logs ─────────────────────────────────────────────────────────

  async getLogs(type = 'access', lines = 100) {
    const safeLines = Math.min(Math.max(parseInt(lines) || 100, 10), 1000);
    const logFile = path.join(CADDY_LOG_DIR, type === 'error' ? 'error.log' : 'access.log');

    try {
      const { stdout } = await execAsync(`tail -n ${safeLines} "${logFile}" 2>&1`, { timeout: 10000 });
      return { logFile, lines: stdout.split('\n').filter(Boolean) };
    } catch (err) {
      // Try Caddy's JSON log
      try {
        // Caddy typically logs JSON to stdout/stderr. Check journald
        const { stdout } = await execAsync(
          `journalctl -u caddy --no-pager -n ${safeLines} 2>/dev/null || echo ""`,
          { timeout: 10000 }
        );
        return { logFile: 'journalctl -u caddy', lines: stdout.split('\n').filter(Boolean) };
      } catch {
        throw new Error(`Log file not found: ${logFile}`);
      }
    }
  }

  // ── Default Caddyfile ───────────────────────────────────────────

  async _writeDefaultCaddyfile() {
    const content = await this._generateDefaultCaddyfileContent();
    const caddyfilePath = CADDYFILE_PATHS[0];

    try {
      await fs.mkdir(path.dirname(caddyfilePath), { recursive: true });
    } catch { /* ignore */ }

    await fs.writeFile(caddyfilePath, content, 'utf8');
    return caddyfilePath;
  }

  async _generateDefaultCaddyfileContent() {
    return DEFAULT_CADDYFILE_BASE
      .replace(/{{email}}/g, process.env.CADDY_EMAIL || 'admin@panelku.local')
      .replace(/{{dataDir}}/g, CADDY_DATA_DIR);
  }

  async getDefaultCaddyfile() {
    const content = await this._generateDefaultCaddyfileContent();
    return { content };
  }

  // ─── Aut HTTPS / Certificate Info ────────────────────────────────

  async getCertificates() {
    const certDir = path.join(CADDY_DATA_DIR, 'certificates');
    let certs = [];

    try {
      const dirs = await fs.readdir(certDir);
      for (const dir of dirs) {
        try {
          const certPath = path.join(certDir, dir);
          const files = await fs.readdir(certPath);
          const certFiles = files.filter(f => f.endsWith('.crt') || f.endsWith('.pem'));
          certs.push({
            domain: dir,
            path: certPath,
            files: certFiles,
            fileCount: certFiles.length,
          });
        } catch (e) {
          logger.warn(`Failed to read cert dir ${dir}: ${e.message}`);
        }
      }
    } catch { /* no certificates yet */ }

    return certs;
  }
}

export default new CaddyService();
