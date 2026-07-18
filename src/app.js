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

import expressEjsLayouts from 'express-ejs-layouts';
import pluginLoader from './core/plugin-loader/PluginLoader.js';

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

  // Security
  app.use(helmet({
    crossOriginOpenerPolicy: false,
    originAgentCluster: false,
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        // [HARDEN] Removed 'unsafe-eval' — no eval/new Function used in codebase
        scriptSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'cdn.socket.io', 'static.cloudflareinsights.com'],
        // script-src-attr must include 'unsafe-inline' because LP.call() pattern
        // renders inline onclick="LP.call(...)" attributes via innerHTML.
        // helmet's default is 'none', which would block all inline event handlers,
        // so we must explicitly set it here despite the CSP weakness.
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net', 'fonts.googleapis.com'],
        fontSrc: ["'self'", 'fonts.gstatic.com', 'cdn.jsdelivr.net'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'", 'ws:', 'wss:', 'cdn.jsdelivr.net', 'cdn.socket.io', 'static.cloudflareinsights.com'],
        // [HARDEN] Restrict form submissions to same origin
        formAction: ["'self'"],
        // [HARDEN] Restrict base URI to prevent base tag injection
        baseUri: ["'self'"],
        // Allow same-origin framing (needed for API docs iframe)
        // Cross-origin framing (clickjacking) is still prevented
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

  // Static assets
  app.use(express.static(join(__dirname, 'public')));

  // API rate limiting
  app.use('/api', apiLimiter);

  // Application level WAF
  app.use(wafMiddleware);

  // API routes
  app.use('/api', apiRoutes);

  // Global locals middleware for EJS templates
  app.use((req, res, next) => {
    res.locals.loadedPlugins = pluginLoader.getAll();
    next();
  });

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
  app.get('/settings/panel', (req, res) => res.render('settings/panel', { title: 'Panel Update' }));
  app.get('/settings/audit', (req, res) => res.render('settings/audit', { title: 'Audit Log' }));
  app.get('/settings/changelog', (req, res) => res.render('settings/changelog', { title: 'Changelog' }));
  app.get('/settings/themes', (req, res) => res.render('settings/themes', { title: 'Themes' }));
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
