/**
 * Tests for Visual Docker Compose Studio & Auto HTTPS Reverse Proxy Integration
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

// Mock external deps
jest.unstable_mockModule('dockerode', () => ({
  default: jest.fn().mockReturnValue({
    listContainers: jest.fn(async () => [
      {
        Id: 'c123456789012',
        Names: ['/my-stack_web_1'],
        Image: 'nginx:alpine',
        State: 'running',
        Status: 'Up 2 hours',
        Ports: [{ PublicPort: 8080, PrivatePort: 80, Type: 'tcp' }],
        Created: 1700000000,
      }
    ]),
  }),
}));

jest.unstable_mockModule('../src/config/logger.js', () => ({
  default: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.unstable_mockModule('../src/modules/system/package-manager.js', () => ({
  default: { init: jest.fn(async () => {}), pmType: 'apt' },
}));

jest.unstable_mockModule('../src/modules/websites/websites.service.js', () => ({
  default: {
    createWebsite: jest.fn(async (data) => ({
      id: 'web-123',
      domain: data.domain,
      type: data.type,
      port: data.port,
    })),
  },
}));

jest.unstable_mockModule('fs/promises', () => ({
  default: {
    mkdir: jest.fn(async () => {}),
    writeFile: jest.fn(async () => {}),
    readFile: jest.fn(async () => `version: '3.8'
services:
  web:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "8080:80"
    environment:
      - NODE_ENV=production
    volumes:
      - ./html:/usr/share/nginx/html
`),
    readdir: jest.fn(async () => [
      { name: 'my-stack', isDirectory: () => true }
    ]),
    rm: jest.fn(async () => {}),
  },
}));

jest.unstable_mockModule('child_process', () => ({
  exec: jest.fn((cmd, ...rest) => {
    const cb = rest.pop();
    if (typeof cb !== 'function') return;
    cb(null, { stdout: 'done', stderr: '' });
  }),
}));

const {
  default: dockerService,
  parseComposeServices,
  generateComposeYaml,
  validateProjectName,
} = await import('../src/modules/docker/docker.service.js');

const { default: dockerController } = await import('../src/modules/docker/docker.controller.js');
const { exec } = await import('child_process');

function fakeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

beforeEach(() => {
  exec.mockClear();
});

describe('Docker Compose YAML Parser & Generator', () => {
  test('parseComposeServices correctly parses services, ports, environment, volumes', () => {
    const yaml = `version: '3.8'
services:
  web:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "8080:80"
    environment:
      - NODE_ENV=production
      - PORT=80
    volumes:
      - ./data:/app/data

  db:
    image: postgres:15
    environment:
      POSTGRES_DB: mydb
      POSTGRES_PASSWORD: secret
`;

    const services = parseComposeServices(yaml);
    expect(services).toHaveLength(2);

    expect(services[0].name).toBe('web');
    expect(services[0].image).toBe('nginx:alpine');
    expect(services[0].restart).toBe('unless-stopped');
    expect(services[0].ports).toContain('8080:80');
    expect(services[0].environment).toContain('NODE_ENV=production');
    expect(services[0].volumes).toContain('./data:/app/data');

    expect(services[1].name).toBe('db');
    expect(services[1].image).toBe('postgres:15');
    expect(services[1].environment).toContain('POSTGRES_DB=mydb');
  });

  test('generateComposeYaml formats services into standard YAML 3.8', () => {
    const services = [
      {
        name: 'api',
        image: 'node:20-alpine',
        restart: 'always',
        ports: ['3000:3000'],
        environment: ['NODE_ENV=production'],
        volumes: ['./src:/app/src'],
      }
    ];

    const yaml = generateComposeYaml({ services });
    expect(yaml).toContain("version: '3.8'");
    expect(yaml).toContain('services:');
    expect(yaml).toContain('api:');
    expect(yaml).toContain('image: node:20-alpine');
    expect(yaml).toContain('restart: always');
    expect(yaml).toContain('- "3000:3000"');
    expect(yaml).toContain('- NODE_ENV=production');
    expect(yaml).toContain('- ./src:/app/src');
  });

  test('handles empty or non-string inputs gracefully', () => {
    expect(parseComposeServices('')).toEqual([]);
    expect(parseComposeServices(null)).toEqual([]);
    expect(generateComposeYaml({ services: [] })).toContain("version: '3.8'");
  });
});

describe('Docker Compose Stack Management Methods', () => {
  test('listComposeProjects returns detected projects with ports and running status', async () => {
    const projects = await dockerService.listComposeProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe('my-stack');
    expect(projects[0].status).toBe('running');
    expect(projects[0].exposedPorts).toEqual(
      expect.arrayContaining([{ service: 'web', hostPort: 8080, containerPort: 80 }])
    );
  });

  test('getComposeProject returns stack details and services', async () => {
    const stack = await dockerService.getComposeProject('my-stack');
    expect(stack.name).toBe('my-stack');
    expect(stack.services).toHaveLength(1);
    expect(stack.services[0].name).toBe('web');
  });

  test('start, stop, restart, delete execute proper compose subcommands', async () => {
    await dockerService.startComposeProject('my-stack');
    expect(exec.mock.calls[0][0]).toContain('up -d');

    exec.mockClear();
    await dockerService.stopComposeProject('my-stack');
    expect(exec.mock.calls[0][0]).toContain('down');

    exec.mockClear();
    await dockerService.restartComposeProject('my-stack');
    expect(exec.mock.calls[0][0]).toContain('restart');

    exec.mockClear();
    await dockerService.deleteComposeProject('my-stack', { removeVolumes: true });
    expect(exec.mock.calls[0][0]).toContain('down -v');
  });

  test('getComposeLogs returns logs output', async () => {
    const logs = await dockerService.getComposeLogs('my-stack', { lines: 100 });
    expect(logs).toBe('done');
    expect(exec.mock.calls[0][0]).toContain('logs --tail=100 --no-color');
  });
});

describe('Auto HTTPS Reverse Proxy Connector', () => {
  test('createAutoProxy provisions reverse proxy website with SSL', async () => {
    const res = await dockerService.createAutoProxy({
      domain: 'app.mycompany.com',
      port: 8080,
      userId: 'user-1',
    });

    expect(res.domain).toBe('app.mycompany.com');
    expect(res.type).toBe('proxy');
    expect(res.port).toBe(8080);
  });

  test('createAutoProxy rejects invalid domain names', async () => {
    await expect(
      dockerService.createAutoProxy({ domain: 'invalid domain', port: 8080 })
    ).rejects.toThrow(/Invalid domain name/);
  });

  test('createAutoProxy rejects invalid port numbers', async () => {
    await expect(
      dockerService.createAutoProxy({ domain: 'app.example.com', port: 999999 })
    ).rejects.toThrow(/Invalid port number/);
  });
});

describe('DockerController Compose Endpoints', () => {
  test('listComposeStacks returns 200 with stacks array', async () => {
    const res = fakeRes();
    await dockerController.listComposeStacks({}, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: expect.objectContaining({ stacks: expect.any(Array) }) })
    );
  });

  test('createAutoProxy controller endpoint handles valid request', async () => {
    const res = fakeRes();
    await dockerController.createAutoProxy({
      body: { domain: 'service.example.com', port: 3000 },
      user: { id: 'admin-1' }
    }, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    );
  });
});
