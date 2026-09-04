import crypto from 'crypto';
import { getDb, generateId, now } from '../../core/db/sqlite.js';
import logger from '../../config/logger.js';
import dashboardService from '../dashboard/dashboard.service.js';

class ClusterService {
  constructor() {
    this._pairingTokens = new Map();
  }

  async getNodes() {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM cluster_nodes ORDER BY created_at DESC').all();
    return rows.map(r => ({
      id:        r.id,
      name:      r.name,
      ipAddress: r.ip_address,
      port:      r.port,
      apiKey:    r.api_key,
      status:    r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  /**
   * Build the base URL for a node.
   */
  _buildBaseUrl(node) {
    const host = node.ip_address || node.ipAddress;
    const port = parseInt(node.port, 10);

    if (!port || port === 443) return `https://${host}`;
    if (port === 80) return `http://${host}`;
    return `http://${host}:${port}`;
  }

  async addNode(name, ipAddress, port, apiKey) {
    const db = getDb();
    const id = generateId();
    const timestamp = now();
    const portVal = port ? (parseInt(port, 10) || 0) : 0;

    try {
      db.prepare(`
        INSERT INTO cluster_nodes (id, name, ip_address, port, api_key, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'offline', ?, ?)
      `).run(id, name, ipAddress, portVal, apiKey, timestamp, timestamp);

      this.pingNode(id).catch(() => {});
      return { id, name, ipAddress, port: portVal, apiKey, status: 'offline' };
    } catch (err) {
      logger.error(`Failed to add cluster node: ${err.message}`);
      throw new Error(err.message.includes('UNIQUE') ? 'Node name must be unique' : 'Failed to add node');
    }
  }

  async deleteNode(id) {
    const db = getDb();
    const result = db.prepare('DELETE FROM cluster_nodes WHERE id = ?').run(id);
    if (result.changes === 0) throw new Error('Node not found');
    return true;
  }

  async pingNode(id) {
    const db = getDb();
    const node = db.prepare('SELECT * FROM cluster_nodes WHERE id = ?').get(id);
    if (!node) throw new Error('Node not found');

    let status = 'offline';
    try {
      const baseUrl = this._buildBaseUrl(node);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(`${baseUrl}/api/agent/health`, {
        method: 'GET',
        headers: { 'X-API-Key': node.api_key, 'Accept': 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.success || data.status === 'online' || data.status === 'ok') {
          status = 'online';
        }
      }
    } catch {
      status = 'offline';
    }

    db.prepare('UPDATE cluster_nodes SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, now(), id);

    return status;
  }

  async getNodeMetrics(id) {
    const db = getDb();
    const node = db.prepare('SELECT * FROM cluster_nodes WHERE id = ?').get(id);
    if (!node) throw new Error('Node not found');

    try {
      const baseUrl = this._buildBaseUrl(node);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const res = await fetch(`${baseUrl}/api/agent/metrics`, {
        method: 'GET',
        headers: { 'X-API-Key': node.api_key, 'Accept': 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) return null;
      const data = await res.json();
      return data?.data || null;
    } catch {
      return null;
    }
  }

  async pingAllNodes() {
    const db = getDb();
    const nodes = db.prepare('SELECT id FROM cluster_nodes').all();
    for (const node of nodes) {
      try { await this.pingNode(node.id); } catch (_) {}
    }
  }

  // ── 1-Click Pairing & Auto Registration ───────────────────────

  generatePairingToken(suggestedName = '') {
    // Purge expired tokens
    const nowTs = Date.now();
    for (const [t, meta] of this._pairingTokens.entries()) {
      if (meta.expiresAt < nowTs) this._pairingTokens.delete(t);
    }

    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = nowTs + (15 * 60 * 1000); // 15 mins TTL
    const cleanName = (suggestedName || `node-${crypto.randomBytes(3).toString('hex')}`).trim();

    this._pairingTokens.set(token, {
      token,
      suggestedName: cleanName,
      expiresAt,
    });

    return { token, suggestedName: cleanName, expiresAt };
  }

  async registerNodeByToken({ token, name, ipAddress, port, apiKey }) {
    if (!token || !this._pairingTokens.has(token)) {
      throw new Error('Invalid or expired pairing token');
    }

    const meta = this._pairingTokens.get(token);
    if (meta.expiresAt < Date.now()) {
      this._pairingTokens.delete(token);
      throw new Error('Pairing token has expired');
    }

    const nodeName = (name || meta.suggestedName || `agent-${Date.now()}`).trim();
    const node = await this.addNode(nodeName, ipAddress, port, apiKey);

    // Consume token (single-use)
    this._pairingTokens.delete(token);
    logger.info(`[Cluster] Node registered successfully via pairing token: ${nodeName} (${ipAddress})`);
    return node;
  }

  getAgentInstallScript(token, masterUrl) {
    const resolvedMasterUrl = masterUrl || ('http://' + (process.env.APP_HOST || '127.0.0.1') + ':23456');
    const resolvedToken = token || '';

    return `#!/usr/bin/env bash
# ==============================================================================
# Panelku Standalone Node & Distributed Cluster Agent 1-Click Installer
# ==============================================================================
set -e

MASTER_URL="${resolvedMasterUrl}"
PAIRING_TOKEN="${resolvedToken}"
AGENT_PORT="23456"
PANEL_DIR="/opt/panelku"
REPO_URL="https://github.com/kiramizuky/PanelKu.git"
NODE_VERSION="22"
NODE_NAME="$(hostname)"
IP_ADDR="$(curl -s -4 https://ifconfig.me 2>/dev/null || ip route get 1.1.1.1 2>/dev/null | awk '{print $7}' || hostname -I | awk '{print $1}')"
API_KEY="lp_$(openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9')"

echo "========================================================"
echo "  🚀 Installing Panelku Standalone Node & Cluster Agent"
echo "  Master Server : $MASTER_URL"
echo "  Node Name     : $NODE_NAME"
echo "  Public IP     : $IP_ADDR"
echo "  Panel Port    : $AGENT_PORT"
echo "  Install Dir   : $PANEL_DIR"
echo "========================================================"

# Check root privilege
if [ "$EUID" -ne 0 ]; then
  echo "❌ Error: Please run this script with sudo or as root."
  exit 1
fi

# Detect package manager
PM="apt"
if command -v apt-get &>/dev/null; then
  PM="apt"
elif command -v pacman &>/dev/null; then
  PM="pacman"
elif command -v dnf &>/dev/null; then
  PM="dnf"
elif command -v yum &>/dev/null; then
  PM="yum"
elif command -v zypper &>/dev/null; then
  PM="zypper"
fi

echo "📦 Installing system dependencies..."
case "$PM" in
  apt)
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl git build-essential python3 make g++ ufw tar xz-utils 2>/dev/null || true
    ;;
  dnf|yum)
    $PM makecache || true
    $PM install -y curl git python3 make gcc-c++ ufw tar xz 2>/dev/null || true
    ;;
  pacman)
    pacman -Sy --noconfirm curl git base-devel python make gcc ufw tar xz 2>/dev/null || true
    ;;
  *)
    echo "⚠️ Proceeding with existing system tools..."
    ;;
esac

# Ensure Node.js >= 20 is installed
NEED_NODE=true
if command -v node &>/dev/null; then
  CURR_NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
  if [ "$CURR_NODE_VER" -ge 20 ]; then
    NEED_NODE=false
    echo "✓ Node.js $(node -v) is already installed."
  fi
fi

if [ "$NEED_NODE" = true ]; then
  echo "📦 Installing Node.js $NODE_VERSION LTS..."
  if [ "$PM" = "apt" ]; then
    curl -fsSL "https://deb.nodesource.com/setup_$NODE_VERSION.x" | bash -
    apt-get install -y nodejs
  elif [ "$PM" = "dnf" ] || [ "$PM" = "yum" ]; then
    curl -fsSL "https://rpm.nodesource.com/setup_$NODE_VERSION.x" | bash -
    $PM install -y nodejs
  fi
fi

# Clone or update Panelku in $PANEL_DIR
echo "📥 Setting up Panelku in $PANEL_DIR..."
mkdir -p "$PANEL_DIR"

if [ -d "$PANEL_DIR/.git" ]; then
  echo "✓ Existing git repository found. Updating codebase..."
  cd "$PANEL_DIR"
  git fetch --all 2>/dev/null || true
  git reset --hard origin/main 2>/dev/null || git pull 2>/dev/null || true
elif [ -f "$PANEL_DIR/package.json" ]; then
  echo "✓ Panelku files found in $PANEL_DIR."
  cd "$PANEL_DIR"
else
  echo "✓ Cloning Panelku repository..."
  git clone "$REPO_URL" "$PANEL_DIR"
  cd "$PANEL_DIR"
fi

# Setup directories and environment
echo "⚙️ Configuring environment and storage..."
mkdir -p storage/logs storage/backups storage/websites storage/uploads storage/temp storage/snapshots
chmod -R 750 storage 2>/dev/null || true

if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
  else
    touch .env
  fi
  APP_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9')
  JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9')
  JWT_REFRESH_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9')

  sed -i "s/change_this_to_a_very_long_random_secret_string/$APP_SECRET/g" .env 2>/dev/null || true
  sed -i "s/change_this_jwt_secret_very_long_random_string/$JWT_SECRET/g" .env 2>/dev/null || true
  sed -i "s/change_this_refresh_secret_very_long_random/$JWT_REFRESH_SECRET/g" .env 2>/dev/null || true
fi

# Install dependencies
echo "📦 Installing npm dependencies (production)..."
npm install --production --no-audit --no-fund -q
npm rebuild better-sqlite3 2>/dev/null || true
npm rebuild node-pty 2>/dev/null || true

# Initialize database and bind Agent API key
echo "🔑 Initializing database & configuring Agent API Key..."
node scripts/setup-agent-node.js "$API_KEY"

# Setup and start systemd service
echo "🚀 Configuring systemd service (panelku.service)..."
NODE_BIN=$(which node)
cat > /etc/systemd/system/panelku.service << EOF
[Unit]
Description=Panelku Linux Control Panel
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$PANEL_DIR
ExecStart=$NODE_BIN --max-old-space-size=512 src/server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
LimitNOFILE=65535
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable panelku 2>/dev/null || true
systemctl restart panelku 2>/dev/null || systemctl start panelku

# Open port in firewall if ufw exists
if command -v ufw &>/dev/null; then
  ufw allow "$AGENT_PORT"/tcp comment 'Panelku' >/dev/null 2>&1 || true
fi

# Local health probe check
echo "⏳ Waiting for Panelku service to become healthy..."
MAX_TRIES=15
HEALTH_OK=false
for i in $(seq 1 $MAX_TRIES); do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "X-API-Key: $API_KEY" "http://127.0.0.1:$AGENT_PORT/api/agent/health" 2>/dev/null || true)
  if [ "$HTTP_CODE" = "200" ]; then
    HEALTH_OK=true
    break
  fi
  sleep 2
done

if [ "$HEALTH_OK" = true ]; then
  echo "✓ Local Panelku service verified (HTTP 200 OK)."
else
  echo "⚠️ Warning: Service is taking longer to start on port $AGENT_PORT."
fi

# Register with Master Panel
echo "🔗 Registering node to Master Panel ($MASTER_URL)..."
REG_STATUS=$(curl -s -X POST "$MASTER_URL/api/cluster/register-token" \\
  -H "Content-Type: application/json" \\
  -d "{\\"token\\":\\"$PAIRING_TOKEN\\",\\"name\\":\\"$NODE_NAME\\",\\"ipAddress\\":\\"$IP_ADDR\\",\\"port\\":$AGENT_PORT,\\"apiKey\\":\\"$API_KEY\\"}")

echo "Registration Response: $REG_STATUS"

echo "========================================================"
echo "  🎉 Panelku Node & Agent Installation Complete!"
echo "  ------------------------------------------------------"
echo "  🌐 Standalone Web UI : http://$IP_ADDR:$AGENT_PORT"
echo "  👤 Default Username  : admin"
echo "  🔑 Default Password  : Admin@123456"
echo "  ⚡ Master Cluster     : Paired to $MASTER_URL"
echo "========================================================"
`;
  }

  // ── Fleet Capacity & Metrics Aggregation ──────────────────────

  async getClusterFleetSummary() {
    const nodes = await this.getNodes();
    let totalCores = 0;
    let totalMemoryBytes = 0;
    let totalMemoryUsedBytes = 0;
    let totalDiskBytes = 0;
    let totalDiskUsedBytes = 0;
    let onlineNodes = 1; // Master is always 1

    // 1. Add Master node metrics
    try {
      const masterMetrics = await dashboardService.getMetrics();
      const cpu = masterMetrics.cpu || {};
      const mem = masterMetrics.memory || {};
      const disk = masterMetrics.disk?.[0] || {};

      totalCores += parseInt(cpu.cores, 10) || 4;
      totalMemoryBytes += mem.total || 0;
      totalMemoryUsedBytes += mem.used || 0;
      totalDiskBytes += disk.total || 0;
      totalDiskUsedBytes += disk.used || 0;
    } catch {
      totalCores += 4;
      totalMemoryBytes += 8 * 1024 * 1024 * 1024;
      totalMemoryUsedBytes += 2 * 1024 * 1024 * 1024;
    }

    // 2. Add remote Agent node metrics
    const fleetNodes = [];
    for (const node of nodes) {
      if (node.status === 'online') {
        onlineNodes += 1;
        const metrics = await this.getNodeMetrics(node.id);
        if (metrics) {
          const cpu = metrics.cpu || {};
          const mem = metrics.memory || {};
          const disk = metrics.disk?.[0] || {};

          totalCores += parseInt(cpu.cores, 10) || 2;
          totalMemoryBytes += mem.total || 0;
          totalMemoryUsedBytes += mem.used || 0;
          totalDiskBytes += disk.total || 0;
          totalDiskUsedBytes += disk.used || 0;

          fleetNodes.push({
            id: node.id,
            name: node.name,
            ipAddress: node.ipAddress,
            port: node.port,
            status: 'online',
            cpuUsage: cpu.usage || 0,
            memoryUsed: mem.used || 0,
            memoryTotal: mem.total || 0,
          });
          continue;
        }
      }
      fleetNodes.push({
        id: node.id,
        name: node.name,
        ipAddress: node.ipAddress,
        port: node.port,
        status: node.status,
        cpuUsage: 0,
        memoryUsed: 0,
        memoryTotal: 0,
      });
    }

    const totalNodes = nodes.length + 1; // including Master
    return {
      totalNodes,
      onlineNodes,
      offlineNodes: totalNodes - onlineNodes,
      totalCores,
      totalMemoryBytes,
      totalMemoryUsedBytes,
      totalDiskBytes,
      totalDiskUsedBytes,
      memoryUsedPercent: totalMemoryBytes > 0 ? Math.round((totalMemoryUsedBytes / totalMemoryBytes) * 100) : 0,
      diskUsedPercent: totalDiskBytes > 0 ? Math.round((totalDiskUsedBytes / totalDiskBytes) * 100) : 0,
      fleetNodes,
    };
  }

  // ── Distributed Remote Command Dispatcher ─────────────────────

  async executeRemoteCommand(nodeIds, command) {
    if (!command || typeof command !== 'string') {
      throw new Error('Command is required');
    }

    const db = getDb();
    let targetNodes = [];

    if (nodeIds === 'all' || (Array.isArray(nodeIds) && nodeIds.includes('all'))) {
      targetNodes = db.prepare('SELECT * FROM cluster_nodes').all();
    } else if (Array.isArray(nodeIds)) {
      targetNodes = db.prepare(`SELECT * FROM cluster_nodes WHERE id IN (${nodeIds.map(() => '?').join(',')})`).all(...nodeIds);
    }

    const results = [];

    // Also run on master if requested
    if (nodeIds === 'all' || (Array.isArray(nodeIds) && nodeIds.includes('master'))) {
      const startTime = Date.now();
      try {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        const { stdout, stderr } = await execAsync(command, { timeout: 30000 });
        results.push({
          nodeId: 'master',
          nodeName: 'Master Panel (Local)',
          status: 'success',
          exitCode: 0,
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          durationMs: Date.now() - startTime,
        });
      } catch (err) {
        results.push({
          nodeId: 'master',
          nodeName: 'Master Panel (Local)',
          status: 'failed',
          exitCode: err.code || 1,
          stdout: '',
          stderr: err.message,
          durationMs: Date.now() - startTime,
        });
      }
    }

    // Run parallel executions across remote agents
    const remotePromises = targetNodes.map(async (node) => {
      const startTime = Date.now();
      try {
        const baseUrl = this._buildBaseUrl(node);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 35000);

        const res = await fetch(`${baseUrl}/api/agent/exec`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': node.api_key,
          },
          body: JSON.stringify({ command, timeout: 30000 }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!res.ok) {
          return {
            nodeId: node.id,
            nodeName: node.name,
            status: 'failed',
            exitCode: res.status,
            stdout: '',
            stderr: `HTTP error: ${res.statusText}`,
            durationMs: Date.now() - startTime,
          };
        }

        const data = await res.json();
        const execData = data?.data || {};
        return {
          nodeId: node.id,
          nodeName: node.name,
          status: execData.exitCode === 0 ? 'success' : 'failed',
          exitCode: execData.exitCode ?? 0,
          stdout: execData.stdout || '',
          stderr: execData.stderr || '',
          durationMs: Date.now() - startTime,
        };
      } catch (err) {
        return {
          nodeId: node.id,
          nodeName: node.name,
          status: 'failed',
          exitCode: 1,
          stdout: '',
          stderr: `Connection failed: ${err.message}`,
          durationMs: Date.now() - startTime,
        };
      }
    });

    const remoteResults = await Promise.all(remotePromises);
    return results.concat(remoteResults);
  }
}

export default new ClusterService();
