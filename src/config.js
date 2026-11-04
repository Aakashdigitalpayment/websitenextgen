'use strict';
require('dotenv').config({ quiet: true });
const path = require('path');

// All wall-clock times (forms, DB timestamps, CURRENT_DATE) are Nepal time.
process.env.TZ = process.env.APP_TIMEZONE || process.env.TZ || 'Asia/Kathmandu';

const env = process.env.NODE_ENV || 'development';
const config = {
  env,
  isProd: env === 'production',
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL || 'postgres://coop:coop@localhost:5432/coop',
  sessionSecret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
  rootDir: path.resolve(__dirname, '..'),
  uploadDir: path.resolve(__dirname, '..', process.env.UPLOAD_DIR || 'uploads'),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 8),
  // Multi-tenant
  // Base domain for subdomain tenants: <slug>.<baseDomain>  (e.g. aakash.coopcloud.np)
  baseDomain: (process.env.BASE_DOMAIN || 'localhost').toLowerCase(),
  // Host that serves the platform console (/platform). Defaults to the bare base domain.
  platformHost: (process.env.PLATFORM_HOST || process.env.BASE_DOMAIN || 'localhost').toLowerCase(),
  // Tenant used when the host matches nothing (handy for local dev). Empty = 404.
  defaultTenant: process.env.DEFAULT_TENANT || '',
  platformUser: process.env.PLATFORM_ADMIN_USER || '',
  platformPassword: process.env.PLATFORM_ADMIN_PASSWORD || '',
};

if (config.isProd && config.defaultTenant) {
  console.warn('WARNING: DEFAULT_TENANT is set in production — any Host header will be served as that tenant. Leave it empty.');
}
if (config.isProd && config.sessionSecret === 'dev-only-secret-change-me') {
  throw new Error('SESSION_SECRET must be set in production');
}
module.exports = config;
