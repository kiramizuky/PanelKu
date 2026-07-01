# Linux Server Control Panel

> Lightweight, modern, realtime Linux server control panel — a blend of aaPanel, Portainer, CasaOS, and Cockpit, but far lighter.

[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-blue)](LICENSE)

## Features (Phase 1)

- 🔐 **JWT Authentication** — Access token, refresh token, 2FA (TOTP), session manager
- 👥 **Dynamic RBAC** — Super Admin, Admin, Operator, Read Only with per-resource permissions
- 📊 **Realtime Dashboard** — CPU, RAM, Disk, Temperature, Network via Socket.IO + Chart.js
- 📈 **Monitoring** — Historical metrics, disk health, network interfaces, alert thresholds
- 🖥️ **Web Terminal** — xterm.js + node-pty, multi-tab, bash/zsh/fish
- 📁 **File Manager** — Browse, upload, download, edit, zip/unzip, rename, delete, search

## Requirements

- Node.js 20+
- SQLite 3 (embedded, zero-configuration required)
- Redis 7 (optional, for background jobs and message queues)
- Linux (Debian/Ubuntu/Fedora/Arch/Gentoo) for full terminal/PTY and service management features

## Quick Start

### With Docker Compose (Recommended)

```bash
cp .env.example .env
# Edit .env and set secure secrets
docker compose up -d
```

Open: http://localhost:23456  
Login: `admin` / `Admin@123456` (**change this immediately!**)

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
| Phase 5 | ✅ Done | Git Deploy, Auto Update, Plugin Marketplace |

## License

MIT
