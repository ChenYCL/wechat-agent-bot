module.exports = {
  apps: [
    {
      name: 'wechat-agent-bot',
      script: 'npx',
      args: 'tsx src/index.ts',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
      },
      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './data/logs/error.log',
      out_file: './data/logs/out.log',
      merge_logs: true,
      // Auto-restart
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      watch: false,
      // Memory limit
      max_memory_restart: '500M',
    },
  ],
};
