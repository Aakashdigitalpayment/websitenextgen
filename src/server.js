'use strict';
const config = require('./config');
const { createApp } = require('./app');
const tenants = require('./lib/tenants');

(async () => {
  await tenants.applyPlatformSchema();
  createApp().listen(config.port, () => console.log(`Cooperative platform listening on http://localhost:${config.port}`));
})().catch(e => { console.error(e); process.exit(1); });
