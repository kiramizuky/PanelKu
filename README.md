# Linux Server Control Panel

> Lightweight, modern, realtime Linux server control panel — a blend of aaPanel, Portainer, CasaOS, and Cockpit, but far lighter.

[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green)](https://nodejs.org)
[![Version](https://img.shields.io/badge/version-1.9.0-blue)](CHANGELOG)
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
| Phase 9 (v1.9.0) | ✅ Done | **Runtime Managers** — Node.js version management (nvm/nodenv), Python virtual environments (pyenv), Gunicorn/Uvicorn setup, MongoDB Manager, Redis Manager, Apache Manager |
| Phase 10 (v1.9.0) | ✅ Done | **Backup & Disaster Recovery** — Rclone + S3 automated backups, scheduled snapshots, retention policies, one-click restore |
| Phase 11 (v1.9.0) | ✅ Done | **Analytics & Monitoring** — Metrics & Logs Analytics Dashboard, historical trend analysis, log aggregation, Prometheus-style visualization |
| Phase 12 (v1.9.0) | ✅ Done | **Multi-User RBAC + SSO/LDAP** — LDAP authentication, SAML/OpenID Connect SSO, fine-grained permissions, group-based role mapping |
| Phase 13 (v1.9.0) | ✅ Done | **Service Mesh & Auto-Healing** — systemd health checks, auto-restart, alerting, service dependency management |
| Phase 14 (v1.9.0) | ✅ Done | **Auto-Updater & Rollback** — One-click git update, pre-update health check, automatic rollback on failure, update history |
| Phase 15 (v1.9.0) | ✅ Done | **Caddy Server Manager** — Full Caddyfile editor, automatic HTTPS, reverse proxy, static file serving |
| Phase 16 (v1.9.0) | ✅ Done | **AI Auto-Repair** — GPT-powered log analysis, auto-fix suggestions, predictive alerts, self-healing engine |
| Phase 17 (v1.9.0) | ✅ Done | **Enhanced Database Explorer** — 5-tab explorer (Browse/Structure/Query/Export/History), pagination, sorting, export/import JSON/CSV/SQL |
| Phase 18 (v1.9.0) | ✅ Done | **GPU Manager** — NVIDIA GPU monitoring (nvidia-smi), CUDA/CUDNN detection, process management, power limit control |
| Phase 19 (v1.9.0) | ✅ Done | **Power Manager** — CPU governor control, power profiles, suspend/hibernate, thermal zones, fan monitoring |
| Phase 20 (v1.9.0) | ✅ Done | **Mail Server Manager** — Postfix/Dovecot/SpamAssassin, email accounts, mail queue, spam config, SSL certs |
| Phase 21 (v1.9.0) | ✅ Done | **CDN & Cache Manager** — Cloudflare API, Varnish cache, Redis cache, Full Page Cache (Nginx FPC) |
| Phase 22 (v1.9.0) | ✅ Done | **IoT & Edge Device Manager** — Mosquitto MQTT, Home Assistant, Node-RED, device discovery, MQTT metrics |

## Changelog

### v1.9.0 — July 17, 2026 (Major Feature Release)

> 12 new modules added — GPU management, power management, mail server, CDN/cache, IoT device manager, enhanced database explorer, runtime managers, and more.

**🚀 New Modules**
- **GPU Manager** — Full NVIDIA GPU monitoring via nvidia-smi, CUDA/CUDNN detection, per-GPU utilization (GPU/Memory/Power), temperature, fan, clocks, process management with kill capability, power limit control
- **Power Manager** — CPU frequency scaling & governor control, power profiles (Performance/Balanced/Power-Saver), suspend/hibernate/hybrid-sleep, thermal zone monitoring with threshold alerts, fan RPM monitoring
- **Mail Server Manager** — Postfix/Dovecot/SpamAssassin: install/uninstall, domain management, email accounts (SHA512-CRYPT), mail queue view/flush/delete, SpamAssassin config, SSL viewer, journalctl logs
- **CDN & Cache Manager** — Cloudflare API (zone list, cache purge, analytics), Varnish (status, VCL editor, cache purge), Redis cache stats/flush, Full Page Cache
- **IoT & Edge Device Manager** — Mosquitto MQTT broker (config/users/ACL/publish QoS), Home Assistant & Node-RED Docker deploy, nmap device discovery, MQTT metrics
- **Enhanced Database Explorer** — 5-tab explorer: Browse (paginated, sortable), Structure (columns/keys/FK), Query (SQL console with Ctrl+Enter), Export (JSON/CSV/SQL), Import (CSV/SQL), History (last 100 queries)
- **Runtime Managers** — Node.js version management (nvm/nodenv), Python virtual environments (pyenv/Gunicorn/Uvicorn), MongoDB full management, Redis dashboard with keyspace monitor, Apache virtual host manager
- **Caddy Server Manager** — Full Caddyfile editor, automatic HTTPS, reverse proxy config, import management
- **AI Auto-Repair** — GPT-powered log analysis, intelligent fix suggestions with one-click apply, predictive alerting, trend analysis
- **Auto-Updater & Rollback** — One-click git update with pre-update health check, automatic rollback on failure
- **Multi-User RBAC + SSO/LDAP** — LDAP integration, SAML/OpenID Connect SSO, fine-grained permissions, group-based mapping
- **Service Mesh & Auto-Healing** — systemd health checks, auto-restart, alerting on repeated failures
- **Backup & Disaster Recovery** — Rclone + S3 automated backups with retention policies
- **Analytics Dashboard** — Historical metrics with time-range selectors, log aggregation, trend charts
- **Comprehensive Swagger API Docs** — OpenAPI 3.0 documentation for all modules with interactive Try-It-Out

### v1.8.0 — July 15, 2026 (Security Patch)
🔴 Critical: Shell injection fix (execFile), Zip Slip protection, upload filter (18 types), graceful shutdown WAL-safe, EISDIR crash guard, install dir fix (/opt/panelku), storage 750, install.sh multi-distro rewrite.

### v1.7.0 — July 13, 2026
OpenClaw AI Copilot, Nginx Reverse Proxy Docker Mapper, PHP Pool Manager, Database Visual Explorer, WhatsApp Alerting, Service Watchdog, Audit Log Dashboard, Security Advisor, Multi-Cloud S3 Backup, Terminal AI, Git Webhooks, Tailscale VPN.

### v1.6.0 — July 9, 2026
Multi-Node Cluster Manager, SQLite Auto-Backups, Terminal Audit Logs, GitHub Actions CI/CD.

### v1.5.0 — July 8, 2026
PHP Manager, 2FA/MFA, SSH Key Manager, Let's Encrypt Auto-Renewal, Fail2Ban logs, distro-aware auto-updates.

## License

MIT
