# Linux Server Control Panel (Panelku)

> Lightweight, modern, realtime Linux server control panel — a blend of aaPanel, Portainer, CasaOS, and Cockpit, but far lighter and feature-packed.

[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green)](https://nodejs.org)
[![Version](https://img.shields.io/badge/version-3.5.0-blue)](CHANGELOG)
[![License](https://img.shields.io/badge/License-MIT-blue)](LICENSE)

## Core Features

- 🔐 **Multi-Factor Authentication (MFA / 2FA & FIDO2 Passkeys)** — WebAuthn / Passkeys (Touch ID, Windows Hello, Face ID, YubiKey) powered by SimpleWebAuthn, TOTP (Google Authenticator/Authy), and secure JWT session management.
- 👥 **Dynamic RBAC & Password Policy Engine** — Super Admin, Admin, Operator, Read Only with per-resource permissions, configurable password complexity rules, expiration reminders, forced password change on first login (`mustChangePassword`), and JSON policy import/export.
- 📊 **Realtime Dashboard & Telemetry** — CPU, RAM, Disk, Temperature, Network via Socket.IO + Chart.js, featuring a real-time Process Inspector and Webserver status controls (Nginx / Apache / Caddy).
- 🌐 **Multi-Node Server Clustering & Fleet Mesh** — Centralized multi-server fleet capacity aggregator, 1-click cryptographic pairing tokens, one-line bootstrap agent installer, and parallel remote command dispatcher across remote nodes.
- 🐳 **Docker Management & Compose Visual Studio** — Container lifecycle controls, live resource limit tuner (CPU Quota, Memory limits on running containers without restart), interactive Docker Hub search, Stack Manager with two-way visual GUI & YAML synchronizer, stack log tailing, and 1-Click Let's Encrypt / ZeroSSL auto-reverse proxy.
- 🏪 **1-Click Docker App Store (20+ Templates)** — Curated production templates across AI & LLM (Ollama, Open WebUI, n8n), Web & CMS (WordPress + MariaDB, Nextcloud, Ghost, Strapi), Dev & Tools (Portainer CE, Uptime Kuma, Vaultwarden, Gitea), Databases (phpMyAdmin, pgAdmin 4, Redis Commander), and Media/IoT (Jellyfin, Home Assistant, Mosquitto MQTT).
- 🛡️ **CrowdSec Community Defense & GeoIP Threat Shield** — Integrated CrowdSec decisions sync, real-time GeoIP attack origin map, bad bot honeypot traps (`/.env`, `/.git`, `/wp-login.php`), RCE Shellshock filter, and 1-Click Geo-Shield country blocking.
- 💾 **ZFS / Btrfs Instant Snapshots & 1-Second Rollback** — Point-in-time volume protection for LVM thin pools, ZFS datasets, and Btrfs subvolumes with sub-second rollback capabilities.
- 🚨 **Multi-Channel Incident Alerting & Auto-Remediation** — Real-time notification broadcaster to Telegram, Discord, Slack, WhatsApp, WebPush, and Email with automated remediation policies (Emergency Disk Cleanup, Dead Service Resurrect, OOM mitigation).
- 🤖 **Autonomous AI Copilot & Terminal Assistant** — Unified terminal AI modal (Command Generator with safety guardrails, Error Diagnostics & 1-click fix execution, and Interactive Assistant chat), predictive log anomaly detection, and automated Root Cause Analysis (RCA) incident post-mortems.
- 📈 **Prometheus / OpenMetrics Exporter & Kubernetes Inspector** — Native `/metrics` endpoint formatted for Prometheus/Grafana scraping and auto-detection of local K3s/MicroK8s cluster workloads, pods, and nodes.
- 🗄️ **Advanced Database GUI Studio** — Multi-engine database manager (MySQL/MariaDB, PostgreSQL, MongoDB, Redis, SQLite) featuring double-click inline cell editing, dynamic row insert modal, safe record deletion, and SQL Scratchpad with `EXPLAIN` query execution plan visualization.
- 📁 **Split-View File Manager & CodeMirror Studio** — Dual-pane side-by-side file tree and CodeMirror editor with syntax highlighting, bracket matching, inline media previewer (image zoom/audio/video/PDF), tree-to-editor drag & drop, and zip/unzip archive tools.
- 📱 **Progressive Web App (PWA)** — Full mobile-first responsive layout with Service Worker offline caching, app install prompt, and native WebPush notifications.
- 🔌 **Plugin Marketplace & Extensible SDK** — Hot-reloadable extension runtime with 15+ built-in modules (Fail2ban, PM2, WireGuard VPN, Tailscale, Rclone S3 Backups, AdGuard Home, MinIO, Uptime Kuma, etc.).

---

## Requirements

- **Node.js**: 20+ LTS
- **Database**: SQLite 3 (embedded, zero-configuration required)
- **Redis**: 7+ (optional, for distributed caching and job queues)
- **Supported Linux Distributions**: Debian, Ubuntu, Fedora, Arch Linux, Gentoo

---

## Quick Start

### One-Line Server Install (Recommended)

```bash
curl -sSL https://dl.panelku.fun/install.sh | sudo bash
```

Or clone and run locally:

```bash
sudo bash scripts/install.sh
```

### With Docker Compose

```bash
cp .env.example .env
# Edit .env and set your secrets
docker compose up -d
```

Open: `http://<your-server-ip>:23456`  
Default Login: `admin` / `Admin@123456` (**Change password upon first login!**)

### With Docker CLI

```bash
docker pull mastarom/panelku:latest

docker run -d -p 23456:3000 --name panelku \
  -v $(pwd)/storage:/app/storage \
  mastarom/panelku:latest
```

### Manual Development Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env

# 3. Start development server
npm run dev

# 4. Production start with PM2
pm2 start ecosystem.config.cjs
```

---

## Project Structure

```
src/
├── app.js              # Express application factory & route mounts
├── server.js           # HTTP, HTTPS & Socket.IO server entry
├── bootstrap.js        # DB initialization, Redis, WS handlers, jobs & plugins
├── config/             # App, DB, Redis, Socket, Logger & CSP configs
├── core/
│   ├── db/             # SQLite Singleton and Schema definitions
│   ├── events/         # EventBus (pub/sub)
│   ├── scheduler/      # Background job scheduler
│   ├── permissions/    # Dynamic RBAC engine & policies
│   └── plugin-loader/  # Plugin SDK & runtime hot-loader
├── middleware/         # Auth, WebAuthn, RBAC, Rate Limiter, Nonce Injector, Error Handler
├── models/             # SQLite Data Models (User, Role, Setting, Notification, etc.)
├── repositories/       # Data access layer
├── helpers/            # Security crypto, system information, response, validation helpers
├── modules/            # Feature modules
│   ├── ai-repair/      # AI Copilot, Anomaly Detector, RCA Generator & Predictive Alerts
│   ├── cluster/        # Multi-node server fleet manager & agent mesh
│   ├── docker/         # Containers, Images, Volumes, Compose Studio & 1-Click App Store
│   ├── database/       # Advanced Database GUI Studio, SQL Console & Table Browser
│   ├── lvm/            # ZFS, Btrfs & LVM Thin Pool Instant Snapshot integration
│   ├── alerts/         # Multi-channel alerting & Auto-Remediation engine
│   ├── metrics/        # Prometheus / OpenMetrics Exporter (/metrics) & K8s inspector
│   ├── crowdsec/       # CrowdSec Community Defense, Honeypot Traps & GeoIP Shield
│   ├── filemanager/    # Split-view file manager & media previewer
│   ├── terminal/       # Web terminal (xterm.js + node-pty) with AI Copilot
│   ├── updater/        # Auto-updater with health checks & rollback engine
│   └── ...
├── websocket/          # Socket.IO namespaces (terminal, monitor, fleet agent)
├── jobs/               # Background cron workers (snapshots, log rotation, health checks)
├── public/             # Frontend assets (Vanilla JS modules, CSS design system, fonts)
└── views/              # EJS server-rendered responsive templates
```

---

## Default Credentials

| Username | Password | Role |
|:---|:---|:---|
| `admin` | `Admin@123456` | Super Admin |

> ⚠️ **Important**: Panelku enforces password policy rules on first login (`mustChangePassword`). You will be required to update credentials immediately upon initial sign-in.

---

## Release Roadmap

| Phase | Version | Status | Milestone Highlights |
|:---|:---|:---:|:---|
| **Phase 1-5** | v1.0.0 - v1.5.0 | ✅ Done | Auth, RBAC, Dashboard, Web Terminal, File Manager, Docker, Websites, DB Manager, WAF, WireGuard, Fail2Ban, PM2 |
| **Phase 6** | v1.6.0 | ✅ Done | Multi-Node Cluster, SQLite Auto-Backups, PTY Terminal Command Audit Logs, Docker Hub CI/CD |
| **Phase 7** | v1.7.0 | ✅ Done | OpenClaw AI Copilot, Nginx Reverse Proxy Docker Mapper, PHP Pool Manager, WhatsApp Alerting, Tailscale VPN |
| **Phase 8** | v1.8.0 | ✅ Done | **Security Hardening** — `execFile()` injection prevention, Zip Slip protection, upload extension blacklist, storage 750 |
| **Phase 9-22** | v1.9.0 | ✅ Done | GPU Manager, Power Manager, Mail Server, CDN/Cache, IoT Edge Manager, Caddy, Node/Python Runtimes, Auto-Updater |
| **Phase 23-24** | v2.0.0 | ✅ Done | Password Policy Engine, Split-View File Manager with CodeMirror & Media Previews, CSP Nonces, 0-Vulnerability Audit |
| **Phase 25** | v2.9.0 | ✅ Done | WebAuthn / Passkeys (FIDO2) Passwordless Auth, Progressive Web App (PWA) with WebPush, Security Vulnerability Scanner |
| **Phase 26** | v3.0.0 | ✅ Done | 1-Click Docker App Store (20+ Templates), Container Live Resource Limits & Stats, Real-Time GeoIP Threat Map & Geo-Shield |
| **Phase 27** | v3.1.0 | ✅ Done | Autonomous AI Copilot, Predictive Log Anomaly Detection, Incident Post-Mortem & Automated RCA Report Generator |
| **Phase 28** | v3.2.0 | ✅ Done | Smart Storage & Instant Directory Volume Snapshots with 1-Click Verification & Rollback |
| **Phase 29** | v3.3.0 | ✅ Done | Native Prometheus / OpenMetrics Exporter (`/metrics`), Lightweight K3s & MicroK8s Kubernetes Inspector |
| **Phase 30-32**| v3.5.0 | ✅ Done | Multi-Node Fleet Agent Mesh, Visual Docker Compose Studio, CrowdSec Community Defense, ZFS/Btrfs Instant Snapshots, Multi-Channel Incident Alerting & Auto-Remediation, Advanced Database GUI Studio |

---

## Changelog

### v3.5.0 — August 31, 2026 (Major Fleet, Docker Studio & Storage Release)

> Multi-Node Mesh & Fleet Orchestration, Visual Docker Compose Studio, CrowdSec Community Defense & Honeypots, ZFS / Btrfs Instant Snapshots, Real-Time Multi-Channel Incident Alerting & Auto-Remediation, and Advanced Database GUI Studio.

**🚀 New Features & Enhancements**
- **Docker Compose Visual Studio & Auto HTTPS**: 
  - Two-way visual form and YAML synchronizer.
  - Live container logs tailing and multi-service lifecycle control (`up`, `down`, `restart`, `pull`).
  - Environment variable matrix manager and 1-Click Let's Encrypt / ZeroSSL auto-reverse proxy integration.
- **CrowdSec Community Defense & Honeypot Traps**:
  - CrowdSec decisions synchronization and live attack feed.
  - Active honeypot traps for malicious probes (`/.env`, `/.git`, `/wp-login.php`).
  - Shellshock / RCE query parameter filters and 1-Click System Hardening advisor.
- **Multi-Node Server Clustering & Fleet Agent Mesh**:
  - Centralized multi-server fleet capacity dashboard (aggregate CPU, RAM, Disk, Active Nodes).
  - Cryptographic token pairing with automated one-line agent bootstrap script.
  - Real-time node heartbeat health monitor and parallel remote command execution dispatcher.
- **ZFS / Btrfs Instant Snapshots & 1-Second Rollback**:
  - Storage engine integration supporting LVM Thin Pools, ZFS datasets, and Btrfs subvolumes.
  - Point-in-time snapshot creation, instant sub-second rollback, and scheduled snapshot lifecycle retention.
- **Multi-Channel Incident Alerting & Auto-Remediation**:
  - Broadcast server alerts to Telegram, Discord, Slack, WhatsApp, WebPush, and Email.
  - Auto-Remediation rules: Emergency Disk Cleanup (prune docker caches, purge old logs), Dead Service Resurrect, and OOM killer mitigation.
- **Advanced Database GUI Studio**:
  - Interactive table explorer with double-click inline cell editing.
  - Dynamic row insertion modal with column type awareness.
  - Safe record deletion with confirmation guardrails and SQL Scratchpad featuring `EXPLAIN` query execution plan visualization.
- **Unified Terminal AI Copilot & Diagnostics**:
  - Merged command generator, error diagnostics, and interactive chat into an expanded 820px multi-tab modal.
  - Added smart error detector in terminal stream to trigger instant AI error diagnosis with 1-click execution.
  - Expanded global AI floating chat window with Maximize toggle (720px × 720px).

---

### v3.3.0 — August 29, 2026 (Enterprise Observability & Kubernetes)

> Native Prometheus / OpenMetrics Exporter and Lightweight K3s / MicroK8s Kubernetes Inspector.

**🚀 Highlights**
- **Prometheus / OpenMetrics Exporter**: Native `/metrics` endpoint exposing CPU cores, memory bytes, load averages, container telemetry, and active firewall rules for Prometheus/Grafana scrapers.
- **Lightweight Kubernetes Inspector**: Auto-detects local K3s and MicroK8s clusters, enumerating nodes, pods, namespaces, services, and workloads.

---

### v3.2.0 — August 29, 2026 (Smart Storage & Instant Snapshots)

> Instant Volume Snapshots and 1-Click Application Tree Rollback.

**🚀 Highlights**
- **Instant Directory Snapshots**: Capture point-in-time tarball archives of `/var/www` or application paths prior to risky updates.
- **1-Click Rollback**: Instantly restore verified snapshots with automatic backup integrity validation.

---

### v3.1.0 — August 29, 2026 (Autonomous AI Operations)

> Terminal AI Copilot, Predictive Log Anomaly Detection, and Incident RCA Generator.

**🚀 Highlights**
- **Terminal AI Copilot**: Natural language to shell translation with Safety Guardrails protecting against destructive commands (`rm -rf`, disk format).
- **Predictive Log Anomaly Detection**: Proactive background scanner detecting OOM killer events, HTTP 502/504 surges, database connection pool exhaustion, and SSH brute-force bursts.
- **Incident Post-Mortem & RCA Generator**: Automated Root Cause Analysis report generation with impact timelines and remediation logs.

---

### v3.0.0 — August 29, 2026 (1-Click App Store & Threat Intelligence)

> 1-Click Docker App Store, Live Container Resource Limits, and Real-Time GeoIP Threat Map.

**🚀 Highlights**
- **1-Click Docker App Store**: 20+ curated application templates across AI & LLM, Web & CMS, Dev & Tools, Databases, and Media/IoT.
- **Live Container Resource Limits**: Real-time in-place tuning of Memory Limits, CPU Quota (NanoCPUs), and Restart Policies without stopping or recreating containers.
- **Real-Time GeoIP Threat Map**: Live visualization of Fail2Ban and WAF intrusion logs plotted on an interactive world map with 1-Click Geo-Shield country blocking.

---

### v2.9.0 — August 28, 2026 (WebAuthn Passkeys & PWA Mobile)

> Hardware FIDO2 Passkeys, Progressive Web App with WebPush, and CVE Vulnerability Scanner.

**🚀 Highlights**
- **WebAuthn / Passkeys (FIDO2)**: True passwordless and biometric authentication (Touch ID, Windows Hello, Face ID, YubiKey) powered by `@simplewebauthn/server` v13.
- **Progressive Web App & WebPush**: Native-like mobile and desktop PWA support with Service Worker offline caching and background WebPush alerts.
- **Security Health & CVE Vulnerability Scanner**: Host audit engine inspecting firewall, SSH hardening, unpatched packages, and exposed database ports with 1-click remediation.

---

### v2.0.0 — July 28, 2026 (Major Architecture & Security Release)

> Password Policy Engine, Split-View File Manager with CodeMirror & Media Previews, CSP Nonce Security, and 0-Vulnerability Audit.

**🚀 Highlights**
- **Password Policy Engine**: Enforce password complexity rules, expiration reminder job, forced password change on first login (`mustChangePassword`), and policy history audit trail.
- **Split-View File Manager & CodeMirror**: Dual-pane file tree and CodeMirror editor with draggable divider, media previewer (image zoom/audio/video/PDF), and tree-to-editor drag & drop.
- **CSP Nonce Security Hardening**: Automated Content Security Policy nonce injection for all inline scripts and styles across 45+ views.
- **0-Vulnerability Dependency Audit**: 100% resolution of npm audit vulnerabilities.

---

### v1.9.0 — July 17, 2026 (Feature Expansion)

> 12 new modules added — GPU Manager, Power Manager, Mail Server, CDN/Cache, IoT Edge Manager, Runtime Managers (Node/Python/MongoDB/Redis/Apache), Caddy Server, and AI Auto-Repair.

---

### v1.8.0 — July 15, 2026 (Security Hardening Patch)

> Critical vulnerability fixes: `execFile()` shell injection prevention, Zip Slip protection, upload extension blacklist (18 dangerous extensions), WAL-safe graceful shutdown, and storage permissions (`750`).

---

### v1.7.0 — July 13, 2026

> OpenClaw AI Copilot, Nginx Reverse Proxy Docker Mapper, PHP Pool Manager, Database Visual Explorer, WhatsApp Alerting, Service Watchdog Auto-Healer, and Tailscale VPN.

---

### v1.6.0 — July 9, 2026

> Multi-Node Cluster Manager, SQLite Auto-Backups, Web Terminal Audit Logs, and GitHub Actions CI/CD.

---

### v1.0.0 - v1.5.0 — June - July, 2026

> Initial releases: Core dashboard, monitoring, web terminal, file manager, Docker engine, websites, SSL automation, and PHP version manager.

---

## License

MIT © 2026 Panelku Contributors
