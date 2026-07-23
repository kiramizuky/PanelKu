import 'dotenv/config';

// [CRIT-2 FIX] Fail fast in production if critical secrets are still defaults
if (process.env.NODE_ENV === 'production') {
  const REQUIRED_SECRETS = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'APP_SECRET'];
  const DANGEROUS_DEFAULTS = [
    'dev-secret-change-in-production',
    'jwt-secret-change-in-production',
    'refresh-secret-change-in-production',
  ];
  for (const key of REQUIRED_SECRETS) {
    const val = process.env[key];
    if (!val || DANGEROUS_DEFAULTS.includes(val)) {
      throw new Error(
        `[Security] ${key} must be set to a strong, unique secret in production. ` +
        `Do NOT use the default value from .env.example.`
      );
    }
  }
}

export default {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT) || 3000,
  appName: process.env.APP_NAME || 'Panelku',
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  appSecret: process.env.APP_SECRET || 'dev-secret-change-in-production',

  jwt: {
    secret: process.env.JWT_SECRET || 'jwt-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '30d',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'refresh-secret-change-in-production',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '90d',
  },

  session: {
    cookieName: process.env.SESSION_COOKIE_NAME || 'lp_session',
    maxAge: parseInt(process.env.SESSION_MAX_AGE) || 604800000,
  },

  totp: {
    issuer: process.env.TOTP_ISSUER || 'Panelku',
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
    max: parseInt(process.env.RATE_LIMIT_MAX) || 1000,
    authMax: parseInt(process.env.AUTH_RATE_LIMIT_MAX) || 30,
  },

  isDev: (process.env.NODE_ENV || 'development') === 'development',
  isProd: process.env.NODE_ENV === 'production',
};

