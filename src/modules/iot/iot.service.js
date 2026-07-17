import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';

const execAsync = promisify(exec);

class IotService {
  /**
   * Validate a port number.
   */
  _validatePort(port) {
    const p = parseInt(port);
    if (isNaN(p) || p < 1 || p > 65535) throw new Error('Invalid port number');
    return p;
  }

  /**
   * Validate a device/client ID — alphanumeric, hyphens, underscores only.
   */
  _validateId(id) {
    if (!id || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new Error('Invalid ID format');
    return id;
  }

  /**
   * Validate a topic filter — alphanumeric, /, +, #, -, _.
   */
  _validateTopic(topic) {
    if (!topic || topic.length > 256 || /[^a-zA-Z0-9_\/+#*-]/.test(topic)) {
      throw new Error('Invalid topic format');
    }
    return topic;
  }

  // ── MQTT Broker (Mosquitto) ──────────────────────────────

  async getMqttStatus() {
    try {
      const { stdout } = await execAsync('systemctl is-active mosquitto 2>/dev/null || echo "inactive"');
      const active = stdout.trim() === 'active';
      let version = null, port = 1883;

      try {
        const { stdout: ver } = await execAsync('mosquitto -h 2>/dev/null | head -1 || mosquitto_sub --version 2>/dev/null || echo ""');
        version = ver.trim() || null;
      } catch {}

      // Check if MQTT is listening
      try {
        const { stdout: listening } = await execAsync('ss -tlnp 2>/dev/null | grep 1883 || netstat -tlnp 2>/dev/null | grep 1883 || echo ""');
        if (listening.trim()) port = 1883;
      } catch {}

      let clientCount = 0;
      if (active) {
        try {
          const { stdout: clients } = await execAsync("mosquitto_sub -t '$SYS/broker/clients/total' -C 1 -W 2 2>/dev/null || echo '0'");
          clientCount = parseInt(clients.trim()) || 0;
        } catch {}
      }

      return { installed: !!version || active, active, version, port, clientCount };
    } catch { return { installed: false, active: false, version: null, port: 1883, clientCount: 0 }; }
  }

  async installMosquitto() {
    try {
      const { stdout } = await execAsync('sudo apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y mosquitto mosquitto-clients 2>&1 | tail -3');
      await execAsync('sudo systemctl enable mosquitto 2>/dev/null');
      await execAsync('sudo systemctl start mosquitto 2>/dev/null');
      return { success: true, log: stdout.trim() };
    } catch (err) {
      throw new Error('Mosquitto install failed: ' + err.message);
    }
  }

  async controlMosquitto(action) {
    if (!['start', 'stop', 'restart'].includes(action)) throw new Error('Invalid action');
    try {
      await execAsync(`sudo systemctl ${action} mosquitto 2>&1`);
      return { success: true };
    } catch (err) {
      throw new Error(`Failed to ${action} Mosquitto: ${err.message}`);
    }
  }

  async getMosquittoConfig() {
    try {
      const { stdout } = await execAsync('cat /etc/mosquitto/mosquitto.conf 2>/dev/null || echo ""');
      return stdout;
    } catch { return ''; }
  }

  async saveMosquittoConfig(content) {
    if (!content || content.length > 100000) throw new Error('Config too large');
    const tmpPath = '/tmp/panelku-mosquitto.tmp';
    try {
      // [SECURITY] Write to temp file using fs (NO shell interpolation)
      await fs.writeFile(tmpPath, content, 'utf8');

      // Copy using execFile with args array (no shell)
      await new Promise((resolve, reject) => {
        execFile('sudo', ['cp', tmpPath, '/etc/mosquitto/mosquitto.conf'], { timeout: 10000 }, (err) => {
          if (err) reject(new Error('Failed to copy config'));
          else resolve();
        });
      });

      // Restart Mosquitto
      await new Promise((resolve, reject) => {
        execFile('sudo', ['systemctl', 'restart', 'mosquitto'], { timeout: 15000 }, (err) => {
          if (err) reject(new Error('Failed to restart Mosquitto'));
          else resolve();
        });
      });

      await fs.unlink(tmpPath).catch(() => {});
      return { success: true };
    } catch (err) {
      await fs.unlink(tmpPath).catch(() => {});
      throw new Error('Failed to save config: ' + err.message);
    }
  }

  // ── MQTT Topics & Messages ───────────────────────────────

  async getMqttTopics() {
    try {
      const { stdout: _stdout } = await execAsync("mosquitto_sub -t '$SYS/broker/#'' -C 1 -W 1 2>/dev/null; echo ''");
      return { topics: [] };
    } catch { return { topics: [] }; }
  }

  async publishMessage(topic, message, qos = 0) {
    this._validateTopic(topic);
    const q = parseInt(qos);
    if (![0, 1, 2].includes(q)) throw new Error('QoS must be 0, 1, or 2');
    if (!message || message.length > 100000) throw new Error('Invalid message');

    try {
      await execAsync(`mosquitto_pub -t "${topic}" -m '${message.replace(/'/g, "'\\''")}' -q ${q} 2>/dev/null`);
      return { success: true, topic, qos: q };
    } catch (err) {
      throw new Error('Failed to publish: ' + err.message);
    }
  }

  // ── MQTT ACL & Users ─────────────────────────────────────

  async getMqttUsers() {
    try {
      const { stdout } = await execAsync('sudo cat /etc/mosquitto/passwd 2>/dev/null || echo ""');
      const users = stdout.split('\n').filter(l => l.trim()).map(l => ({
        username: l.split(':')[0] || l.trim(),
        hasPassword: l.includes(':'),
      }));
      return users;
    } catch { return []; }
  }

  async addMqttUser(username, password) {
    this._validateId(username);
    if (!password || password.length < 4) throw new Error('Password must be at least 4 characters');

    try {
      // [SECURITY] Use execFile with args array — no shell interpolation
      await new Promise((resolve, reject) => {
        execFile('sudo', ['mosquitto_passwd', '-b', '/etc/mosquitto/passwd', username, password], { timeout: 10000 }, (err) => {
          if (err) reject(new Error('Failed to add user'));
          else resolve();
        });
      });

      // Reload Mosquitto
      await new Promise((resolve, reject) => {
        execFile('sudo', ['systemctl', 'reload', 'mosquitto'], { timeout: 10000 }, (err) => {
          if (err) reject(new Error('Failed to reload Mosquitto'));
          else resolve();
        });
      });

      return { success: true, username };
    } catch (err) {
      throw new Error('Failed to add user: ' + err.message);
    }
  }

  async deleteMqttUser(username) {
    this._validateId(username);
    try {
      await execAsync(`sudo mosquitto_passwd -D /etc/mosquitto/passwd "${username}" 2>/dev/null`);
      await execAsync('sudo systemctl reload mosquitto 2>/dev/null');
      return { success: true, username };
    } catch (err) {
      throw new Error('Failed to delete user: ' + err.message);
    }
  }

  async getMqttAcl() {
    try {
      const { stdout } = await execAsync('sudo cat /etc/mosquitto/acl 2>/dev/null || sudo cat /etc/mosquitto/acl.conf 2>/dev/null || echo ""');
      return stdout;
    } catch { return ''; }
  }

  async saveMqttAcl(content) {
    if (!content || content.length > 100000) throw new Error('ACL too large');
    const tmpPath = '/tmp/panelku-acl.tmp';
    try {
      // [SECURITY] Write to temp file using fs (NO shell interpolation)
      await fs.writeFile(tmpPath, content, 'utf8');

      // Copy using execFile with args array (no shell)
      await new Promise((resolve, reject) => {
        execFile('sudo', ['cp', tmpPath, '/etc/mosquitto/acl'], { timeout: 10000 }, (err) => {
          if (err) reject(new Error('Failed to copy ACL'));
          else resolve();
        });
      });

      // Reload Mosquitto
      await new Promise((resolve, reject) => {
        execFile('sudo', ['systemctl', 'reload', 'mosquitto'], { timeout: 10000 }, (err) => {
          if (err) reject(new Error('Failed to reload Mosquitto'));
          else resolve();
        });
      });

      await fs.unlink(tmpPath).catch(() => {});
      return { success: true };
    } catch (err) {
      await fs.unlink(tmpPath).catch(() => {});
      throw new Error('Failed to save ACL: ' + err.message);
    }
  }

  // ── Home Assistant Integration ───────────────────────────

  async getHomeAssistantStatus() {
    try {
      const { stdout } = await execAsync('systemctl is-active home-assistant 2>/dev/null || docker ps --format "{{.Names}}" 2>/dev/null | grep -i homeassistant || echo "inactive"');
      const active = stdout.trim() !== 'inactive' && stdout.trim() !== '';
      let version = null, port = 8123;

      if (active) {
        try {
          const { stdout: listening } = await execAsync('ss -tlnp 2>/dev/null | grep 8123 || netstat -tlnp 2>/dev/null | grep 8123 || echo ""');
          if (!listening.trim()) port = null;
        } catch { port = null; }

        try {
          const { stdout: ver } = await execAsync('docker inspect homeassistant 2>/dev/null | grep -i "image" | head -1 || cat /var/lib/docker/containers/*/config.v2.json 2>/dev/null | grep -o "homeassistant/[^\"]*" | head -1 || echo ""');
          version = ver.trim() || null;
        } catch {}
      }

      return { installed: active, active, version, port };
    } catch { return { installed: false, active: false, version: null, port: 8123 }; }
  }

  async installHomeAssistant() {
    try {
      const { stdout } = await execAsync(
        'docker pull ghcr.io/home-assistant/home-assistant:stable 2>&1 && ' +
        'docker run -d --name homeassistant --restart unless-stopped ' +
        '-v /opt/homeassistant/config:/config ' +
        '--network host ' +
        'ghcr.io/home-assistant/home-assistant:stable 2>&1 | tail -3'
      );
      return { success: true, log: stdout.trim() };
    } catch (err) {
      throw new Error('Home Assistant install failed: ' + err.message);
    }
  }

  // ── Node-RED Integration ─────────────────────────────────

  async getNodeRedStatus() {
    try {
      const { stdout } = await execAsync('systemctl is-active nodered 2>/dev/null || docker ps --format "{{.Names}}" 2>/dev/null | grep -i nodered || echo "inactive"');
      const active = stdout.trim() !== 'inactive' && stdout.trim() !== '';
      let port = 1880;

      if (active) {
        try {
          const { stdout: listening } = await execAsync('ss -tlnp 2>/dev/null | grep 1880 || netstat -tlnp 2>/dev/null | grep 1880 || echo ""');
          if (!listening.trim()) port = null;
        } catch { port = null; }
      }

      return { installed: active, active, port };
    } catch { return { installed: false, active: false, port: 1880 }; }
  }

  async installNodeRed() {
    try {
      const { stdout } = await execAsync(
        'docker pull nodered/node-red:latest 2>&1 && ' +
        'docker run -d --name nodered --restart unless-stopped ' +
        '-p 1880:1880 ' +
        '-v /opt/nodered/data:/data ' +
        'nodered/node-red:latest 2>&1 | tail -3'
      );
      return { success: true, log: stdout.trim() };
    } catch (err) {
      throw new Error('Node-RED install failed: ' + err.message);
    }
  }

  // ── Device Discovery (Network Scan) ───────────────────────

  async discoverDevices(subnet = null) {
    if (subnet && !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/.test(subnet)) {
      throw new Error('Invalid subnet format (e.g. 192.168.1.0/24)');
    }

    try {
      const target = subnet || '192.168.1.0/24';
      const { stdout } = await execAsync(
        `nmap -sn ${target} -oG - 2>/dev/null | grep "Status: Up" -B 1 | grep "Host:" | awk '{print $2, $3}' | tr -d '()' || ` +
        `arp -a 2>/dev/null | head -20 || echo "No devices found"`
      );
      const devices = stdout.split('\n').filter(l => l.trim()).map(line => {
        const parts = line.trim().split(/\s+/);
        return { ip: parts[0] || '—', hostname: parts.slice(1).join(' ') || 'Unknown' };
      });
      return devices;
    } catch { return []; }
  }

  // ── Metrics ──────────────────────────────────────────────

  async getMetrics() {
    try {
      const { stdout } = await execAsync(
        "mosquitto_sub -t '$SYS/broker/messages/sent' -C 1 -W 1 2>/dev/null || echo '0'; " +
        "mosquitto_sub -t '$SYS/broker/bytes/sent' -C 1 -W 1 2>/dev/null || echo '0'"
      );
      const metrics = stdout.split('\n').filter(l => l.trim());
      return {
        messagesSent: parseInt(metrics[0]) || 0,
        bytesSent: parseInt(metrics[1]) || 0,
      };
    } catch { return { messagesSent: 0, bytesSent: 0 }; }
  }
}

export default new IotService();
