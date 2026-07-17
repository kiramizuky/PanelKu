/**
 * OpenAPI 3.0 Specification — Linux Panel API
 * Auto-generated from JSDoc annotations via swagger-jsdoc
 */
import swaggerJsdoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Linux Panel API',
      version: '1.8.0',
      description: `
## REST API for Linux Server Control Panel

Manage your Linux server entirely through this API — authentication, system
management, Docker, websites, databases, firewalls, backups, and more.

### Authentication

Most endpoints require a **JWT Bearer token** in the \`Authorization\` header:
\`\`\`
Authorization: Bearer <your_access_token>
\`\`\`

For programmatic access, you can also use an **API Key**:
\`\`\`
X-API-Key: <your_api_key>
\`\`\`

Generate your API key in **Settings → Profile**.

### Response Format

All API responses follow a consistent format:

\`\`\`json
{
  "success": true,
  "message": "Success",
  "data": { ... },
  "timestamp": "2026-01-15T10:30:00.000Z"
}
\`\`\`

Paginated responses include a \`pagination\` object:

\`\`\`json
{
  "success": true,
  "data": [ ... ],
  "pagination": {
    "total": 50,
    "page": 1,
    "limit": 10,
    "pages": 5
  },
  "timestamp": "2026-01-15T10:30:00.000Z"
}
\`\`\`

### Rate Limiting

- **General API**: 100 requests per 15 minutes
- **Authentication**: 10 attempts per 15 minutes
- **API Key**: 200 requests per 15 minutes
- **Upload**: 20 requests per minute

Rate limit headers (\`RateLimit-*\`) are included in all responses.
      `,
      contact: {
        name: 'Linux Panel Team',
        url: 'https://github.com/linux-panel',
      },
      license: {
        name: 'MIT',
      },
    },
    servers: [
      {
        url: '/api',
        description: 'API Base Path',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter your JWT access token',
        },
        apiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'Enter your API key (generated in Settings → Profile)',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string', example: 'An error occurred' },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
        Success: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Success' },
            data: { type: 'object' },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
        Pagination: {
          type: 'object',
          properties: {
            total: { type: 'integer', example: 50 },
            page: { type: 'integer', example: 1 },
            limit: { type: 'integer', example: 10 },
            pages: { type: 'integer', example: 5 },
          },
        },
        HealthCheck: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            status: { type: 'string' },
            panel: { type: 'string' },
            version: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
        // ── Auth ──
        LoginRequest: {
          type: 'object',
          required: ['username', 'password'],
          properties: {
            username: { type: 'string', example: 'admin' },
            password: { type: 'string', example: 'Admin@123456' },
          },
        },
        LoginResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                accessToken: { type: 'string' },
                user: { $ref: '#/components/schemas/User' },
              },
            },
          },
        },
        TwoFactorVerifyRequest: {
          type: 'object',
          required: ['tempToken', 'otp'],
          properties: {
            tempToken: { type: 'string' },
            otp: { type: 'string', example: '123456' },
          },
        },
        RefreshTokenRequest: {
          type: 'object',
          properties: {
            refreshToken: { type: 'string' },
          },
        },
        // ── Users ──
        User: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            username: { type: 'string' },
            email: { type: 'string' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            role: { $ref: '#/components/schemas/Role' },
            isActive: { type: 'boolean' },
            isSuperAdmin: { type: 'boolean' },
            lastLogin: { type: 'string', format: 'date-time' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        CreateUserRequest: {
          type: 'object',
          required: ['username', 'email', 'password'],
          properties: {
            username: { type: 'string' },
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 8 },
            role: { type: 'string', description: 'Role slug (admin, operator, read_only)' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
          },
        },
        // ── Roles ──
        Role: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            name: { type: 'string' },
            slug: { type: 'string' },
            description: { type: 'string' },
            isSystem: { type: 'boolean' },
            color: { type: 'string' },
            permissions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  resource: { type: 'string' },
                  actions: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
        CreateRoleRequest: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            color: { type: 'string' },
            permissions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  resource: { type: 'string' },
                  actions: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
        // ── Dashboard ──
        DashboardMetrics: {
          type: 'object',
          properties: {
            cpu: { type: 'object', properties: { usage: { type: 'number' }, cores: { type: 'integer' } } },
            memory: { type: 'object', properties: { total: { type: 'integer' }, used: { type: 'integer' }, free: { type: 'integer' }, percent: { type: 'number' } } },
            disk: { type: 'array', items: { type: 'object', properties: { fs: { type: 'string' }, mount: { type: 'string' }, total: { type: 'integer' }, used: { type: 'integer' }, usedPercent: { type: 'number' } } } },
            uptime: { type: 'number' },
            loadAvg: { type: 'array', items: { type: 'number' } },
          },
        },
        // ── Docker ──
        DockerSummary: {
          type: 'object',
          properties: {
            containers: { type: 'integer' },
            containersRunning: { type: 'integer' },
            containersStopped: { type: 'integer' },
            images: { type: 'integer' },
          },
        },
        Container: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            names: { type: 'array', items: { type: 'string' } },
            image: { type: 'string' },
            state: { type: 'string', enum: ['running', 'exited', 'paused', 'created'] },
            status: { type: 'string' },
            ports: { type: 'array', items: { type: 'object' } },
            created: { type: 'integer' },
          },
        },
        DockerImage: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            size: { type: 'integer' },
            created: { type: 'integer' },
            containers: { type: 'array', items: { type: 'object' } },
          },
        },
        CreateContainerRequest: {
          type: 'object',
          required: ['image'],
          properties: {
            name: { type: 'string' },
            image: { type: 'string', example: 'nginx:latest' },
            restart: { type: 'string', enum: ['no', 'always', 'on-failure', 'unless-stopped'] },
            startAfterCreate: { type: 'boolean' },
            ports: { type: 'array', items: { type: 'object', properties: { hostPort: { type: 'integer' }, containerPort: { type: 'integer' } } } },
            volumes: { type: 'array', items: { type: 'object', properties: { hostPath: { type: 'string' }, containerPath: { type: 'string' } } } },
            env: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' } } } },
          },
        },
        ComposeDeployRequest: {
          type: 'object',
          required: ['yaml'],
          properties: {
            projectName: { type: 'string', example: 'my-stack' },
            yaml: { type: 'string', description: 'docker-compose.yml content' },
          },
        },
        // ── Websites ──
        Website: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            domain: { type: 'string' },
            type: { type: 'string', enum: ['static', 'php', 'node', 'proxy', 'python'] },
            rootDirectory: { type: 'string' },
            status: { type: 'string', enum: ['active', 'suspended'] },
            port: { type: 'integer' },
            phpVersion: { type: 'string' },
            gitRepo: { type: 'string' },
            autoDeploy: { type: 'boolean' },
            ssl: { type: 'object' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        CreateWebsiteRequest: {
          type: 'object',
          required: ['domain'],
          properties: {
            domain: { type: 'string', example: 'example.com' },
            type: { type: 'string', enum: ['static', 'php', 'node', 'proxy', 'python'] },
            rootDirectory: { type: 'string' },
            port: { type: 'integer' },
            gitRepo: { type: 'string' },
            autoDeploy: { type: 'boolean' },
            phpVersion: { type: 'string' },
          },
        },
        // ── SSL ──
        SSLCertificate: {
          type: 'object',
          properties: {
            domain: { type: 'string' },
            issuer: { type: 'string' },
            expiresAt: { type: 'string', format: 'date-time' },
            issuedAt: { type: 'string', format: 'date-time' },
            autoRenew: { type: 'boolean' },
          },
        },
        // ── Firewall ──
        FirewallStatus: {
          type: 'object',
          properties: {
            isActive: { type: 'boolean' },
            rules: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  to: { type: 'string' },
                  action: { type: 'string', enum: ['ALLOW', 'DENY'] },
                  direction: { type: 'string', enum: ['IN', 'OUT'] },
                  from: { type: 'string' },
                },
              },
            },
          },
        },
        FirewallRuleRequest: {
          type: 'object',
          required: ['port'],
          properties: {
            port: { type: 'integer', minimum: 1, maximum: 65535, example: 80 },
            protocol: { type: 'string', enum: ['tcp', 'udp'] },
            action: { type: 'string', enum: ['allow', 'deny', 'reject', 'limit'] },
          },
        },
        // ── WAF ──
        WafRule: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            type: { type: 'string', example: 'ip_block' },
            value: { type: 'string', example: '192.168.1.100' },
            action: { type: 'string', enum: ['allow', 'block', 'challenge'] },
            description: { type: 'string' },
          },
        },
        WafRuleRequest: {
          type: 'object',
          required: ['type', 'value'],
          properties: {
            type: { type: 'string', example: 'ip_block' },
            value: { type: 'string' },
            action: { type: 'string', enum: ['allow', 'block', 'challenge'] },
            description: { type: 'string' },
          },
        },
        // ── Database ──
        DatabaseInfo: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['mysql', 'postgres', 'sqlite'] },
            status: { type: 'string', enum: ['running', 'stopped', 'not_installed'] },
            databases: { type: 'array', items: { type: 'string' } },
          },
        },
        QueryRequest: {
          type: 'object',
          required: ['query'],
          properties: {
            type: { type: 'string', enum: ['mysql', 'postgres', 'sqlite'] },
            database: { type: 'string' },
            query: { type: 'string', example: 'SELECT * FROM users LIMIT 10;' },
          },
        },
        // ── Backup ──
        Backup: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            name: { type: 'string' },
            type: { type: 'string', enum: ['full', 'website', 'database', 'config'] },
            size: { type: 'integer' },
            status: { type: 'string', enum: ['completed', 'failed', 'in_progress'] },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        CreateBackupRequest: {
          type: 'object',
          required: ['type'],
          properties: {
            type: { type: 'string', enum: ['full', 'website', 'database', 'config'] },
            name: { type: 'string' },
          },
        },
        // ── Cron ──
        CronJob: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            name: { type: 'string' },
            schedule: { type: 'string', example: '0 2 * * *' },
            command: { type: 'string' },
            isEnabled: { type: 'boolean' },
            lastRun: { type: 'string', format: 'date-time' },
          },
        },
        CronJobRequest: {
          type: 'object',
          required: ['name', 'schedule', 'command'],
          properties: {
            name: { type: 'string' },
            schedule: { type: 'string', example: '0 2 * * *' },
            command: { type: 'string' },
            isEnabled: { type: 'boolean' },
          },
        },
        // ── DNS ──
        DNSRecord: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            type: { type: 'string', enum: ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'NS'] },
            name: { type: 'string' },
            content: { type: 'string' },
            proxied: { type: 'boolean' },
            ttl: { type: 'integer' },
          },
        },
        DNSRecordRequest: {
          type: 'object',
          required: ['type', 'name', 'content'],
          properties: {
            type: { type: 'string', enum: ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'NS'] },
            name: { type: 'string', example: 'www' },
            content: { type: 'string', example: '192.168.1.1' },
            proxied: { type: 'boolean' },
          },
        },
        // ── Notifications ──
        AlertConfig: {
          type: 'object',
          properties: {
            telegram: { type: 'object', properties: { enabled: { type: 'boolean' }, botToken: { type: 'string' }, chatId: { type: 'string' } } },
            email: { type: 'object', properties: { enabled: { type: 'boolean' }, smtpHost: { type: 'string' }, smtpPort: { type: 'integer' }, smtpUser: { type: 'string' }, smtpPass: { type: 'string' }, fromAddress: { type: 'string' }, toAddress: { type: 'string' } } },
            discord: { type: 'object', properties: { enabled: { type: 'boolean' }, webhookUrl: { type: 'string' } } },
            slack: { type: 'object', properties: { enabled: { type: 'boolean' }, webhookUrl: { type: 'string' } } },
            whatsapp: { type: 'object', properties: { enabled: { type: 'boolean' }, phoneNumber: { type: 'string' } } },
            thresholds: { type: 'object', properties: { cpuPercent: { type: 'integer' }, ramPercent: { type: 'integer' }, diskPercent: { type: 'integer' } } },
          },
        },
        // ── System ──
        SystemInfo: {
          type: 'object',
          properties: {
            hostname: { type: 'string' },
            os: { type: 'string' },
            kernel: { type: 'string' },
            arch: { type: 'string' },
            uptime: { type: 'number' },
            cpu: { type: 'object', properties: { model: { type: 'string' }, cores: { type: 'integer' }, usage: { type: 'number' } } },
            memory: { type: 'object', properties: { total: { type: 'integer' }, used: { type: 'integer' }, free: { type: 'integer' }, percent: { type: 'number' } } },
            disk: { type: 'array', items: { type: 'object', properties: { fs: { type: 'string' }, mount: { type: 'string' }, total: { type: 'integer' }, used: { type: 'integer' }, usedPercent: { type: 'number' } } } },
          },
        },
        PublicIP: {
          type: 'object',
          properties: {
            ip: { type: 'string' },
            city: { type: 'string' },
            region: { type: 'string' },
            country: { type: 'string' },
            isp: { type: 'string' },
          },
        },
        // ── Session ──
        Session: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            deviceInfo: { type: 'string' },
            userAgent: { type: 'string' },
            ip: { type: 'string' },
            lastActive: { type: 'string', format: 'date-time' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        // ── Monitor History ──
        MonitorPoint: {
          type: 'object',
          properties: {
            timestamp: { type: 'string', format: 'date-time' },
            cpu: { type: 'number' },
            ram: { type: 'number' },
            disk: { type: 'number' },
          },
        },
        // ── Audit ──
        AuditLog: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            username: { type: 'string' },
            action: { type: 'string' },
            resource: { type: 'string' },
            details: { type: 'string' },
            ip: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        // ── Cluster ──
        ClusterNode: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            name: { type: 'string' },
            ipAddress: { type: 'string' },
            port: { type: 'integer' },
            status: { type: 'string', enum: ['online', 'offline'] },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        CreateClusterNodeRequest: {
          type: 'object',
          required: ['name', 'ipAddress', 'apiKey'],
          properties: {
            name: { type: 'string' },
            ipAddress: { type: 'string', example: '192.168.1.100' },
            port: { type: 'integer', example: 23456 },
            apiKey: { type: 'string' },
          },
        },
        // ── Agent Metrics ──
        AgentMetrics: {
          type: 'object',
          properties: {
            cpu: { type: 'object', properties: { usage: { type: 'number' }, cores: { type: 'integer' }, loadAvg: { type: 'array', items: { type: 'number' } } } },
            memory: { type: 'object', properties: { total: { type: 'integer' }, used: { type: 'integer' }, free: { type: 'integer' } } },
            disk: { type: 'array', items: { type: 'object' } },
            network: { type: 'array', items: { type: 'object' } },
            system: { type: 'object', properties: { distro: { type: 'string' }, kernel: { type: 'string' }, uptime: { type: 'number' }, hostname: { type: 'string' } } },
          },
        },
        // ── AI Copilot ──
        AiChatRequest: {
          type: 'object',
          required: ['message'],
          properties: {
            message: { type: 'string', example: 'Analyze this log file for errors' },
            context: { type: 'object' },
          },
        },
        AiChatResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                reply: { type: 'string' },
                model: { type: 'string' },
              },
            },
          },
        },
      },
    },
    tags: [
      { name: 'Auth', description: 'Authentication, 2FA, session management' },
      { name: 'Users', description: 'User management & API keys' },
      { name: 'Roles', description: 'Role-based access control' },
      { name: 'Dashboard', description: 'System metrics & dashboard data' },
      { name: 'Monitor', description: 'Real-time monitoring & historical data' },
      { name: 'System', description: 'System management, services, updates, SSH keys' },
      { name: 'Docker', description: 'Container, image, compose management' },
      { name: 'Websites', description: 'Website/Nginx virtual host management' },
      { name: 'SSL', description: 'SSL certificate management (Let\'s Encrypt)' },
      { name: 'Firewall', description: 'UFW firewall rule management' },
      { name: 'WAF', description: 'Web Application Firewall & Fail2Ban' },
      { name: 'DNS', description: 'Cloudflare DNS zone & record management' },
      { name: 'Database', description: 'Database explorer & query console' },
      { name: 'Backup', description: 'Backup & restore operations' },
      { name: 'Cron', description: 'Cron job management' },
      { name: 'File Manager', description: 'File system browsing & editing' },
      { name: 'Terminal', description: 'Web-based terminal' },
      { name: 'Notifications', description: 'Alert channels (Telegram, Email, Discord, etc.)' },
      { name: 'Cluster', description: 'Multi-node cluster management' },
      { name: 'AI', description: 'AI Copilot & assistant' },
      { name: 'WhatsApp', description: 'WhatsApp API session management' },
      { name: 'Plugins', description: 'Plugin management' },
      { name: 'Agent', description: 'Cluster agent communication endpoints' },
    ],
    paths: {
      // ── Health ──
      '/health': {
        get: {
          tags: ['System'],
          summary: 'Health check',
          description: 'Public endpoint for monitoring tools to verify the panel is running.',
          responses: {
            200: {
              description: 'Panel is healthy',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthCheck' } } },
            },
          },
        },
      },

      // ═══════════════════════════════════════════════
      //  AUTH
      // ═══════════════════════════════════════════════
      '/auth/login': {
        post: {
          tags: ['Auth'],
          summary: 'Login',
          description: 'Authenticate with username/password. Returns JWT tokens. If 2FA is enabled, returns a tempToken for 2FA verification.',
          security: [],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } },
          },
          responses: {
            200: { description: 'Login successful (or 2FA required)', content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginResponse' } } } },
            401: { description: 'Invalid credentials' },
          },
        },
      },
      '/auth/2fa/verify': {
        post: {
          tags: ['Auth'],
          summary: 'Verify 2FA OTP',
          description: 'Complete login after 2FA verification.',
          security: [],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/TwoFactorVerifyRequest' } } },
          },
          responses: {
            200: { description: '2FA verified, tokens returned' },
            401: { description: 'Invalid OTP or temp token' },
          },
        },
      },
      '/auth/refresh': {
        post: {
          tags: ['Auth'],
          summary: 'Refresh access token',
          description: 'Exchange a valid refresh token for a new access token. Old refresh token is invalidated (token rotation).',
          security: [],
          requestBody: {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/RefreshTokenRequest' } } },
          },
          responses: {
            200: { description: 'Tokens refreshed' },
            401: { description: 'Invalid or expired refresh token' },
          },
        },
      },
      '/auth/logout': {
        post: {
          tags: ['Auth'],
          summary: 'Logout',
          description: 'Invalidate current refresh token session.',
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'Logged out' } },
        },
      },
      '/auth/logout/all': {
        post: {
          tags: ['Auth'],
          summary: 'Logout all devices',
          description: 'Invalidate all active sessions for the current user.',
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'All sessions logged out' } },
        },
      },
      '/auth/sessions': {
        get: {
          tags: ['Auth'],
          summary: 'List active sessions',
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: 'Active sessions list',
              content: { 'application/json': { schema: { type: 'object', properties: { sessions: { type: 'array', items: { $ref: '#/components/schemas/Session' } } } } } },
            },
          },
        },
      },
      '/auth/profile': {
        get: {
          tags: ['Auth'],
          summary: 'Get current user profile',
          security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
          responses: { 200: { description: 'User profile', content: { 'application/json': { schema: { type: 'object', properties: { user: { $ref: '#/components/schemas/User' } } } } } } },
        },
      },
      '/auth/2fa/setup': {
        post: {
          tags: ['Auth'],
          summary: 'Setup 2FA',
          description: 'Generate TOTP secret and QR code for authenticator app.',
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'Secret and QR code generated' } },
        },
      },
      '/auth/2fa/enable': {
        post: {
          tags: ['Auth'],
          summary: 'Enable 2FA',
          description: 'Verify OTP and enable two-factor authentication.',
          security: [{ bearerAuth: [] }],
          requestBody: {
            content: { 'application/json': { schema: { type: 'object', properties: { otp: { type: 'string' } } } } },
          },
          responses: { 200: { description: '2FA enabled' } },
        },
      },
      '/auth/2fa/disable': {
        post: {
          tags: ['Auth'],
          summary: 'Disable 2FA',
          description: 'Disable two-factor authentication (requires password).',
          security: [{ bearerAuth: [] }],
          requestBody: {
            content: { 'application/json': { schema: { type: 'object', properties: { password: { type: 'string' } } } } },
          },
          responses: { 200: { description: '2FA disabled' } },
        },
      },

      // ═══════════════════════════════════════════════
      //  USERS
      // ═══════════════════════════════════════════════
      '/users': {
        get: {
          tags: ['Users'],
          summary: 'List users',
          description: 'List all users with pagination. Requires USERS:READ permission.',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
          ],
          responses: { 200: { description: 'Paginated user list' } },
        },
        post: {
          tags: ['Users'],
          summary: 'Create user',
          description: 'Create a new user. Requires USERS:CREATE permission.',
          security: [{ bearerAuth: [] }],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateUserRequest' } } } },
          responses: { 201: { description: 'User created' } },
        },
      },
      '/users/{id}': {
        get: {
          tags: ['Users'],
          summary: 'Get user by ID',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'User details' } },
        },
        put: {
          tags: ['Users'],
          summary: 'Update user',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'User updated' } },
        },
        delete: {
          tags: ['Users'],
          summary: 'Delete user',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'User deleted' } },
        },
      },
      '/users/{id}/toggle': {
        patch: {
          tags: ['Users'],
          summary: 'Toggle user active status',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Status toggled' } },
        },
      },
      '/users/me/api-key': {
        post: {
          tags: ['Users'],
          summary: 'Regenerate API key',
          description: 'Generate a new API key for the current user.',
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'API key regenerated', content: { 'application/json': { schema: { type: 'object', properties: { apiKey: { type: 'string' } } } } } } },
        },
        delete: {
          tags: ['Users'],
          summary: 'Revoke API key',
          description: 'Disable API key access for the current user.',
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'API key revoked' } },
        },
      },
      '/users/me/password': {
        post: {
          tags: ['Users'],
          summary: 'Change password',
          description: 'Change current user password. Invalidates all other sessions.',
          security: [{ bearerAuth: [] }],
          requestBody: {
            content: { 'application/json': { schema: { type: 'object', properties: { currentPassword: { type: 'string' }, newPassword: { type: 'string' } } } } },
          },
          responses: { 200: { description: 'Password changed' } },
        },
      },

      // ═══════════════════════════════════════════════
      //  ROLES
      // ═══════════════════════════════════════════════
      '/roles': {
        get: {
          tags: ['Roles'],
          summary: 'List roles',
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'Roles list' } },
        },
        post: {
          tags: ['Roles'],
          summary: 'Create role',
          security: [{ bearerAuth: [] }],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateRoleRequest' } } } },
          responses: { 201: { description: 'Role created' } },
        },
      },
      '/roles/resources': {
        get: {
          tags: ['Roles'],
          summary: 'List permission resources',
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'Available resources and actions' } },
        },
      },
      '/roles/{id}': {
        get: {
          tags: ['Roles'],
          summary: 'Get role by ID',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'Role details' } },
        },
        put: {
          tags: ['Roles'],
          summary: 'Update role',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'Role updated' } },
        },
        delete: {
          tags: ['Roles'],
          summary: 'Delete role',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'Role deleted' } },
        },
      },

      // ═══════════════════════════════════════════════
      //  DASHBOARD
      // ═══════════════════════════════════════════════
      '/dashboard/metrics': {
        get: {
          tags: ['Dashboard'],
          summary: 'Real-time system metrics',
          description: 'CPU, RAM, disk usage, uptime, and load average. Updated every 3 seconds.',
          security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
          responses: { 200: { description: 'System metrics', content: { 'application/json': { schema: { $ref: '#/components/schemas/DashboardMetrics' } } } } },
        },
      },
      '/dashboard/info': {
        get: {
          tags: ['Dashboard'],
          summary: 'System information',
          description: 'OS details, kernel, hostname, public/private IP, and Docker status.',
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'System info' } },
        },
      },

      // ═══════════════════════════════════════════════
      //  DOCKER
      // ═══════════════════════════════════════════════
      '/docker/summary': {
        get: {
          tags: ['Docker'],
          summary: 'Docker summary',
          security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
          responses: { 200: { description: 'Docker summary stats', content: { 'application/json': { schema: { $ref: '#/components/schemas/DockerSummary' } } } } },
        },
      },
      '/docker/containers': {
        get: {
          tags: ['Docker'],
          summary: 'List containers',
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'Container list', content: { 'application/json': { schema: { type: 'object', properties: { containers: { type: 'array', items: { $ref: '#/components/schemas/Container' } } } } } } } },
        },
        post: {
          tags: ['Docker'],
          summary: 'Create container',
          security: [{ bearerAuth: [] }],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateContainerRequest' } } } },
          responses: { 201: { description: 'Container created' } },
        },
      },
      '/docker/containers/{id}/start': {
        post: { tags: ['Docker'], summary: 'Start container', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Container started' } } },
      },
      '/docker/containers/{id}/stop': {
        post: { tags: ['Docker'], summary: 'Stop container', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Container stopped' } } },
      },
      '/docker/containers/{id}/restart': {
        post: { tags: ['Docker'], summary: 'Restart container', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Container restarted' } } },
      },
      '/docker/containers/{id}/kill': {
        post: { tags: ['Docker'], summary: 'Kill container', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Container killed' } } },
      },
      '/docker/containers/{id}': {
        delete: { tags: ['Docker'], summary: 'Delete container', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'force', in: 'query', schema: { type: 'boolean' } }], responses: { 200: { description: 'Container deleted' } } },
      },
      '/docker/images': {
        get: {
          tags: ['Docker'],
          summary: 'List images',
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'Image list', content: { 'application/json': { schema: { type: 'object', properties: { images: { type: 'array', items: { $ref: '#/components/schemas/DockerImage' } } } } } } } },
        },
      },
      '/docker/images/search': {
        get: { tags: ['Docker'], summary: 'Search Docker Hub images', security: [{ bearerAuth: [] }], parameters: [{ name: 'term', in: 'query', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Search results' } } },
      },
      '/docker/images/{id}': {
        delete: { tags: ['Docker'], summary: 'Delete image', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'force', in: 'query', schema: { type: 'boolean' } }], responses: { 200: { description: 'Image deleted' } } },
      },
      '/docker/images/{id}/pull': {
        post: { tags: ['Docker'], summary: 'Pull image', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Image pulled' } } },
      },
      '/docker/images/prune': {
        post: { tags: ['Docker'], summary: 'Prune unused images', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Prune complete' } } },
      },
      '/docker/networks': {
        get: { tags: ['Docker'], summary: 'List networks', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Network list' } } },
      },
      '/docker/volumes': {
        get: { tags: ['Docker'], summary: 'List volumes', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Volume list' } } },
      },
      '/docker/compose': {
        post: {
          tags: ['Docker'],
          summary: 'Deploy Docker Compose stack',
          security: [{ bearerAuth: [] }],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ComposeDeployRequest' } } } },
          responses: { 200: { description: 'Stack deployed' } },
        },
      },

      // ═══════════════════════════════════════════════
      //  WEBSITES
      // ═══════════════════════════════════════════════
      '/websites': {
        get: {
          tags: ['Websites'],
          summary: 'List websites',
          security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
          responses: { 200: { description: 'Website list', content: { 'application/json': { schema: { type: 'object', properties: { websites: { type: 'array', items: { $ref: '#/components/schemas/Website' } } } } } } } },
        },
        post: {
          tags: ['Websites'],
          summary: 'Create website',
          description: 'Create a new Nginx virtual host for a website. Supports static, PHP, Node.js, proxy, and Python types.',
          security: [{ bearerAuth: [] }],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateWebsiteRequest' } } } },
          responses: { 201: { description: 'Website created' } },
        },
      },
      '/websites/{id}': {
        delete: { tags: ['Websites'], summary: 'Delete website', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Website deleted' } } },
      },
      '/websites/{id}/deploy': {
        post: { tags: ['Websites'], summary: 'Git deploy', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Deployment triggered' } } },
      },
      '/websites/{id}/deploy/{token}': {
        post: { tags: ['Websites'], summary: 'Git deploy via webhook', description: 'Public endpoint for Git webhook auto-deployment.', security: [], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'token', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Deployment triggered' } } },
      },

      // ═══════════════════════════════════════════════
      //  SSL
      // ═══════════════════════════════════════════════
      '/ssl': {
        get: { tags: ['SSL'], summary: 'List SSL certificates', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Certificate list' } } },
        post: {
          tags: ['SSL'],
          summary: 'Issue SSL certificate',
          description: 'Request a new Let\'s Encrypt SSL certificate for a domain.',
          security: [{ bearerAuth: [] }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { domain: { type: 'string' }, method: { type: 'string', enum: ['http', 'dns', 'manual'] }, dnsProvider: { type: 'string' } } } } } },
          responses: { 200: { description: 'Certificate issued' } },
        },
      },
      '/ssl/{id}': {
        delete: { tags: ['SSL'], summary: 'Delete certificate', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Certificate deleted' } } },
      },
      '/ssl/{id}/renew': {
        post: { tags: ['SSL'], summary: 'Renew certificate', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Certificate renewed' } } },
      },

      // ═══════════════════════════════════════════════
      //  FIREWALL
      // ═══════════════════════════════════════════════
      '/firewall/status': {
        get: { tags: ['Firewall'], summary: 'Get firewall status and rules', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Firewall status', content: { 'application/json': { schema: { $ref: '#/components/schemas/FirewallStatus' } } } } } },
      },
      '/firewall/toggle': {
        post: { tags: ['Firewall'], summary: 'Enable/disable firewall', security: [{ bearerAuth: [] }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { enable: { type: 'boolean' } } } } } }, responses: { 200: { description: 'Firewall toggled' } } },
      },
      '/firewall/rules': {
        post: { tags: ['Firewall'], summary: 'Add firewall rule', security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/FirewallRuleRequest' } } } }, responses: { 200: { description: 'Rule added' } } },
      },
      '/firewall/rules/{id}': {
        delete: { tags: ['Firewall'], summary: 'Delete firewall rule', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Rule deleted' } } },
      },

      // ═══════════════════════════════════════════════
      //  WAF
      // ═══════════════════════════════════════════════
      '/waf/rules': {
        get: { tags: ['WAF'], summary: 'List WAF rules', security: [{ bearerAuth: [] }], responses: { 200: { description: 'WAF rules', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/WafRule' } } } } } } },
        post: { tags: ['WAF'], summary: 'Add WAF rule', security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/WafRuleRequest' } } } }, responses: { 200: { description: 'Rule added' } } },
      },
      '/waf/rules/{id}': {
        delete: { tags: ['WAF'], summary: 'Delete WAF rule', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Rule deleted' } } },
      },
      '/waf/fail2ban/logs': {
        get: { tags: ['WAF'], summary: 'Get Fail2Ban logs', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Fail2Ban log entries' } } },
      },

      // ═══════════════════════════════════════════════
      //  DNS
      // ═══════════════════════════════════════════════
      '/dns/zones': {
        get: { tags: ['DNS'], summary: 'List Cloudflare zones', security: [{ bearerAuth: [] }], responses: { 200: { description: 'DNS zones' } } },
      },
      '/dns/zones/{zoneId}/records': {
        get: { tags: ['DNS'], summary: 'List DNS records', security: [{ bearerAuth: [] }], parameters: [{ name: 'zoneId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'DNS records' } } },
        post: { tags: ['DNS'], summary: 'Create DNS record', security: [{ bearerAuth: [] }], parameters: [{ name: 'zoneId', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/DNSRecordRequest' } } } }, responses: { 200: { description: 'Record created' } } },
      },
      '/dns/zones/{zoneId}/records/{recordId}': {
        delete: { tags: ['DNS'], summary: 'Delete DNS record', security: [{ bearerAuth: [] }], parameters: [{ name: 'zoneId', in: 'path', required: true, schema: { type: 'string' } }, { name: 'recordId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Record deleted' } } },
      },

      // ═══════════════════════════════════════════════
      //  DATABASE
      // ═══════════════════════════════════════════════
      '/database/{type}': {
        get: { tags: ['Database'], summary: 'Get database info', security: [{ bearerAuth: [] }], parameters: [{ name: 'type', in: 'path', required: true, schema: { type: 'string', enum: ['mysql', 'postgres', 'sqlite'] } }], responses: { 200: { description: 'Database info' } } },
      },
      '/database/{type}/query': {
        post: { tags: ['Database'], summary: 'Execute SQL query', description: 'Run a SQL query against the specified database type.', security: [{ bearerAuth: [] }], parameters: [{ name: 'type', in: 'path', required: true, schema: { type: 'string', enum: ['mysql', 'postgres', 'sqlite'] } }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/QueryRequest' } } } }, responses: { 200: { description: 'Query results' } } },
      },

      // ═══════════════════════════════════════════════
      //  BACKUP
      // ═══════════════════════════════════════════════
      '/backups': {
        get: { tags: ['Backup'], summary: 'List backups', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Backup list' } } },
        post: { tags: ['Backup'], summary: 'Create backup', security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateBackupRequest' } } } }, responses: { 200: { description: 'Backup created' } } },
      },
      '/backups/{id}': {
        delete: { tags: ['Backup'], summary: 'Delete backup', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Backup deleted' } } },
      },
      '/backups/{id}/restore': {
        post: { tags: ['Backup'], summary: 'Restore backup', description: 'Restore system from a backup.', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Restore initiated' } } },
      },

      // ═══════════════════════════════════════════════
      //  CRON
      // ═══════════════════════════════════════════════
      '/cron': {
        get: { tags: ['Cron'], summary: 'List cron jobs', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Cron job list' } } },
        post: { tags: ['Cron'], summary: 'Create cron job', security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CronJobRequest' } } } }, responses: { 200: { description: 'Cron job created' } } },
      },
      '/cron/{id}': {
        put: { tags: ['Cron'], summary: 'Update cron job', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Cron job updated' } } },
        delete: { tags: ['Cron'], summary: 'Delete cron job', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Cron job deleted' } } },
      },
      '/cron/{id}/toggle': {
        post: { tags: ['Cron'], summary: 'Toggle cron job', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Cron job toggled' } } },
      },

      // ═══════════════════════════════════════════════
      //  SYSTEM
      // ═══════════════════════════════════════════════
      '/system/services': {
        get: { tags: ['System'], summary: 'List services status', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Services status' } } },
      },
      '/system/services/manage': {
        post: { tags: ['System'], summary: 'Manage service (start/stop/restart)', security: [{ bearerAuth: [] }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { service: { type: 'string' }, action: { type: 'string', enum: ['start', 'stop', 'restart'] } } } } } }, responses: { 200: { description: 'Service action executed' } } },
      },
      '/system/check-install': {
        get: { tags: ['System'], summary: 'Check installed packages status', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Install status for nginx, docker, etc.' } } },
      },
      '/system/install': {
        post: { tags: ['System'], summary: 'Install a package', security: [{ bearerAuth: [] }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { package: { type: 'string' }, password: { type: 'string' } } } } } }, responses: { 200: { description: 'Package installed' } } },
      },
      '/system/reboot': {
        post: { tags: ['System'], summary: 'Reboot the server', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Reboot initiated' } } },
      },
      '/system/apt/update': {
        post: { tags: ['System'], summary: 'Update package lists', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Package list updated' } } },
      },
      '/system/apt/upgrade': {
        post: { tags: ['System'], summary: 'Upgrade all packages', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Packages upgraded' } } },
      },

      // SSH Keys
      '/system/ssh/keys': {
        get: { tags: ['System'], summary: 'List SSH keys', security: [{ bearerAuth: [] }], responses: { 200: { description: 'SSH key list' } } },
        post: { tags: ['System'], summary: 'Add SSH key', security: [{ bearerAuth: [] }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { key: { type: 'string' }, name: { type: 'string' } } } } } }, responses: { 200: { description: 'SSH key added' } } },
      },
      '/system/ssh/config': {
        get: { tags: ['System'], summary: 'Get SSH configuration', security: [{ bearerAuth: [] }], responses: { 200: { description: 'SSH config' } } },
        post: { tags: ['System'], summary: 'Update SSH configuration', security: [{ bearerAuth: [] }], responses: { 200: { description: 'SSH config updated' } } },
      },

      // Panel Updates
      '/system/panel/version': {
        get: { tags: ['System'], summary: 'Get panel version', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Panel version info' } } },
      },
      '/system/panel/check-update': {
        get: { tags: ['System'], summary: 'Check for panel updates', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Update availability' } } },
      },
      '/system/panel/update': {
        post: { tags: ['System'], summary: 'Update the panel', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Update initiated' } } },
      },
      '/system/panel/restart': {
        post: { tags: ['System'], summary: 'Restart the panel service', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Restart initiated' } } },
      },

      // Audit logs
      '/system/audit/stats': {
        get: { tags: ['System'], summary: 'Get audit statistics', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Audit stats with chart data' } } },
      },
      '/system/audit/logs': {
        get: { tags: ['System'], summary: 'Get audit log entries', security: [{ bearerAuth: [] }], parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 100 } }], responses: { 200: { description: 'Audit log entries' } } },
      },

      // Security scan
      '/system/security/scan': {
        get: { tags: ['System'], summary: 'Run security scan', description: 'Scan server for common security vulnerabilities.', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Security scan results' } } },
      },
      '/system/security/fix': {
        post: { tags: ['System'], summary: 'Fix security issue', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Issue fixed' } } },
      },

      // ── MONITOR ──
      '/monitor/history': {
        get: { tags: ['Monitor'], summary: 'Get monitoring history', description: 'Historical CPU, RAM, and disk usage data for charts.', security: [{ bearerAuth: [] }], parameters: [{ name: 'hours', in: 'query', schema: { type: 'integer', default: 24 } }], responses: { 200: { description: 'Monitor history', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/MonitorPoint' } } } } } } } },
      },

      // ── FILE MANAGER ──
      '/filemanager/list': {
        get: { tags: ['File Manager'], summary: 'List directory contents', security: [{ bearerAuth: [] }], parameters: [{ name: 'path', in: 'query', schema: { type: 'string', default: '/' } }], responses: { 200: { description: 'Directory listing' } } },
      },
      '/filemanager/read': {
        get: { tags: ['File Manager'], summary: 'Read file content', security: [{ bearerAuth: [] }], parameters: [{ name: 'path', in: 'query', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'File content' } } },
      },
      '/filemanager/write': {
        post: { tags: ['File Manager'], summary: 'Write file content', security: [{ bearerAuth: [] }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } } } } }, responses: { 200: { description: 'File saved' } } },
      },
      '/filemanager/rename': {
        post: { tags: ['File Manager'], summary: 'Rename file/directory', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Renamed' } } },
      },
      '/filemanager/delete': {
        delete: { tags: ['File Manager'], summary: 'Delete file/directory', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Deleted' } } },
      },
      '/filemanager/mkdir': {
        post: { tags: ['File Manager'], summary: 'Create directory', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Directory created' } } },
      },
      '/filemanager/search': {
        get: { tags: ['File Manager'], summary: 'Search files', security: [{ bearerAuth: [] }], parameters: [{ name: 'path', in: 'query', schema: { type: 'string', default: '/' } }, { name: 'query', in: 'query', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Search results' } } },
      },
      '/filemanager/upload': {
        post: { tags: ['File Manager'], summary: 'Upload files', security: [{ bearerAuth: [] }], requestBody: { content: { 'multipart/form-data': { schema: { type: 'object', properties: { files: { type: 'array', items: { type: 'string', format: 'binary' } } } } } } }, responses: { 200: { description: 'Files uploaded' } } },
      },
      '/filemanager/zip': {
        post: { tags: ['File Manager'], summary: 'Zip directory', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Zipped' } } },
      },
      '/filemanager/unzip': {
        post: { tags: ['File Manager'], summary: 'Unzip archive', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Extracted' } } },
      },
      '/filemanager/download': {
        get: { tags: ['File Manager'], summary: 'Download file', security: [{ bearerAuth: [] }], parameters: [{ name: 'path', in: 'query', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'File download stream' } } },
      },

      // ── NOTIFICATIONS ──
      '/alerts/config': {
        get: { tags: ['Notifications'], summary: 'Get alert configuration', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Alert configuration', content: { 'application/json': { schema: { $ref: '#/components/schemas/AlertConfig' } } } } },
        },
        put: { tags: ['Notifications'], summary: 'Update alert configuration', security: [{ bearerAuth: [] }], requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/AlertConfig' } } } }, responses: { 200: { description: 'Configuration updated' } } },
      },
      '/alerts/test': {
        post: { tags: ['Notifications'], summary: 'Send test notification', security: [{ bearerAuth: [] }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { channel: { type: 'string', enum: ['telegram', 'email', 'discord', 'slack', 'whatsapp'] } } } } } }, responses: { 200: { description: 'Test notification sent' } } },
      },

      // ── CLUSTER ──
      '/cluster/nodes': {
        get: { tags: ['Cluster'], summary: 'List cluster nodes', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Node list', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/ClusterNode' } } } } } },
        },
        post: { tags: ['Cluster'], summary: 'Add cluster node', security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateClusterNodeRequest' } } } }, responses: { 200: { description: 'Node added' } } },
      },
      '/cluster/nodes/{id}': {
        delete: { tags: ['Cluster'], summary: 'Remove cluster node', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Node removed' } } },
      },
      '/cluster/nodes/{id}/ping': {
        post: { tags: ['Cluster'], summary: 'Ping cluster node', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Ping result' } } },
      },
      '/cluster/nodes/{id}/metrics': {
        get: { tags: ['Cluster'], summary: 'Get cluster node metrics', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Node metrics', content: { 'application/json': { schema: { $ref: '#/components/schemas/AgentMetrics' } } } } },
        },
      },

      // ── AI ──
      '/ai/chat': {
        post: { tags: ['AI'], summary: 'Send message to AI Copilot', security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/AiChatRequest' } } } }, responses: { 200: { description: 'AI response', content: { 'application/json': { schema: { $ref: '#/components/schemas/AiChatResponse' } } } } },
        },
      },

      // ── WHATSAPP ──
      '/whatsapp/sessions': {
        get: { tags: ['WhatsApp'], summary: 'List WhatsApp sessions', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Session list' } } },
        post: { tags: ['WhatsApp'], summary: 'Create WhatsApp session', security: [{ bearerAuth: [] }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { sessionName: { type: 'string' } } } } } }, responses: { 200: { description: 'Session created' } } },
      },
      '/whatsapp/sessions/{id}/logout': {
        post: { tags: ['WhatsApp'], summary: 'Logout WhatsApp session', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Session logged out' } } },
      },

      // ── AGENT ──
      '/agent/metrics': {
        post: { tags: ['Agent'], summary: 'Report agent metrics (internal)', description: 'Used by cluster agents to report system metrics to master. X-API-Key authentication.', security: [{ apiKeyAuth: [] }], responses: { 200: { description: 'Metrics received' } } },
      },
      '/agent/ping': {
        post: { tags: ['Agent'], summary: 'Agent ping (internal)', description: 'Health check endpoint for cluster agents.', security: [{ apiKeyAuth: [] }], responses: { 200: { description: 'Pong received' } } },
      },
      '/agent/terminal/ws': {
        get: { tags: ['Agent'], summary: 'Agent terminal WebSocket (internal)', description: 'WebSocket upgrade endpoint for agent terminal sessions.' },
      },
    },
  },
  // swagger-jsdoc options — we define all paths manually in the spec above,
  // so we just need the base configuration.
  apis: [],
};

export const swaggerSpec = swaggerJsdoc(options);
export default swaggerSpec;
