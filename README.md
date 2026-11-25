<div align="center">

# PanelKu

**Lightweight, Enterprise-Grade Linux Server Control Panel**

*Real-time telemetry, Docker & Compose orchestration, multi-engine database studio, automated security auditing, and AI-assisted operations — all in one fast, zero-bloat web console.*

[![Version](https://img.shields.io/badge/version-3.8.0-6366f1?style=for-the-badge)](package.json)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B%20LTS-10b981?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-0ea5e9?style=for-the-badge)](LICENSE)
[![Security](https://img.shields.io/badge/CSP-Nonce%20Enforced-f59e0b?style=for-the-badge)](#security-architecture)

</div>

---

## Table of Contents

- [Why PanelKu?](#why-panelku)
- [Core Capabilities](#core-capabilities)
- [Quick Start](#quick-start)
- [Operations CLI & Systemd Hardening](#operations-cli--systemd-hardening)
- [Architecture](#architecture)
- [Security Architecture](#security-architecture)
- [Testing & Verification](#testing--verification)
- [Release History](#release-history)
- [License](#license)

---

## Why PanelKu?

PanelKu combines the operational depth of **aaPanel**, **Portainer**, **Cockpit**, and **CasaOS** into a single modular Node.js platform backed by embedded **SQLite (WAL mode)** and optional **Redis**.

- **Zero heavy runtime dependencies** — runs cleanly on a 512 MB VPS or a multi-node bare-metal fleet.
- **Security-first design** — strict Content Security Policy (per-request nonces), `execFile()` argument isolation, dynamic RBAC, FIDO2 Passkeys, and opt-in `systemd` sandboxing.
- **Resilient real-time operations** — persistent PTY web terminal sessions that survive transient WebSocket drops without interrupting running commands.

---

## Core Capabilities

### Security, Identity & Threat Defense
- **Zero-Trust Authentication**: Hardware **FIDO2 / WebAuthn Passkeys** (`@simplewebauthn/server`), TOTP 2FA, LDAP/SSO integration, and scoped JWT + API Key access.
- **Dynamic RBAC & Password Policy**: Built-in roles (`Super Admin`, `Admin`, `Operator`, `Read Only`) with per-resource permissions, configurable complexity/expiry rules, and JSON policy import/export.
- **Vulnerability Center & AI Remediation (`v3.8.0`)**: Multi-vector host auditing across OS/kernel (`regreSSHion`, `cups-browsed`, `needrestart`, `sshd`, `sysctl`), runtimes & web servers (`Node.js`, `Nginx server_tokens`, exposed Redis), websites (`.env`, `.git`, SQL dumps), and firewall/WAF posture — with 1-click guided remediation and Markdown/JSON audit report exports.
- **CrowdSec, WAF & GeoIP Shield**: Built-in HTTP WAF middleware, honeypot traps (`/.env`, `/.git`, `/wp-login.php`), CrowdSec blocklist sync, Fail2Ban integration, and real-time GeoIP threat map.

### Infrastructure, Containers & Fleet Mesh
- **Docker & Compose Visual Studio**: Container lifecycle controls, live CPU/memory tuning without restarts, Docker Hub search, two-way Compose GUI/YAML editor, and 1-click reverse proxy + HTTPS provisioning.
- **1-Click App Store**: 20+ curated production templates across AI/LLM (`Ollama`, `Open WebUI`, `n8n`), CMS (`WordPress`, `Ghost`, `Nextcloud`, `Strapi`), DevOps (`Gitea`, `Portainer`, `Vaultwarden`, `Uptime Kuma`), and Media/IoT (`Jellyfin`, `Home Assistant`, `Mosquitto`).
- **Multi-Node Fleet Mesh**: Cryptographic token pairing, one-line agent bootstrapper, aggregate fleet telemetry, remote web terminal proxying, and Kubernetes (`K3s` / `MicroK8s`) cluster inspection.

### Web, Databases & Storage
- **Web Server & SSL Automation**: Native management for **Nginx**, **Apache**, and **Caddy**, PHP pool tuning, DNS management, and automated Let's Encrypt / ZeroSSL certificates.
- **Multi-Engine Database Studio**: Unified GUI for **MySQL / MariaDB**, **PostgreSQL**, **MongoDB**, **Redis**, and **SQLite** with inline cell editing, SQL scratchpad (`EXPLAIN` analyzer), scheduled backups, and restore workflows.
- **Split-View File Manager**: Dual-pane tree + CodeMirror studio, drag-and-drop, inline media preview (images, audio, video, PDF), archive tools, and token-authenticated downloads.
- **Snapshots & S3 Backups**: Instant **ZFS / Btrfs / LVM** volume snapshots with sub-second rollback, directory snapshots, and Rclone / AWS S3 off-site sync.

### Observability, Terminal & AI Operations
- **Resilient Web Terminal**: Multi-tab `xterm.js` + `node-pty` shell with 16ms output batching, 128 KB scrollback ring buffer, and seamless session reattachment across WebSocket reconnects.
- **OpenClaw AI Copilot**: Natural-language Linux command generator with destructive-command guardrails, live terminal error diagnostics, predictive log anomaly detection, and automated Root Cause Analysis (RCA).
- **Telemetry & Alerting**: Real-time CPU/RAM/Disk/Network/GPU charts, native **Prometheus `/metrics`** exporter, background job queue (`BullMQ`), and multi-channel alerts (Telegram, Discord, Slack, WhatsApp, WebPush, Email).

---

## Quick Start

### 1. One-Line Server Installer (Recommended)

Supports Debian, Ubuntu, Fedora, Arch Linux, and Gentoo:

```bash
curl -sSL https://dl.panelku.fun/install.sh | sudo bash
```

For **hardened mode** (dedicated `panelku` user + `systemd` sandboxing):

```bash
curl -sSL https://dl.panelku.fun/install.sh | sudo bash -s -- --hardened
```

Or install from a local clone:

```bash
git clone https://github.com/kiramizuky/PanelKu.git
cd PanelKu/linux-panel
sudo bash scripts/install.sh
```

> **Note:** The installer provisions `/opt/panelku` as a git repository so the built-in in-place updater and rollback engine can operate safely.

### 2. Docker Compose

```bash
cp .env.example .env
# IMPORTANT: Replace APP_SECRET, JWT_SECRET, and JWT_REFRESH_SECRET with strong random values.
# Production startup refuses to boot if example placeholders remain unchanged.
docker compose up -d
```

Docker Compose isolates container socket access through `tecnativa/docker-socket-proxy` rather than mounting the raw Docker socket directly into the panel container.

### 3. Local Development

```bash
npm install
cp .env.example .env
npm run dev
```

Access the panel at `http://localhost:3000` (or `http://<server-ip>:23456` on standard server installs).  
Default username: `admin` — use the `ADMIN_PASSWORD` environment variable or the password generated during installation. A password change is enforced on first sign-in.

---

## Operations CLI & Systemd Hardening

The installer registers the `panelku` CLI globally at `/usr/local/bin/panelku`:

```bash
panelku status                         # Inspect service health, endpoint status, and version
panelku doctor                         # Verify Node.js, .env, SQLite, Redis, Docker, and disk health
panelku check-update                   # Compare local commit against origin/master
panelku rollback --commit <sha> --yes  # Roll back to a verified commit
panelku reset-password --user admin    # Issue a temporary password for recovery
```

`panelku status --json` and `panelku doctor --json` emit machine-readable JSON for external monitoring probes.

### Hardened Deployment Details
- Runs under a dedicated unprivileged `panelku` service account with `ProtectSystem=strict`.
- Restricts write access to `/opt/panelku/storage` and the application directory.
- Scopes privileged operations via `deploy/panelku.sudoers` and `deploy/panelku.polkit.rules`.

---

## Architecture

```text
src/
├── app.js                  # Express app factory, security headers, CSP & route mounts
├── server.js               # HTTP server entry & process signal handling
├── bootstrap.js            # SQLite WAL, migrations, Redis, Socket.IO, jobs & plugins
├── config/                 # App, DB, Redis, Socket.IO, Logger & CSP configurations
├── core/
│   ├── db/                 # SQLite singleton, schema & versioned Migrator
│   ├── events/             # Internal EventBus (pub/sub)
│   ├── queue/              # BullMQ / in-memory background job manager
│   ├── permissions/        # Dynamic RBAC engine
│   └── plugin-loader/      # Extensible Plugin SDK & hot-loader
├── middleware/             # JWT/API-Key Auth, WebAuthn, RBAC, Rate Limiter, WAF, Nonce
├── modules/                # 42 self-contained feature modules (routes/controllers/services)
├── repositories/           # Data access layer
├── websocket/              # Socket.IO namespaces (/monitor, /terminal, /notifications, /docker)
├── jobs/                   # Scheduled maintenance, backups, health & retention workers
├── public/                 # Modular frontend JS controllers, CSS design system & PWA assets
└── views/                  # EJS server-rendered templates with automatic CSP nonces
```

---

## Security Architecture

- **Content Security Policy (CSP)**: Every response receives a cryptographically unique per-request nonce injected into inline `<script>` and `<style>` blocks, enforced by automated CSP integration tests.
- **Command Execution Safety**: System integrations use parameterized `execFile()` / `execFileSync()` calls rather than raw shell interpolation; AI-generated commands pass through a destructive-command guardrail and require explicit user confirmation.
- **Database Integrity**: SQLite operates in WAL mode with graceful HTTP connection draining prior to database close on shutdown.
- **Upload & Path Validation**: File operations enforce canonical path containment, Zip Slip prevention, and extension/signature verification.

---

## Testing & Verification

PanelKu includes a comprehensive Jest test suite covering security middleware, CSP nonces, API controllers, terminal resilience, and vulnerability scanning:

```bash
npm test                     # Run all Jest unit & integration test suites
npm run test:csp             # Verify CSP headers, nonces, and view compliance
npm run test:window-check    # Verify all frontend modules expose window.* bindings
npm run lint:check           # Run ESLint with --max-warnings 0
npm run lint:ci              # Full CI pipeline (lint + window check + plugin check + coverage)
```

---

## Release History

| Version | Highlights |
|:---|:---|
| **v3.8.0** | Vulnerability Center & AI Remediation Engine, Markdown/JSON audit exports, resilient PTY terminal reattach & output batching, full English UI/API standardization, 1,500+ automated tests |
| **v3.7.0** | Native module auto-rebuild diagnostics, hardened `panelku` CLI (`doctor`, `rollback`), safe in-place updater with pre-update snapshots |
| **v3.5.0** | Multi-Node Fleet Mesh, Visual Docker Compose Studio, CrowdSec & Honeypots, ZFS/Btrfs Instant Snapshots, Multi-Channel Alerting & Auto-Remediation |
| **v3.3.0** | Native Prometheus `/metrics` exporter and K3s/MicroK8s Kubernetes Inspector |
| **v3.1.0 – v3.2.0** | Terminal AI Copilot, Predictive Log Anomaly Detection, Automated RCA, Directory Volume Snapshots |
| **v2.9.0 – v3.0.0** | FIDO2 WebAuthn Passkeys, PWA + WebPush, 1-Click Docker App Store (20+ templates), GeoIP Threat Map |
| **v2.0.0** | Password Policy Engine, Split-View File Manager + CodeMirror, Per-Request CSP Nonces |
| **v1.0.0 – v1.9.0** | Core control panel, RBAC, Web Terminal, Docker, Websites, DB Studio, WAF, Mail, CDN, Runtimes & Cluster |

---

## License

Released under the [MIT License](LICENSE). © 2026 PanelKu Contributors.
