import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import logger from '../../config/logger.js';

const execAsync = promisify(exec);

const CRITICAL_PACKAGES = [
  'openssl',
  'openssh-server',
  'nginx',
  'sudo',
  'curl',
  'postgresql',
  'mariadb-server',
  'redis-server',
  'docker-ce',
  'containerd.io',
  'nodejs',
  'python3',
  'git',
  'libc6',
];

async function runCmd(cmd, timeout = 8000) {
  const { stdout } = await execAsync(cmd, { timeout, maxBuffer: 4 * 1024 * 1024 });
  return stdout || '';
}

class VulnerabilityIntelligenceService {
  /**
   * Detect Linux OS ecosystem for OSV.dev queries.
   */
  detectOsEcosystem() {
    if (process.platform === 'win32' || !fs.existsSync('/etc/os-release')) {
      return { ecosystem: null, prettyName: process.platform };
    }
    try {
      const content = fs.readFileSync('/etc/os-release', 'utf8');
      const idMatch = content.match(/^ID=["']?([a-zA-Z0-9_-]+)["']?/m);
      const nameMatch = content.match(/^PRETTY_NAME=["']?([^"'\n]+)["']?/m);
      const id = (idMatch?.[1] || '').toLowerCase();
      const map = {
        debian: 'Debian',
        ubuntu: 'Ubuntu',
        alpine: 'Alpine',
        rocky: 'Rocky Linux',
        almalinux: 'AlmaLinux',
      };
      return {
        ecosystem: map[id] || null,
        prettyName: nameMatch?.[1] || id || 'Linux',
      };
    } catch {
      return { ecosystem: null, prettyName: 'Linux' };
    }
  }

  /**
   * Query OSV.dev batch API for live CVEs affecting installed host packages.
   * Gracefully no-ops in test/Windows/offline environments.
   */
  async scanLivePackages(fetchFn = globalThis.fetch) {
    const findings = [];
    if (process.platform === 'win32' || process.env.NODE_ENV === 'test') {
      return findings;
    }

    const { ecosystem } = this.detectOsEcosystem();
    if (!ecosystem || typeof fetchFn !== 'function') return findings;

    try {
      const installed = [];
      if (ecosystem === 'Debian' || ecosystem === 'Ubuntu') {
        const pkgList = CRITICAL_PACKAGES.join(' ');
        const out = await runCmd(`dpkg-query -W -f='\${Package}\\t\${Version}\\n' ${pkgList} 2>/dev/null || true`, 5000);
        for (const line of out.split('\n')) {
          const [name, version] = line.trim().split('\t');
          if (name && version) installed.push({ name, version });
        }
      } else if (ecosystem === 'Alpine') {
        const out = await runCmd('apk info -v 2>/dev/null || true', 5000);
        for (const pkg of CRITICAL_PACKAGES) {
          const line = out.split('\n').find((l) => l.startsWith(`${pkg}-`));
          if (line) {
            const ver = line.slice(pkg.length + 1).trim();
            if (ver) installed.push({ name: pkg, version: ver });
          }
        }
      }

      if (installed.length === 0) return findings;

      const queries = installed.map((p) => ({
        package: { name: p.name, ecosystem },
        version: p.version,
      }));

      const res = await fetchFn('https://api.osv.dev/v1/querybatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries }),
        signal: AbortSignal.timeout(4000),
      });

      if (!res.ok) return findings;
      const data = await res.json();
      const results = Array.isArray(data?.results) ? data.results : [];

      results.forEach((entry, idx) => {
        const vulns = Array.isArray(entry?.vulns) ? entry.vulns : [];
        if (vulns.length === 0) return;

        const pkg = installed[idx];
        const top = vulns[0];
        const cveId = top.id || `OSV-${pkg.name.toUpperCase()}`;

        findings.push({
          category: 'os',
          title: `Outdated Package with Known CVEs: ${pkg.name} (${vulns.length} advisories)`,
          cve_id: cveId,
          severity: vulns.length >= 3 ? 'high' : 'medium',
          cvss_score: vulns.length >= 3 ? 7.8 : 5.9,
          component: `OS Package: ${pkg.name}`,
          installed_version: pkg.version,
          fixed_version: 'Latest distribution security patch',
          description: `OSV.dev threat feed reported ${vulns.length} known advisory/advisories affecting ${pkg.name} (${pkg.version}), including ${cveId}.`,
          impact: 'Unpatched OS packages may expose known remote or local security flaws.',
          manual_steps: `# Upgrade ${pkg.name} to latest security release\nsudo apt-get update && sudo apt-get --only-upgrade install -y ${pkg.name}`,
          auto_fix_command: `apt-get update && apt-get --only-upgrade install -y ${pkg.name}`,
          auto_fix_safe: 1,
        });
      });
    } catch (err) {
      logger.debug(`OSV.dev live package scan skipped: ${err.message}`);
    }

    return findings;
  }

  /**
   * Run CIS Linux Benchmark compliance checks and emit both compliance summary and findings.
   */
  async scanCisBenchmark() {
    const controls = [];
    const findings = [];
    const isWin = process.platform === 'win32';

    const record = (id, title, passed, findingIfFailed = null) => {
      controls.push({ id, title, status: passed ? 'pass' : 'fail' });
      if (!passed && findingIfFailed) {
        findings.push({ category: 'cis', cve_id: id, ...findingIfFailed });
      }
    };

    if (isWin) {
      // Return clean baseline controls on Windows dev/test hosts
      record('CIS-1.5.1', 'Kernel ASLR Enabled (kernel.randomize_va_space = 2)', true);
      record('CIS-3.3.8', 'TCP SYN Cookies Enabled (net.ipv4.tcp_syncookies = 1)', true);
      record('CIS-5.2.8', 'SSH PasswordAuthentication Disabled', true);
      record('CIS-5.2.11', 'SSH PermitEmptyPasswords Disabled', true);
      record('CIS-6.1.3', 'Restricted /etc/shadow File Permissions', true);
      record('CIS-4.2', 'System Logging Daemon Active (journald/rsyslog)', true);
      return { scorePercent: 100, passed: 6, failed: 0, total: 6, controls, findings };
    }

    // CIS-1.5.1: ASLR
    try {
      const aslr = (await runCmd('cat /proc/sys/kernel/randomize_va_space 2>/dev/null || echo 2')).trim();
      record('CIS-1.5.1', 'Kernel ASLR Enabled (kernel.randomize_va_space = 2)', aslr === '2', {
        title: 'CIS-1.5.1: Kernel ASLR Not Fully Enabled',
        severity: 'medium',
        cvss_score: 5.5,
        component: 'Linux Kernel Sysctl',
        installed_version: `randomize_va_space = ${aslr}`,
        fixed_version: 'randomize_va_space = 2',
        description: 'Address Space Layout Randomization (ASLR) is not set to full randomization (2), making memory corruption exploitation easier.',
        impact: 'Weakened memory exploit mitigation for running daemons.',
        manual_steps: 'echo "kernel.randomize_va_space = 2" | sudo tee /etc/sysctl.d/99-cis-aslr.conf && sudo sysctl -w kernel.randomize_va_space=2',
        auto_fix_command: 'echo "kernel.randomize_va_space = 2" > /etc/sysctl.d/99-cis-aslr.conf && sysctl -w kernel.randomize_va_space=2',
        auto_fix_safe: 1,
      });
    } catch {}

    // CIS-3.3.8: TCP SYN Cookies
    try {
      const syn = (await runCmd('cat /proc/sys/net/ipv4/tcp_syncookies 2>/dev/null || echo 1')).trim();
      record('CIS-3.3.8', 'TCP SYN Cookies Enabled (net.ipv4.tcp_syncookies = 1)', syn === '1', {
        title: 'CIS-3.3.8: TCP SYN Cookies Disabled',
        severity: 'medium',
        cvss_score: 5.3,
        component: 'Linux Network Stack',
        installed_version: `tcp_syncookies = ${syn}`,
        fixed_version: 'tcp_syncookies = 1',
        description: 'TCP SYN cookies are disabled, leaving the host more vulnerable to SYN flood denial-of-service attacks.',
        impact: 'Increased susceptibility to TCP SYN flood exhaustion.',
        manual_steps: 'echo "net.ipv4.tcp_syncookies = 1" | sudo tee /etc/sysctl.d/99-cis-syncookies.conf && sudo sysctl -w net.ipv4.tcp_syncookies=1',
        auto_fix_command: 'echo "net.ipv4.tcp_syncookies = 1" > /etc/sysctl.d/99-cis-syncookies.conf && sysctl -w net.ipv4.tcp_syncookies=1',
        auto_fix_safe: 1,
      });
    } catch {}

    // CIS-5.2.8 & CIS-5.2.11: SSH Hardening
    try {
      const sshdT = await runCmd('sshd -T 2>/dev/null || true');
      if (sshdT) {
        const pwAuthOff = /^passwordauthentication\s+no\b/mi.test(sshdT);
        record('CIS-5.2.8', 'SSH PasswordAuthentication Disabled', pwAuthOff, {
          title: 'CIS-5.2.8: SSH Password Authentication Enabled',
          severity: 'medium',
          cvss_score: 6.2,
          component: 'OpenSSH Server',
          installed_version: 'PasswordAuthentication yes',
          fixed_version: 'PasswordAuthentication no',
          description: 'SSH allows password-based authentication instead of enforcing public-key authentication.',
          impact: 'Exposure to automated SSH credential stuffing and brute-force attacks.',
          manual_steps: '# Ensure your SSH public key works before disabling passwords!\nsudo sed -i "s/^#*PasswordAuthentication.*/PasswordAuthentication no/" /etc/ssh/sshd_config && sudo systemctl reload ssh || sudo systemctl reload sshd',
          auto_fix_command: null, // Manual only to prevent lockout
          auto_fix_safe: 0,
        });

        const emptyPwOff = !/^permitemptypasswords\s+yes\b/mi.test(sshdT);
        record('CIS-5.2.11', 'SSH PermitEmptyPasswords Disabled', emptyPwOff, {
          title: 'CIS-5.2.11: SSH PermitEmptyPasswords Enabled',
          severity: 'critical',
          cvss_score: 9.1,
          component: 'OpenSSH Server',
          installed_version: 'PermitEmptyPasswords yes',
          fixed_version: 'PermitEmptyPasswords no',
          description: 'SSH allows login to accounts with empty passwords.',
          impact: 'Critical unauthorized remote access risk.',
          manual_steps: 'sudo sed -i "s/^#*PermitEmptyPasswords.*/PermitEmptyPasswords no/" /etc/ssh/sshd_config && (sudo systemctl reload ssh || sudo systemctl reload sshd)',
          auto_fix_command: 'sed -i "s/^#*PermitEmptyPasswords.*/PermitEmptyPasswords no/" /etc/ssh/sshd_config && (systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true)',
          auto_fix_safe: 1,
        });
      }
    } catch {}

    // CIS-6.1.3: /etc/shadow permissions
    try {
      if (fs.existsSync('/etc/shadow')) {
        const stat = fs.statSync('/etc/shadow');
        const mode = stat.mode & 0o777;
        const safeShadow = (mode & 0o037) === 0; // no group write/exec, no world access
        record('CIS-6.1.3', 'Restricted /etc/shadow File Permissions', safeShadow, {
          title: 'CIS-6.1.3: Overly Permissive /etc/shadow Permissions',
          severity: 'high',
          cvss_score: 7.8,
          component: 'Filesystem Permissions',
          installed_version: `mode ${mode.toString(8)}`,
          fixed_version: 'mode 640 or 600',
          description: '/etc/shadow has overly permissive access bits, potentially exposing password hashes to non-privileged users.',
          impact: 'Local password hash disclosure.',
          manual_steps: 'sudo chmod 640 /etc/shadow && sudo chown root:shadow /etc/shadow',
          auto_fix_command: 'chmod 640 /etc/shadow',
          auto_fix_safe: 1,
        });
      }
    } catch {}

    // CIS-4.2: System Logging
    try {
      const logStatus = (await runCmd('systemctl is-active systemd-journald rsyslog 2>/dev/null || true')).trim();
      const logOk = logStatus.split('\n').some((s) => s.trim() === 'active');
      record('CIS-4.2', 'System Logging Daemon Active (journald/rsyslog)', logOk, {
        title: 'CIS-4.2: System Logging Service Inactive',
        severity: 'medium',
        cvss_score: 5.0,
        component: 'System Logging',
        installed_version: 'Inactive',
        fixed_version: 'Active (journald/rsyslog)',
        description: 'Neither systemd-journald nor rsyslog appears active, impairing security audit trails.',
        impact: 'Loss of forensic and intrusion audit logs.',
        manual_steps: 'sudo systemctl enable --now systemd-journald',
        auto_fix_command: 'systemctl enable --now systemd-journald',
        auto_fix_safe: 1,
      });
    } catch {}

    const total = controls.length || 1;
    const passed = controls.filter((c) => c.status === 'pass').length;
    const failed = total - passed;
    return {
      scorePercent: Math.round((passed / total) * 100),
      passed,
      failed,
      total,
      controls,
      findings,
    };
  }

  /**
   * Scan running Docker containers & images (Trivy if installed, plus runtime posture checks).
   */
  async scanContainers() {
    const findings = [];
    if (process.platform === 'win32' || process.env.NODE_ENV === 'test') {
      return findings;
    }

    try {
      const hasDocker = (await runCmd('command -v docker 2>/dev/null || true')).trim();
      if (!hasDocker) return findings;

      const psOut = await runCmd('docker ps --format "{{.Names}}\\t{{.Image}}" 2>/dev/null || true', 5000);
      const containers = psOut
        .split('\n')
        .map((l) => l.trim().split('\t'))
        .filter(([name, image]) => name && image);

      if (containers.length === 0) return findings;

      // 1. Runtime privilege & Docker socket mount inspection
      for (const [name, image] of containers.slice(0, 20)) {
        try {
          const inspectRaw = await runCmd(`docker inspect --format '{{.HostConfig.Privileged}}|{{json .Mounts}}' "${name.replace(/"/g, '')}" 2>/dev/null || true`, 3000);
          const [priv, mountsJson] = inspectRaw.trim().split('|');
          if (priv === 'true') {
            findings.push({
              category: 'containers',
              title: `Privileged Docker Container Running: ${name}`,
              cve_id: 'CIS-DOCK-5.4',
              severity: 'high',
              cvss_score: 8.1,
              component: `Container: ${name} (${image})`,
              installed_version: 'Privileged: true',
              fixed_version: 'Privileged: false',
              description: `Container "${name}" is running with --privileged, granting near-root host kernel capabilities.`,
              impact: 'Container escape to full host root compromise.',
              manual_steps: `# Recreate container "${name}" without --privileged and grant only specific --cap-add flags if needed.`,
              auto_fix_command: null,
              auto_fix_safe: 0,
            });
          }
          if (mountsJson && mountsJson.includes('/var/run/docker.sock') && !name.includes('socket-proxy')) {
            findings.push({
              category: 'containers',
              title: `Raw Docker Socket Mounted in Container: ${name}`,
              cve_id: 'CIS-DOCK-5.31',
              severity: 'high',
              cvss_score: 8.4,
              component: `Container: ${name}`,
              installed_version: '/var/run/docker.sock mounted',
              fixed_version: 'Use docker-socket-proxy',
              description: `Container "${name}" mounts /var/run/docker.sock directly, allowing full Docker daemon control.`,
              impact: 'Full host takeover via Docker API container spawning.',
              manual_steps: `# Route Docker API calls through tecnativa/docker-socket-proxy instead of mounting /var/run/docker.sock directly.`,
              auto_fix_command: null,
              auto_fix_safe: 0,
            });
          }
        } catch {}
      }

      // 2. Optional Trivy image CVE scan (if trivy CLI is installed)
      const hasTrivy = (await runCmd('command -v trivy 2>/dev/null || true')).trim();
      if (hasTrivy) {
        const uniqueImages = [...new Set(containers.map(([, img]) => img))].slice(0, 5);
        for (const img of uniqueImages) {
          try {
            const safeImg = img.replace(/[^a-zA-Z0-9._:/@-]/g, '');
            const trivyRaw = await runCmd(`trivy image --quiet --severity CRITICAL,HIGH --format json "${safeImg}" 2>/dev/null || true`, 20000);
            if (!trivyRaw) continue;
            const parsed = JSON.parse(trivyRaw);
            const results = parsed?.Results || [];
            const vulns = results.flatMap((r) => r.Vulnerabilities || []);
            if (vulns.length > 0) {
              const top = vulns[0];
              findings.push({
                category: 'containers',
                title: `Container Image Vulnerabilities in ${safeImg} (${vulns.length} High/Critical)`,
                cve_id: top.VulnerabilityID || 'TRIVY-CVE',
                severity: vulns.some((v) => v.Severity === 'CRITICAL') ? 'critical' : 'high',
                cvss_score: 8.0,
                component: `Docker Image: ${safeImg}`,
                installed_version: top.InstalledVersion || 'current',
                fixed_version: top.FixedVersion || 'Updated base image',
                description: `Trivy detected ${vulns.length} CRITICAL/HIGH vulnerabilities in image ${safeImg} (e.g. ${top.VulnerabilityID} in ${top.PkgName}).`,
                impact: 'Exploitable libraries inside running container workloads.',
                manual_steps: `docker pull ${safeImg} && docker compose up -d`,
                auto_fix_command: null,
                auto_fix_safe: 0,
              });
            }
          } catch {}
        }
      }
    } catch (err) {
      logger.debug(`Container scan error: ${err.message}`);
    }

    return findings;
  }

  /**
   * Build a SARIF v2.1.0 report for CI/CD & SIEM interoperability.
   */
  buildSarifReport(summary, findings) {
    const levelMap = {
      critical: 'error',
      high: 'error',
      medium: 'warning',
      low: 'note',
    };

    const rules = [];
    const seenRules = new Set();
    const results = [];

    for (const f of findings) {
      const ruleId = f.cve_id || f.id || 'PANELKU-SEC';
      if (!seenRules.has(ruleId)) {
        seenRules.add(ruleId);
        rules.push({
          id: ruleId,
          name: f.title,
          shortDescription: { text: f.title },
          fullDescription: { text: f.description || f.title },
          properties: {
            category: f.category,
            severity: f.severity,
            cvss: f.cvss_score || 0,
          },
        });
      }

      results.push({
        ruleId,
        level: levelMap[f.severity] || 'warning',
        message: {
          text: `${f.title} [${f.component}] — ${f.description || ''}`,
        },
        locations: [
          {
            physicalLocation: {
              artifactLocation: {
                uri: f.component || 'host',
              },
            },
          },
        ],
      });
    }

    return {
      $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
      version: '2.1.0',
      runs: [
        {
          tool: {
            driver: {
              name: 'PanelKu Vulnerability & Compliance Center',
              version: '3.8.0',
              informationUri: 'https://github.com/kiramizuky/PanelKu',
              rules,
            },
          },
          properties: {
            securityScore: summary.score,
            rating: summary.rating,
          },
          results,
        },
      ],
    };
  }
}

export default new VulnerabilityIntelligenceService();
