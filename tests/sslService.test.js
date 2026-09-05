/**
 * SSLService & Nginx SSL Configuration Tests
 */
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { describe, test, expect } from '@jest/globals';
import { error as errorHelper, errorResponse } from '../src/helpers/response.js';
import sslService from '../src/modules/ssl/ssl.service.js';
import websiteService from '../src/modules/websites/websites.service.js';
import fs from 'fs/promises';
import path from 'path';

describe('Response Error Serialization Helper', () => {
  test('serializes standard Error object into a readable message string', () => {
    let capturedStatus = 0;
    let capturedBody = null;
    const mockRes = {
      status(code) {
        capturedStatus = code;
        return this;
      },
      json(body) {
        capturedBody = body;
        return this;
      }
    };

    errorResponse(mockRes, new Error('SSL challenge failed: port 80 blocked'), 500);

    expect(capturedStatus).toBe(500);
    expect(capturedBody).toBeDefined();
    expect(capturedBody.success).toBe(false);
    expect(capturedBody.message).toBe('SSL challenge failed: port 80 blocked');
    expect(typeof capturedBody.message).toBe('string');
    expect(capturedBody.message).not.toEqual({});
  });

  test('handles swapped arguments gracefully (statusCode first)', () => {
    let capturedStatus = 0;
    let capturedBody = null;
    const mockRes = {
      status(code) {
        capturedStatus = code;
        return this;
      },
      json(body) {
        capturedBody = body;
        return this;
      }
    };

    errorHelper(mockRes, 400, new Error('Invalid domain'));

    expect(capturedStatus).toBe(400);
    expect(capturedBody.message).toBe('Invalid domain');
  });
});

describe('SSLService — Input validation and Self-Signed generation', () => {
  test('rejects invalid or dangerous domain names', async () => {
    await expect(sslService.issueSelfSignedCertificate('example.com; rm -rf /')).rejects.toThrow();
    await expect(sslService.issueSelfSignedCertificate('')).rejects.toThrow();
    await expect(sslService.issueSelfSignedCertificate(null)).rejects.toThrow();
  });

  test('issues self-signed certificate for valid domain', async () => {
    const domain = 'testssl.local';
    const certData = await sslService.issueSelfSignedCertificate(domain);

    expect(certData).toBeDefined();
    expect(certData.certificate).toContain('fullchain.pem');
    expect(certData.privateKey).toContain('privkey.pem');
    expect(new Date(certData.expiresAt).getTime()).toBeGreaterThan(Date.now());

    // Verify files exist on disk
    const certStat = await fs.stat(certData.certificate);
    const keyStat = await fs.stat(certData.privateKey);
    expect(certStat.isFile()).toBe(true);
    expect(keyStat.isFile()).toBe(true);

    // Clean up
    await fs.rm(path.dirname(certData.certificate), { recursive: true, force: true });
  });
});

describe('WebsiteService — Nginx SSL Config Generator', () => {
  test('generates HTTPS 443 block and HTTP 80 redirect when SSL is enabled', async () => {
    const website = {
      domain: 'sslwebsite.test',
      aliases: ['www.sslwebsite.test'],
      type: 'static',
      rootDirectory: '/var/www/sslwebsite.test',
      ssl: {
        enabled: true,
        certificate: '/etc/nginx/ssl/sslwebsite.test/fullchain.pem',
        privateKey: '/etc/nginx/ssl/sslwebsite.test/privkey.pem'
      }
    };

    await websiteService.generateNginxConfig(website);

    const confFile = path.join(websiteService.nginxConfDir, 'sslwebsite.test.conf');
    const content = await fs.readFile(confFile, 'utf8');

    expect(content).toContain('listen 80;');
    expect(content).toContain('return 301 https://$host$request_uri;');
    expect(content).toContain('listen 443 ssl http2;');
    expect(content).toContain('ssl_certificate /etc/nginx/ssl/sslwebsite.test/fullchain.pem;');
    expect(content).toContain('ssl_certificate_key /etc/nginx/ssl/sslwebsite.test/privkey.pem;');

    // Clean up
    await fs.rm(confFile, { force: true });
  });

  test('includes high-priority ACME challenge block on proxy vhosts to avoid 404', async () => {
    const proxyWebsite = {
      domain: 'proxytest.local',
      type: 'proxy',
      port: 5678,
      ssl: { enabled: false }
    };

    await websiteService.generateNginxConfig(proxyWebsite);

    const confFile = path.join(websiteService.nginxConfDir, 'proxytest.local.conf');
    const content = await fs.readFile(confFile, 'utf8');

    expect(content).toContain('location ^~ /.well-known/acme-challenge/');
    expect(content).toContain('proxy_pass http://127.0.0.1:5678;');

    // Clean up
    await fs.rm(confFile, { force: true });
  });
});
