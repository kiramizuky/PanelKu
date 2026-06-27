module.exports = {
  apps: [
    {
      name: 'linux-panel',
      script: 'src/server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '150M',
      node_args: '--max-old-space-size=128',
      env: {
        NODE_ENV: 'production',
        PORT: 23456,
      },
      error_file: './storage/logs/pm2-error.log',
      out_file: './storage/logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
