module.exports = {
  apps: [{
    name: 'enterprise-mcp',
    script: 'dist/index.js',
    args: '--http',
    cwd: '/opt/lanonasis/mcp-monorepo/packages/enterprise-mcp',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      PORT: 3010,
    },
    error_file: 'logs/error.log',
    out_file: 'logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
  }]
};
