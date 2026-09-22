# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.6.0] — 2026-09-22

### Added
- **Universal Multi-Module Auto-Healing Engine (AutoHeal 2.0)**: Complete architectural overhaul of Auto-Healing into a modular provider registry covering all 40 modules:
  - **Web & Proxy Provider**: Automated syntax testing (`nginx -t`), broken configuration rollback (`nginx.conf.bak`), daemon resurrection, and PHP-FPM pool (`php8.x-fpm`) monitoring & restarts.
  - **Database Provider**: Automated PostgreSQL collation mismatch refresh (`template1`/`postgres`), stale `postmaster.pid` cleanup, MySQL connection check, SQLite WAL checkpointing & integrity check, Redis memory defragmentation (`MEMORY PURGE`), and MongoDB stale socket/lock cleanup.
  - **Container Provider**: Docker daemon & socket watchdog, CrashLoopBackOff container detection with isolated recovery, and Docker network subnet pruning.
  - **Storage & OS Provider**: Multi-stage emergency disk cleaner (journalctl vacuum, docker system prune, package cache clean, `/tmp` cleanup > 3d, stale `.tmp` backup purge), inode exhaustion detection, and RAM cache drop (`sync && echo 3 > /proc/sys/vm/drop_caches`).
  - **Security & Firewall Provider**: UFW firewall auto-enable with SSH (port 22/custom) & Panelku (port 23456) anti-lockout protection, Fail2ban stale socket `/var/run/fail2ban/fail2ban.sock` cleanup, and SSL certificate expiry monitor (<14 days).
  - **Runtime & Daemons Provider**: Node.js C++ native binary verification (`better-sqlite3`, `node-pty`), WhatsApp Baileys session lock release, Postfix MTA queue flush, Mosquitto MQTT broker restart, and zombie port collision resolution.
  - **Interactive Matrix UI**: New "All Modules" matrix dashboard tab, 1-Click "Heal All Modules" action, and independent module-level toggle switches.
- **PostgreSQL Collation Mismatch Auto-Remediation**: Native auto-healing in `createPgDatabase` catching `template database "template1" has a collation version mismatch` caused by OS glibc updates, auto-refreshing collation on `template1` & `postgres`, and retrying creation without failure.
- **Queue Architecture (BullMQ + In-Memory Fallback)**: Built unified `QueueManager` supporting BullMQ backed by Redis for heavy background operations (backup, restore, git deploy) with seamless in-memory fallback, concurrency control, and EventBus status notifications (`BACKUP_COMPLETE`, `BACKUP_FAILED`, `DEPLOY_COMPLETE`, `DEPLOY_FAILED`).
- **Asynchronous Queue Operations**: Added `/backup/queue/metrics` and `/backup/queue/:jobId` endpoints, plus non-blocking `?async=true` execution mode for database dumps, file archives, and disaster recovery restores.
- **Dedicated Test Coverage Expansion**: Added comprehensive test suites covering `autoheal`, `queue`, `alerts`, `whatsapp`, `analytics`, `caddy`, `mail`, and `filemanager` (expanding test suites to 38 passed suites and 500+ tests).

### Fixed
- **Orphaned Module Routes & Navigation**: Restored `/alerts` page route and desktop/mobile navigation links under Security; restored `/whatsapp` desktop/mobile navigation links under Services.
- **Metrics History Truncation**: Resolved hardcoded 1,000-row truncate in `MonitorHistory.find` by adding indexed timestamp `since` filtering and dynamic limits up to 10,000 records.
- **Dashboard Service Control Conflict & Route Alias**: Added `/system/services` alias alongside `/system/services/manage` to eliminate 404s when managing webserver services from the dashboard, and removed redundant duplicate Drag-and-Drop listener in dashboard view.
- **Redis Cache Layer Activation**: Connected Redis client and EventBus invalidation (`cache.setClient`, `cache.initEventBusInvalidation`) in `bootstrap.js`; activated caching for dashboard metrics (TTL 2s), server info (TTL 5s), and Docker container list (TTL 3s) with auto-invalidation on container events.
- **Event Loop & Teardown**: Handled `.unref()` on WhatsApp service session auto-restore timer to prevent hanging background intervals during test runs or graceful shutdown.
- **Removed Swagger Spec Duplication**: Cleaned obsolete unreferenced `swagger.fixed.js` file.

## [3.5.0] — 2026-08-31

### Added
- **Multi-Node Server Clustering & Distributed Agent Mesh**: Centralized fleet capacity aggregator (CPU cores, RAM, Disk), 1-Click pairing tokens with 15-minute TTL, single-line bash installer generator, and distributed concurrent remote command runner.
- **Docker Compose Visual Studio & Auto HTTPS**: 2-way Visual Form $\leftrightarrow$ YAML editor with stack logs tailing, environment matrix, and 1-Click Let's Encrypt / ZeroSSL auto-reverse proxy.
- **CrowdSec Community Defense & Honeypot Traps**: Native CrowdSec decisions integration, automated honeypot trap interceptor (`/.env`, `/.git`, `/wp-login.php`), RCE Shellshock filter, GeoIP country shield, and 1-Click System Hardening.
- **ZFS / Btrfs / LVM Instant Snapshots**: Unified storage snapshot manager supporting LVM thin pools, ZFS datasets (`zfs snapshot`), and Btrfs subvolumes (`btrfs subvolume snapshot`) with 1-second instant rollback.
- **Real-Time Multi-Channel Alerting & Auto-Remediation Playbooks**: Centralized incident dispatcher broadcasting to Telegram, Discord, Slack, WhatsApp, Email, and WebPush with automated incident recovery (Emergency Disk Cleanup, Dead Service Resurrect, OOM mitigation).
- **Advanced Database GUI Studio**: Visual table browser with double-click inline cell editing, dynamic row insertion modal, primary-key safe row deletion, and interactive SQL Scratchpad with `EXPLAIN` query execution plan visualization.

## [3.3.0] — 2026-08-29

### Added
- **Prometheus / OpenMetrics Exporter**: Native `/metrics` endpoint exposing host metrics and container stats for Grafana scraping.
- **Lightweight Kubernetes Inspector**: Real-time Pod, Node, and Workload manager for K3s and MicroK8s clusters.

## [2.0.0] — 2026-08-10

### Security
- **Complete R3 command-injection audit** — 16 findings (2 critical, 8 medium,
  6 low) all fixed: `gitRepo` validation + `execFile` (websites), `projectName`
  regex (docker), `_validateFixContext` (ai-repair), pm2 → `execFile` args array
  (nodejs), `validateAppName` (pm2-manager), `validateJailName` (fail2ban),
  `validateRestoreTarget` boundary-aware (backup), trusted-input docs (git-deployer).
  Full detail: `docs/audit-exec-checklist.md` ([`810ad94`](https://example.invalid))
- **Plugin import fixes** — 6 broken imports (`../../middleware|models` →
  `../../src/...`) in git-deployer, pm2-manager, rclone-backuper; permanent CI
  guard via `scripts/check-plugin-imports.mjs` (blocker in ci.yml & docker-publish.yml)
- **npm audit = 0 high/critical** — 5 high-severity deps patched; audit is now a
  CI blocker (`--audit-level=high`, no `continue-on-error`)
- Coverage gate: `coverageThreshold` (statements 12 / branches 6 / functions 10 /
  lines 12) enforced in CI [R1]

### Added
- 91+ regression tests (total **279 tests / 16 suites**), including injection
  payloads `'; rm -rf / #'`, `$()`, backticks, pipes
- `CONTRIBUTING.md` + `PULL_REQUEST_TEMPLATE.md` — mandatory R3 security checklist
- Coverage baseline + project analysis docs (`docs/analisis-proyek.md`,
  `docs/analisis-per-modul.md`, `docs/coverage-baseline.md`)

### Changed
- Coverage threshold raised one level after +57→+91 new tests ([`6c9b3cd`](https://example.invalid))

## [2.0.0-beta] — 2026-08-05

### Added
- Database management module: MySQL/PostgreSQL connection management, schema
  exploration, query console with WAF SQL-injection protection, SQL/CSV import
- PostgreSQL multi-schema explorer with schema dropdown (tables/structures/data)
- `SKIP_BODY_SCAN_PATHS` extension for arbitrary-content endpoints (db-admin-manager,
  mongodb query, git-deploy webhook, whatsapp, ai-repair)

## [1.0.0] — 2026-07-29

### Added
- Express application with security headers, CSP nonce support, WAF, rate limiting
- Auth service: JWT access + refresh rotation, 2FA (TOTP), password expiry, RBAC
- File manager module with navigation, bulk operations, download tokens
- Backup management with rclone integration and scheduled jobs
- LVM manager module + initial plugin suite (17 plugins)
- Terminal (xterm.js WebSocket), monitoring, alerts, auto-healer
- CI/CD: lint, Jest tests, npm audit, CodeQL, Docker publish
- CSP integration tests & static analysis suites

[Unreleased]: https://example.invalid/compare/v2.0.0...HEAD
[2.0.0]: https://example.invalid/releases/tag/v2.0.0
[2.0.0-beta]: https://example.invalid/releases/tag/v2.0.0-beta
[1.0.0]: https://example.invalid/releases/tag/v1.0.0
