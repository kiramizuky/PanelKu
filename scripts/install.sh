#!/bin/bash
# ============================================================
# ============================================================
# Panelku — One-Click Install Script
# Supports: Debian, Ubuntu, Armbian, RHEL/CentOS, Arch, Alpine
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# [HIGH-4 FIX] Use /opt/panelku to match all references in system.service.js
# Previously was /opt/linux-panel which caused panel update commands to fail
PANEL_DIR="${PANELKU_INSTALL_DIR:-/opt/panelku}"
PANEL_PORT="${PANELKU_PORT:-23456}"
NODE_VERSION="${NODE_VERSION:-22}"
REPO_URL="${PANELKU_REPO_URL:-https://github.com/kiramizuky/PanelKu.git}"
REPO_BRANCH="${PANELKU_BRANCH:-master}"
NEW_ADMIN_PASSWORD=""
# Optional hardening. Default remains root to keep every panel feature working.
# PANELKU_HARDENED=1 creates a dedicated `panelku` user + ProtectSystem=strict
# and installs the sudoers policy. Set PANELKU_NNP=1 to enable
# NoNewPrivileges (disables sudo, so privileged panel features stop).
PANEL_USER="${PANELKU_USER:-root}"
HARDENING_BLOCK=""

# Parse CLI options (supports both flags and environment variables)
while [ $# -gt 0 ]; do
  case "$1" in
    --hardened|-h)
      export PANELKU_HARDENED=1
      shift
      ;;
    --nnp)
      export PANELKU_NNP=1
      shift
      ;;
    --port|-p)
      PANEL_PORT="$2"
      export PANELKU_PORT="$2"
      shift 2
      ;;
    --user|-u)
      PANEL_USER="$2"
      export PANELKU_USER="$2"
      shift 2
      ;;
    --branch|-b)
      REPO_BRANCH="$2"
      export PANELKU_BRANCH="$2"
      shift 2
      ;;
    --dir|-d)
      PANEL_DIR="$2"
      export PANELKU_INSTALL_DIR="$2"
      shift 2
      ;;
    --help)
      echo "Usage: sudo bash install.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --hardened, -h      Enable systemd hardening (dedicated user + ProtectSystem=strict)"
      echo "  --nnp               Enable NoNewPrivileges (disables sudo)"
      echo "  --port, -p <port>   Panel listen port (default: 23456)"
      echo "  --user, -u <user>   Hardened system user (default: panelku)"
      echo "  --branch, -b <br>   Git branch to install (default: master)"
      echo "  --dir, -d <path>    Install directory (default: /opt/panelku)"
      echo "  --help              Show this help message"
      exit 0
      ;;
    *)
      shift
      ;;
  esac
done

print_banner() {
  echo -e "${CYAN}"
  echo "  ██╗     ██╗███╗   ██╗██╗   ██╗██╗  ██╗"
  echo "  ██║     ██║████╗  ██║██║   ██║╚██╗██╔╝"
  echo "  ██║     ██║██╔██╗ ██║██║   ██║ ╚███╔╝ "
  echo "  ██║     ██║██║╚██╗██║██║   ██║ ██╔██╗ "
  echo "  ███████╗██║██║ ╚████║╚██████╔╝██╔╝ ██╗"
  echo "  ╚══════╝╚═╝╚═╝  ╚═══╝ ╚═════╝ ╚═╝  ╚═╝"
  echo "  PANELKU — Linux Server Control Panel"
  echo -e "${NC}"
}

log() { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; exit 1; }
info() { echo -e "${BLUE}[→]${NC} $1"; }

check_root() {
  [[ $EUID -ne 0 ]] && error "Run as root: sudo bash install.sh"
}

detect_os() {
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
    OS_VERSION=$VERSION_ID
    log "Detected: $PRETTY_NAME"
  else
    error "Unsupported OS"
  fi

  if command -v apt-get &>/dev/null; then
    PM="apt"
  elif command -v pacman &>/dev/null; then
    PM="pacman"
  elif command -v dnf &>/dev/null; then
    PM="dnf"
  elif command -v yum &>/dev/null; then
    PM="yum"
  elif command -v apk &>/dev/null; then
    PM="apk"
  elif command -v zypper &>/dev/null; then
    PM="zypper"
  elif command -v emerge &>/dev/null; then
    PM="emerge"
  else
    warn "Unsupported package manager. Falling back to apt/standard detection."
    PM="apt"
  fi

  ARCH=$(uname -m)
  IS_64BIT=true
  if [[ "$ARCH" != "x86_64" && "$ARCH" != "aarch64" && "$ARCH" != "arm64" ]]; then
    IS_64BIT=false
  fi
  log "Architecture: $ARCH (64bit/ARM64: $IS_64BIT)"
}

install_dependencies() {
  info "Configuring and fixing package manager..."
  if [ "$PM" = "apt" ]; then
    dpkg --configure -a || true
    apt-get install -f -y || true
  fi

  info "Installing dependencies..."
  case "$PM" in
    apt)
      apt-get update -qq || true
      apt-get install -y curl git openssl build-essential python3 make g++ redis-server nginx docker.io ufw || {
        for pkg in curl git openssl build-essential python3 make g++ redis-server nginx docker.io ufw; do
          apt-get install -y -qq "$pkg" || warn "Failed to install $pkg"
        done
      }
      ;;
    pacman)
      pacman -Sy --noconfirm || true
      pacman -S --noconfirm --needed curl git openssl base-devel python make gcc redis nginx docker ufw || {
        for pkg in curl git openssl base-devel python make gcc redis nginx docker ufw; do
          pacman -S --noconfirm --needed "$pkg" || warn "Failed to install $pkg"
        done
      }
      ;;
    dnf|yum)
      local cmd="$PM"
      $cmd makecache || true
      if [ "$cmd" = "yum" ] || command -v subscription-manager &>/dev/null; then
        $cmd install -y epel-release || true
      fi
      $cmd install -y curl git openssl python3 make gcc-c++ redis nginx docker ufw || {
        for pkg in curl git openssl python3 make gcc-c++ redis nginx docker ufw; do
          $cmd install -y "$pkg" || warn "Failed to install $pkg"
        done
      }
      ;;
    apk)
      apk update || true
      apk add curl git openssl build-base g++ make python3 redis nginx docker ufw || {
        for pkg in curl git openssl build-base g++ make python3 redis nginx docker ufw; do
          apk add "$pkg" || warn "Failed to install $pkg"
        done
      }
      ;;
    zypper)
      zypper refresh || true
      zypper install -y gcc gcc-c++ make python3 curl git openssl redis nginx docker ufw || {
        for pkg in gcc gcc-c++ make python3 curl git openssl redis nginx docker ufw; do
          zypper install -y "$pkg" || warn "Failed to install $pkg"
        done
      }
      ;;
    emerge)
      emerge --sync || true
      emerge -v net-misc/curl dev-vcs/git dev-libs/openssl www-servers/nginx dev-db/redis sys-devel/make sys-devel/gcc app-containers/docker net-firewall/ufw || {
        for pkg in net-misc/curl dev-vcs/git dev-libs/openssl www-servers/nginx dev-db/redis sys-devel/make sys-devel/gcc app-containers/docker net-firewall/ufw; do
          emerge -v "$pkg" || warn "Failed to install $pkg"
        done
      }
      ;;
  esac

  # Install acme.sh for SSL
  if [ ! -d ~/.acme.sh ]; then
    info "Installing acme.sh..."
    curl -s https://get.acme.sh | sh || warn "Failed to install acme.sh automatically"
  fi

  # Ensure Redis service is enabled and started on systemd hosts
  if command -v systemctl &>/dev/null; then
    systemctl enable redis 2>/dev/null || systemctl enable redis-server 2>/dev/null || true
    systemctl start redis 2>/dev/null || systemctl start redis-server 2>/dev/null || true
  fi
}

install_nodejs() {
  if command -v node &>/dev/null; then
    local ver=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$ver" -ge "$NODE_VERSION" ]; then
      log "Node.js $(node -v) already installed"
      return
    fi
  fi

  info "Installing Node.js $NODE_VERSION LTS..."
  local success=false
  # Try repository / NodeSource first if 64-bit and supported PM
  if [ "$PM" = "apt" ] && [ "$IS_64BIT" = true ]; then
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - && apt-get install -y nodejs && success=true || true
  elif [ "$PM" = "dnf" ] && [ "$IS_64BIT" = true ]; then
    curl -fsSL https://rpm.nodesource.com/setup_${NODE_VERSION}.x | bash - && dnf install -y nodejs && success=true || true
  fi

  if [ "$success" = false ]; then
    case "$PM" in
      apt) apt-get install -y nodejs npm && success=true || true ;;
      pacman) pacman -S --noconfirm --needed nodejs npm && success=true || true ;;
      dnf|yum) $PM install -y nodejs npm && success=true || true ;;
      apk) apk add nodejs npm && success=true || true ;;
      zypper) zypper install -y nodejs npm && success=true || true ;;
      emerge) emerge -v net-libs/nodejs && success=true || true ;;
    esac
  fi

  local check_ver=0
  if command -v node &>/dev/null; then
    check_ver=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
  fi

  # Bulletproof fallback using official prebuilt binaries
  if [ "$check_ver" -lt "$NODE_VERSION" ]; then
    local node_arch=""
    case "$ARCH" in
      x86_64) node_arch="x64" ;;
      aarch64|arm64) node_arch="arm64" ;;
      armv7l) node_arch="armv7l" ;;
    esac

    if [ -n "$node_arch" ]; then
      info "Package manager did not provide Node.js >= $NODE_VERSION. Installing official prebuilt binary..."
      case "$PM" in
        apt)     DEBIAN_FRONTEND=noninteractive apt-get install -y tar gzip xz-utils 2>/dev/null || true ;;
        pacman)  pacman -S --noconfirm --needed tar gzip xz 2>/dev/null || true ;;
        dnf|yum) $PM install -y tar gzip xz 2>/dev/null || true ;;
        apk)     apk add tar gzip xz 2>/dev/null || true ;;
        zypper)  zypper install -y tar gzip xz 2>/dev/null || true ;;
      esac
      local node_dist_url="https://nodejs.org/dist/latest-v${NODE_VERSION}.x/"
      local node_filename=$(curl -fsSL "$node_dist_url" 2>/dev/null | grep -oE "node-v[0-9.]+-linux-${node_arch}\.tar\.gz" | head -1)
      if [ -z "$node_filename" ]; then
        node_filename=$(curl -fsSL "$node_dist_url" 2>/dev/null | grep -oE "node-v[0-9.]+-linux-${node_arch}\.tar\.xz" | head -1)
      fi
      if [ -n "$node_filename" ]; then
        local temp_archive="/tmp/${node_filename}"
        curl -fsSL "${node_dist_url}${node_filename}" -o "$temp_archive" || true
        tar -xf "$temp_archive" -C /usr/local --strip-components=1 2>/dev/null || true
        rm -f "$temp_archive" || true
      else
        local temp_tar="/tmp/node.tar.xz"
        curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}.0.0/node-v${NODE_VERSION}.0.0-linux-${node_arch}.tar.xz" -o "$temp_tar" || true
        tar -xf "$temp_tar" -C /usr/local --strip-components=1 2>/dev/null || true
        rm -f "$temp_tar" || true
      fi
    else
      error "No prebuilt Node.js binary fallback available for architecture $ARCH. Installation failed."
    fi
  fi

  # Verify the result before continuing to npm install.
  local final_ver=0
  if command -v node &>/dev/null; then
    final_ver=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
  fi
  if [ "${final_ver:-0}" -lt "$NODE_VERSION" ]; then
    error "Node.js >= $NODE_VERSION is required, but v${final_ver:-none} is installed. Aborting."
  fi
  log "Node.js $(node -v) ready"
}

install_pm2() {
  if ! command -v pm2 &>/dev/null; then
    info "Installing PM2..."
    npm install -g pm2 -q 2>/dev/null || true
    if command -v systemctl &>/dev/null; then
      pm2 startup systemd -u root --hp /root 2>/dev/null || true
    else
      pm2 startup 2>/dev/null || true
    fi
    log "PM2 installed"
  else
    log "PM2 already installed"
  fi
}

setup_panel() {
  info "Setting up Panelku in $PANEL_DIR..."

  # [FIX] The updater requires a real git repository. Copying files with `cp -r`
  # produced installations where `git pull` and `git reset` could never work.
  if [ -d "$PANEL_DIR/.git" ]; then
    info "Existing installation detected — updating source..."
    git -C "$PANEL_DIR" remote set-url origin "$REPO_URL" 2>/dev/null || true
    git -C "$PANEL_DIR" fetch origin "$REPO_BRANCH" 2>&1 || warn "Git fetch had warnings, proceeding..."
    git -C "$PANEL_DIR" checkout -B "$REPO_BRANCH" "origin/$REPO_BRANCH" 2>/dev/null || true
    git -C "$PANEL_DIR" reset --hard "origin/$REPO_BRANCH" 2>/dev/null || true
  elif [ -d "$PANEL_DIR" ] && [ -n "$(ls -A "$PANEL_DIR" 2>/dev/null)" ]; then
    # Never delete an existing non-git installation: it may contain the SQLite
    # database, certificates and uploads. The updater requires git anyway.
    error "Existing non-git installation found at $PANEL_DIR. Move it aside or convert it to a git clone before reinstalling."
  elif [ -f "$PWD/package.json" ] && [ -d "$PWD/src" ] && [ -d "$PWD/.git" ]; then
    info "Installing from local git clone ($PWD)..."
    mkdir -p "$(dirname "$PANEL_DIR")"
    cp -a "$PWD/." "$PANEL_DIR/"
  else
    info "Cloning $REPO_URL ($REPO_BRANCH)..."
    rm -rf "$PANEL_DIR"
    mkdir -p "$(dirname "$PANEL_DIR")"
    git clone --depth 1 --branch "$REPO_BRANCH" "$REPO_URL" "$PANEL_DIR"
  fi

  cd "$PANEL_DIR"

  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    error "Installation is not a git repository. The updater requires git (clone $REPO_URL)."
  fi

  # Detached updater supervisor must be executable after clone/copy.
  chmod +x scripts/panel-update.sh 2>/dev/null || true

  info "Setting up storage directories..."
  mkdir -p storage/logs storage/backups storage/websites storage/uploads storage/temp storage/snapshots
  # [MED-7 FIX] Use 750 instead of 777 — storage contains SQLite DB and secrets.
  # Only panel process (running as root or dedicated user) needs access.
  chmod -R 750 storage

  # Copy env
  if [ ! -f .env ]; then
    cp .env.example .env
    APP_SECRET=$(openssl rand -hex 32)
    JWT_SECRET=$(openssl rand -hex 32)
    JWT_REFRESH_SECRET=$(openssl rand -hex 32)
    
    # Cross-platform sed compatibility
    if sed --version 2>&1 | grep -q "GNU"; then
      sed -i "s/change_this_to_a_very_long_random_secret_string/$APP_SECRET/" .env
      sed -i "s/change_this_jwt_secret_very_long_random_string/$JWT_SECRET/" .env
      sed -i "s/change_this_refresh_secret_very_long_random/$JWT_REFRESH_SECRET/" .env
      sed -i "s/NODE_ENV=development/NODE_ENV=production/" .env
      sed -i "s/PORT=23456/PORT=$PANEL_PORT/" .env
    else
      sed -i "" "s/change_this_to_a_very_long_random_secret_string/$APP_SECRET/" .env
      sed -i "" "s/change_this_jwt_secret_very_long_random_string/$JWT_SECRET/" .env
      sed -i "" "s/change_this_refresh_secret_very_long_random/$JWT_REFRESH_SECRET/" .env
      sed -i "" "s/NODE_ENV=development/NODE_ENV=production/" .env
      sed -i "" "s/PORT=23456/PORT=$PANEL_PORT/" .env
    fi

    # [SEC] Never ship the well-known default admin password on a public install.
    NEW_ADMIN_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-20)
    printf '\n# Initial super-admin password (forced change on first login)\nADMIN_PASSWORD=%s\n' "$NEW_ADMIN_PASSWORD" >> .env
    log "Generated secure secrets and a random admin password"
  fi
  chmod 600 .env 2>/dev/null || true

  info "Installing npm packages..."
  if [ -f package-lock.json ]; then
    npm ci --omit=dev --no-audit --no-fund 2>&1 || {
      warn "npm ci encountered an issue, falling back to npm install..."
      npm install --omit=dev --no-audit --no-fund || error "npm install failed"
    }
  else
    npm install --omit=dev --no-audit --no-fund || error "npm install failed"
  fi

  # [NATIVE ADDONS] Rebuild and verify native C++ addons (better-sqlite3 & node-pty).
  # Native modules MUST be compiled to match the host Linux kernel and Node.js ABI,
  # otherwise better-sqlite3 (database) and node-pty (Web Terminal) will fail to load.
  info "Building and verifying native addons (better-sqlite3, node-pty)..."

  # Temporary swap check: low-spec VPS (<=2GB RAM without swap) can trigger OOM during g++ linking
  local created_temp_swap=false
  if [ -f /proc/meminfo ]; then
    local mem_total_kb=$(grep -i MemTotal /proc/meminfo | awk '{print $2}')
    local swap_total_kb=$(grep -i SwapTotal /proc/meminfo | awk '{print $2}')
    local mem_total_mb=$((mem_total_kb / 1024))
    if [ "$mem_total_mb" -gt 0 ] && [ "$mem_total_mb" -le 2048 ] && [ "$swap_total_kb" -le 262144 ]; then
      info "Low memory detected (${mem_total_mb}MB RAM without swap). Creating temporary 1GB swap to prevent compiler OOM..."
      if command -v fallocate &>/dev/null; then
        fallocate -l 1G /swapfile_panelku_install 2>/dev/null || dd if=/dev/zero of=/swapfile_panelku_install bs=1M count=1024 2>/dev/null || true
      else
        dd if=/dev/zero of=/swapfile_panelku_install bs=1M count=1024 2>/dev/null || true
      fi
      if [ -f /swapfile_panelku_install ]; then
        chmod 600 /swapfile_panelku_install
        mkswap /swapfile_panelku_install 2>/dev/null && swapon /swapfile_panelku_install 2>/dev/null && created_temp_swap=true
      fi
    fi
  fi

  # 1. better-sqlite3 build & verify
  info "Building better-sqlite3..."
  npm rebuild better-sqlite3 2>&1 || {
    warn "npm rebuild better-sqlite3 had warnings, attempting build-from-source..."
    npm install better-sqlite3 --build-from-source --omit=dev --no-audit --no-fund 2>&1 || warn "better-sqlite3 build-from-source failed"
  }

  if node -e "import('better-sqlite3').then(m => { const db = new (m.default || m)(':memory:'); db.prepare('SELECT 1').get(); db.close(); })" 2>/dev/null; then
    log "better-sqlite3 verified successfully"
  else
    warn "better-sqlite3 verification failed — SQLite operations may fail"
  fi

  # 2. node-pty build & verify
  info "Building node-pty (Web Terminal engine)..."
  npm rebuild node-pty 2>&1 || {
    info "npm rebuild node-pty triggered fallback, compiling from source..."
    npm install node-pty --build-from-source --omit=dev --no-audit --no-fund 2>&1 || warn "node-pty build-from-source failed"
  }

  if ! node -e "import('node-pty').then(m => { const pty = m.default || m; if (typeof pty.spawn !== 'function') process.exit(1); })" 2>/dev/null; then
    info "node-pty not yet verified. Forcing source compilation with node-gyp..."
    npm install node-pty --build-from-source --omit=dev --no-audit --no-fund 2>&1 || true
  fi

  if node -e "import('node-pty').then(m => { const pty = m.default || m; if (typeof pty.spawn !== 'function') process.exit(1); })" 2>/dev/null; then
    log "node-pty verified successfully (Web Terminal ready)"
  else
    warn "node-pty could not be verified. Web Terminal may require 'npm rebuild node-pty' after installation."
  fi

  # Remove temporary swap if created
  if [ "$created_temp_swap" = true ] && [ -f /swapfile_panelku_install ]; then
    swapoff /swapfile_panelku_install 2>/dev/null || true
    rm -f /swapfile_panelku_install 2>/dev/null || true
    info "Temporary build swapfile cleaned up"
  fi

  log "NPM packages and native addons ready"

  # Operational CLI (doctor/status/check-update/rollback/reset-password).
  # Symlink instead of copying: the CLI resolves its repository root from its
  # own real path, so a copy in /usr/local/bin would look for package.json and
  # .env in /usr/local.
  if [ -f "$PANEL_DIR/bin/panelku.js" ]; then
    mkdir -p /usr/local/bin
    chmod 0755 "$PANEL_DIR/bin/panelku.js"
    ln -sfn "$PANEL_DIR/bin/panelku.js" /usr/local/bin/panelku
    log "CLI installed: /usr/local/bin/panelku -> $PANEL_DIR/bin/panelku.js"
  fi

  # Opt-in systemd hardening. Keep the default root unit behaviour intact so
  # existing installs do not lose package/service management.
  if [ "${PANELKU_HARDENED:-0}" = "1" ]; then
    info "Applying opt-in systemd hardening (PANELKU_HARDENED=1)..."
    PANEL_USER="${PANELKU_USER:-panelku}"
    if ! printf '%s' "$PANEL_USER" | grep -Eq '^[a-z_][a-z0-9_-]*$'; then
      error "Invalid PANELKU_USER '${PANEL_USER}': use lowercase letters, digits, '_' or '-'"
    fi
    if [ -f "$PANEL_DIR/deploy/panelku.sudoers" ] && command -v visudo >/dev/null 2>&1; then
      mkdir -p /etc/sudoers.d
      # Keep the policy in sync with PANELKU_USER (it is scoped to one account).
      sed "s/panelku/${PANEL_USER}/g" "$PANEL_DIR/deploy/panelku.sudoers" > /etc/sudoers.d/panelku
      chmod 0440 /etc/sudoers.d/panelku
      if ! visudo -cf /etc/sudoers.d/panelku >/dev/null 2>&1; then
        warn "sudoers validation failed; removing /etc/sudoers.d/panelku"
        rm -f /etc/sudoers.d/panelku
      fi
    elif [ -f "$PANEL_DIR/deploy/panelku.sudoers" ]; then
      warn "sudo/visudo not installed; skipping deploy/panelku.sudoers"
    fi

    if ! id -u "$PANEL_USER" >/dev/null 2>&1; then
      if command -v useradd >/dev/null 2>&1; then
        useradd --system --home-dir "$PANEL_DIR" --shell /usr/sbin/nologin "$PANEL_USER" || true
      elif command -v adduser >/dev/null 2>&1; then
        adduser -S -D -H -h "$PANEL_DIR" -s /sbin/nologin "$PANEL_USER" || true
      else
        error "Cannot create $PANEL_USER user: neither useradd nor adduser is available"
      fi
    fi
    if ! id -u "$PANEL_USER" >/dev/null 2>&1; then
      error "Cannot create user $PANEL_USER (required by systemd User=)"
    fi
    # systemd uses Group=$PANEL_USER; make sure it exists even when useradd
    # imported an existing account whose primary group has another name.
    if ! grep -q "^${PANEL_USER}:" /etc/group; then
      if command -v groupadd >/dev/null 2>&1; then
        groupadd --system "$PANEL_USER" || true
      elif command -v addgroup >/dev/null 2>&1; then
        addgroup -S "$PANEL_USER" || true
      fi
    fi
    if ! grep -q "^${PANEL_USER}:" /etc/group; then
      error "Cannot create group $PANEL_USER (required by systemd Group=)"
    fi
    chown -R "$PANEL_USER:$PANEL_USER" "$PANEL_DIR" || true
    chmod 750 "$PANEL_DIR/storage" || true

    HARDENING_BLOCK=$(cat <<EOF
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$PANEL_DIR/storage $PANEL_DIR
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
EOF
)
    if [ "${PANELKU_NNP:-0}" = "1" ]; then
      HARDENING_BLOCK="NoNewPrivileges=true
$HARDENING_BLOCK"
      warn "NoNewPrivileges=true is enabled; sudo-based panel features will not work"
    fi
    log "Hardening enabled for user ${PANEL_USER}"
  fi

  # Create systemd service so 'systemctl restart panelku' works
  # [HIGH-4 FIX] Service name 'panelku' matches system.service.js restartPanel()
  if command -v systemctl &>/dev/null; then
    info "Creating systemd service: panelku..."

    # [FIX] Previous limits (512M/256M heap) OOM-killed the panel on normal use.
    # Scale limits to the actual VPS size instead of one fixed value.
    local mem_total_mb
    mem_total_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)
    local heap_mb=512 memory_high=1024M memory_max=1536M
    if [ "$mem_total_mb" -gt 0 ] && [ "$mem_total_mb" -le 1024 ]; then
      heap_mb=256; memory_high=640M; memory_max=768M
    elif [ "$mem_total_mb" -gt 0 ] && [ "$mem_total_mb" -le 2048 ]; then
      heap_mb=384; memory_high=768M; memory_max=1024M
    fi

    cat > /etc/systemd/system/panelku.service << EOF
[Unit]
Description=Panelku Linux Control Panel
After=network.target redis.service redis-server.service
Wants=redis.service redis-server.service
StartLimitIntervalSec=120
StartLimitBurst=5

[Service]
Type=simple
User=$PANEL_USER
Group=$PANEL_USER
WorkingDirectory=$PANEL_DIR
ExecStart=$(which node) --max-old-space-size=$heap_mb src/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PANELKU_HOME=$PANEL_DIR
$HARDENING_BLOCK
MemoryHigh=$memory_high
MemoryMax=$memory_max
LimitNOFILE=65535
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable panelku 2>/dev/null || true
    systemctl restart panelku 2>/dev/null || systemctl start panelku
    log "Panelku service created and started (heap ${heap_mb}MB, MemoryMax ${memory_max})"
  else
    info "Starting panel with PM2..."
    pm2 start ecosystem.config.cjs --env production
    pm2 save
    log "Panel started with PM2"
  fi
}

setup_firewall() {
  if command -v ufw &>/dev/null; then
    ufw allow "$PANEL_PORT"/tcp comment 'Panelku' >/dev/null 2>&1 || true
    log "Firewall: port $PANEL_PORT opened"
  fi
}

print_banner
check_root
detect_os
install_dependencies
install_nodejs
install_pm2
setup_panel
setup_firewall

echo ""
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}  Panelku installed successfully!       ${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "  URL:      ${CYAN}http://$(hostname -I | awk '{print $1}'):$PANEL_PORT${NC}"
if [ -n "${NEW_ADMIN_PASSWORD:-}" ]; then
  echo -e "  Login:    ${YELLOW}admin${NC} / ${YELLOW}${NEW_ADMIN_PASSWORD}${NC}"
  echo -e "  ${RED}IMPORTANT: A password change is forced on first login.${NC}"
else
  echo -e "  Login:    use your existing admin credentials"
fi
echo ""
