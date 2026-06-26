import 'dotenv/config';

export default {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT) || 3000,
  appName: process.env.APP_NAME || 'LinuxPanel',
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  appSecret: process.env.APP_SECRET || 'dev-secret-change-in-production',

  jwt: {
    secret: process.env.JWT_SECRET || 'jwt-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'refresh-secret-change-in-production',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  session: {
    cookieName: process.env.SESSION_COOKIE_NAME || 'lp_session',
    maxAge: parseInt(process.env.SESSION_MAX_AGE) || 604800000,
  },

  totp: {
    issuer: process.env.TOTP_ISSUER || 'LinuxPanel',
  },

  upload: {
    maxSize: parseInt(process.env.UPLOAD_MAX_SIZE) || 104857600,
    path: process.env.UPLOAD_PATH || './storage/uploads',
  },

  backup: {
    path: process.env.BACKUP_PATH || './storage/backups',
  },

  logs: {
    level: process.env.LOG_LEVEL || 'info',
    path: process.env.LOG_PATH || './storage/logs',
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
    max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
    authMax: parseInt(process.env.AUTH_RATE_LIMIT_MAX) || 10,
  },

  isDev: (process.env.NODE_ENV || 'development') === 'development',
  isProd: process.env.NODE_ENV === 'production',
};
