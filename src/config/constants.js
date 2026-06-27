// Roles
export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  OPERATOR: 'operator',
  READ_ONLY: 'read_only',
};

// Permissions Actions
export const ACTIONS = {
  READ: 'read',
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  EXECUTE: 'execute',
};

// Permission Resources (menus)
export const RESOURCES = {
  DASHBOARD: 'dashboard',
  MONITOR: 'monitor',
  TERMINAL: 'terminal',
  FILEMANAGER: 'filemanager',
  DOCKER: 'docker',
  WEBSITES: 'websites',
  DOMAINS: 'domains',
  SSL: 'ssl',
  NGINX: 'nginx',
  APACHE: 'apache',
  PHP: 'php',
  NODE: 'node',
  PYTHON: 'python',
  MYSQL: 'mysql',
  POSTGRES: 'postgres',
  MONGODB: 'mongodb',
  REDIS: 'redis',
  FIREWALL: 'firewall',
  WAF: 'waf',
  DNS: 'dns',
  CRON: 'cron',
  BACKUP: 'backup',
  RESTORE: 'restore',
  LOGS: 'logs',
  NOTIFICATIONS: 'notifications',
  UPDATES: 'updates',
  USERS: 'users',
  ROLES: 'roles',
  PERMISSIONS: 'permissions',
  SETTINGS: 'settings',
  AUDIT: 'audit',
  SYSTEM: 'system',
};

// Token types
export const TOKEN_TYPES = {
  ACCESS: 'access',
  REFRESH: 'refresh',
  RESET: 'reset',
};

// Socket Events
export const SOCKET_EVENTS = {
  MONITOR_UPDATE: 'monitor:update',
  DOCKER_UPDATE: 'docker:update',
  TERMINAL_DATA: 'terminal:data',
  TERMINAL_RESIZE: 'terminal:resize',
  NOTIFICATION: 'notification',
  SYSTEM_ALERT: 'system:alert',
};

// Monitor intervals (ms)
export const MONITOR_INTERVALS = {
  METRICS: 3000,
  NETWORK: 5000,
  DISK: 10000,
  HISTORY_SAVE: 60000,
};

// HTTP Status
export const HTTP = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  TOO_MANY_REQUESTS: 429,
  SERVER_ERROR: 500,
};
