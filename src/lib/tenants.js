'use strict';
/**
 * Tenant registry: resolve a request host to a tenant, create/provision tenants,
 * and run per-tenant migrations.
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('../db');
const config = require('../config');

const DB_DIR = path.join(config.rootDir, 'db');
const SLUG_RE = /^[a-z][a-z0-9_]{1,39}$/;

const cache = new Map(); // host -> { tenant, at }  (only hosts that resolve to a tenant; bounded)
const CACHE_MS = 30_000, CACHE_MAX = 2000;

function clearCache() { cache.clear(); }

function normalizeHost(host) {
  return String(host || '').toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
}

/** Find the tenant for a Host header: custom domain first, then <slug>.<baseDomain>. */
async function resolveHost(rawHost) {
  const host = normalizeHost(rawHost);
  const hit = cache.get(host);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.tenant;

  let tenant = await db.one(
    `SELECT t.* FROM platform.tenant_domains d JOIN platform.tenants t ON t.id = d.tenant_id WHERE d.domain = $1`, [host]);
  if (!tenant && host.endsWith('.' + config.baseDomain)) {
    const slug = host.slice(0, -(config.baseDomain.length + 1));
    if (SLUG_RE.test(slug)) tenant = await db.one('SELECT * FROM platform.tenants WHERE slug = $1', [slug]);
  }
  if (!tenant && config.defaultTenant && host !== config.platformHost) {
    tenant = await db.one('SELECT * FROM platform.tenants WHERE slug = $1', [config.defaultTenant]);
  }
  if (tenant && host.length <= 253) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(host, { tenant, at: Date.now() });
  }
  return tenant;
}

async function list() {
  return db.many(`SELECT t.*, COALESCE(array_agg(d.domain ORDER BY d.is_primary DESC, d.domain) FILTER (WHERE d.domain IS NOT NULL), '{}') AS domains
                  FROM platform.tenants t LEFT JOIN platform.tenant_domains d ON d.tenant_id = t.id
                  GROUP BY t.id ORDER BY t.created_at DESC`);
}

async function get(id) {
  return db.one('SELECT * FROM platform.tenants WHERE id = $1', [id]);
}

async function applyPlatformSchema() {
  await db.query(fs.readFileSync(path.join(DB_DIR, 'platform.sql'), 'utf8'));
}

function migrationFiles() {
  const dir = path.join(DB_DIR, 'migrations');
  return fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
}

/** Bring one tenant schema up to date (base schema + pending migrations). */
async function migrateTenant(tenant) {
  const schema = db.ident(tenant.schema_name);
  await db.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  return db.withSchema(schema, async () => {
    const hasBase = await db.value(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'schema_migrations'`, [schema]);
    if (!hasBase) await db.query(fs.readFileSync(path.join(DB_DIR, 'schema.sql'), 'utf8'));
    const applied = new Set((await db.many('SELECT version FROM schema_migrations')).map(r => r.version));
    const ran = [];
    for (const file of migrationFiles()) {
      const version = file.replace(/\.sql$/, '');
      if (applied.has(version)) continue;
      await db.transaction(async () => {
        await db.query(fs.readFileSync(path.join(DB_DIR, 'migrations', file), 'utf8'));
        await db.query('INSERT INTO schema_migrations (version, description, applied_at) VALUES ($1, $2, CURRENT_TIMESTAMP)', [version, 'node: ' + file]);
      });
      ran.push(version);
    }
    return ran;
  });
}

const DEFAULT_SETTINGS = [
  ['site_name', '', 'text', 'संस्थाको नाम (नेपाली)', 'general'],
  ['site_name_en', '', 'text', 'Organisation name (English)', 'general'],
  ['site_tagline', 'सदस्यको हितमा, समुदायको साथमा', 'text', 'Tagline', 'general'],
  ['logo', '', 'image', 'Logo', 'general'],
  ['primary_color', '#0f766e', 'color', 'Brand colour', 'theme'],
  ['phone', '', 'text', 'Phone', 'contact'],
  ['mobile', '', 'text', 'Mobile', 'contact'],
  ['email', '', 'text', 'Email', 'contact'],
  ['address', '', 'textarea', 'Address', 'contact'],
  ['working_hours', 'आइतबार–शुक्रबार, १०:०० – ५:००', 'text', 'Working hours', 'contact'],
  ['map_embed_url', '', 'url', 'Google map embed URL', 'contact'],
  ['established_year', '', 'text', 'Established year', 'about'],
  ['registration_no', '', 'text', 'Registration number', 'about'],
  ['about_short', '', 'textarea', 'Short introduction', 'about'],
  ['about_content', '', 'textarea', 'About us (full)', 'about'],
  ['vision_content_np', '', 'textarea', 'Vision', 'about'],
  ['mission_content_np', '', 'textarea', 'Mission', 'about'],
  ['chairman_message_np', '', 'textarea', 'Chairman message', 'about'],
  ['ceo_message_np', '', 'textarea', 'CEO message', 'about'],
  ['facebook_url', '', 'url', 'Facebook', 'social'],
  ['youtube_url', '', 'url', 'YouTube', 'social'],
  ['instagram_url', '', 'url', 'Instagram', 'social'],
  ['whatsapp_number', '', 'text', 'WhatsApp number', 'social'],
  ['play_store_url', '', 'url', 'Play Store app', 'apps'],
  ['app_store_url', '', 'url', 'App Store app', 'apps'],
  ['internet_banking_url', '', 'url', 'Internet banking', 'apps'],
  ['meta_description', '', 'textarea', 'SEO description', 'seo'],
];

/**
 * Create a tenant: registry row, schema, tables, default settings and first admin.
 * @returns {Promise<object>} tenant row
 */
async function createTenant({ slug, name, nameEn = '', domains = [], adminUsername = 'admin', adminPassword, contactEmail = null }) {
  slug = String(slug || '').toLowerCase().trim();
  if (!SLUG_RE.test(slug)) throw new Error('Slug must be 2–40 chars: lowercase letters, digits, underscore; start with a letter');
  if (!name) throw new Error('Name is required');
  if (!adminPassword || adminPassword.length < 8) throw new Error('Admin password must be at least 8 characters');
  const schemaName = 'tenant_' + slug;

  const exists = await db.value('SELECT 1 FROM platform.tenants WHERE slug = $1', [slug]);
  if (exists) throw new Error(`Tenant "${slug}" already exists`);

  const tenant = await db.one(
    `INSERT INTO platform.tenants (slug, name, schema_name, contact_email) VALUES ($1, $2, $3, $4) RETURNING *`,
    [slug, name, schemaName, contactEmail]);
  try {
    for (const [i, d] of domains.map(normalizeHost).filter(Boolean).entries()) {
      await db.query('INSERT INTO platform.tenant_domains (tenant_id, domain, is_primary) VALUES ($1, $2, $3)', [tenant.id, d, i === 0]);
    }
    await migrateTenant(tenant);
    await db.withSchema(schemaName, async () => {
      for (const [key, val, type, label, group] of DEFAULT_SETTINGS) {
        const v = key === 'site_name' ? name : key === 'site_name_en' ? (nameEn || name) : val;
        await db.query(
          `INSERT INTO site_settings (setting_key, setting_value, setting_type, setting_label, setting_group)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT (setting_key) DO NOTHING`, [key, v, type, label, group]);
      }
      await db.query(
        `INSERT INTO admin_users (username, password, full_name, role, is_active, status) VALUES ($1, $2, $3, 'superadmin', 1, 'active')`,
        [adminUsername, await bcrypt.hash(adminPassword, 12), 'Super Admin']);
    });
  } catch (e) {
    // roll back a half-provisioned tenant
    await db.query(`DROP SCHEMA IF EXISTS ${db.ident(schemaName)} CASCADE`).catch(() => {});
    await db.query('DELETE FROM platform.tenants WHERE id = $1', [tenant.id]).catch(() => {});
    throw e;
  }
  clearCache();
  return tenant;
}

async function setStatus(id, status) {
  if (!['active', 'suspended'].includes(status)) throw new Error('bad status');
  await db.query('UPDATE platform.tenants SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [status, id]);
  clearCache();
}

async function addDomain(tenantId, domain) {
  await db.query('INSERT INTO platform.tenant_domains (tenant_id, domain) VALUES ($1, $2)', [tenantId, normalizeHost(domain)]);
  clearCache();
}

async function removeDomain(tenantId, domain) {
  await db.query('DELETE FROM platform.tenant_domains WHERE tenant_id = $1 AND domain = $2', [tenantId, normalizeHost(domain)]);
  clearCache();
}

module.exports = {
  resolveHost, list, get, createTenant, migrateTenant, applyPlatformSchema, setStatus,
  addDomain, removeDomain, clearCache, normalizeHost, SLUG_RE,
};
