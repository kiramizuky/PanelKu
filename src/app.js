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
import { wafMiddleware, refreshWafCache } from './middleware/waf.middleware.js';

import expressEjsLayouts from 'express-ejs-layouts';

const __dirname = dirname(fileURLToPath(import.meta.url));

const createApp = () => {
  const app = express();

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
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'cdn.socket.io'],
        styleSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net', 'fonts.googleapis.com'],
        fontSrc: ["'self'", 'fonts.gstatic.com', 'cdn.jsdelivr.net'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'", 'ws:', 'wss:', 'cdn.jsdelivr.net', 'cdn.socket.io'],
        upgradeInsecureRequests: null,
      },
    },
  }));

  app.use(cors({
    origin: appConfig.isDev ? true : appConfig.appUrl,
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

  // SPA / Page routes
  app.get('/', (req, res) => res.render('login/index', { layout: false }));
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
  app.get('/dns', (req, res) => res.render('dns/index', { title: 'DNS Management' }));
  app.get('/alerts', (req, res) => res.render('alerts/index', { title: 'Alerts' }));
  app.get('/plugins', (req, res) => res.render('plugins/index', { title: 'Plugins' }));
  app.get('/settings/users', (req, res) => res.render('settings/users', { title: 'Users' }));
  app.get('/settings/roles', (req, res) => res.render('settings/roles', { title: 'Roles' }));
  app.get('/settings/profile', (req, res) => res.render('settings/profile', { title: 'Profile' }));

  // Error handlers (must be last)
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

export default createApp;
