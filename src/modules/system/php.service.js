import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';

const execAsync = util.promisify(exec);

class PHPService {
  constructor() {
    this.phpVersion = '8.2';
    this.systemConfPath = `/etc/php/${this.phpVersion}/fpm/pool.d/www.conf`;
    this.fallbackConfPath = path.resolve('storage', 'configs', 'php-fpm-www.conf');
  }

  async getConfPath() {
    try {
      await fs.access(this.systemConfPath);
      return this.systemConfPath;
    } catch {
      // Ensure fallback directory exists
      await fs.mkdir(path.dirname(this.fallbackConfPath), { recursive: true });
      try {
        await fs.access(this.fallbackConfPath);
      } catch {
        // Initialize default configuration content
        const defaultContent = `; PHP-FPM pool configuration
[www]
user = www-data
group = www-data
listen = /run/php/php8.2-fpm.sock
pm = dynamic
pm.max_children = 5
pm.start_servers = 2
pm.min_spare_servers = 1
pm.max_spare_servers = 3
`;
        await fs.writeFile(this.fallbackConfPath, defaultContent, 'utf8');
      }
      return this.fallbackConfPath;
    }
  }

  async getConfig() {
    const confPath = await this.getConfPath();
    const content = await fs.readFile(confPath, 'utf8');
    
    return {
      max_children: parseInt(content.match(/^\s*pm\.max_children\s*=\s*(\d+)/m)?.[1] || '5'),
      start_servers: parseInt(content.match(/^\s*pm\.start_servers\s*=\s*(\d+)/m)?.[1] || '2'),
      min_spare_servers: parseInt(content.match(/^\s*pm\.min_spare_servers\s*=\s*(\d+)/m)?.[1] || '1'),
      max_spare_servers: parseInt(content.match(/^\s*pm\.max_spare_servers\s*=\s*(\d+)/m)?.[1] || '3'),
      raw: content
    };
  }

  async updateConfig(params) {
    const confPath = await this.getConfPath();
    let content = await fs.readFile(confPath, 'utf8');

    const mappings = {
      'pm.max_children': params.max_children,
      'pm.start_servers': params.start_servers,
      'pm.min_spare_servers': params.min_spare_servers,
      'pm.max_spare_servers': params.max_spare_servers
    };

    for (const [key, value] of Object.entries(mappings)) {
      if (value !== undefined) {
        const regex = new RegExp(`^(\\s*${key.replace('.', '\\.')}\\s*=\\s*)(\\d+)`, 'm');
        if (regex.test(content)) {
          content = content.replace(regex, `$1${value}`);
        } else {
          content += `\n${key} = ${value}`;
        }
      }
    }

    await fs.writeFile(confPath, content, 'utf8');

    // Reload PHP-FPM if systemctl is available
    try {
      await execAsync(`systemctl reload php${this.phpVersion}-fpm`);
    } catch {
      // Ignore if not on Linux or systemctl reload fails
    }

    return true;
  }
}

export default new PHPService();
