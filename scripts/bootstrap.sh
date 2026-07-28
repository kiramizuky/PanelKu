#!/bin/bash
# ============================================================
# Panelku — Bootstrap Script
# ============================================================
# Initial setup: checks environment, security config, generates
# secrets, installs dependencies, initializes DB, runs validation.
#
# Usage:
#   bash scripts/bootstrap.sh              # full bootstrap
#   bash scripts/bootstrap.sh --quick      # skip npm install + tests
#   bash scripts/bootstrap.sh --ci         # CI mode (exit on first fail)
#   bash scripts/bootstrap.sh --report     # security report only, no setup
# ============================================================

set -o pipefail

# ── Colors ──────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
NC='\033[0m'

# ── State ───────────────────────────────────────────────
ERRORS=0
WARNINGS=0
MODE="${1:-full}"
SKIP_NPM=false
SKIP_TESTS=false
EXIT_ON_FAIL=false
REPORT_ONLY=false

case "$MODE" in
  --quick)    SKIP_NPM=true; SKIP_TESTS=true ;;
  --ci)       EXIT_ON_FAIL=true ;;
  --report)   REPORT_ONLY=true ;;
esac

# Determine project root (where package.json lives)
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

# ── Output Helpers ──────────────────────────────────────
pass() { echo -e "  ${GREEN}✓${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; ERRORS=$((ERRORS+1)); if [ "$EXIT_ON_FAIL" = true ]; then exit 1; fi; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; WARNINGS=$((WARNINGS+1)); }
info() { echo -e "  ${BLUE}→${NC} $1"; }
header() {
  echo ""
  echo -e "${BOLD}${CYAN}━━━ $1 ━━━${NC}"
}
summary_line() {
  local label="$1" status="$2" detail="$3"
  printf "  %-30s %s %s\n" "$label" "$status" "$detail"
}

# ── Banner ──────────────────────────────────────────────
echo ""
echo -e "${CYAN}  ╔══════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}  ║        Panelku — Bootstrap & Security Audit     ║${NC}"
echo -e "${CYAN}  ║        v1.9.0                                   ║${NC}"
echo -e "${CYAN}  ╚══════════════════════════════════════════════════╝${NC}"
echo ""

# ─────────────────────────────────────────────────────────
#  1. ENVIRONMENT CHECKS
# ─────────────────────────────────────────────────────────
header "ENVIRONMENT"

# Node.js
if command -v node &>/dev/null; then
  NODE_VER=$(node -v | sed 's/v//')
  NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
  if [ "$NODE_MAJOR" -ge 20 ]; then
    pass "Node.js v$NODE_VER (≥ v20.0.0)"
  else
    fail "Node.js v$NODE_VER — need ≥ v20.0.0"
  fi
else
  fail "Node.js not found — install Node.js ≥ v20.0.0"
fi

# npm
if command -v npm &>/dev/null; then
  NPM_VER=$(npm -v)
  pass "npm v$NPM_VER"
else
  fail "npm not found"
fi

# OS Detection
if [ -f /etc/os-release ]; then
  . /etc/os-release
  info "$PRETTY_NAME ($(uname -m))"
elif [ "$(uname)" = "Darwin" ]; then
  info "macOS $(sw_vers -productVersion) ($(uname -m))"
elif [ "$(uname)" = "MINGW"* ] || [ "$(uname)" = "MSYS"* ]; then
  warn "Windows detected — some features may be limited"
else
  info "$(uname) ($(uname -m))"
fi

# Git
if command -v git &>/dev/null; then
  pass "Git $(git --version | awk '{print $3}')"
else
  fail "Git not found — required for updates and plugin management"
fi

# Python (needed for node-pty build)
if command -v python3 &>/dev/null; then
  PY_VER=$(python3 --version 2>&1 | awk '{print $2}')
  pass "Python $PY_VER"
elif command -v python &>/dev/null; then
  PY_VER=$(python --version 2>&1 | awk '{print $2}')
  warn "Python $PY_VER — python3 may be needed for native addon builds"
else
  warn "Python not found — node-pty build may fail"
fi

# Build tools (needed for native addons)
if command -v make &>/dev/null && command -v g++ &>/dev/null; then
  pass "Build tools (make, g++)"
elif command -v make &>/dev/null && command -v cc &>/dev/null; then
  pass "Build tools (make, cc)"
else
  warn "Build tools (make/g++) not found — native addons may fail to build"
fi

# Redis (optional)
if command -v redis-cli &>/dev/null; then
  if redis-cli ping 2>/dev/null | grep -q "PONG"; then
    pass "Redis server — connected"
  else
    warn "Redis installed but not running — bg jobs won't work"
  fi
elif [ -f /etc/redis/redis.conf ]; then
  warn "Redis installed (config found) but not running"
else
  warn "Redis not found — optional; required for background jobs"
fi

# SQLite
if command -v sqlite3 &>/dev/null; then
  SQLITE_VER=$(sqlite3 --version | awk '{print $1}')
  pass "SQLite $SQLITE_VER"
else
  info "SQLite CLI not found — this is fine; better-sqlite3 npm package includes it"
fi

# ─────────────────────────────────────────────────────────
#  2. PROJECT FILE INTEGRITY
# ─────────────────────────────────────────────────────────
header "PROJECT INTEGRITY"

# package.json
if [ -f package.json ]; then
  PROJECT_NAME=$(node -e "console.log(require('./package.json').name || 'unknown')")
  PROJECT_VER=$(node -e "console.log(require('./package.json').version || '0.0.0')")
  pass "package.json — $PROJECT_NAME v$PROJECT_VER"
else
  fail "package.json not found — not a valid project directory"
fi

# .env file
if [ -f .env ]; then
  pass ".env file exists"
  # Check for placeholder secrets
  if grep -q "change_this_" .env 2>/dev/null; then
    fail ".env contains placeholder secrets (change_this_...) — run setup to generate secure values"
  elif grep -q "dev-secret-change" .env 2>/dev/null; then
    fail ".env contains default dev secrets — run setup to generate secure values"
  else
    pass ".env — no placeholder secrets detected"
  fi
else
  fail ".env file missing — run setup or copy .env.example to .env"
  info "  Run: cp .env.example .env && bash scripts/bootstrap.sh"
fi

# Storage directories
STORAGE_DIRS=("storage" "storage/logs" "storage/uploads" "storage/backups" "storage/temp")
for dir in "${STORAGE_DIRS[@]}"; do
  if [ -d "$dir" ]; then
    pass "Storage: $dir/"
  else
    info "Creating: $dir/"
    mkdir -p "$dir"
    pass "Storage: $dir/ (created)"
  fi
done

# Storage permissions check
if [ -d "storage" ]; then
  PERMS=$(stat -c "%a" storage 2>/dev/null || stat -f "%OLp" storage 2>/dev/null || echo "unknown")
  if [ "$PERMS" != "unknown" ] && [ "$PERMS" -gt 750 ] 2>/dev/null; then
    warn "Storage permissions: $PERMS — recommended: 750 (too permissive: $PERMS)"
  elif [ "$PERMS" = "750" ] || [ "$PERMS" = "755" ]; then
    pass "Storage permissions: $PERMS"
  fi
fi

# Node modules
if [ -d node_modules ]; then
  # Quick check: count modules vs package.json dependencies
  DEP_COUNT=$(node -e "const p=require('./package.json');console.log(Object.keys(p.dependencies||{}).length + Object.keys(p.devDependencies||{}).length)")
  MOD_COUNT=$(ls node_modules/.package-lock.json 2>/dev/null && echo "present" || echo "check")
  if [ "$MOD_COUNT" = "present" ]; then
    pass "node_modules/ installed (lockfile present)"
  else
    MOD_DIR_COUNT=$(ls -d node_modules/*/ 2>/dev/null | wc -l)
    if [ "$MOD_DIR_COUNT" -ge "$DEP_COUNT" ]; then
      pass "node_modules/ ($MOD_DIR_COUNT packages)"
    else
      warn "node_modules/ — only $MOD_DIR_COUNT of $DEP_COUNT deps found"
    fi
  fi
else
  fail "node_modules/ missing — run: npm install"
fi

# ─────────────────────────────────────────────────────────
#  3. SECURITY AUDIT
# ─────────────────────────────────────────────────────────
header "SECURITY AUDIT"

# Check secrets strength
info "Checking secret strength..."
if [ -f .env ]; then
  check_secret_strength() {
    local key="$1" val="$2"
    local len=${#val}
    if [ -z "$val" ]; then
      fail "$key is empty"
    elif [ "$len" -lt 24 ]; then
      fail "$key is too short ($len chars, min 24)"
    elif echo "$val" | grep -qiE "^(change_this_|dev-secret-change|jwt-secret-change|refresh-secret-change|secret|password|123)"; then
      fail "$key uses a known default/weak value"
    else
      pass "$key — $len chars"
    fi
  }

  if [ -f .env ]; then
    # Source .env but only for bootstrap-checked vars
    APP_SECRET_VAL=$(grep -E "^APP_SECRET=" .env | head -1 | cut -d= -f2-)
    JWT_SECRET_VAL=$(grep -E "^JWT_SECRET=" .env | head -1 | cut -d= -f2-)
    JWT_REFRESH_VAL=$(grep -E "^JWT_REFRESH_SECRET=" .env | head -1 | cut -d= -f2-)
    [ -n "$APP_SECRET_VAL" ] && check_secret_strength "APP_SECRET" "$APP_SECRET_VAL" || warn "APP_SECRET not set in .env"
    [ -n "$JWT_SECRET_VAL" ] && check_secret_strength "JWT_SECRET" "$JWT_SECRET_VAL" || warn "JWT_SECRET not set in .env"
    [ -n "$JWT_REFRESH_VAL" ] && check_secret_strength "JWT_REFRESH_SECRET" "$JWT_REFRESH_VAL" || warn "JWT_REFRESH_SECRET not set in .env"
  fi
fi

# CSP configuration check
if [ -f src/app.js ]; then
  if grep -q "unsafe-inline" src/app.js | grep -q "scriptSrc"; then
    warn "CSP scriptSrc still uses 'unsafe-inline' (nonce recommended)"
  else
    pass "CSP scriptSrc — nonce-based (no unsafe-inline)"
  fi
  if grep -q "'unsafe-inline'" src/app.js | grep -q "styleSrc"; then
    warn "CSP styleSrc still uses 'unsafe-inline' (nonce recommended)"
  else
    pass "CSP styleSrc — nonce-based (no unsafe-inline)"
  fi
else
  warn "src/app.js not found — cannot check CSP"
fi

# Helmet presence
if grep -q "helmet" package.json 2>/dev/null; then
  pass "Helmet middleware installed (security headers)"
else
  fail "Helmet not installed — missing security headers"
fi

# Rate limiting presence
if grep -q "express-rate-limit\|rateLimiter" package.json 2>/dev/null; then
  pass "Rate limiting middleware installed"
else
  warn "Rate limiting not detected"
fi

# CORS config (should not be wildcard in production)
if [ -f src/app.js ]; then
  if grep -q "origin:\s*true\b\|origin:\s*'\*'" src/app.js 2>/dev/null; then
    fail "CORS origin is set to wildcard (*) — restrict to specific origins"
  else
    pass "CORS origin is restricted"
  fi
fi

# Gitignore check (exposed .env)
if [ -f .gitignore ] && grep -q "^\.env$" .gitignore 2>/dev/null; then
  pass ".env is gitignored"
else
  fail ".env is NOT in .gitignore — secrets could be committed!"
fi

# Node modules in gitignore
if grep -q "^node_modules/" .gitignore 2>/dev/null || grep -q "^node_modules$" .gitignore 2>/dev/null; then
  pass "node_modules is gitignored"
else
  warn "node_modules NOT in .gitignore"
fi

# ─────────────────────────────────────────────────────────
#  4. SETUP (skip in --report mode)
# ─────────────────────────────────────────────────────────
if [ "$REPORT_ONLY" = false ]; then

  # Generate .env from template if missing
  if [ ! -f .env ]; then
    header "SETUP"
    info "Generating .env from .env.example..."
    if [ -f .env.example ]; then
      cp .env.example .env

      # Generate secure secrets
      if command -v openssl &>/dev/null; then
        APP_SECRET=$(openssl rand -hex 32)
        JWT_SECRET=$(openssl rand -hex 32)
        JWT_REFRESH_SECRET=$(openssl rand -hex 32)
      elif command -v node &>/dev/null; then
        APP_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
        JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
        JWT_REFRESH_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
      else
        APP_SECRET="boot-$(date +%s)-$$-$RANDOM"
        JWT_SECRET="jwt-$(date +%s)-$$-$RANDOM"
        JWT_REFRESH_SECRET="ref-$(date +%s)-$$-$RANDOM"
        warn "openssl not found — using weaker secrets. Install openssl for stronger entropy."
      fi

      # Replace placeholders (cross-platform sed)
      if sed --version 2>/dev/null | grep -q "GNU"; then
        sed -i "s/change_this_to_a_very_long_random_secret_string/$APP_SECRET/" .env
        sed -i "s/change_this_jwt_secret_very_long_random_string/$JWT_SECRET/" .env
        sed -i "s/change_this_refresh_secret_very_long_random/$JWT_REFRESH_SECRET/" .env
        sed -i "s/NODE_ENV=development/NODE_ENV=development/" .env
      else
        # macOS/BSD sed
        sed -i "" "s/change_this_to_a_very_long_random_secret_string/$APP_SECRET/" .env
        sed -i "" "s/change_this_jwt_secret_very_long_random_string/$JWT_SECRET/" .env
        sed -i "" "s/change_this_refresh_secret_very_long_random/$JWT_REFRESH_SECRET/" .env
      fi

      pass ".env created with secure secrets"
    else
      fail ".env.example not found — cannot create .env"
    fi
  fi

  # Create storage directories
  header "STORAGE"
  for dir in "${STORAGE_DIRS[@]}"; do
    if [ ! -d "$dir" ]; then
      mkdir -p "$dir"
      pass "Created $dir/"
    fi
  done

  # Set storage permissions (non-intrusive — only on Linux)
  if [ -d "storage" ] && [ "$(uname)" = "Linux" ]; then
    chmod 750 storage 2>/dev/null && pass "Storage permissions set to 750"
    chmod 750 storage/logs storage/uploads storage/backups storage/temp 2>/dev/null
  fi

  # Install npm dependencies (skip with --quick)
  header "DEPENDENCIES"
  if [ "$SKIP_NPM" = false ]; then
    if [ ! -d node_modules ] || [ ! -f node_modules/.package-lock.json ]; then
      info "Installing npm dependencies..."
      npm install 2>&1 | tail -5
      if [ $? -eq 0 ]; then
        # Rebuild native addons for current Node.js ABI
        npm rebuild better-sqlite3 2>/dev/null
        npm rebuild node-pty 2>/dev/null
        pass "npm install completed"
      else
        fail "npm install failed — check npm ERR! output above"
      fi
    else
      info "node_modules/ exists — run 'npm install' manually if needed"
    fi
  else
    info "Skipped (--quick mode)"
  fi

  # Database initialization
  header "DATABASE"
  if [ -f scripts/reset-db.js ]; then
    DB_PATH="./storage/panelku.db"
    if [ ! -f "$DB_PATH" ]; then
      info "Initializing database..."
      node scripts/reset-db.js 2>&1 | head -12
      if [ $? -eq 0 ]; then
        pass "Database initialized"
      else
        fail "Database initialization failed"
      fi
    else
      # Check if DB has required tables
      if command -v sqlite3 &>/dev/null; then
        TABLE_COUNT=$(sqlite3 "$DB_PATH" ".tables" 2>/dev/null | wc -w)
        if [ "$TABLE_COUNT" -ge 5 ]; then
          pass "Database exists with $TABLE_COUNT tables"
        else
          warn "Database exists but may be incomplete ($TABLE_COUNT tables)"
        fi
      else
        pass "Database exists ($DB_PATH)"
      fi
    fi
  else
    warn "reset-db.js not found — cannot initialize database"
  fi

  # Run security advisor check (Node.js helper — uses dynamic import for ESM compat)
  if [ -f src/helpers/security-advisor.js ]; then
    header "SECURITY ADVISOR"
    info "Running security advisor..."
    node --input-type=module -e "
      import { pathToFileURL } from 'url';
      import { join } from 'path';
      try {
        const advisorPath = pathToFileURL(join(process.cwd(), 'src/helpers/security-advisor.js')).href;
        import(advisorPath).then(mod => {
          const advisor = mod.default || mod;
          const result = typeof advisor.checkAll === 'function' ? advisor.checkAll() : advisor;
          Promise.resolve(result).then(r => {
            const issues = Array.isArray(r) ? r : [];
            if (issues.length === 0) {
              console.log('  ✓ No security issues found');
            } else {
              issues.forEach(i => {
                const icon = i.severity === 'CRITICAL' || i.severity === 'HIGH' ? '✗' : '⚠';
                console.log('  ' + icon + ' [' + (i.severity||'LOW') + '] ' + (i.message||i.title||'Unknown'));
              });
            }
          }).catch(e => console.log('  → Security advisor error:', e.message));
        }).catch(e => console.log('  → Security advisor not available:', e.message.split('\\n')[0].substring(0,80)));
      } catch(e) {
        console.log('  → Security advisor error:', e.message.split('\\n')[0].substring(0,80));
      }
    " 2>/dev/null || warn "Security advisor check skipped"
  fi

  # Lint check
  header "LINT"
  if [ -f node_modules/.bin/eslint ]; then
    info "Running ESLint..."
    npx eslint src/ --max-warnings 50 2>&1 | tail -5
    if [ $? -eq 0 ]; then
      pass "ESLint — no errors"
    else
      warn "ESLint found issues — run 'npm run lint:fix' to auto-fix"
    fi
  else
    info "ESLint not installed — skip lint check"
  fi

  # Run tests (skip with --quick)
  if [ "$SKIP_TESTS" = false ]; then
    header "TESTS"
    if [ -f node_modules/.bin/jest ]; then
      info "Running Jest tests..."
      npx jest --no-cache --silent 2>&1 | tail -8
      local test_exit=$?
      if [ $test_exit -eq 0 ]; then
        pass "All tests passed"
      else
        fail "Some tests failed (exit code $test_exit)"
      fi
    else
      info "Jest not installed — skip tests"
    fi
  else
    info "Tests skipped (--quick mode)"
  fi

fi # end REPORT_ONLY

# ─────────────────────────────────────────────────────────
#  5. SUMMARY
# ─────────────────────────────────────────────────────────
header "SUMMARY"

echo ""
if [ "$ERRORS" -eq 0 ] && [ "$WARNINGS" -eq 0 ]; then
  echo -e "  ${GREEN}${BOLD}✓ All checks passed — environment is ready${NC}"
elif [ "$ERRORS" -eq 0 ]; then
  echo -e "  ${YELLOW}${BOLD}⚠ $WARNINGS warnings — review suggestions above${NC}"
else
  echo -e "  ${RED}${BOLD}✗ $ERRORS errors, $WARNINGS warnings — issues must be resolved${NC}"
fi

echo ""
printf "  %-25s %s\n" "Errors:"  "${RED}$ERRORS${NC}"
printf "  %-25s %s\n" "Warnings:" "${YELLOW}$WARNINGS${NC}"
echo ""

# Quick reference
echo -e "  ${BOLD}Quick Reference:${NC}"
echo -e "  ${BLUE}→${NC} Start dev server:        ${GREEN}npm run dev${NC}"
echo -e "  ${BLUE}→${NC} Start production:        ${GREEN}npm start${NC}"
echo -e "  ${BLUE}→${NC} Run tests:               ${GREEN}npm test${NC}"
echo -e "  ${BLUE}→${NC} Lint & fix:              ${GREEN}npm run lint:fix${NC}"
echo -e "  ${BLUE}→${NC} Default login:           ${YELLOW}admin / Admin@123456${NC}"
echo -e "  ${BLUE}→${NC} Reset DB:                ${GREEN}npm run reset-db${NC}"
echo ""

# Exit code
if [ "$ERRORS" -gt 0 ]; then
  exit 1
fi
exit 0
