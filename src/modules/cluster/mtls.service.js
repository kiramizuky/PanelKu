import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import logger from '../../config/logger.js';
import { getStorageDir } from '../../config/paths.js';

const execFileAsync = promisify(execFile);

class MtlsService {
  getCertsDir() {
    return path.join(getStorageDir(), 'certs', 'cluster');
  }

  _paths() {
    const dir = this.getCertsDir();
    return {
      dir,
      caKey: path.join(dir, 'ca.key'),
      caCert: path.join(dir, 'ca.crt'),
      masterKey: path.join(dir, 'master-client.key'),
      masterCert: path.join(dir, 'master-client.crt'),
      nodesDir: path.join(dir, 'nodes'),
    };
  }

  isInitialized() {
    const p = this._paths();
    return fs.existsSync(p.caCert) && fs.existsSync(p.caKey) && fs.existsSync(p.masterCert) && fs.existsSync(p.masterKey);
  }

  /**
   * Initialize the internal PanelKu Root CA and Master Client mTLS certificate.
   * Uses openssl CLI when available.
   */
  async initCA() {
    const p = this._paths();
    fs.mkdirSync(p.dir, { recursive: true, mode: 0o750 });
    fs.mkdirSync(p.nodesDir, { recursive: true, mode: 0o750 });

    if (this.isInitialized()) {
      return this.getStatus();
    }

    // Generate Root CA key & self-signed X.509 certificate (10 years)
    await execFileAsync('openssl', [
      'req', '-x509', '-new', '-nodes',
      '-newkey', 'rsa:4096',
      '-keyout', p.caKey,
      '-out', p.caCert,
      '-days', '3650',
      '-subj', '/CN=PanelKu-Internal-Cluster-CA/O=PanelKu',
    ], { timeout: 15000 });
    fs.chmodSync(p.caKey, 0o600);

    // Generate Master Client key + CSR + signed certificate
    const csrPath = path.join(p.dir, 'master-client.csr');
    await execFileAsync('openssl', [
      'req', '-new', '-nodes',
      '-newkey', 'rsa:2048',
      '-keyout', p.masterKey,
      '-out', csrPath,
      '-subj', '/CN=panelku-master-client/O=PanelKu',
    ], { timeout: 15000 });
    fs.chmodSync(p.masterKey, 0o600);

    await execFileAsync('openssl', [
      'x509', '-req',
      '-in', csrPath,
      '-CA', p.caCert,
      '-CAkey', p.caKey,
      '-CAcreateserial',
      '-out', p.masterCert,
      '-days', '825',
    ], { timeout: 15000 });

    try { fs.unlinkSync(csrPath); } catch {}
    logger.info('[Cluster-mTLS] Initialized internal PanelKu Root CA & Master Client cert');
    return this.getStatus();
  }

  /**
   * Issue a signed mTLS certificate for a specific Cluster Agent node.
   */
  async issueNodeCert(nodeId, hostOrIp) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(String(nodeId || ''))) {
      throw new Error('Invalid nodeId');
    }
    if (!this.isInitialized()) {
      await this.initCA();
    }

    const p = this._paths();
    const keyPath = path.join(p.nodesDir, `${nodeId}.key`);
    const csrPath = path.join(p.nodesDir, `${nodeId}.csr`);
    const extPath = path.join(p.nodesDir, `${nodeId}.ext`);
    const certPath = path.join(p.nodesDir, `${nodeId}.crt`);

    const safeHost = String(hostOrIp || '127.0.0.1').replace(/[^a-zA-Z0-9.:_-]/g, '');
    const isIp = /^[0-9.]+$/.test(safeHost) || safeHost.includes(':');
    const sanLine = isIp ? `subjectAltName=IP:${safeHost}` : `subjectAltName=DNS:${safeHost}`;

    fs.writeFileSync(extPath, `${sanLine}\nextendedKeyUsage=serverAuth,clientAuth\n`, 'utf8');

    await execFileAsync('openssl', [
      'req', '-new', '-nodes',
      '-newkey', 'rsa:2048',
      '-keyout', keyPath,
      '-out', csrPath,
      '-subj', `/CN=${safeHost}/O=PanelKu-Agent`,
    ], { timeout: 15000 });
    fs.chmodSync(keyPath, 0o600);

    await execFileAsync('openssl', [
      'x509', '-req',
      '-in', csrPath,
      '-CA', p.caCert,
      '-CAkey', p.caKey,
      '-CAcreateserial',
      '-out', certPath,
      '-days', '825',
      '-extfile', extPath,
    ], { timeout: 15000 });

    try {
      fs.unlinkSync(csrPath);
      fs.unlinkSync(extPath);
    } catch {}

    return {
      nodeId,
      cert: fs.readFileSync(certPath, 'utf8'),
      key: fs.readFileSync(keyPath, 'utf8'),
      ca: fs.readFileSync(p.caCert, 'utf8'),
    };
  }

  /**
   * Verify a node certificate PEM against the PanelKu internal Root CA.
   */
  verifyNodeCert(certPem) {
    const p = this._paths();
    if (!fs.existsSync(p.caCert)) {
      return { valid: false, reason: 'Internal CA not initialized' };
    }
    try {
      const caX509 = new crypto.X509Certificate(fs.readFileSync(p.caCert));
      const nodeX509 = new crypto.X509Certificate(certPem);
      const issuedByCa = nodeX509.checkIssued(caX509);
      const signatureValid = nodeX509.verify(caX509.publicKey);
      const now = Date.now();
      const notBefore = Date.parse(nodeX509.validFrom);
      const notAfter = Date.parse(nodeX509.validTo);
      const withinDates = now >= notBefore && now <= notAfter;

      return {
        valid: issuedByCa && signatureValid && withinDates,
        subject: nodeX509.subject,
        validTo: nodeX509.validTo,
      };
    } catch (err) {
      return { valid: false, reason: err.message };
    }
  }

  /**
   * Return TLS options for WebSocket / HTTPS connections to cluster agent nodes.
   * Enforces strict mTLS verification whenever PanelKu CA is initialized.
   */
  getWsTlsOptions() {
    const p = this._paths();
    if (this.isInitialized()) {
      return {
        ca: fs.readFileSync(p.caCert),
        cert: fs.readFileSync(p.masterCert),
        key: fs.readFileSync(p.masterKey),
        rejectUnauthorized: true,
      };
    }
    return {
      rejectUnauthorized: process.env.AGENT_TLS_STRICT === 'true',
    };
  }

  getStatus() {
    const p = this._paths();
    const initialized = this.isInitialized();
    let caSubject = null;
    let caValidTo = null;
    if (initialized) {
      try {
        const ca = new crypto.X509Certificate(fs.readFileSync(p.caCert));
        caSubject = ca.subject;
        caValidTo = ca.validTo;
      } catch {}
    }
    const issuedNodes = fs.existsSync(p.nodesDir)
      ? fs.readdirSync(p.nodesDir).filter((f) => f.endsWith('.crt')).map((f) => f.replace(/\.crt$/, ''))
      : [];

    return {
      initialized,
      caSubject,
      caValidTo,
      issuedNodes,
    };
  }
}

export default new MtlsService();
