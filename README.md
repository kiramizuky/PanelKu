# Linux Server Control Panel

> Lightweight, modern, realtime Linux server control panel — a blend of aaPanel, Portainer, CasaOS, and Cockpit, but far lighter.

[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green)](https://nodejs.org)
[![Version](https://img.shields.io/badge/version-1.8.0-blue)](CHANGELOG)
[![License](https://img.shields.io/badge/License-MIT-blue)](LICENSE)

## Core Features

- 🔐 **Multi-Factor Authentication (MFA / 2FA)** — Access token, refresh token, TOTP (Google Authenticator/Authy) session management
- 👥 **Dynamic RBAC** — Super Admin, Admin, Operator, Read Only with per-resource permissions
- 📊 **Realtime Dashboard** — CPU, RAM, Disk, Temperature, Network via Socket.IO + Chart.js, featuring a **Real-Time Process Inspector** (sort by CPU/Memory)
- 📈 **Monitoring** — Historical metrics, disk health, network interfaces (with IP mapping), alert thresholds
- 🖥️ **Web Terminal** — xterm.js + node-pty, multi-tab, bash/zsh/fish
- 📁 **File Manager** — Browse, upload, download, edit, zip/unzip, rename, delete, search
- 🛡️ **Security & SSH Key Manager** — Dedicated UI to manage SSH keys (`authorized_keys`), SSH port, Password Authentication toggle, and live Fail2Ban intrusion logs dashboard
- 🌐 **Tailscale VPN Integration** — Optional client-side status dashboard, automatic installation scripts, one-click connection/disconnection controls, and web browser or auth key configuration to securely access the panel privately
- 🔌 **Plugin Marketplace & SDK** — Install/uninstall extensions dynamically with hot route mounting
- 🐘 **PHP Manager Plugin** — Complete control panel for multiple PHP versions (8.1 - 8.4) with FPM service actions and custom `php.ini` config values
- 🐳 **Docker & Compose Engine** — Start, stop, monitor telemetry, and deploy compose stacks (with automatic fallback to standalone `docker-compose`)
- 🔒 **Let's Encrypt Auto-Renewal** — Automatic SSL certificate request and renewal scheduler built into the panel health system
- ⚙️ **Distro-Aware Auto-Updates** — Dynamically writes daily update/upgrade cron scripts tailored to native package managers (APT, DNF, Pacman, Emerge)
- 📱 **Responsive Design** — Fully mobile-friendly layout with a frosted-glass **Burger Sidebar Drawer** offcanvas navigation menu
- 📡 **Built-in Plugins** — DB Web Admin (phpMyAdmin, pgAdmin, Adminer), Smart Home Manager (Home Assistant, Mosquitto, Zigbee2MQTT), Media & Cloud Services (Jellyfin, qBottorrent), Realtime Log Analyzer, OpenClaw AI, WireGuard VPN, Fail2ban Admin, PM2 Manager, S3/Rclone Backups, Redis, Nextcloud, AdGuard Home, MinIO S3 Server, Uptime Kuma, and Rclone Manager (featuring host-level dependencies auto-installers)
- 🔐 **Security Hardened (v1.8.0)** — Shell injection prevention via `execFile()`, Zip Slip protection, upload extension blocking (18 dangerous types), WAL-safe graceful shutdown, EISDIR crash guard, storage permission hardening (`750`), and path traversal validation on rename

## Requirements

- Node.js 20+
- SQLite 3 (embedded, zero-configuration required)
- Redis 7 (optional, for background jobs and message queues)
- Linux (Debian/Ubuntu/Fedora/Arch/Gentoo) for full terminal/PTY and service management features

## Quick Start

### With Docker Compose (Recommended)

```bash
cp .env.example .env
# Edit .env and set secure secrets.
docker compose up -d
```

Open: http://localhost:23456  
Login: `admin` / `Admin@123456` (**change this immediately!**)

### With Docker CLI

```bash
# Pull the latest image from Docker Hub
docker pull mastarom/panelku:latest

# Run the container
docker run -d -p 23456:3000 --name panelku \
  -v $(pwd)/storage:/app/storage \
  mastarom/panelku:latest
```

### Manual Install

```bash
# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env

# Start development server
npm run dev

# Or production with PM2
pm2 start ecosystem.config.cjs
```

### One-Click Server Install (Debian/Ubuntu/Fedora/Arch/Gentoo)

```bash
sudo bash scripts/install.sh
```

## Architecture

```
src/
├── app.js              # Express factory
├── server.js           # HTTP + Socket.IO entry
├── bootstrap.js        # DB, Redis, WS, jobs, plugins
├── config/             # App, DB, Redis, Socket, Logger configs
├── core/
│   ├── db/             # SQLite Singleton and Schema definitions
│   ├── events/         # EventBus (pub/sub)
│   ├── scheduler/      # Background job scheduler
│   ├── permissions/    # Dynamic RBAC engine
│   └── plugin-loader/  # Plugin SDK
├── middleware/         # Auth, RBAC, rate limit, error handler
├── models/             # Mongoose-compatible SQLite models
├── repositories/       # Data access layer
├── helpers/            # Response, crypto, system, validation
├── modules/            # Feature modules (auth, users, dashboard, etc.)
├── websocket/          # Socket.IO namespaces
├── jobs/               # Background jobs
├── public/             # Static assets (CSS, JS)
└── views/              # HTML pages
```

## Default Credentials

| Username | Password | Role |
|----------|----------|------|
| admin | Admin@123456 | Super Admin |

> ⚠️ **Change the default password immediately after first login!**

## Roadmap

| Phase | Status | Features |
|-------|--------|----------|
| Phase 1 | ✅ Done | Auth, RBAC, Dashboard, Monitor, Terminal, File Manager |
| Phase 2 | ✅ Done | Docker, Websites, Domains, SSL |
| Phase 3 | ✅ Done | Database Management, Backup, Cron |
| Phase 4 | ✅ Done | Firewall, WAF, Security, Notifications |
| Phase 5 | ✅ Done | Git Deploy, Auto Update, Plugin Marketplace, WireGuard VPN, Fail2ban, PM2, Rclone, OpenClaw AI, DB Web Admin, Smart Home, Media Services, Log Analyzer |
| Phase 6 (v1.6.0) | ✅ Done | Multi-Node Cluster, SQLite Auto-Backups, PTY Terminal Command Audit Log, GitHub Actions Docker Hub Integration |
| Phase 7 (v1.7.0) | ✅ Done | OpenClaw AI Copilot Floating Assistant, Nginx Reverse Proxy Docker Mapper, PHP Pool Configuration Manager, Database Visual Explorer/Console, WhatsApp Alerting, Service Watchdog Auto-Healer, Visual Audit Log Dashboard, Security Advisor (One-Click Fix), Multi-Cloud S3 Backup, Terminal AI Suggestions, Git Webhook Auto-Build, Tailscale VPN Integration |
| Phase 8 (v1.8.0) | ✅ Done | **Security Patch** — Shell injection fix (execFile), Zip Slip protection, upload extension filter, graceful shutdown WAL-safe, EISDIR crash guard, install dir fix (/opt/panelku), storage permission hardening (750→), multi-distro install.sh rewrite |

## Changelog

### v1.8.0 — July 15, 2026 (Security Patch & Stability Release)

> Critical security vulnerabilities patched. Recommended upgrade for all production deployments.

**🔴 Critical Fixes**
- **[CRIT-1]** Fixed shell command injection in database password config — replaced shell string interpolation with `execFile()` + strict regex validation
- **[CRIT-2]** Fixed Zip Slip attack in File Manager — each ZIP entry path validated before extraction
- **[CRIT-3]** Added upload file extension filter — blocks `.php`, `.sh`, `.exe`, `.htaccess` and 15 other dangerous types

**🟠 High Severity Fixes**
- **[HIGH-1]** Fixed graceful shutdown race condition — `server.close()` now called before SQLite/Redis close (prevents WAL corruption)
- **[HIGH-2]** Fixed EISDIR crash on directory download — returns HTTP 400 instead of crashing the Node.js process
- **[HIGH-3]** Upgraded `unzipper` from `^0.12.3` to `^0.12.5`
- **[HIGH-4]** Fixed install directory mismatch (`/opt/linux-panel` → `/opt/panelku`, port `3000` → `23456`)

**🟡 Medium Fixes**
- **[MED-3]** Added File Manager API endpoints to WAF skip list (prevents false positives on `../` in config files)
- **[MED-4]** Fixed path traversal via rename — `newName` now validated through `_resolvePath()`
- **[MED-7]** Storage permission hardened from `777` to `750` in install scripts

**🟢 Improvements**
- **[LOW-1]** Added `npm rebuild node-pty` in install scripts
- **install.sh** (both scripts): Rewritten with `set -euo pipefail`, multi-distro support (`yum`/`apk`/`zypper`), secure secrets via `openssl rand -hex 32`, dynamic Node.js binary URL, safer `sed` delimiter (`|`), systemd hardening

### v1.7.0 — July 13, 2026
Added OpenClaw AI Copilot, Nginx Reverse Proxy Docker Mapper, PHP Pool Manager, Database Visual Explorer, WhatsApp Alerting, Service Watchdog, Visual Audit Log Dashboard, Security Advisor, Multi-Cloud S3 Backup, Terminal AI Suggestions, Git Webhook Auto-Build, Tailscale VPN Integration.

### v1.6.0 — July 9, 2026
Introduced Multi-Node Cluster Manager, SQLite Auto-Backups, Terminal Audit Logs, GitHub Actions CI/CD pipeline.

### v1.5.0 — July 8, 2026
PHP Manager, 2FA/MFA, SSH Key Manager, Let's Encrypt Auto-Renewal, Fail2Ban logs, distro-aware auto-updates.

## License

MIT
