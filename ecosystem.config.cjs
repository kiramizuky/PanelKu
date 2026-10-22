const path = require('path');

module.exports = {
  apps: [
    {
      name: 'panelku',
      script: path.join(__dirname, 'src/server.js'),
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      // 600M was too tight for normal use and caused restart loops; 768M still
      // fits a 1 GB VPS together with nginx/redis.
      max_memory_restart: '768M',
      node_args: '--max-old-space-size=384',
      env: {
        NODE_ENV: 'production',
        PORT: 23456,
      },
      error_file: path.join(__dirname, 'storage/logs/pm2-error.log'),
      out_file: path.join(__dirname, 'storage/logs/pm2-out.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
