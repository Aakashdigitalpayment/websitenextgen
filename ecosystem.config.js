// pm2 apps for Yeti Cloud (Jelastic Node.js "pm2" image starts /home/jelastic/ROOT/ecosystem.config.js at boot).
// docs/YETI.md explains the set-up. Secrets are never in this file: Node reads them from an env file outside
// the repository (--env-file), so a `git reset --hard` or a new release can never remove or expose them.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// deploy/yeti/deploy.sh builds each version in releases/r-…, then points `current` at it.
const RELEASES = process.env.COOP_RELEASES_DIR || '/home/jelastic/coop-releases';
const CURRENT = path.join(RELEASES, 'current');
const ROOT = fs.existsSync(path.join(CURRENT, 'src/server.js')) ? CURRENT : __dirname;
const ENV_FILE = [process.env.COOP_ENV_FILE, '/home/jelastic/coop.env', path.join(__dirname, '.env')].find(f => f && fs.existsSync(f));
const nodeArgs = ENV_FILE ? [`--env-file=${ENV_FILE}`] : [];

module.exports = {
  apps: [
    {
      name: 'coop-web',
      cwd: ROOT,
      script: 'src/server.js',
      node_args: nodeArgs,
      // what pm2 sets here wins over the env file
      env: { NODE_ENV: 'production', PORT: '8080', HOST: '0.0.0.0' },
      max_memory_restart: '700M',
      kill_timeout: 12000,          // src/server.js closes gracefully on SIGTERM (10 s)
      autorestart: true, max_restarts: 20, restart_delay: 3000,
      time: true, merge_logs: true,
    },
    {
      // daily housekeeping (expired OTPs, old logs, marketplace expiry …) at 02:30 Nepal time
      name: 'coop-cleanup',
      cwd: ROOT,
      script: 'scripts/cleanup.js',
      node_args: nodeArgs,
      env: { NODE_ENV: 'production', TZ: 'Asia/Kathmandu' },
      cron_restart: '30 2 * * *',
      autorestart: false,
      time: true,
    },
  ],
};
