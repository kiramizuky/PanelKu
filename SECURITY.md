# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 2.0.x   | ✅ Active support  |
| < 2.0   | ❌ Not supported   |

## Reporting a Vulnerability

**Please do NOT open a public GitHub issue for security vulnerabilities.**

Instead, report privately via one of:

1. **GitHub Security Advisory** — use the "Report a vulnerability" button on the
   repository's *Security* tab (recommended).
2. **Email** — `security@panelku.local` (replace with a real inbox before release).

### What to include

- Affected module / endpoint / file (if known)
- A minimal reproduction or proof-of-concept
- Impact assessment (what an attacker could achieve)
- Suggested fix (optional)

You should receive an acknowledgment within **72 hours**. We aim to ship a fix
and release a patched version within **14 days** for critical issues, or sooner
when a hotfix is possible.

## Security Model (Panelku)

- **Auth**: JWT access + refresh token (httpOnly, `SameSite=Strict`, `secure` in
  prod), 2FA (TOTP), RBAC (`requirePermission`), session revocation on password change.
- **Command execution**: all user-controlled command inputs must go through
  `execFile(bin, args[])` **without a shell**, or hardcoded strings. See
  `docs/audit-exec-checklist.md` and `CONTRIBUTING.md` (mandatory PR checklist).
- **Uploads**: dangerous extensions blocked by `multer` filter + **content
  (magic-bytes) validation** (`src/helpers/file-validation.js`).
- **WAF**: request scanning + SQL-injection protection in
  `src/middleware/waf.middleware.js` (see `docs/audit-exec-checklist.md`).
- **CI gates**: `npm audit --audit-level=high` = 0, coverage threshold, plugin
  import check — all **blockers** in `ci.yml` / `docker-publish.yml`.

## Security Audit Trail

- `docs/audit-exec-checklist.md` — R3 command-injection audit (16 findings, all fixed)
- `docs/analisis-proyek.md` — project-wide security analysis & risk register

## Disclosure Timeline

- **0–72h**: acknowledgment
- **≤14 hari**: fix for critical/high + patched release
- **30 hari**: public disclosure (if not already public) with CVE reference when applicable
