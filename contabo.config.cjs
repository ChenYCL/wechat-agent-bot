/**
 * PM2 config for the jp-contabo VPS (or any Linux host where Node 22
 * was installed via nvm into ~/.nvm). Points to the nvm-managed Node
 * 22 binary so it doesn't conflict with system Node.
 *
 * Usage:
 *   pm2 start contabo.config.cjs
 *   pm2 save                          # persist across reboots
 *   pm2 startup                       # run once to install systemd
 *
 * Required env vars (place in .env):
 *   PORT=3210
 *   HOST=0.0.0.0          # 0.0.0.0 for direct exposure, 127.0.0.1 + SSH tunnel for safer
 *   API_SECRET=<random>
 *   ADMIN_PASSWORD=<random>
 *   NODE_ENV=production
 *   TZ=Asia/Shanghai
 *   # Optional: SECURE_COOKIES=1 if behind HTTPS reverse proxy
 */
const path = require('node:path');
const fs = require('node:fs');

function findNvmNode(version) {
  const home = process.env.HOME || '/root';
  const dir = path.join(home, '.nvm/versions/node');
  if (!fs.existsSync(dir)) return null;
  const versions = fs.readdirSync(dir).filter((v) => v.startsWith(`v${version}`));
  if (versions.length === 0) return null;
  return path.join(dir, versions[0], 'bin');
}

const NODE_BIN = findNvmNode(22) || '/usr/bin';
const NODE = path.join(NODE_BIN, 'node');
const TSX = path.join(__dirname, 'node_modules/.bin/tsx');

module.exports = {
  apps: [{
    name: 'wechat-agent-bot',
    script: NODE,
    args: `${TSX} src/index.ts`,
    cwd: __dirname,
    interpreter: 'none',
    env: {
      NODE_ENV: 'production',
      PATH: `${NODE_BIN}:/usr/bin:/bin`,
    },
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000,
    max_memory_restart: '500M',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true,
  }],
};
