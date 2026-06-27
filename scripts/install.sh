#!/bin/bash
# ============================================================
# Linux Panel — One-Click Install Script
# Supports: Debian, Ubuntu, Armbian
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

PANEL_DIR="/opt/linux-panel"
PANEL_PORT=3000
NODE_VERSION=20

print_banner() {
  echo -e "${CYAN}"
  echo "  ██╗     ██╗███╗   ██╗██╗   ██╗██╗  ██╗"
  echo "  ██║     ██║████╗  ██║██║   ██║╚██╗██╔╝"
  echo "  ██║     ██║██╔██╗ ██║██║   ██║ ╚███╔╝ "
  echo "  ██║     ██║██║╚██╗██║██║   ██║ ██╔██╗ "
  echo "  ███████╗██║██║ ╚████║╚██████╔╝██╔╝ ██╗"
  echo "  ╚══════╝╚═╝╚═╝  ╚═══╝ ╚═════╝ ╚═╝  ╚═╝"
  echo "  PANEL — Linux Server Control Panel"
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
  [[ "$OS" != "ubuntu" && "$OS" != "debian" ]] && warn "Non-standard OS: $OS (may work anyway)"
}

install_dependencies() {
  info "Updating package list..."
  apt-get update -qq

  info "Installing dependencies..."
  apt-get install -y -qq curl git build-essential python3 make g++ redis-server nginx docker.io docker-compose ufw

  # Install acme.sh for SSL
  if [ ! -d ~/.acme.sh ]; then
    info "Installing acme.sh..."
    curl -s https://get.acme.sh | sh
    log "acme.sh installed"
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
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
  apt-get install -y -qq nodejs
  log "Node.js $(node -v) installed"
}

install_pm2() {
  if ! command -v pm2 &>/dev/null; then
    info "Installing PM2..."
    npm install -g pm2 -q
    pm2 startup systemd -u root --hp /root
    log "PM2 installed"
  else
    log "PM2 already installed"
  fi
}

setup_panel() {
  info "Setting up Linux Panel in $PANEL_DIR..."
  mkdir -p "$PANEL_DIR"
  cp -r . "$PANEL_DIR/"
  cd "$PANEL_DIR"

  info "Setting up storage directories..."
  mkdir -p storage/logs storage/backups storage/websites
  chmod -R 755 storage

  # Copy env
  if [ ! -f .env ]; then
    cp .env.example .env
    APP_SECRET=$(openssl rand -hex 32)
    JWT_SECRET=$(openssl rand -hex 32)
    JWT_REFRESH_SECRET=$(openssl rand -hex 32)
    sed -i "s/change_this_to_a_very_long_random_secret_string/$APP_SECRET/" .env
    sed -i "s/change_this_jwt_secret_very_long_random_string/$JWT_SECRET/" .env
    sed -i "s/change_this_refresh_secret_very_long_random/$JWT_REFRESH_SECRET/" .env
    log "Generated secure secrets"
  fi

  info "Setting up storage permissions..."
  mkdir -p storage
  chmod -R 777 storage


  info "Installing npm packages..."
  npm install --production -q
  npm rebuild better-sqlite3

  info "Starting panel with PM2..."
  pm2 start ecosystem.config.cjs --env production
  pm2 save
  log "Panel started"
}

setup_firewall() {
  if command -v ufw &>/dev/null; then
    ufw allow "$PANEL_PORT"/tcp comment 'Linux Panel' >/dev/null 2>&1
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
echo -e "${GREEN}  Linux Panel installed successfully!   ${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "  URL:      ${CYAN}http://$(hostname -I | awk '{print $1}'):$PANEL_PORT${NC}"
echo -e "  Login:    ${YELLOW}admin${NC} / ${YELLOW}Admin@123456${NC}"
echo -e "  ${RED}IMPORTANT: Change the default password!${NC}"
echo ""
