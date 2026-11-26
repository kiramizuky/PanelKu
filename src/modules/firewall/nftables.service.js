import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import logger from '../../config/logger.js';

const execFileAsync = promisify(execFile);

class NftablesService {
  async isAvailable() {
    if (process.platform === 'win32' || process.env.NODE_ENV === 'test') return false;
    try {
      await execFileAsync('nft', ['--version'], { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }

  async getStatus() {
    const available = await this.isAvailable();
    if (!available) {
      return {
        available: false,
        egressActive: false,
        ruleset: '',
        note: process.platform === 'win32' ? 'nftables is Linux-only' : 'nft binary not installed',
      };
    }

    try {
      const { stdout } = await execFileAsync('nft', ['list', 'ruleset'], { timeout: 5000 });
      const egressActive = stdout.includes('table inet panelku_egress');
      return { available: true, egressActive, ruleset: stdout };
    } catch (err) {
      return { available: true, egressActive: false, ruleset: '', error: err.message };
    }
  }

  _sanitizePorts(ports) {
    if (!Array.isArray(ports)) throw new Error('allowedPorts must be an array');
    const clean = [];
    for (const p of ports) {
      const n = parseInt(p, 10);
      if (!Number.isInteger(n) || n < 1 || n > 65535) {
        throw new Error(`Invalid port number: ${p}`);
      }
      clean.push(n);
    }
    return [...new Set(clean)];
  }

  /**
   * Build atomic nftables script for outbound/egress filtering (blocks reverse-shell ports).
   */
  buildEgressScript({ allowedTcpPorts = [53, 80, 443, 123], allowedUdpPorts = [53, 123] } = {}) {
    const tcp = this._sanitizePorts(allowedTcpPorts);
    const udp = this._sanitizePorts(allowedUdpPorts);

    return [
      'table inet panelku_egress',
      'delete table inet panelku_egress',
      'table inet panelku_egress {',
      '  chain output {',
      '    type filter hook output priority 0; policy drop;',
      '    oifname "lo" accept',
      '    ct state established,related accept',
      udp.length > 0 ? `    udp dport { ${udp.join(', ')} } accept` : null,
      tcp.length > 0 ? `    tcp dport { ${tcp.join(', ')} } accept` : null,
      '    counter log prefix "PANELKU-EGRESS-DROP: "',
      '  }',
      '}',
    ].filter(Boolean).join('\n') + '\n';
  }

  async _applyNftScript(script) {
    return new Promise((resolve, reject) => {
      const child = spawn('nft', ['-f', '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve(true);
        else reject(new Error(stderr.trim() || `nft exited with code ${code}`));
      });
      child.stdin.write(script);
      child.stdin.end();
    });
  }

  async enableEgressFilter(options = {}) {
    const script = this.buildEgressScript(options);
    if (process.platform === 'win32' || process.env.NODE_ENV === 'test') {
      return { applied: false, simulated: true, script };
    }
    await this._applyNftScript(script);
    logger.info('[nftables] Outbound egress filter enabled (panelku_egress)');
    return { applied: true, simulated: false, script };
  }

  async disableEgressFilter() {
    if (process.platform === 'win32' || process.env.NODE_ENV === 'test') {
      return { disabled: true, simulated: true };
    }
    await execFileAsync('nft', ['delete', 'table', 'inet', 'panelku_egress'], { timeout: 5000 }).catch(() => {});
    logger.info('[nftables] Outbound egress filter removed (panelku_egress)');
    return { disabled: true, simulated: false };
  }

  async addIngressRule({ port, protocol = 'tcp', action = 'accept' }) {
    const [safePort] = this._sanitizePorts([port]);
    const safeProto = ['tcp', 'udp'].includes(protocol) ? protocol : 'tcp';
    const safeAction = ['accept', 'drop', 'reject'].includes(action) ? action : 'accept';

    const script = [
      'table inet panelku_ingress {',
      '  chain input {',
      '    type filter hook input priority 0; policy accept;',
      `    ${safeProto} dport ${safePort} ${safeAction}`,
      '  }',
      '}',
    ].join('\n') + '\n';

    if (process.platform === 'win32' || process.env.NODE_ENV === 'test') {
      return { added: true, simulated: true, port: safePort, protocol: safeProto, action: safeAction };
    }
    await this._applyNftScript(script);
    return { added: true, simulated: false, port: safePort, protocol: safeProto, action: safeAction };
  }
}

export default new NftablesService();
