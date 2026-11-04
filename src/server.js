'use strict';
const config = require('./config');
const { createApp } = require('./app');
const tenants = require('./lib/tenants');

(async () => {
  await tenants.applyPlatformSchema();
  const server = createApp().listen(config.port, process.env.HOST || (config.isProd ? '127.0.0.1' : '0.0.0.0'), () => console.log(`Cooperative platform listening on http://localhost:${config.port}`));
  if (process.env.WEBHOOK_WORKER !== 'off') require('./lib/webhooks').startWorker();
  const shutdown = sig => {
    console.log(`${sig} received — closing`);
    server.close(() => require('./db').pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
})().catch(e => { console.error(e); process.exit(1); });
