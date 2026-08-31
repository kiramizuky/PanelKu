import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import appConfig from './config/app.js';
import logger from './config/logger.js';
import apiRoutes from './routes/index.js';
import { apiLimiter } from './middleware/rateLimiter.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { wafMiddleware } from './middleware/waf.middleware.js';
import { nonceMiddleware, nonceInjector } from './middleware/nonce.js';

import expressEjsLayouts from 'express-ejs-layouts';
import pluginLoader from './core/plugin-loader/PluginLoader.js';
import prometheusService from './modules/monitor/prometheus.service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const createApp = () => {
  const app = express();

  // [HIGH-1 FIX] Trust exactly 1 reverse-proxy hop (nginx/caddy in front).
  // This ensures req.ip reflects the real client IP from X-Forwarded-For,
  // while preventing full X-Forwarded-For chain spoofing.
  app.set('trust proxy', 1);

  // Template engine setup
  app.set('view engine', 'ejs');
  app.set('views', join(__dirname, 'views'));
  app.use(expressEjsLayouts);
  app.set('layout', 'layout'); // Default layout file
  app.set('layout extractScripts', true);
  app.set('layout extractStyles', true);

  // [CSP HARDEN] Generate nonce BEFORE helmet so it's ready for CSP header
  app.use(nonceMiddleware);

  // Security
  app.use(helmet({
    crossOriginOpenerPolicy: false,
    originAgentCluster: false,
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        // [CSP HARDEN] 'unsafe-inline' removed — replaced with per-request nonce.
        // All external resources (Bootstrap, Chart.js, CodeMirror, Xterm, fonts)
        // are now self-hosted — no CDN whitelist needed for loading resources.
        scriptSrc: [
          "'self'",
          (req, res) => `'nonce-${res.locals.nonce}'`,
        ],
        // script-src-attr must remain 'unsafe-inline' because:
        // 1) LP.call() pattern renders inline onclick handlers via innerHTML
        // 2) 126+ inline event handlers across views (onclick, onchange, etc.)
        // 3) CSP nonces do NOT work for HTML attribute event handlers
        scriptSrcAttr: ["'unsafe-inline'"],
        // style-src uses 'unsafe-inline' instead of nonce because:
        // 1) CSP spec: if nonce is present, 'unsafe-inline' is IGNORED
        // 2) xterm.js, CodeMirror, and other client libs dynamically inject
        //    <style> elements at runtime that cannot carry a nonce
        // 3) Inline style attributes (style="...") are covered by style-src-attr
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
        ],
        // style-src-attr must remain 'unsafe-inline' because:
        // 1) style="..." HTML attributes are used extensively across views
        // 2) CSP nonces do NOT apply to style HTML attributes — only <style> tags
        // 3) Migrating all 126+ inline style attributes to CSS classes is impractical
        styleSrcAttr: ["'unsafe-inline'"],
        fontSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        // [HARDEN] Restrict form submissions to same origin
        formAction: ["'self'"],
        // [HARDEN] Restrict base URI to prevent base tag injection
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
    // [HARDEN] Restrict browser feature access
    permissionsPolicy: {
      permissions: {
        camera: [],
        microphone: [],
        geolocation: [],
        notifications: [],
        payment: [],
        usb: [],
        'display-capture': [],
        'clipboard-read': [],
        'clipboard-write': ["'self'"],
      },
    },
  }));

  // [HARDEN] CORS — single explicit origin even in dev mode (no more origin:true)
  app.use(cors({
    origin: appConfig.appUrl,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  }));

  // Body parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(cookieParser());

  // HTTP request logging (Morgan)
  if (appConfig.isDev) {
    app.use(morgan('dev'));
  } else {
    app.use(morgan('combined', {
      stream: { write: (msg) => logger.http(msg.trim()) },
    }));
  }

  // Audit logging
  app.use(requestLogger);

  // Static assets (support root, /public prefix, and /img alias)
  const publicDir = join(__dirname, 'public');
  app.use(express.static(publicDir));
  app.use('/public', express.static(publicDir));
  app.use(['/img', '/public/img'], express.static(join(publicDir, 'images')));

  // API rate limiting
  app.use('/api', apiLimiter);

  // Application level WAF
  app.use(wafMiddleware);

  // ── Prometheus / OpenMetrics Metrics Exporter (Fase 5) ──
  app.get(['/metrics', '/api/metrics'], async (req, res) => {
    try {
      const metrics = await prometheusService.getMetrics();
      res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.send(metrics);
    } catch (err) {
      res.status(500).send(`# Error collecting metrics: ${err.message}\n`);
    }
  });

  // API routes
  app.use('/api', apiRoutes);

  // Global locals middleware for EJS templates
  app.use((req, res, next) => {
    res.locals.loadedPlugins = pluginLoader.getAll();
    next();
  });

  // [CSP HARDEN] Auto-inject nonces into inline <script>/<style> after rendering
  // MUST be before page routes so res.render() is already overridden when routes call it
  app.use(nonceInjector);

  // SPA / Page routes
  app.get('/', (req, res) => res.render('login/index', { layout: false }));
  app.get('/login/2fa', (req, res) => res.render('login/2fa', { layout: false }));
  app.get('/dashboard', (req, res) => res.render('dashboard/index', { title: 'Dashboard' }));
  app.get('/monitor', (req, res) => res.render('monitor/index', { title: 'Monitoring' }));
  app.get('/terminal', (req, res) => res.render('terminal/index', { title: 'Terminal' }));
  app.get('/filemanager', (req, res) => res.render('filemanager/index', { title: 'File Manager' }));
  app.get('/docker', (req, res) => res.render('docker/index', { title: 'Docker' }));
  app.get('/websites', (req, res) => res.render('websites/index', { title: 'Websites' }));
  app.get('/database', (req, res) => res.render('database/index', { title: 'Databases' }));
  app.get('/backup', (req, res) => res.render('backup/index', { title: 'Backups' }));
  app.get('/cron', (req, res) => res.render('cron/index', { title: 'Cron' }));
  app.get('/firewall', (req, res) => res.render('firewall/index', { title: 'Firewall' }));
  app.get('/system', (req, res) => res.render('system/index', { title: 'System' }));
  app.get('/ssl', (req, res) => res.render('ssl/index', { title: 'SSL Certificates' }));
  app.get('/waf', (req, res) => res.render('waf/index', { title: 'WAF' }));
  app.get('/dns', (req, res) => res.render('dns/index', { title: 'DNS Manager' }));
  app.get('/cloudflare', (req, res) => res.render('cloudflare/index', { title: 'Cloudflare Tunnel' }));
  app.get('/n8n', (req, res) => res.render('n8n/index', { title: 'n8n Automation' }));
  app.get('/tailscale', (req, res) => res.render('tailscale/index', { title: 'Tailscale VPN' }));
  app.get('/plugins', (req, res) => res.render('plugins/index', { title: 'Plugins' }));
  app.get('/cluster', (req, res) => res.render('cluster/index', { title: 'Cluster Manager' }));
  app.get('/settings/users', (req, res) => res.render('settings/users', { title: 'Users' }));
  app.get('/settings/roles', (req, res) => res.render('settings/roles', { title: 'Roles' }));
  app.get('/settings/profile', (req, res) => res.render('settings/profile', { title: 'Profile' }));
  app.get('/settings/audit', (req, res) => res.render('settings/audit', { title: 'Audit Log' }));
  app.get('/settings/changelog', (req, res) => res.render('settings/changelog', { title: 'Changelog' }));
  app.get('/settings/auth', (req, res) => res.render('settings/auth', { title: 'SSO / LDAP' }));
  app.get('/settings/themes', (req, res) => res.render('settings/themes', { title: 'Themes' }));
  app.get('/settings/password-policy', (req, res) => res.render('settings/password-policy', { title: 'Password Policy' }));
  app.get('/settings/password-policy-history', (req, res) => res.render('settings/password-policy-history', { title: 'Policy History' }));
  app.get('/whatsapp', (req, res) => res.render('whatsapp/index', { title: 'WhatsApp API' }));
  app.get('/api-docs', (req, res) => res.render('api-docs/index', { title: 'API Documentation' }));
  app.get('/nodejs', (req, res) => res.render('nodejs/index', { title: 'Node.js Manager' }));
  app.get('/python', (req, res) => res.render('python/index', { title: 'Python Manager' }));
  app.get('/mongodb', (req, res) => res.render('mongodb/index', { title: 'MongoDB Manager' }));
  app.get('/redis-manager', (req, res) => res.render('redis/index', { title: 'Redis Manager' }));
  app.get('/apache', (req, res) => res.render('apache/index', { title: 'Apache Manager' }));
  app.get('/analytics', (req, res) => res.render('analytics/index', { title: 'Analytics Dashboard' }));
  app.get('/autoheal', (req, res) => res.render('autoheal/index', { title: 'Auto-Healing' }));
  app.get('/ai-repair', (req, res) => res.render('ai-repair/index', { title: 'AI Auto-Repair' }));
  app.get('/updater', (req, res) => res.render('updater/index', { title: 'Panel Updater' }));
  app.get('/caddy', (req, res) => res.render('caddy/index', { title: 'Caddy Server' }));
  app.get('/gpu', (req, res) => res.render('gpu/index', { title: 'GPU Manager' }));
  app.get('/power', (req, res) => res.render('power/index', { title: 'Power Manager' }));
  app.get('/mail', (req, res) => res.render('mail/index', { title: 'Mail Server' }));
  app.get('/cdn', (req, res) => res.render('cdn/index', { title: 'CDN Manager' }));
  app.get('/iot', (req, res) => res.render('iot/index', { title: 'IoT Manager' }));
  // [DEDUP] /lvm-manager removed — merged into plugins/lvm-manager

  // Dynamic plugins router (loaded before 404 handler)
  app.use((req, res, next) => pluginLoader.handleProxy(req, res, next));
  app.use(pluginLoader.router);
  app.use('/api', pluginLoader.router);

  // Error handlers (must be last)
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

export default createApp;
