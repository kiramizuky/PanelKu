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
#   bash scripts/bootstrap.sh --deploy     # git pull + install + restart + CSP verify
#   bash scripts/bootstrap.sh --production # full bootstrap + production hardening
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
DEPLOY_MODE=false

PRODUCTION_MODE=false

case "$MODE" in
  --quick)    SKIP_NPM=true; SKIP_TESTS=true ;;
  --ci)       EXIT_ON_FAIL=true ;;
  --report)   REPORT_ONLY=true ;;
  --deploy)   DEPLOY_MODE=true; EXIT_ON_FAIL=true ;;
  --production) PRODUCTION_MODE=true ;;
esac

# Determine project root (where package.json lives)
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

# ── Production Config Paths ─────────────────────────────
SYSTEMD_SERVICE="panelku"
SYSTEMD_FILE="/etc/systemd/system/${SYSTEMD_SERVICE}.service"
NGINX_CONF_AVAILABLE="/etc/nginx/sites-available/panelku"
NGINX_CONF_ENABLED="/etc/nginx/sites-enabled/panelku"
LOGROTATE_FILE="/etc/logrotate.d/panelku"
BACKUP_SCRIPT="${PROJECT_ROOT}/scripts/backup-db.sh"
BACKUP_CRON_FILE="/etc/cron.d/panelku-backup"
PM2_STARTUP_SCRIPT=""
SWAP_FILE="/swapfile"

# Track what was set up
PROD_STEPS=()

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
echo -e "${CYAN}  ║        v2.0.0                                   ║${NC}"
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
#  5. PRODUCTION SETUP (--production mode)
# ─────────────────────────────────────────────────────────
if [ "$PRODUCTION_MODE" = true ]; then

  # ── 5a. Swap Space ────────────────────────────────────
  header "PRODUCTION — SWAP"
  if [ "$(uname)" = "Linux" ]; then
    TOTAL_RAM_KB=$(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}')
    if [ -n "$TOTAL_RAM_KB" ]; then
      TOTAL_RAM_MB=$((TOTAL_RAM_KB / 1024))
      info "Detected RAM: ${TOTAL_RAM_MB}MB"
      if [ "$TOTAL_RAM_MB" -lt 2048 ]; then
        if [ -f "$SWAP_FILE" ]; then
          SWAP_CURRENT=$(wc -c < "$SWAP_FILE" 2>/dev/null || echo 0)
          SWAP_CURRENT_MB=$((SWAP_CURRENT / 1048576))
          info "Swap file exists: ${SWAP_CURRENT_MB}MB"
          if [ "$SWAP_CURRENT_MB" -lt 1024 ]; then
            warn "Swap is only ${SWAP_CURRENT_MB}MB — recommend ≥2GB for low-RAM servers"
          fi
        else
          info "Creating 2GB swap file..."
          if command -v fallocate &>/dev/null; then
            fallocate -l 2G "$SWAP_FILE" 2>/dev/null || dd if=/dev/zero of="$SWAP_FILE" bs=1M count=2048 2>/dev/null
          else
            dd if=/dev/zero of="$SWAP_FILE" bs=1M count=2048 2>/dev/null
          fi
          chmod 600 "$SWAP_FILE"
          mkswap "$SWAP_FILE" 2>/dev/null
          swapon "$SWAP_FILE" 2>/dev/null
          # Add to fstab if not already
          if ! grep -q "$SWAP_FILE" /etc/fstab 2>/dev/null; then
            echo "$SWAP_FILE none swap sw 0 0" >> /etc/fstab 2>/dev/null && \
              pass "Swap added to /etc/fstab" || \
              warn "Could not add swap to /etc/fstab — add manually"
          fi
          pass "2GB swap created at $SWAP_FILE"
          PROD_STEPS+=("swap")
        fi
      else
        pass "RAM ≥ 2GB (${TOTAL_RAM_MB}MB) — swap not required"
      fi
    else
      warn "Cannot detect RAM size — skipping swap check"
    fi
  else
    info "Not Linux — skipping swap setup"
  fi

  # ── 5b. Systemd Service ───────────────────────────────
  header "PRODUCTION — SYSTEMD SERVICE"
  if [ "$(uname)" = "Linux" ] && command -v systemctl &>/dev/null; then
    if [ -f "$SYSTEMD_FILE" ]; then
      SYSTEMD_STATUS=$(systemctl is-active "$SYSTEMD_SERVICE" 2>/dev/null || echo "unknown")
      SYSTEMD_ENABLED=$(systemctl is-enabled "$SYSTEMD_SERVICE" 2>/dev/null || echo "disabled")
      pass "Systemd service exists ($SYSTEMD_STATUS, $SYSTEMD_ENABLED)"
    else
      info "Creating systemd service at $SYSTEMD_FILE..."
      PANEL_USER="${SUDO_USER:-$USER}"
      PANEL_HOME=$(eval echo ~"$PANEL_USER" 2>/dev/null || echo "$PROJECT_ROOT")
      NODE_BIN=$(command -v node 2>/dev/null || echo "/usr/local/bin/node")
      PM2_BIN=$(command -v pm2 2>/dev/null || echo "/usr/local/bin/pm2")

      if command -v pm2 &>/dev/null; then
        # PM2-based service
        cat > /tmp/panelku.service << EOF
[Unit]
Description=Panelku — Server Management Panel
Documentation=https://github.com/panelku/panelku
After=network.target redis-server.service
Wants=redis-server.service

[Service]
Type=forking
User=$PANEL_USER
WorkingDirectory=$PROJECT_ROOT
Environment=NODE_ENV=production
ExecStart=$PM2_BIN start $PROJECT_ROOT/ecosystem.config.cjs --env production
ExecReload=$PM2_BIN reload $PROJECT_ROOT/ecosystem.config.cjs
ExecStop=$PM2_BIN stop $PROJECT_ROOT/ecosystem.config.cjs
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
      else
        # Direct Node.js service
        cat > /tmp/panelku.service << EOF
[Unit]
Description=Panelku — Server Management Panel
Documentation=https://github.com/panelku/panelku
After=network.target redis-server.service
Wants=redis-server.service

[Service]
Type=simple
User=$PANEL_USER
WorkingDirectory=$PROJECT_ROOT
Environment=NODE_ENV=production
Environment=NODE_OPTIONS="--max-old-space-size=1024"
ExecStart=$NODE_BIN --experimental-vm-modules $PROJECT_ROOT/src/server.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
      fi

      if sudo mv /tmp/panelku.service "$SYSTEMD_FILE" 2>/dev/null; then
        sudo systemctl daemon-reload 2>/dev/null
        sudo systemctl enable "$SYSTEMD_SERVICE" 2>/dev/null
        pass "Systemd service created and enabled (auto-start on boot)"
        PROD_STEPS+=("systemd")
      else
        warn "Could not create systemd service — need sudo/root"
        info "  Preview: cat /tmp/panelku.service"
      fi
    fi
  else
    info "Not Linux or systemctl not found — skipping systemd setup"
  fi

  # ── 5c. PM2 Startup on Boot ───────────────────────────
  header "PRODUCTION — PM2 STARTUP"
  if command -v pm2 &>/dev/null && command -v systemctl &>/dev/null; then
    # Check if PM2 startup hook is already installed
    if pm2 startup 2>/dev/null | grep -q "already"; then
      pass "PM2 startup already configured"
    else
      info "Configuring PM2 to start on boot..."
      PM2_STARTUP_OUTPUT=$(pm2 startup systemd 2>&1)
      if echo "$PM2_STARTUP_OUTPUT" | grep -qi "command\|sudo"; then
        # PM2 outputs the sudo command we need to run
        SUDO_CMD=$(echo "$PM2_STARTUP_OUTPUT" | grep -i 'sudo' | head -1)
        warn "PM2 startup requires root — run manually:"
        info "  $SUDO_CMD"
      else
        pass "PM2 startup configured"
        PROD_STEPS+=("pm2-startup")
      fi
    fi
    # Save current PM2 process list
    pm2 save 2>/dev/null
    pass "PM2 process list saved"
  else
    info "PM2 not installed — skipping PM2 startup"
  fi

  # ── 5d. Nginx Reverse Proxy ───────────────────────────
  header "PRODUCTION — NGINX REVERSE PROXY"
  PANEL_PORT=${PORT:-23456}
  if command -v nginx &>/dev/null; then
    NGINX_SITES_DIR="/etc/nginx/sites-available"
    if [ -d "$NGINX_SITES_DIR" ]; then
      if [ -f "/etc/nginx/sites-enabled/panelku" ]; then
        pass "Nginx reverse proxy already configured"
      else
        info "Configuring Nginx reverse proxy..."

        # Auto-detect domain or use IP
        if [ -n "$(command -v hostname)" ]; then
          SERVER_NAME=$(hostname -f 2>/dev/null || hostname 2>/dev/null || echo "_")
        else
          SERVER_NAME="_"
        fi

        # Check for SSL certificates
        SSL_CERT="/etc/letsencrypt/live/${SERVER_NAME}/fullchain.pem"
        SSL_KEY="/etc/letsencrypt/live/${SERVER_NAME}/privkey.pem"

        if [ -f "$SSL_CERT" ] && [ -f "$SSL_KEY" ]; then
          info "SSL certificates found at $SSL_CERT — configuring HTTPS"
          cat > /tmp/panelku-nginx.conf << EOF
server {
    listen 80;
    server_name $SERVER_NAME;
    return 301 https://\$server_name\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name $SERVER_NAME;

    ssl_certificate $SSL_CERT;
    ssl_certificate_key $SSL_KEY;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://127.0.0.1:$PANEL_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    location /socket.io/ {
        proxy_pass http://127.0.0.1:$PANEL_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 86400s;
    }

    client_max_body_size 100m;
    gzip on;
    gzip_types text/plain text/css application/json application/javascript;
}
EOF
          SSL_CONFIGURED=true
        else
          info "No SSL certificates found — configuring HTTP-only proxy"
          cat > /tmp/panelku-nginx.conf << EOF
server {
    listen 80;
    server_name $SERVER_NAME;

    location / {
        proxy_pass http://127.0.0.1:$PANEL_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    location /socket.io/ {
        proxy_pass http://127.0.0.1:$PANEL_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 86400s;
    }

    client_max_body_size 100m;
    gzip on;
    gzip_types text/plain text/css application/json application/javascript;
}
EOF
          SSL_CONFIGURED=false
        fi

        if sudo cp /tmp/panelku-nginx.conf "$NGINX_CONF_AVAILABLE" 2>/dev/null; then
          sudo ln -sf "$NGINX_CONF_AVAILABLE" "$NGINX_CONF_ENABLED" 2>/dev/null
          # Test nginx config
          if sudo nginx -t 2>/dev/null; then
            sudo systemctl reload nginx 2>/dev/null || sudo nginx -s reload 2>/dev/null
            pass "Nginx reverse proxy configured"
            if [ "$SSL_CONFIGURED" = true ]; then
              info "  HTTPS: https://$SERVER_NAME"
            else
              info "  HTTP: http://$SERVER_NAME"
              info "  Configure SSL with: certbot --nginx -d $SERVER_NAME"
            fi
            PROD_STEPS+=("nginx")
          else
            warn "Nginx config test failed — check /etc/nginx/sites-available/panelku"
            sudo rm -f "$NGINX_CONF_AVAILABLE" "$NGINX_CONF_ENABLED" 2>/dev/null
          fi
        else
          warn "Could not create Nginx config — need sudo/root"
          info "  Preview: cat /tmp/panelku-nginx.conf"
        fi
      fi
    else
      warn "Nginx sites-available directory not found ($NGINX_SITES_DIR)"
    fi
  else
    info "Nginx not installed — skipping reverse proxy setup"
    info "  Install: apt install nginx && bash scripts/bootstrap.sh --production"
  fi

  # ── 5e. Let's Encrypt SSL (if Certbot available) ──────
  header "PRODUCTION — SSL / LET'S ENCRYPT"
  if command -v certbot &>/dev/null && [ -f "$NGINX_CONF_ENABLED" ]; then
    if [ -d "/etc/letsencrypt/live" ]; then
      # Check if certs are expiring soon
      for domain_dir in /etc/letsencrypt/live/*/; do
        if [ -f "${domain_dir}fullchain.pem" ]; then
          CERT_EXPIRY=$(openssl x509 -enddate -noout -in "${domain_dir}fullchain.pem" 2>/dev/null | cut -d= -f2)
          if [ -n "$CERT_EXPIRY" ]; then
            EXPIRY_EPOCH=$(date -d "$CERT_EXPIRY" +%s 2>/dev/null)
            NOW_EPOCH=$(date +%s)
            DAYS_LEFT=$(( (EXPIRY_EPOCH - NOW_EPOCH) / 86400 ))
            if [ "$DAYS_LEFT" -lt 30 ]; then
              warn "SSL cert for $(basename $domain_dir) expires in ${DAYS_LEFT} days"
              info "  Renew: certbot renew"
            else
              pass "SSL cert for $(basename $domain_dir) — ${DAYS_LEFT} days remaining"
            fi
          fi
        fi
      done
      # Check auto-renewal
      if systemctl list-timers 2>/dev/null | grep -q certbot; then
        pass "Certbot auto-renewal timer active"
      else
        warn "Certbot auto-renewal not configured"
        info "  Run: certbot renew --quiet"
      fi
    else
      info "No Let's Encrypt certificates found"
      if [ -f "$NGINX_CONF_ENABLED" ]; then
        SERVER_NAME=$(grep server_name "$NGINX_CONF_AVAILABLE" 2>/dev/null | head -1 | awk '{print $2}' | tr -d ';')
        if [ -n "$SERVER_NAME" ] && [ "$SERVER_NAME" != "_" ]; then
          info "  Get SSL: certbot --nginx -d $SERVER_NAME"
        fi
      fi
    fi
  else
    info "Certbot not installed — skipping SSL setup"
    info "  Install: apt install certbot python3-certbot-nginx"
  fi

  # ── 5f. UFW Firewall ──────────────────────────────────
  header "PRODUCTION — FIREWALL (UFW)"
  if command -v ufw &>/dev/null; then
    UFW_STATUS=$(ufw status 2>/dev/null | head -1)
    if echo "$UFW_STATUS" | grep -qi "active"; then
      pass "UFW is active ($UFW_STATUS)"
      # Show current rules summary
      ufw status verbose 2>/dev/null | grep -E "^[0-9]" | head -10 | while IFS= read -r line; do
        info "  Rule: $line"
      done
    else
      info "Configuring UFW firewall..."
      # Default deny
      ufw default deny incoming 2>/dev/null
      ufw default allow outgoing 2>/dev/null

      # Essential services
      ufw allow ssh 2>/dev/null && info "  Allowed: SSH (22)"
      ufw allow "${PANEL_PORT}/tcp" 2>/dev/null && info "  Allowed: Panel (${PANEL_PORT})"

      # HTTP/HTTPS if Nginx is configured
      if [ -f "$NGINX_CONF_ENABLED" ]; then
        ufw allow 80/tcp 2>/dev/null && info "  Allowed: HTTP (80)"
        ufw allow 443/tcp 2>/dev/null && info "  Allowed: HTTPS (443)"
      fi

      # Enable (non-interactive)
      ufw --force enable 2>/dev/null
      if [ $? -eq 0 ]; then
        pass "UFW firewall enabled — ssh + port ${PANEL_PORT} allowed"
        PROD_STEPS+=("ufw")
      else
        warn "Could not enable UFW — check manually"
      fi
    fi
  else
    info "UFW not installed — skipping firewall setup"
    info "  Install: apt install ufw"
  fi

  # ── 5g. Log Rotation ──────────────────────────────────
  header "PRODUCTION — LOG ROTATION"
  if [ "$(uname)" = "Linux" ] && command -v logrotate &>/dev/null; then
    if [ -f "$LOGROTATE_FILE" ]; then
      pass "Logrotate config exists ($LOGROTATE_FILE)"
    else
      info "Creating logrotate config at $LOGROTATE_FILE..."
      cat > /tmp/panelku-logrotate << 'EOF'
# Panelku — Log Rotation
# Managed by bootstrap.sh — do not edit manually

/opt/panelku/storage/logs/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
    dateext
    dateformat -%Y%m%d
}

/opt/panelku/storage/logs/*.err {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
    dateext
    dateformat -%Y%m%d
}
EOF
      # Replace path with actual project root
      sed -i "s|/opt/panelku|$PROJECT_ROOT|g" /tmp/panelku-logrotate

      if sudo mv /tmp/panelku-logrotate "$LOGROTATE_FILE" 2>/dev/null; then
        pass "Logrotate configured (14 days retention)"
        PROD_STEPS+=("logrotate")
      else
        warn "Could not create logrotate config — need sudo/root"
        info "  Preview: cat /tmp/panelku-logrotate"
      fi
    fi
  else
    info "Logrotate not available — skipping log rotation setup"
    info "  Install: apt install logrotate"
  fi

  # ── 5h. Database Backup Cron ──────────────────────────
  header "PRODUCTION — DATABASE BACKUP"
  DB_PATH="${PROJECT_ROOT}/storage/panelku.db"
  BACKUP_DIR="${PROJECT_ROOT}/storage/backups"

  if [ -f "$DB_PATH" ]; then
    # Create backup script
    cat > /tmp/backup-db.sh << 'BACKUPEOF'
#!/bin/bash
# Panelku — Database Backup Script
# Generated by bootstrap.sh
BACKUP_DIR="${1:-./storage/backups}"
DB_PATH="${2:-./storage/panelku.db}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/panelku-${TIMESTAMP}.db"

if [ ! -f "$DB_PATH" ]; then
  echo "ERROR: Database not found at $DB_PATH" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

# Backup with timestamp
cp "$DB_PATH" "$BACKUP_FILE"

# Compress
if command -v gzip &>/dev/null; then
  gzip -f "$BACKUP_FILE"
  BACKUP_FILE="${BACKUP_FILE}.gz"
fi

echo "Backup created: $BACKUP_FILE"

# Cleanup backups older than 30 days
find "$BACKUP_DIR" -name "panelku-*.db*" -type f -mtime +30 -delete 2>/dev/null
echo "Cleaned up backups older than 30 days"

# Keep last 7 daily backups minimum (in case find didn't work)
BACKUP_COUNT=$(ls -1 "${BACKUP_DIR}"/panelku-*.db* 2>/dev/null | wc -l)
if [ "$BACKUP_COUNT" -gt 30 ]; then
  ls -1tr "${BACKUP_DIR}"/panelku-*.db* 2>/dev/null | head -n -30 | while IFS= read -r old; do
    rm -f "$old"
  done
fi
BACKUPEOF

    chmod +x /tmp/backup-db.sh
    cp /tmp/backup-db.sh "$BACKUP_SCRIPT" 2>/dev/null
    chmod +x "$BACKUP_SCRIPT" 2>/dev/null
    pass "Backup script created at $BACKUP_SCRIPT"

    # Setup cron job
    if command -v crontab &>/dev/null; then
      CRON_EXPRESSION="0 3 * * *"  # Every day at 3 AM
      CRON_JOB="${CRON_EXPRESSION} mkdir -p ${PROJECT_ROOT}/storage/logs && ${BACKUP_SCRIPT} ${BACKUP_DIR} ${DB_PATH} >> ${PROJECT_ROOT}/storage/logs/backup-cron.log 2>&1"

      # Check if cron job already exists
      EXISTING_CRON=$(crontab -l 2>/dev/null | grep -F "$BACKUP_SCRIPT" | head -1)
      if [ -n "$EXISTING_CRON" ]; then
        pass "Database backup cron job already exists"
      else
        (crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab - 2>/dev/null
        if [ $? -eq 0 ]; then
          pass "Database backup cron installed (daily at 3 AM)"
          PROD_STEPS+=("backup-cron")
        else
          warn "Could not install cron job — add manually:"
          info "  $CRON_JOB"
        fi
      fi
    else
      warn "crontab not found — install backup script manually:"
      info "  $BACKUP_SCRIPT $BACKUP_DIR $DB_PATH"
    fi

    # Rotate existing backups
    OLD_BACKUPS=$(find "$BACKUP_DIR" -name "panelku-*.db*" -type f -mtime +30 2>/dev/null | wc -l)
    if [ "$OLD_BACKUPS" -gt 0 ]; then
      info "Cleaning $OLD_BACKUPS backups older than 30 days..."
      find "$BACKUP_DIR" -name "panelku-*.db*" -type f -mtime +30 -delete 2>/dev/null
    fi
  else
    info "Database not found yet — backup setup will run after first DB init"
  fi

  # ── 5i. Kernel Parameters (sysctl) ────────────────────
  header "PRODUCTION — KERNEL PARAMETERS"
  if [ "$(uname)" = "Linux" ] && [ -f /etc/sysctl.conf ]; then
    SYSCTL_FILE="/etc/sysctl.d/99-panelku.conf"
    if [ -f "$SYSCTL_FILE" ]; then
      pass "Kernel parameters already configured ($SYSCTL_FILE)"
    else
      cat > /tmp/99-panelku.conf << 'EOF'
# Panelku — Kernel Tuning for Production
# Managed by bootstrap.sh

# Reduce TIME_WAIT sockets
net.ipv4.tcp_fin_timeout = 15
net.ipv4.tcp_tw_reuse = 1

# Increase network buffer sizes
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216

# Increase max open files (needed for file manager, terminal)
fs.file-max = 100000

# Enable TCP keepalive (for WebSocket connections)
net.ipv4.tcp_keepalive_time = 120
net.ipv4.tcp_keepalive_intvl = 30
net.ipv4.tcp_keepalive_probes = 8

# Reduce swappiness for better responsiveness
vm.swappiness = 10
EOF

      if sudo cp /tmp/99-panelku.conf "$SYSCTL_FILE" 2>/dev/null; then
        sudo sysctl -p "$SYSCTL_FILE" 2>/dev/null
        pass "Kernel parameters tuned (${SYSCTL_FILE})"
        PROD_STEPS+=("sysctl")
      else
        warn "Could not create sysctl config — need sudo/root"
        info "  Preview: cat /tmp/99-panelku.conf"
      fi
    fi
  else
    info "Not Linux — skipping kernel parameter tuning"
  fi

  # ── 5j. Node.js Memory Tuning ─────────────────────────
  header "PRODUCTION — NODE.JS TUNING"
  if [ -f ecosystem.config.cjs ]; then
    # Check if memory limit is already set
    if grep -q "max-old-space-size\|max_old_space_size" ecosystem.config.cjs 2>/dev/null; then
      pass "Node.js memory limit configured in ecosystem.config.cjs"
    else
      info "Node.js memory limit not set in PM2 config"
      warn "  Recommended: add --max-old-space-size=1024 to NODE_OPTIONS"
    fi
  fi

  # Check node memory limit (for non-PM2 deployments)
  if [ -n "$NODE_OPTIONS" ]; then
    if echo "$NODE_OPTIONS" | grep -q "max-old-space-size"; then
      pass "NODE_OPTIONS has memory limit: $NODE_OPTIONS"
    else
      warn "NODE_OPTIONS set but no --max-old-space-size — set to 1024 for servers with <2GB RAM"
    fi
  else
    # Suggest setting it
    warn "NODE_OPTIONS not set — add to .bashrc or systemd service:"
    warn "  export NODE_OPTIONS='--max-old-space-size=1024'"
  fi

  # ── 5k. Health Check ──────────────────────────────────
  header "PRODUCTION — HEALTH CHECK"
  if command -v curl &>/dev/null; then
    # Try to ping the panel
    for attempt in 1 2 3; do
      HEALTH_RESULT=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "http://127.0.0.1:${PANEL_PORT}/" 2>/dev/null)
      if [ -n "$HEALTH_RESULT" ] && [ "$HEALTH_RESULT" -ge 200 ] && [ "$HEALTH_RESULT" -lt 500 ]; then
        pass "Panel responds on port ${PANEL_PORT} (HTTP ${HEALTH_RESULT})"
        break
      fi
      if [ "$attempt" -lt 3 ]; then
        info "Panel not responding yet — retrying in 3s (attempt ${attempt}/3)..."
        sleep 3
      else
        warn "Panel not responding on port ${PANEL_PORT} after 3 attempts"
        info "  Check: systemctl status panelku  (if systemd configured)"
        info "  Check: pm2 status               (if PM2 configured)"
        info "  Check: node src/server.js       (direct start)"
      fi
    done

    # Verify CSP headers
    CSP_HEADER=$(curl -s -I "http://127.0.0.1:${PANEL_PORT}/" 2>/dev/null | grep -i content-security-policy | head -1)
    if [ -n "$CSP_HEADER" ]; then
      pass "Security headers verified (CSP present)"
    fi
  else
    info "curl not found — skipping health check"
  fi

  # ── 5l. Security Hardening Summary ────────────────────
  header "PRODUCTION — SECURITY HARDENING"

  # Check if SSH password auth is disabled (recommended)
  if [ -f /etc/ssh/sshd_config ]; then
    if grep -qi "PasswordAuthentication no" /etc/ssh/sshd_config 2>/dev/null; then
      pass "SSH password authentication disabled (key-only)"
    else
      warn "SSH password authentication is enabled — use SSH keys for better security"
    fi
  fi

  # Check if unattended-upgrades is installed
  if command -v unattended-upgrade &>/dev/null; then
    pass "Unattended upgrades installed (auto security updates)"
  elif [ -f /etc/apt/apt.conf.d/20auto-upgrades ]; then
    pass "APT auto-upgrades configured"
  else
    warn "No automatic security updates configured"
    info "  Install: apt install unattended-upgrades"
  fi

  # Check fail2ban
  if command -v fail2ban-client &>/dev/null; then
    FAIL2BAN_STATUS=$(fail2ban-client status 2>/dev/null | head -3)
    pass "Fail2ban installed — ${FAIL2BAN_STATUS}"
  else
    warn "Fail2ban not installed — protects against brute force"
    info "  Install: apt install fail2ban"
  fi

  # Check if root login is restricted
  if [ -f /etc/ssh/sshd_config ]; then
    if grep -qi "PermitRootLogin (no|prohibit-password)" /etc/ssh/sshd_config 2>/dev/null; then
      pass "SSH root login restricted"
    else
      warn "SSH PermitRootLogin may be enabled — consider setting to 'prohibit-password'"
    fi
  fi

  # Check for Docker socket exposure
  if [ -S /var/run/docker.sock ]; then
    DOCKER_GROUP=$(stat -c "%G" /var/run/docker.sock 2>/dev/null || echo "root")
    if [ "$DOCKER_GROUP" = "docker" ]; then
      warn "Docker socket is group-readable — users in 'docker' group have root-equivalent access"
    fi
  fi

  # ── 5m. Final Production Summary ──────────────────────
  if [ ${#PROD_STEPS[@]} -gt 0 ]; then
    header "PRODUCTION SETUP COMPLETE"
    echo ""
    echo -e "  ${BOLD}Steps completed:${NC}"
    for step in "${PROD_STEPS[@]}"; do
      case "$step" in
        swap)       echo -e "    ${GREEN}✓${NC} Swap file configured" ;;
        systemd)    echo -e "    ${GREEN}✓${NC} Systemd service (auto-start on boot)" ;;
        pm2-startup) echo -e "    ${GREEN}✓${NC} PM2 startup on boot" ;;
        nginx)      echo -e "    ${GREEN}✓${NC} Nginx reverse proxy" ;;
        ufw)        echo -e "    ${GREEN}✓${NC} UFW firewall" ;;
        logrotate)  echo -e "    ${GREEN}✓${NC} Log rotation (14 days)" ;;
        backup-cron) echo -e "    ${GREEN}✓${NC} Database backup (daily at 3 AM)" ;;
        sysctl)     echo -e "    ${GREEN}✓${NC} Kernel parameters tuned" ;;
        *)          echo -e "    ${GREEN}✓${NC} $step" ;;
      esac
    done
    echo ""
  fi

fi # end PRODUCTION_MODE

# ─────────────────────────────────────────────────────────
#  6. DEPLOY / RESTART (--deploy mode)
# ─────────────────────────────────────────────────────────
if [ "$DEPLOY_MODE" = true ]; then

  header "DEPLOY"

  # 1. Check we're in a git repo
  if ! git rev-parse --is-inside-work-tree &>/dev/null; then
    fail "Not a git repository — deploy mode requires git"
  else
    BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
    info "Current branch: $BRANCH"
  fi

  # 2. Stash local changes if any, then pull
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    warn "Local changes detected — stashing before pull"
    git stash push -m "bootstrap-deploy-auto-stash-$(date +%s)" 2>&1 | head -3
  fi

  info "Pulling latest code..."
  GIT_OUTPUT=$(git pull origin "$BRANCH" 2>&1)
  GIT_EXIT=$?
  echo "$GIT_OUTPUT" | while IFS= read -r line; do echo "    $line"; done
  
  if [ "$GIT_EXIT" -ne 0 ]; then
    fail "Git pull failed — resolve conflicts and retry"
  else
    pass "Git pull completed"
    
    # Check if app.js changed (CSP changes are critical)
    if echo "$GIT_OUTPUT" | grep -q "src/app.js"; then
      info "src/app.js changed — CSP update detected"
    fi
    if echo "$GIT_OUTPUT" | grep -q "src/views/"; then
      info "View files changed — templates updated"
    fi
  fi

  # 3. Install dependencies
  header "DEPENDENCIES"
  info "Installing npm dependencies..."
  npm install 2>&1 | tail -5
  if [ $? -eq 0 ]; then
    pass "npm install completed"
  else
    fail "npm install failed"
    if [ "$EXIT_ON_FAIL" = true ]; then exit 1; fi
  fi

  # 4. Run CSP tests first (fast security gate)
  header "CSP GATE"
  if [ -f node_modules/.bin/jest ] && [ -f tests/csp.test.js ]; then
    info "Running CSP verification tests..."
    CSP_OUTPUT=$(npx jest --no-cache tests/csp.test.js --testTimeout=30000 2>&1)
    CSP_EXIT=$?
    echo "$CSP_OUTPUT" | tail -8 | while IFS= read -r line; do
      echo "    $line"
    done
    if [ $CSP_EXIT -eq 0 ]; then
      pass "CSP tests passed"
    else
      fail "CSP tests failed — deployment blocked!"
      if [ "$EXIT_ON_FAIL" = true ]; then exit 1; fi
    fi
  else
    warn "CSP tests not available — skipping security gate"
  fi

  # 5. Stop existing panel process
  header "RESTART"
  info "Stopping current panel process..."
  
  # Try PM2 first
  if command -v pm2 &>/dev/null; then
    if pm2 list 2>/dev/null | grep -q "panelku"; then
      pm2 stop panelku 2>&1 | tail -2
      pm2 delete panelku 2>&1 | tail -2
      pass "Stopped PM2 process: panelku"
    else
      info "No PM2 process named 'panelku' running"
    fi
  fi
  
  # Fallback: kill any process on our port
  PORT=${PORT:-23456}
  KILLED=false
  if command -v fuser &>/dev/null; then
    if fuser "${PORT}/tcp" 2>/dev/null; then
      fuser -k "${PORT}/tcp" 2>/dev/null
      sleep 2
      pass "Freed port ${PORT} (fuser)"
      KILLED=true
    fi
  elif command -v ss &>/dev/null; then
    OLD_PID=$(ss -tlnp "sport = :$PORT" 2>/dev/null | grep -oP 'pid=\K\d+' | head -1)
    if [ -n "$OLD_PID" ]; then
      kill "$OLD_PID" 2>/dev/null
      sleep 2
      pass "Killed process (PID $OLD_PID) via ss"
      KILLED=true
    fi
  elif command -v lsof &>/dev/null; then
    OLD_PID=$(lsof -ti:"$PORT" 2>/dev/null)
    if [ -n "$OLD_PID" ]; then
      kill "$OLD_PID" 2>/dev/null
      sleep 2
      if kill -0 "$OLD_PID" 2>/dev/null; then
        kill -9 "$OLD_PID" 2>/dev/null
        sleep 1
      fi
      pass "Killed old process (PID $OLD_PID)"
      KILLED=true
    fi
  fi
  if [ "$KILLED" = false ]; then
    warn "Could not find process on port ${PORT} — no fuser/lsof/ss available"
  fi

  # 6. Start panel
  info "Starting panel on port $PORT..."
  if command -v pm2 &>/dev/null; then
    pm2 start ecosystem.config.cjs --env production 2>&1 | tail -5
    START_EXIT=$?
  else
    nohup node --experimental-vm-modules src/server.js > /dev/null 2>&1 &
    START_EXIT=$?
    info "Started with PID $!"
  fi
  
  sleep 4

  if [ $START_EXIT -eq 0 ]; then
    pass "Panel started"
  else
    fail "Panel failed to start — check logs"
    if [ "$EXIT_ON_FAIL" = true ]; then exit 1; fi
  fi

  # 7. Verify CSP header
  header "CSP VERIFICATION"
  sleep 3
  CSP_HEADER=$(curl -s -I "http://localhost:$PORT/" 2>/dev/null | grep -i content-security-policy)
  
  if [ -z "$CSP_HEADER" ]; then
    fail "No CSP header received — panel may not be running"
  else
    pass "CSP header present"
    
    # Check critical CSP features
    if echo "$CSP_HEADER" | grep -q "style-src-attr.*unsafe-inline"; then
      pass "style-src-attr 'unsafe-inline' — inline styles allowed"
    else
      fail "style-src-attr missing — inline style="..." will be blocked!"
    fi
    
    if echo "$CSP_HEADER" | grep -q "script-src-attr.*unsafe-inline"; then
      pass "script-src-attr 'unsafe-inline' — inline event handlers allowed"
    else
      fail "script-src-attr missing — inline onclick="..." will be blocked!"
    fi
    
    if echo "$CSP_HEADER" | grep -q "cdn\.jsdelivr"; then
      warn "cdn.jsdelivr.net still in CSP — consider migrating to local hosting"
    else
      pass "No CDN domains in CSP — all resources self-hosted"
    fi
    
    if echo "$CSP_HEADER" | grep -q "fonts\.googleapis\|fonts\.gstatic"; then
      warn "Google Fonts domains still in CSP — consider self-hosting"
    else
      pass "No Google Fonts domains in CSP"
    fi
  fi

  # 8. Show status
  header "DEPLOY COMPLETE"
  echo ""
  echo -e "  ${BOLD}Panel URL:${NC}  http://localhost:$PORT"
  echo -e "  ${BOLD}CSP Status:${NC} $(echo "$CSP_HEADER" | head -c 120)..."
  echo ""
fi

# ─────────────────────────────────────────────────────────
#  7. SUMMARY
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
echo -e "  ${BLUE}→${NC} Deploy update:           ${GREEN}bash scripts/bootstrap.sh --deploy${NC}"
echo -e "  ${BLUE}→${NC} Production setup:        ${GREEN}bash scripts/bootstrap.sh --production${NC}"
echo -e "  ${BLUE}→${NC} Backup database:         ${GREEN}bash scripts/backup-db.sh${NC}"
echo -e "  ${BLUE}→${NC} View panel status:       ${GREEN}systemctl status panelku${NC} (if systemd configured)"
echo ""

# Exit code
if [ "$ERRORS" -gt 0 ]; then
  exit 1
fi
exit 0
