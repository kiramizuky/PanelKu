import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import logger from '../../src/config/logger.js';
import packageManager from '../../src/modules/system/package-manager.js';
import { successResponse, errorResponse } from '../../src/helpers/response.js';

const execAsync = promisify(exec);

const SUPPORTED_PHP_VERSIONS = ['7.2', '7.3', '7.4', '8.0', '8.1', '8.2', '8.3', '8.4', '8.5'];

export default {
  register(app, io) {
    // Helper: run commands
    async function runCommand(cmd) {
      if (process.platform === 'win32') {
        return 'Mock output for command: ' + cmd;
      }
      const { stdout } = await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 });
      return stdout.trim();
    }

    // Detect architecture and package manager
    async function getSystemInfo() {
      await packageManager.init();
      return packageManager.getPMInfo();
    }

    // Helper: detect installed PHP versions & services
    async function getPhpStatus() {
      const systemInfo = await getSystemInfo();
      const isWindows = process.platform === 'win32';
      
      const versions = SUPPORTED_PHP_VERSIONS;
      const result = {
        system: systemInfo,
        phpCli: 'Not Found',
        versions: []
      };

      try {
        result.phpCli = await runCommand('php -r "echo PHP_VERSION;"');
      } catch (_) {
        if (isWindows) result.phpCli = '8.2.12';
      }

      for (const ver of versions) {
        let installed = false;
        let active = false;
        let iniPath = `/etc/php/${ver}/fpm/php.ini`;
        let serviceName = `php${ver}-fpm`;

        if (!isWindows) {
          try {
            await fs.access(`/etc/php/${ver}`);
            installed = true;
          } catch (_) {}

          if (installed) {
            try {
              const activeStatus = await runCommand(`systemctl is-active ${serviceName}`);
              active = activeStatus === 'active';
            } catch (_) {}
          }
        } else {
          // Windows mock data
          installed = ver === '8.2' || ver === '8.3';
          active = ver === '8.2';
          iniPath = `C:\\temp\\php\\${ver}\\php.ini`;
        }

        let iniSettings = null;
        if (installed) {
          try {
            let content = '';
            if (!isWindows) {
              content = await fs.readFile(iniPath, 'utf8');
            } else {
              content = `memory_limit = 256M\nupload_max_filesize = 64M\npost_max_size = 64M\nmax_execution_time = 120`;
            }
            iniSettings = {
              memory_limit: content.match(/^memory_limit\s*=\s*(.*)$/m)?.[1] || '128M',
              upload_max_filesize: content.match(/^upload_max_filesize\s*=\s*(.*)$/m)?.[1] || '2M',
              post_max_size: content.match(/^post_max_size\s*=\s*(.*)$/m)?.[1] || '8M',
              max_execution_time: content.match(/^max_execution_time\s*=\s*(.*)$/m)?.[1] || '30'
            };
          } catch (_) {
            iniSettings = {
              memory_limit: '128M',
              upload_max_filesize: '2M',
              post_max_size: '8M',
              max_execution_time: '30'
            };
          }
        }

        result.versions.push({
          version: ver,
          installed,
          active,
          serviceName,
          iniPath,
          settings: iniSettings
        });
      }

      return result;
    }

    // 1. PHP Manager View Route
    app.get('/plugins/php-manager', async (req, res) => {
      try {
        const phpData = await getPhpStatus();
        res.render('layout', {
          title: 'PHP Manager',
          body: `
            <div class="lp-page-header" style="margin-bottom:25px; display:flex; justify-content:space-between; align-items:flex-end;">
              <div>
                <h1 class="lp-page-title" style="font-size:24px;font-weight:600;margin:0;"><i class="bi bi-code-slash text-primary me-2"></i> PHP Manager</h1>
                <p class="lp-page-subtitle" style="color:var(--text-muted);margin:0;">Manage multiple PHP-FPM versions, extensions, and configuration settings</p>
              </div>
              <div style="font-size:12px; color:var(--text-muted); text-align:right;">
                <div>Distro: <strong class="text-white">${phpData.system.distro} (${phpData.system.name})</strong></div>
                <div>Architecture: <strong class="text-white">${phpData.system.arch}</strong></div>
              </div>
            </div>

            <!-- CLI Status Card -->
            <div class="lp-glass-card p-4 mb-4">
              <div class="d-flex align-items-center gap-3">
                <div style="width:48px; height:48px; border-radius:50%; background:rgba(79,91,147,0.1); color:#4f5b93; display:flex; align-items:center; justify-content:center; font-size:24px;">
                  <i class="bi bi-terminal-fill"></i>
                </div>
                <div>
                  <h5 style="font-weight:700; margin:0; font-size:15px;">PHP Command Line Interface (CLI)</h5>
                  <p class="text-muted mb-0" style="font-size:12px;">Active default CLI version: <strong>${phpData.phpCli}</strong></p>
                </div>
              </div>
            </div>

            <!-- Version list -->
            <div class="row g-4">
              <div class="col-12 col-lg-7">
                <div class="lp-glass-card p-4">
                  <h5 style="font-weight:700; margin-bottom:20px;"><i class="bi bi-list-stars text-primary me-2"></i> PHP Versions</h5>
                  <div class="d-flex flex-column gap-3">
                    ${phpData.versions.map(v => `
                      <div class="p-3 rounded d-flex justify-content-between align-items-center" style="background:rgba(0,0,0,0.15); border:1px solid var(--glass-border);">
                        <div>
                          <div class="d-flex align-items-center gap-2">
                            <strong class="text-white" style="font-size:16px;">PHP ${v.version}</strong>
                            ${v.installed 
                              ? (v.active 
                                ? `<span class="lp-badge lp-badge-success" style="font-size:10px;"><span class="lp-badge-dot"></span>Active</span>`
                                : `<span class="lp-badge lp-badge-danger" style="font-size:10px;"><span class="lp-badge-dot"></span>Stopped</span>`)
                              : `<span class="lp-badge lp-badge-ghost" style="font-size:10px;"><span class="lp-badge-dot"></span>Not Installed</span>`
                            }
                          </div>
                          <div class="text-muted mt-1" style="font-size:11px;">
                            ${v.installed ? `Service: <code>${v.serviceName}</code>` : 'Install to enable PHP FPM execution.'}
                          </div>
                        </div>
                        
                        <div class="d-flex gap-2">
                          ${v.installed
                            ? `
                              ${v.active
                                ? `<button class="btn-lp btn-lp-ghost text-danger btn-sm" onclick="PhpPage.manageService('${v.version}', 'stop')"><i class="bi bi-stop-circle me-1"></i> Stop</button>`
                                : `<button class="btn-lp btn-lp-primary btn-sm" onclick="PhpPage.manageService('${v.version}', 'start')"><i class="bi bi-play-circle me-1"></i> Start</button>`
                              }
                              <button class="btn-lp btn-lp-ghost text-warning btn-sm" onclick="PhpPage.manageService('${v.version}', 'restart')"><i class="bi bi-arrow-clockwise me-1"></i> Restart</button>
                              <button class="btn-lp btn-lp-ghost text-light btn-sm" onclick="PhpPage.editConfig('${v.version}', '${encodeURIComponent(JSON.stringify(v.settings))}')"><i class="bi bi-gear-fill"></i> Config</button>
                            `
                            : `
                              <button class="btn-lp btn-lp-primary btn-sm" onclick="PhpPage.installPhp('${v.version}')"><i class="bi bi-download me-1"></i> Install</button>
                            `
                          }
                        </div>
                      </div>
                    `).join('')}
                  </div>
                </div>
              </div>

              <!-- Sidebar: Recommended configurations / extensions info -->
              <div class="col-12 col-lg-5">
                <div class="lp-glass-card p-4">
                  <h5 style="font-weight:700; margin-bottom:15px;"><i class="bi bi-shield-check text-primary me-2"></i> Professional PHP Setup</h5>
                  <p class="text-slate-300" style="font-size:13px; line-height:1.6; margin-bottom:15px;">
                    Having multiple PHP versions active allows hosting legacy projects (PHP 7.2 - 7.4) alongside modern and cutting-edge sites running PHP 8.0 - 8.5. PHP-FPM works seamlessly behind Nginx for highly optimized speed.
                  </p>
                  <div style="background:rgba(255,255,255,0.05); padding:15px; border-radius:8px; border:1px solid rgba(255,255,255,0.08);">
                    <h6 style="font-size:12px; font-weight:600; color:var(--text-primary); margin-bottom:10px;">Common Extensions Installed:</h6>
                    <div class="d-flex flex-wrap gap-2">
                      <span class="lp-badge lp-badge-info" style="font-size:10px;">php-cli</span>
                      <span class="lp-badge lp-badge-info" style="font-size:10px;">php-fpm</span>
                      <span class="lp-badge lp-badge-info" style="font-size:10px;">php-sqlite3</span>
                      <span class="lp-badge lp-badge-info" style="font-size:10px;">php-mysql</span>
                      <span class="lp-badge lp-badge-info" style="font-size:10px;">php-curl</span>
                      <span class="lp-badge lp-badge-info" style="font-size:10px;">php-zip</span>
                      <span class="lp-badge lp-badge-info" style="font-size:10px;">php-xml</span>
                      <span class="lp-badge lp-badge-info" style="font-size:10px;">php-mbstring</span>
                      <span class="lp-badge lp-badge-info" style="font-size:10px;">php-gd</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Config Edit Modal -->
            <div class="modal fade" id="phpConfigModal" tabindex="-1">
              <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content lp-glass-card" style="border: 1px solid rgba(255,255,255,0.1); background: rgba(20,20,25,0.95);">
                  <div class="modal-header" style="border-bottom:1px solid rgba(255,255,255,0.1);">
                    <h5 class="modal-title font-mono text-white" id="phpConfigTitle" style="font-size:15px;">Edit php.ini (PHP FPM)</h5>
                    <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                  </div>
                  <div class="modal-body">
                    <input type="hidden" id="phpConfigVersion">
                    <div class="mb-3">
                      <label class="lp-label" style="display:block; margin-bottom:6px;">Memory Limit</label>
                      <input type="text" id="phpIniMemory" class="form-control lp-input w-100" placeholder="e.g. 256M">
                    </div>
                    <div class="mb-3">
                      <label class="lp-label" style="display:block; margin-bottom:6px;">Upload Max Filesize</label>
                      <input type="text" id="phpIniUpload" class="form-control lp-input w-100" placeholder="e.g. 64M">
                    </div>
                    <div class="mb-3">
                      <label class="lp-label" style="display:block; margin-bottom:6px;">Post Max Size</label>
                      <input type="text" id="phpIniPost" class="form-control lp-input w-100" placeholder="e.g. 64M">
                    </div>
                    <div class="mb-3">
                      <label class="lp-label" style="display:block; margin-bottom:6px;">Max Execution Time (Seconds)</label>
                      <input type="number" id="phpIniExecTime" class="form-control lp-input w-100" placeholder="e.g. 60">
                    </div>
                  </div>
                  <div class="modal-footer" style="border-top:1px solid rgba(255,255,255,0.1);">
                    <button type="button" class="btn-lp btn-lp-ghost" data-bs-dismiss="modal">Cancel</button>
                    <button type="button" class="btn-lp btn-lp-primary" onclick="PhpPage.saveConfig()">Save & Reload FPM</button>
                  </div>
                </div>
              </div>
            </div>

            <script>
              const PhpPage = (() => {
                let bsModal = null;

                function showLoading(text = 'Processing...') {
                  LP.toast(text, 'info');
                }

                async function manageService(ver, action) {
                  showLoading(\`Sending \${action} command to PHP \${ver}-FPM...\`);
                  try {
                    const res = await LP.post('/api/plugins/php-manager/service', { version: ver, action });
                    if (res?.success) {
                      LP.toast(res.message, 'success');
                      setTimeout(() => location.reload(), 1500);
                    } else {
                      LP.toast(res?.message || 'Action failed', 'error');
                    }
                  } catch {
                    LP.toast('Network error executing command', 'error');
                  }
                }

                async function installPhp(ver) {
                  if (!(await LP.confirm(\`Are you sure you want to install PHP \${ver} with common extensions? This might take several minutes.\`, 'Install PHP'))) return;
                  showLoading(\`Installing PHP \${ver}. Please wait...\`);
                  try {
                    const res = await LP.post('/api/plugins/php-manager/install', { version: ver });
                    if (res?.success) {
                      LP.toast(res.message, 'success');
                      setTimeout(() => location.reload(), 2000);
                    } else {
                      LP.toast(res?.message || 'Installation failed', 'error');
                    }
                  } catch {
                    LP.toast('Network error during installation', 'error');
                  }
                }

                function editConfig(ver, settingsStr) {
                  const settings = JSON.parse(decodeURIComponent(settingsStr));
                  document.getElementById('phpConfigVersion').value = ver;
                  document.getElementById('phpIniMemory').value = settings.memory_limit;
                  document.getElementById('phpIniUpload').value = settings.upload_max_filesize;
                  document.getElementById('phpIniPost').value = settings.post_max_size;
                  document.getElementById('phpIniExecTime').value = settings.max_execution_time;
                  document.getElementById('phpConfigTitle').textContent = \`Edit php.ini (PHP \${ver}-FPM)\`;

                  if (!bsModal) {
                    bsModal = new bootstrap.Modal(document.getElementById('phpConfigModal'));
                  }
                  bsModal.show();
                }

                async function saveConfig() {
                  const ver = document.getElementById('phpConfigVersion').value;
                  const memory = document.getElementById('phpIniMemory').value;
                  const upload = document.getElementById('phpIniUpload').value;
                  const post = document.getElementById('phpIniPost').value;
                  const execTime = document.getElementById('phpIniExecTime').value;

                  showLoading('Saving settings and reloading FPM...');
                  try {
                    const res = await LP.post('/api/plugins/php-manager/config', {
                      version: ver,
                      memory_limit: memory,
                      upload_max_filesize: upload,
                      post_max_size: post,
                      max_execution_time: execTime
                    });

                    if (res?.success) {
                      LP.toast(res.message, 'success');
                      if (bsModal) bsModal.hide();
                      setTimeout(() => location.reload(), 1500);
                    } else {
                      LP.toast(res?.message || 'Failed to save configuration', 'error');
                    }
                  } catch {
                    LP.toast('Network error saving config', 'error');
                  }
                }

                return { manageService, installPhp, editConfig, saveConfig };
              })();
            // [FIX] Expose to window for LP.call() resolution
            window.PhpPage = PhpPage;
            </script>
          `,
          layout: false
        });
      } catch (err) {
        res.status(500).send(`Error loading PHP Manager: ${err.message}`);
      }
    });

    // 2. Route: Manage Service (Start/Stop/Restart)
    app.post('/api/plugins/php-manager/service', async (req, res) => {
      const { version, action } = req.body;
      if (!SUPPORTED_PHP_VERSIONS.includes(version)) {
        return errorResponse(res, 'Invalid PHP Version', 400);
      }
      if (!['start', 'stop', 'restart'].includes(action)) {
        return errorResponse(res, 'Invalid action', 400);
      }

      try {
        const serviceName = `php${version}-fpm`;
        if (process.platform !== 'win32') {
          await runCommand(`sudo systemctl ${action} ${serviceName}`);
        }
        return successResponse(res, null, `PHP ${version}-FPM ${action}ed successfully`);
      } catch (err) {
        return errorResponse(res, err.message, 500);
      }
    });

    // Helper: determine valid Ubuntu codename (handles derivatives like Linux Mint 'resolute' -> 'noble')
    async function getValidUbuntuCodename() {
      // 1. Check UBUNTU_CODENAME in /etc/os-release
      try {
        const osRel = await fs.readFile('/etc/os-release', 'utf8').catch(() => '');
        const m = osRel.match(/^UBUNTU_CODENAME=([a-z0-9]+)/m);
        if (m && m[1] && m[1].toLowerCase() !== 'resolute') {
          return m[1].toLowerCase();
        }
      } catch (_) {}

      // 2. Check VERSION_ID to map to Ubuntu LTS codename
      try {
        const osRel = await fs.readFile('/etc/os-release', 'utf8').catch(() => '');
        const v = osRel.match(/^VERSION_ID="?(\d+)/m);
        if (v && v[1]) {
          const major = parseInt(v[1], 10);
          if (major >= 24) return 'noble';
          if (major >= 22) return 'jammy';
          if (major >= 20) return 'focal';
        }
      } catch (_) {}

      // 3. Check lsb_release -sc only if it is a known official Ubuntu codename
      try {
        const lsb = (await runCommand('lsb_release -sc 2>/dev/null || true')).trim().toLowerCase();
        if (['noble', 'jammy', 'focal', 'mantic', 'oracular', 'bionic'].includes(lsb)) {
          return lsb;
        }
      } catch (_) {}

      return 'noble';
    }

    // Helper: clean conflicting repository files that cause "Conflicting values set for option Signed-By"
    async function cleanupConflictingPhpRepos() {
      if (process.platform === 'win32') return;
      try {
        await runCommand('sudo rm -f /etc/apt/sources.list.d/ondrej-php.list /etc/apt/trusted.gpg.d/ondrej-php.gpg /etc/apt/trusted.gpg.d/ondrej* /etc/apt/sources.list.d/sury-php.list');
        const validCodename = await getValidUbuntuCodename();
        await runCommand(`sudo sed -i "s/resolute/${validCodename}/g" /etc/apt/sources.list.d/*ondrej* 2>/dev/null || true`);
      } catch (_) {}
    }

    // Helper: ensure multi-version PHP repositories are configured (Debian Sury / Ubuntu Ondrej / DNF Remi)
    async function ensurePhpRepo(pmType, distro) {
      if (process.platform === 'win32') return;

      if (pmType === 'apt') {
        // Always clean conflicting entries first
        await cleanupConflictingPhpRepos();

        let isDebian = false;
        try {
          const osRel = await fs.readFile('/etc/os-release', 'utf8').catch(() => '');
          if (osRel.includes('ID=debian') || (osRel.includes('ID_LIKE=debian') && !osRel.includes('ubuntu'))) {
            isDebian = true;
          }
        } catch (_) {}

        if (isDebian || distro === 'debian') {
          logger.info('PHP Manager: Ensuring Sury repository for Debian...');
          try {
            await runCommand('sudo DEBIAN_FRONTEND=noninteractive apt-get update -y').catch(() => {});
            await runCommand('sudo DEBIAN_FRONTEND=noninteractive apt-get install -y lsb-release ca-certificates apt-transport-https curl gnupg software-properties-common');
            await runCommand('sudo curl -sSLo /etc/apt/trusted.gpg.d/php.gpg https://packages.sury.org/php/apt.gpg');
            const codename = (await runCommand('lsb_release -sc 2>/dev/null || (grep VERSION_CODENAME /etc/os-release | cut -d= -f2)')).trim() || 'bookworm';
            await runCommand(`echo "deb https://packages.sury.org/php/ ${codename} main" | sudo tee /etc/apt/sources.list.d/sury-php.list`);
            await runCommand('sudo apt-get update -y');
            logger.info('PHP Manager: Sury repository for Debian successfully added.');
          } catch (repoErr) {
            logger.error(`PHP Manager: Failed to configure Sury Debian repository: ${repoErr.message}`);
          }
        } else {
          logger.info('PHP Manager: Ensuring Ondrej PPA for Ubuntu...');
          const ubuntuCodename = await getValidUbuntuCodename();

          // Wipe existing ondrej files to eliminate any Signed-By or codename conflicts
          await runCommand('sudo rm -f /etc/apt/sources.list.d/*ondrej* /etc/apt/trusted.gpg.d/ondrej* /etc/apt/keyrings/ondrej*');
          
          let ppaSuccess = false;
          try {
            await runCommand('sudo DEBIAN_FRONTEND=noninteractive apt-get update -y').catch(() => {});
            await runCommand('sudo DEBIAN_FRONTEND=noninteractive apt-get install -y software-properties-common ca-certificates lsb-release gnupg curl');
            await runCommand('sudo LC_ALL=C.UTF-8 add-apt-repository -y ppa:ondrej/php');
            // If add-apt-repository wrote derivative codename like "resolute", sanitize to valid Ubuntu codename
            await runCommand(`sudo sed -i "s/resolute/${ubuntuCodename}/g" /etc/apt/sources.list.d/*ondrej* 2>/dev/null || true`);
            await runCommand('sudo apt-get update -y');
            ppaSuccess = true;
            logger.info('PHP Manager: Ondrej PPA added via add-apt-repository.');
          } catch (ppaErr) {
            logger.warn(`PHP Manager: add-apt-repository had issues (${ppaErr.message}), configuring single direct PPA source...`);
          }

          if (!ppaSuccess) {
            try {
              // Ensure clean state before direct setup
              await runCommand('sudo rm -f /etc/apt/sources.list.d/*ondrej* /etc/apt/trusted.gpg.d/ondrej* /etc/apt/keyrings/ondrej*');
              await runCommand('sudo mkdir -p /etc/apt/keyrings');
              await runCommand('sudo curl -sSLo /etc/apt/keyrings/ondrej-php.gpg "https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x14AA40EC0831756756D7F66C4F4EA0AAE5267A6C"');
              await runCommand(`echo "deb [signed-by=/etc/apt/keyrings/ondrej-php.gpg] https://ppa.launchpadcontent.net/ondrej/php/ubuntu ${ubuntuCodename} main" | sudo tee /etc/apt/sources.list.d/ondrej-php.list`);
              await runCommand('sudo apt-get update -y');
              logger.info(`PHP Manager: Ondrej PPA configured directly with codename ${ubuntuCodename}.`);
            } catch (directErr) {
              logger.error(`PHP Manager: Direct Ondrej PPA setup failed: ${directErr.message}`);
            }
          }
        }
      } else if (pmType === 'dnf') {
        try {
          await runCommand('sudo dnf install -y epel-release https://rpms.remirepo.net/enterprise/remi-release-$(rpm -E %rhel).rpm || true');
        } catch (_) {}
      }
    }

    // 3. Route: Install PHP Version
    app.post('/api/plugins/php-manager/install', async (req, res) => {
      const { version } = req.body;
      if (!SUPPORTED_PHP_VERSIONS.includes(version)) {
        return errorResponse(res, 'Invalid PHP Version', 400);
      }

      try {
        await packageManager.init();
        const isWindows = process.platform === 'win32';
        
        let installCmd = '';
        if (packageManager.pmType === 'apt') {
          if (!isWindows) {
            // First cleanup any corrupted repo state
            await cleanupConflictingPhpRepos();

            // Check if package candidate exists; if not, ensure repo is added
            let hasCandidate = false;
            try {
              const checkOutput = await runCommand(`apt-cache show php${version}-fpm 2>/dev/null || true`);
              if (checkOutput && checkOutput.includes(`Package: php${version}-fpm`)) {
                hasCandidate = true;
              }
            } catch (_) {}

            if (!hasCandidate) {
              await ensurePhpRepo(packageManager.pmType, packageManager.distro);
            }
          }

          const pkgs = `php${version}-fpm php${version}-cli php${version}-sqlite3 php${version}-mysql php${version}-curl php${version}-zip php${version}-xml php${version}-mbstring php${version}-gd`;
          installCmd = `sudo DEBIAN_FRONTEND=noninteractive apt-get install -y ${pkgs}`;
        } else if (packageManager.pmType === 'dnf') {
          if (!isWindows) {
            await ensurePhpRepo(packageManager.pmType, packageManager.distro);
          }
          installCmd = `sudo dnf install -y php${version.replace('.', '')}-php-fpm php${version.replace('.', '')}-php-cli php${version.replace('.', '')}-php-mysqlnd php${version.replace('.', '')}-php-gd php${version.replace('.', '')}-php-xml php${version.replace('.', '')}-php-mbstring`;
        } else {
          // Generic
          installCmd = `echo "Installer fallback for ${packageManager.pmType}"`;
        }

        try {
          logger.info(`PHP Manager: Installing PHP ${version} with command: ${installCmd}`);
          await runCommand(installCmd);
        } catch (firstErr) {
          if (!isWindows && (
            firstErr.message.includes('Conflicting values') ||
            firstErr.message.includes('no installation candidate') ||
            firstErr.message.includes('Unable to locate package') ||
            firstErr.message.includes('The list of sources could not be read')
          )) {
            logger.warn(`PHP Manager: Install encountered repository issue (${firstErr.message}), running auto-repair...`);
            await ensurePhpRepo(packageManager.pmType, packageManager.distro);
            logger.info(`PHP Manager: Retrying installation of PHP ${version}...`);
            await runCommand(installCmd);
          } else {
            throw firstErr;
          }
        }

        // Start and enable service after install
        if (!isWindows) {
          await runCommand(`sudo systemctl enable php${version}-fpm && sudo systemctl start php${version}-fpm`).catch(() => {});
        }
        
        return successResponse(res, null, `PHP ${version} and extensions installed successfully`);
      } catch (err) {
        logger.error(`PHP Manager: Install failed for PHP ${version}: ${err.message}`);
        return errorResponse(res, err.message, 500);
      }
    });

    // 4. Route: Update Config (php.ini)
    app.post('/api/plugins/php-manager/config', async (req, res) => {
      const { version, memory_limit, upload_max_filesize, post_max_size, max_execution_time } = req.body;
      if (!SUPPORTED_PHP_VERSIONS.includes(version)) {
        return errorResponse(res, 'Invalid PHP Version', 400);
      }

      const iniPath = `/etc/php/${version}/fpm/php.ini`;

      try {
        if (process.platform !== 'win32') {
          // Read ini
          let content = await fs.readFile(iniPath, 'utf8');

          // Replace keys safely
          const replacements = {
            memory_limit: memory_limit || '128M',
            upload_max_filesize: upload_max_filesize || '2M',
            post_max_size: post_max_size || '8M',
            max_execution_time: max_execution_time || '30'
          };

          for (const [key, val] of Object.entries(replacements)) {
            const regex = new RegExp(`^${key}\\s*=\\s*.*$`, 'm');
            if (content.match(regex)) {
              content = content.replace(regex, `${key} = ${val}`);
            } else {
              content += `\n${key} = ${val}`;
            }
          }

          // Write back using a temp file and sudo mv to avoid permission errors
          const tmpPath = `/tmp/php-${version}-ini-update`;
          await fs.writeFile(tmpPath, content, 'utf8');
          await runCommand(`sudo mv ${tmpPath} ${iniPath}`);
          await runCommand(`sudo chmod 644 ${iniPath}`);
          
          // Restart FPM to apply changes
          await runCommand(`sudo systemctl restart php${version}-fpm`);
        }

        return successResponse(res, null, `PHP ${version} configuration updated and FPM service restarted`);
      } catch (err) {
        return errorResponse(res, err.message, 500);
      }
    });
  }
};
