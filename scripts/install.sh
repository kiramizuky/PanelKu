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
PANEL_DIR="/opt/panelku"
PANEL_PORT=23456
NODE_VERSION=22

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
      apt-get update -qq
      apt-get install -y curl git build-essential python3 make g++ redis-server nginx docker.io ufw || {
        for pkg in curl git build-essential python3 make g++ redis-server nginx docker.io ufw; do
          apt-get install -y -qq "$pkg" || warn "Failed to install $pkg"
        done
      }
      ;;
    pacman)
      pacman -Sy --noconfirm
      pacman -S --noconfirm --needed curl git base-devel python make gcc redis nginx docker ufw || {
        for pkg in curl git base-devel python make gcc redis nginx docker ufw; do
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
      $cmd install -y curl git python3 make gcc-c++ redis nginx docker ufw || {
        for pkg in curl git python3 make gcc-c++ redis nginx docker ufw; do
          $cmd install -y "$pkg" || warn "Failed to install $pkg"
        done
      }
      ;;
    apk)
      apk update
      apk add curl git build-base g++ make python3 redis nginx docker ufw || {
        for pkg in curl git build-base g++ make python3 redis nginx docker ufw; do
          apk add "$pkg" || warn "Failed to install $pkg"
        done
      }
      ;;
    zypper)
      zypper refresh
      zypper install -y gcc gcc-c++ make python3 curl git redis nginx docker ufw || {
        for pkg in gcc gcc-c++ make python3 curl git redis nginx docker ufw; do
          zypper install -y "$pkg" || warn "Failed to install $pkg"
        done
      }
      ;;
    emerge)
      emerge --sync || true
      emerge -v net-misc/curl dev-vcs/git www-servers/nginx dev-db/redis sys-devel/make sys-devel/gcc app-containers/docker net-firewall/ufw || {
        for pkg in net-misc/curl dev-vcs/git www-servers/nginx dev-db/redis sys-devel/make sys-devel/gcc app-containers/docker net-firewall/ufw; do
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
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - && apt-get install -y nodejs && success=true
  elif [ "$PM" = "dnf" ] && [ "$IS_64BIT" = true ]; then
    curl -fsSL https://rpm.nodesource.com/setup_${NODE_VERSION}.x | bash - && dnf install -y nodejs && success=true
  fi

  if [ "$success" = false ]; then
    case "$PM" in
      apt) apt-get install -y nodejs npm && success=true ;;
      pacman) pacman -S --noconfirm --needed nodejs npm && success=true ;;
      dnf|yum) $PM install -y nodejs npm && success=true ;;
      apk) apk add nodejs npm && success=true ;;
      zypper) zypper install -y nodejs npm && success=true ;;
      emerge) emerge -v net-libs/nodejs && success=true ;;
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
      local temp_tar="/tmp/node.tar.xz"
      case "$PM" in
        apt) apt-get install -y tar xz-utils ;;
        pacman) pacman -S --noconfirm --needed tar xz ;;
        dnf|yum) $PM install -y tar xz ;;
        apk) apk add tar xz ;;
        zypper) zypper install -y tar xz ;;
      esac
      curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}.11.0/node-v${NODE_VERSION}.11.0-linux-${node_arch}.tar.xz" -o "$temp_tar" || \
        curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}.0.0/node-v${NODE_VERSION}.0.0-linux-${node_arch}.tar.xz" -o "$temp_tar"
      tar -xJf "$temp_tar" -C /usr/local --strip-components=1
      rm -f "$temp_tar"
    else
      error "No prebuilt Node.js binary fallback available for architecture $ARCH. Installation failed."
    fi
  fi
  log "Node.js $(node -v) ready"
}

install_pm2() {
  if ! command -v pm2 &>/dev/null; then
    info "Installing PM2..."
    npm install -g pm2 -q
    if command -v systemctl &>/dev/null; then
      pm2 startup systemd -u root --hp /root || true
    else
      pm2 startup || true
    fi
    log "PM2 installed"
  else
    log "PM2 already installed"
  fi
}

setup_panel() {
  info "Setting up Panelku in $PANEL_DIR..."
  mkdir -p "$PANEL_DIR"
  cp -r . "$PANEL_DIR/"
  cd "$PANEL_DIR"

  info "Setting up storage directories..."
  mkdir -p storage/logs storage/backups storage/websites storage/uploads storage/temp
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
    else
      sed -i "" "s/change_this_to_a_very_long_random_secret_string/$APP_SECRET/" .env
      sed -i "" "s/change_this_jwt_secret_very_long_random_string/$JWT_SECRET/" .env
      sed -i "" "s/change_this_refresh_secret_very_long_random/$JWT_REFRESH_SECRET/" .env
    fi
    log "Generated secure secrets"
  fi

  info "Installing npm packages..."
  npm install --production -q
  # [LOW-1 FIX] Rebuild native addons after npm install.
  # node-pty and better-sqlite3 are native modules that must match the running Node.js ABI.
  npm rebuild better-sqlite3
  npm rebuild node-pty

  # Create systemd service so 'systemctl restart panelku' works
  # [HIGH-4 FIX] Service name 'panelku' matches system.service.js restartPanel()
  if command -v systemctl &>/dev/null; then
    info "Creating systemd service: panelku..."
    cat > /etc/systemd/system/panelku.service << EOF
[Unit]
Description=Panelku Linux Control Panel
After=network.target redis.service
Wants=redis.service

[Service]
Type=simple
User=root
WorkingDirectory=$PANEL_DIR
ExecStart=$(which node) src/server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable panelku
    systemctl start panelku
    log "Panelku service created and started"
  else
    info "Starting panel with PM2..."
    pm2 start ecosystem.config.cjs --env production
    pm2 save
    log "Panel started with PM2"
  fi
}

setup_firewall() {
  if command -v ufw &>/dev/null; then
    ufw allow "$PANEL_PORT"/tcp comment 'Panelku' >/dev/null 2>&1
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
echo -e "  Login:    ${YELLOW}admin${NC} / ${YELLOW}Admin@123456${NC}"
echo -e "  ${RED}IMPORTANT: Change the default password!${NC}"
echo ""
