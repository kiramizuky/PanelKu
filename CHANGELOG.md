# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Upload content validation (magic bytes) in file manager — polyglot/executable
  files rejected even when extension is spoofed (`src/helpers/file-validation.js`) [9.1]
- Dependabot config for weekly npm + GitHub Actions updates (`.github/dependabot.yml`) [8.3]
- Testing matrix in CI: Jest now runs on **Node 20 & 24 LTS** [8.3]
- `SECURITY.md` + GitHub issue templates (bug report, feature request) [8.5]
- `CHANGELOG.md` (this file, Keep a Changelog format) [8.5]

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
