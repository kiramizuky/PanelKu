/**
 * Extended Unit Tests for SSL Module:
 * - src/modules/ssl/ssl.service.js
 * - src/modules/ssl/ssl.controller.js
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import path from 'path';

let mockExecFileHandler = null;

jest.unstable_mockModule('child_process', () => ({
  execFile: jest.fn((file, args, opts, cb) => {
    const callback = typeof opts === 'function' ? opts : cb;
    if (mockExecFileHandler) {
      const res = mockExecFileHandler(file, args);
      if (res instanceof Error) return callback(res);
      return callback(null, res || { stdout: '', stderr: '' });
    }
    return callback(null, { stdout: '', stderr: '' });
  }),
  exec: jest.fn((cmd, opts, cb) => {
    const callback = typeof opts === 'function' ? opts : cb;
    return callback(null, { stdout: '', stderr: '' });
  }),
}));

const mockFs = {
  access: jest.fn(),
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  rm: jest.fn().mockResolvedValue(undefined),
};

jest.unstable_mockModule('fs/promises', () => ({
  default: mockFs,
  ...mockFs,
}));

const mockWebsiteModel = {
  find: jest.fn(),
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn(),
};

jest.unstable_mockModule('../src/models/Website.js', () => ({
  default: mockWebsiteModel,
}));

const mockWebsiteService = {
  generateNginxConfig: jest.fn().mockResolvedValue(undefined),
  nginxConfDir: path.join(process.cwd(), 'temp-conf'),
};

jest.unstable_mockModule('../src/modules/websites/websites.service.js', () => ({
  default: mockWebsiteService,
  ACME_CHALLENGE_DIR: '/var/www/acme-challenge',
}));

const { default: sslService } = await import('../src/modules/ssl/ssl.service.js');
const { default: sslController } = await import('../src/modules/ssl/ssl.controller.js');

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

beforeEach(() => {
  mockExecFileHandler = null;
  jest.clearAllMocks();
});

describe('SSLService — Acme.sh Discovery & Lifecycle', () => {
  test('getAcmeShPath finds binary from environment variable or candidates', async () => {
    process.env.ACME_SH_PATH = '/custom/path/acme.sh';
    mockFs.access.mockResolvedValueOnce(undefined);

    const detected = await sslService.getAcmeShPath();
    expect(detected).toBe('/custom/path/acme.sh');
    delete process.env.ACME_SH_PATH;

    // Fallback search through candidate list
    mockFs.access.mockRejectedValueOnce(new Error('no access'))
      .mockResolvedValueOnce(undefined);
    const candidatePath = await sslService.getAcmeShPath();
    expect(candidatePath).toContain('acme.sh');
  });

  test('installAcmeSh returns existing if already found', async () => {
    jest.spyOn(sslService, 'getAcmeShPath').mockResolvedValueOnce('/usr/local/bin/acme.sh');
    const pathFound = await sslService.installAcmeSh();
    expect(pathFound).toBe('/usr/local/bin/acme.sh');
  });
});

describe('SSLService — Issue & Custom Certificate', () => {
  test('issueCertificate validates input domain and path', async () => {
    await expect(sslService.issueCertificate('')).rejects.toThrow('Domain is required');
    await expect(sslService.issueCertificate('test.com; rm -rf')).rejects.toThrow('Invalid domain name');
    await expect(sslService.issueCertificate('example.com', 'bad/path/with/|pipe')).rejects.toThrow('Invalid path');
  });

  test('issueCertificate successfully issues cert with acme.sh and parses expiry', async () => {
    jest.spyOn(sslService, 'installAcmeSh').mockResolvedValue('/root/.acme.sh/acme.sh');

    mockExecFileHandler = (file, args) => {
      if (file.includes('acme.sh') && args.includes('--issue')) {
        return { stdout: 'Cert success', stderr: '' };
      }
      if (file.includes('acme.sh') && args.includes('--install-cert')) {
        return { stdout: 'Install success', stderr: '' };
      }
      if (file === 'openssl' && args.includes('x509')) {
        return { stdout: 'notAfter=Dec 31 23:59:59 2026 GMT\n', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    };

    const certData = await sslService.issueCertificate('panel.example.com', '/var/www/acme', true);
    expect(certData.certificate).toContain('fullchain.pem');
    expect(certData.privateKey).toContain('privkey.pem');
    expect(certData.expiresAt).toBeDefined();
  });

  test('issueCertificate handles already-issued domain gracefully', async () => {
    jest.spyOn(sslService, 'installAcmeSh').mockResolvedValue('/root/.acme.sh/acme.sh');

    mockExecFileHandler = (file, args) => {
      if (file.includes('acme.sh') && args.includes('--issue')) {
        const err = new Error('Command failed');
        err.stdout = 'Domains not changed. Skipping...';
        return err;
      }
      return { stdout: '', stderr: '' };
    };

    const certData = await sslService.issueCertificate('panel.example.com');
    expect(certData.certificate).toContain('fullchain.pem');
  });

  test('issueCertificate throws descriptive error when Let\'s Encrypt verification fails', async () => {
    jest.spyOn(sslService, 'installAcmeSh').mockResolvedValue('/root/.acme.sh/acme.sh');

    mockExecFileHandler = (file, args) => {
      if (file.includes('acme.sh') && args.includes('--issue')) {
        const err = new Error('Verification error');
        err.stderr = 'Timeout during connect (likely firewall problem)';
        return err;
      }
      return { stdout: '', stderr: '' };
    };

    await expect(sslService.issueCertificate('unreachable.com')).rejects.toThrow("Let's Encrypt validation failed");
  });

  test('saveCustomCertificate stores fullchain and privkey files', async () => {
    await expect(sslService.saveCustomCertificate('valid.com', '', 'key')).rejects.toThrow('Both Certificate and Private Key content are required');

    const res = await sslService.saveCustomCertificate(
      'custom.domain.com',
      '-----BEGIN CERTIFICATE-----\nMIIB...',
      '-----BEGIN PRIVATE KEY-----\nMIIE...'
    );

    expect(res.certificate).toContain('fullchain.pem');
    expect(res.privateKey).toContain('privkey.pem');
    expect(mockFs.writeFile).toHaveBeenCalledTimes(2);
  });
});

describe('SSLService — configureWebsiteSSL and disableWebsiteSSL', () => {
  const fakeWebsite = {
    _id: 'web123',
    domain: 'mywebsite.org',
    ssl: { enabled: false },
  };

  test('configureWebsiteSSL handles selfsigned, custom, and letsencrypt providers', async () => {
    mockWebsiteModel.findById.mockResolvedValue(fakeWebsite);

    // 1. Selfsigned
    jest.spyOn(sslService, 'issueSelfSignedCertificate').mockResolvedValue({
      certificate: '/ssl/fullchain.pem',
      privateKey: '/ssl/privkey.pem',
      expiresAt: '2027-01-01T00:00:00.000Z',
    });

    await sslService.configureWebsiteSSL('web123', 'selfsigned');
    expect(mockWebsiteModel.findByIdAndUpdate).toHaveBeenCalledWith(
      'web123',
      expect.objectContaining({
        ssl: expect.objectContaining({ provider: 'selfsigned', enabled: true }),
      })
    );
    expect(mockWebsiteService.generateNginxConfig).toHaveBeenCalled();

    // 2. Custom
    await expect(
      sslService.configureWebsiteSSL('web123', 'custom', null)
    ).rejects.toThrow('Certificate and private key are required for custom SSL');

    jest.spyOn(sslService, 'saveCustomCertificate').mockResolvedValue({
      certificate: '/ssl/custom.pem',
      privateKey: '/ssl/custom.key',
      expiresAt: '2027-01-01T00:00:00.000Z',
    });

    await sslService.configureWebsiteSSL('web123', 'custom', { certificate: 'cert', privateKey: 'key' });
    expect(mockWebsiteModel.findByIdAndUpdate).toHaveBeenCalledWith(
      'web123',
      expect.objectContaining({
        ssl: expect.objectContaining({ provider: 'custom' }),
      })
    );

    // 3. Let's Encrypt
    jest.spyOn(sslService, 'issueCertificate').mockResolvedValue({
      certificate: '/ssl/le.pem',
      privateKey: '/ssl/le.key',
      expiresAt: '2026-12-31T00:00:00.000Z',
    });

    await sslService.configureWebsiteSSL('web123', 'letsencrypt');
    expect(mockWebsiteModel.findByIdAndUpdate).toHaveBeenCalledWith(
      'web123',
      expect.objectContaining({
        ssl: expect.objectContaining({ provider: 'letsencrypt' }),
      })
    );
  });

  test('configureWebsiteSSL throws error when website does not exist', async () => {
    mockWebsiteModel.findById.mockResolvedValue(null);
    await expect(sslService.configureWebsiteSSL('not-found')).rejects.toThrow('Website not found');
  });

  test('disableWebsiteSSL updates website record and triggers nginx reconfiguration', async () => {
    mockWebsiteModel.findById.mockResolvedValue({ ...fakeWebsite, ssl: { enabled: true } });

    await sslService.disableWebsiteSSL('web123');
    expect(mockWebsiteModel.findByIdAndUpdate).toHaveBeenCalledWith(
      'web123',
      { ssl: { enabled: false } }
    );
    expect(mockWebsiteService.generateNginxConfig).toHaveBeenCalled();

    mockWebsiteModel.findById.mockResolvedValue(null);
    await expect(sslService.disableWebsiteSSL('not-found')).rejects.toThrow('Website not found');
  });
});

describe('SSLController — Endpoints', () => {
  test('listCertificates filters websites with active SSL', async () => {
    mockWebsiteModel.find.mockResolvedValue([
      { _id: '1', domain: 'a.com', ssl: { enabled: true, provider: 'letsencrypt' } },
      { _id: '2', domain: 'b.com', ssl: { enabled: false } },
      { _id: '3', domain: 'c.com' },
    ]);

    const res = mockRes();
    await sslController.listCertificates({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].domain).toBe('a.com');
  });

  test('issueCertificate validates websiteId and calls service', async () => {
    const resErr = mockRes();
    await sslController.issueCertificate({ body: {} }, resErr);
    expect(resErr.statusCode).toBe(400);

    const resOk = mockRes();
    jest.spyOn(sslService, 'configureWebsiteSSL').mockResolvedValue({ domain: 'test.com', ssl: { enabled: true } });
    await sslController.issueCertificate({ body: { websiteId: 'w1', provider: 'selfsigned' } }, resOk);
    expect(resOk.statusCode).toBe(200);
    expect(resOk.body.data.domain).toBe('test.com');
  });

  test('renewCertificate handles 404 and successful renewal', async () => {
    mockWebsiteModel.findById.mockResolvedValue(null);
    const res404 = mockRes();
    await sslController.renewCertificate({ params: { websiteId: 'w404' } }, res404);
    expect(res404.statusCode).toBe(404);

    mockWebsiteModel.findById.mockResolvedValue({ _id: 'w1', ssl: { provider: 'letsencrypt' } });
    jest.spyOn(sslService, 'configureWebsiteSSL').mockResolvedValue({ _id: 'w1', ssl: { enabled: true } });
    const resOk = mockRes();
    await sslController.renewCertificate({ params: { websiteId: 'w1' } }, resOk);
    expect(resOk.statusCode).toBe(200);
  });

  test('disableCertificate and getCertificate endpoints', async () => {
    const resErr = mockRes();
    await sslController.disableCertificate({ params: {}, body: {} }, resErr);
    expect(resErr.statusCode).toBe(400);

    jest.spyOn(sslService, 'disableWebsiteSSL').mockResolvedValue({ _id: 'w1', ssl: { enabled: false } });
    const resDis = mockRes();
    await sslController.disableCertificate({ params: { websiteId: 'w1' } }, resDis);
    expect(resDis.statusCode).toBe(200);

    mockWebsiteModel.findById.mockResolvedValue({ domain: 'site.com', ssl: { enabled: true } });
    const resGet = mockRes();
    await sslController.getCertificate({ params: { websiteId: 'w1' } }, resGet);
    expect(resGet.statusCode).toBe(200);
    expect(resGet.body.data.domain).toBe('site.com');
  });
});
