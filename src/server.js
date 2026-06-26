import 'dotenv/config';
import http from 'http';
import createApp from './app.js';
import { bootstrap, gracefulShutdown } from './bootstrap.js';
import appConfig from './config/app.js';
import logger from './config/logger.js';

const start = async () => {
  const app = createApp();
  const server = http.createServer(app);

  try {
    await bootstrap(app, server);
  } catch (err) {
    logger.error('Bootstrap failed:', err);
    process.exit(1);
  }

  server.listen(appConfig.port, () => {
    logger.info(`
╔════════════════════════════════════════╗
║       Linux Server Control Panel       ║
╠════════════════════════════════════════╣
║  URL:   http://localhost:${appConfig.port}          ║
║  Mode:  ${appConfig.env.padEnd(30)}  ║
║  Node:  ${process.version.padEnd(30)}  ║
╚════════════════════════════════════════╝
    `);
  });

  // Graceful shutdown handlers
  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled Rejection:', reason);
  });

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception:', err);
    process.exit(1);
  });
};

start();
