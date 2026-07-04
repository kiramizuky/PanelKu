import Redis from 'ioredis';
import { Server as SocketIO } from 'socket.io';

import redisConfig from './config/redis.js';
import socketConfig from './config/socket.js';
import appConfig from './config/app.js';
import logger from './config/logger.js';
import { getDb } from './core/db/sqlite.js';
import { initWebSocket } from './websocket/index.js';
import { startMonitorJob } from './jobs/monitor.job.js';
import { startHealthJob } from './jobs/health.job.js';
import pluginLoader from './core/plugin-loader/PluginLoader.js';
import { mkdirSync } from 'fs';

// Ensure storage directories exist
['./storage/logs', './storage/uploads', './storage/backups', './storage/temp'].forEach((dir) => {
  mkdirSync(dir, { recursive: true });
});

let redis;

export const bootstrap = async (app, httpServer) => {
  // 1. Initialize SQLite (auto-creates tables on first run)
  logger.info('Initializing SQLite database...');
  getDb(); // singleton — opens & creates schema
  logger.info('SQLite database ready');

  // 2. Connect Redis
  logger.info('Connecting to Redis...');
  redis = new Redis(redisConfig);
  redis.on('error', (err) => logger.warn('Redis error: ' + err.message));
  redis.on('ready', () => logger.info('Redis connected'));
  try {
    await redis.connect();
  } catch (err) {
    logger.warn(`Failed to connect to Redis: ${err.message}. Panel will run without active background queues.`);
  }

  // 3. Seed initial data (roles, super admin)
  await seedInitialData();

  // 4. Initialize Socket.IO
  const io = new SocketIO(httpServer, socketConfig);
  initWebSocket(io);
  app.set('io', io);
  logger.info('Socket.IO initialized');

  // 5. Start background jobs
  startMonitorJob();
  startHealthJob();

  // 5.5 Load WAF cache
  const { refreshWafCache } = await import('./middleware/waf.middleware.js');
  await refreshWafCache();

  // 6. Load plugins
  await pluginLoader.loadAll(app, io);

  logger.info(`🚀 ${appConfig.appName} bootstrap complete`);
  return { io, redis };
};

export const gracefulShutdown = async () => {
  logger.info('Graceful shutdown initiated...');
  const { getDb } = await import('./core/db/sqlite.js');
  getDb().close();
  if (redis) await redis.quit();
  logger.info('Shutdown complete');
  process.exit(0);
};

async function seedInitialData() {
  const Role = (await import('./models/Role.js')).default;
  const User = (await import('./models/User.js')).default;
  const { ROLES, RESOURCES, ACTIONS } = await import('./config/constants.js');
  const bcrypt = (await import('bcryptjs')).default;

  // Create default roles if they don't exist
  const defaultRoles = [
    {
      name: 'Super Admin',
      slug: ROLES.SUPER_ADMIN,
      description: 'Full system access',
      isSystem: true,
      color: '#dc3545',
      permissions: Object.values(RESOURCES).map((r) => ({
        resource: r,
        actions: Object.values(ACTIONS),
      })),
    },
    {
      name: 'Admin',
      slug: ROLES.ADMIN,
      description: 'Administrative access',
      isSystem: true,
      color: '#0d6efd',
      permissions: Object.values(RESOURCES)
        .filter((r) => r !== RESOURCES.USERS && r !== RESOURCES.ROLES)
        .map((r) => ({ resource: r, actions: Object.values(ACTIONS) })),
    },
    {
      name: 'Operator',
      slug: ROLES.OPERATOR,
      description: 'Operational access',
      isSystem: true,
      color: '#fd7e14',
      permissions: [RESOURCES.DASHBOARD, RESOURCES.MONITOR, RESOURCES.TERMINAL, RESOURCES.DOCKER].map((r) => ({
        resource: r,
        actions: [ACTIONS.READ, ACTIONS.EXECUTE],
      })),
    },
    {
      name: 'Read Only',
      slug: ROLES.READ_ONLY,
      description: 'View-only access',
      isSystem: true,
      color: '#6c757d',
      permissions: [RESOURCES.DASHBOARD, RESOURCES.MONITOR].map((r) => ({
        resource: r,
        actions: [ACTIONS.READ],
      })),
    },
  ];

  for (const roleData of defaultRoles) {
    await Role.findOneAndUpdate(
      { slug: roleData.slug },
      roleData,
      { upsert: true, new: true }
    );
  }
  logger.info('Default roles seeded');

  // Create default super admin if no users exist
  const userCount = await User.countDocuments();
  if (userCount === 0) {
    const superAdminRole = await Role.findOne({ slug: ROLES.SUPER_ADMIN });
    await User.create({
      username: 'admin',
      email: 'admin@linuxpanel.local',
      password: 'Admin@123456',
      role: superAdminRole._id,
      firstName: 'Super',
      lastName: 'Admin',
      isSuperAdmin: true,
      isActive: true,
    });
    logger.warn('⚠️  Default admin created: username=admin password=Admin@123456 — CHANGE THIS IMMEDIATELY!');
  }
}
