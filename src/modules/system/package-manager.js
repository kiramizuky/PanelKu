import fs from 'fs/promises';
import logger from '../../config/logger.js';

class PackageManager {
  constructor() {
    this.distro = 'unknown';
    this.pmType = 'apt'; // default fallback
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    try {
      if (process.platform === 'win32') {
        this.distro = 'windows';
        this.pmType = 'mock';
        this.initialized = true;
        return;
      }

      // Try reading /etc/os-release
      let osRelease = '';
      try {
        osRelease = await fs.readFile('/etc/os-release', 'utf8');
      } catch (err) {
        // Fallback to reading /usr/lib/os-release
        try {
          osRelease = await fs.readFile('/usr/lib/os-release', 'utf8');
        } catch (_) {}
      }

      if (osRelease) {
        const lines = osRelease.split('\n');
        const info = {};
        for (const line of lines) {
          const parts = line.split('=');
          if (parts.length === 2) {
            info[parts[0].trim()] = parts[1].replace(/['"]/g, '').trim();
          }
        }

        const id = info.ID ? info.ID.toLowerCase() : '';
        const idLike = info.ID_LIKE ? info.ID_LIKE.toLowerCase() : '';

        if (id === 'arch' || idLike.includes('arch')) {
          this.distro = 'arch';
          this.pmType = 'pacman';
        } else if (id === 'fedora' || id === 'rhel' || id === 'centos' || idLike.includes('fedora') || idLike.includes('rhel')) {
          this.distro = 'fedora';
          this.pmType = 'dnf';
        } else if (id === 'gentoo' || idLike.includes('gentoo')) {
          this.distro = 'gentoo';
          this.pmType = 'emerge';
        } else if (id === 'debian' || id === 'ubuntu' || idLike.includes('debian') || idLike.includes('ubuntu')) {
          this.distro = id || 'debian';
          this.pmType = 'apt';
        } else {
          // Detect by command availability as fallback
          this.distro = id || 'unknown';
          this.pmType = 'apt'; // default fallback
        }
      }
    } catch (error) {
      logger.error(`Error detecting distribution: ${error.message}`);
    }
    this.initialized = true;
  }

  getPMInfo() {
    const config = {
      apt: { name: 'APT (Debian/Ubuntu)', updateName: 'APT Update', upgradeName: 'APT Upgrade' },
      pacman: { name: 'Pacman (Arch Linux)', updateName: 'Sync Databases', upgradeName: 'System Upgrade' },
      dnf: { name: 'DNF (Fedora/RHEL)', updateName: 'DNF Check-Update', upgradeName: 'DNF Upgrade' },
      emerge: { name: 'Emerge (Gentoo)', updateName: 'Sync Portage', upgradeName: 'Emerge Upgrade' },
      mock: { name: 'Mock Package Manager (Windows)', updateName: 'Mock Update', upgradeName: 'Mock Upgrade' }
    };
    return config[this.pmType] || { name: 'Unknown Package Manager', updateName: 'Update', upgradeName: 'Upgrade' };
  }

  getUpdateCommand() {
    switch (this.pmType) {
      case 'pacman':
        return 'sudo pacman -Sy --noconfirm';
      case 'dnf':
        return 'sudo dnf check-update || true';
      case 'emerge':
        return 'sudo emerge --sync';
      case 'mock':
        return 'mock update';
      case 'apt':
      default:
        return 'sudo apt-get update -y';
    }
  }

  getUpgradeCommand() {
    switch (this.pmType) {
      case 'pacman':
        return 'sudo pacman -Syu --noconfirm';
      case 'dnf':
        return 'sudo dnf upgrade -y';
      case 'emerge':
        return 'sudo emerge -uDN @world';
      case 'mock':
        return 'mock upgrade';
      case 'apt':
      default:
        return 'sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y';
    }
  }

  getInstallCommand(pkgName) {
    const mappedPkg = this.getPackageMap(pkgName).pkg;
    switch (this.pmType) {
      case 'pacman':
        return `sudo pacman -S --noconfirm --needed ${mappedPkg}`;
      case 'dnf':
        return `sudo dnf install -y ${mappedPkg}`;
      case 'emerge':
        return `sudo emerge -v ${mappedPkg}`;
      case 'mock':
        return `mock install ${mappedPkg}`;
      case 'apt':
      default:
        return `sudo DEBIAN_FRONTEND=noninteractive apt-get install -y ${mappedPkg}`;
    }
  }

  getCheckInstalledCommand(pkgName) {
    const mapped = this.getPackageMap(pkgName);
    switch (this.pmType) {
      case 'pacman':
        return `command -v ${mapped.cmd} || pacman -Qs ^${mapped.pkg}$`;
      case 'dnf':
        return `command -v ${mapped.cmd} || rpm -q ${mapped.pkg}`;
      case 'emerge':
        return `command -v ${mapped.cmd} || emerge -p ${mapped.pkg}`;
      case 'mock':
        return `command -v ${mapped.cmd}`;
      case 'apt':
      default:
        return `command -v ${mapped.cmd} || dpkg -s ${mapped.pkg}`;
    }
  }

  getPackageMap(pkgName) {
    const packageMaps = {
      apt: {
        mysql: { cmd: 'mysql', pkg: 'mysql-server' },
        postgres: { cmd: 'psql', pkg: 'postgresql' },
        docker: { cmd: 'docker', pkg: 'docker.io docker-compose' },
        nginx: { cmd: 'nginx', pkg: 'nginx' },
        syncthing: { cmd: 'syncthing', pkg: 'syncthing' },
        fail2ban: { cmd: 'fail2ban-client', pkg: 'fail2ban' },
        wireguard: { cmd: 'wg', pkg: 'wireguard' },
        rclone: { cmd: 'rclone', pkg: 'rclone' },
        git: { cmd: 'git', pkg: 'git' }
      },
      pacman: {
        mysql: { cmd: 'mysql', pkg: 'mariadb' },
        postgres: { cmd: 'psql', pkg: 'postgresql' },
        docker: { cmd: 'docker', pkg: 'docker docker-compose' },
        nginx: { cmd: 'nginx', pkg: 'nginx' },
        syncthing: { cmd: 'syncthing', pkg: 'syncthing' },
        fail2ban: { cmd: 'fail2ban-client', pkg: 'fail2ban' },
        wireguard: { cmd: 'wg', pkg: 'wireguard-tools' },
        rclone: { cmd: 'rclone', pkg: 'rclone' },
        git: { cmd: 'git', pkg: 'git' }
      },
      dnf: {
        mysql: { cmd: 'mysql', pkg: 'mariadb-server' },
        postgres: { cmd: 'psql', pkg: 'postgresql-server' },
        docker: { cmd: 'docker', pkg: 'moby-engine docker-compose' },
        nginx: { cmd: 'nginx', pkg: 'nginx' },
        syncthing: { cmd: 'syncthing', pkg: 'syncthing' },
        fail2ban: { cmd: 'fail2ban-client', pkg: 'fail2ban' },
        wireguard: { cmd: 'wg', pkg: 'wireguard-tools' },
        rclone: { cmd: 'rclone', pkg: 'rclone' },
        git: { cmd: 'git', pkg: 'git' }
      },
      emerge: {
        mysql: { cmd: 'mysql', pkg: 'dev-db/mariadb' },
        postgres: { cmd: 'psql', pkg: 'dev-db/postgresql' },
        docker: { cmd: 'docker', pkg: 'app-containers/docker' },
        nginx: { cmd: 'nginx', pkg: 'www-servers/nginx' },
        syncthing: { cmd: 'syncthing', pkg: 'net-p2p/syncthing' },
        fail2ban: { cmd: 'fail2ban-client', pkg: 'net-analyzer/fail2ban' },
        wireguard: { cmd: 'wg', pkg: 'net-vpn/wireguard-tools' },
        rclone: { cmd: 'rclone', pkg: 'net-misc/rclone' },
        git: { cmd: 'git', pkg: 'dev-vcs/git' }
      }
    };

    const currentMap = packageMaps[this.pmType] || packageMaps.apt;
    return currentMap[pkgName] || { cmd: pkgName, pkg: pkgName };
  }
}

export default new PackageManager();
