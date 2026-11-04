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
const domainsLib = require('./domains');
const domains = domainsLib;

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
    `SELECT t.*, 'custom' AS host_kind FROM platform.tenant_domains d JOIN platform.tenants t ON t.id = d.tenant_id WHERE d.domain = $1 AND d.status = 'active'`, [host]);
  if (!tenant) tenant = await db.one(`SELECT t.*, 'target' AS host_kind FROM platform.tenants t WHERE t.cname_target = $1`, [host]);
  if (!tenant && host.endsWith('.' + config.baseDomain)) {
    const slug = host.slice(0, -(config.baseDomain.length + 1));
    if (SLUG_RE.test(slug)) tenant = await db.one(`SELECT t.*, 'subdomain' AS host_kind FROM platform.tenants t WHERE slug = $1`, [slug]);
  }
  if (!tenant && config.defaultTenant && host !== config.platformHost) {
    tenant = await db.one(`SELECT t.*, 'default' AS host_kind FROM platform.tenants t WHERE slug = $1`, [config.defaultTenant]);
  }
  if (tenant) {
    tenant.primary_domain = await db.value(`SELECT domain FROM platform.tenant_domains WHERE tenant_id = $1 AND is_primary AND status = 'active'`, [tenant.id]);
  }
  if (tenant && host.length <= 253) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(host, { tenant, at: Date.now() });
  }
  return tenant;
}

async function list() {
  return db.many(`SELECT t.*,
      COALESCE(array_agg(d.domain ORDER BY d.is_primary DESC, d.domain) FILTER (WHERE d.domain IS NOT NULL), '{}') AS domains,
      COALESCE(json_agg(json_build_object('id', d.id, 'domain', d.domain, 'status', d.status, 'is_primary', d.is_primary, 'last_error', d.last_error, 'verified_at', d.verified_at, 'last_check_at', d.last_check_at)
               ORDER BY d.is_primary DESC, d.domain) FILTER (WHERE d.domain IS NOT NULL), '[]') AS domain_rows
    FROM platform.tenants t LEFT JOIN platform.tenant_domains d ON d.tenant_id = t.id
    GROUP BY t.id ORDER BY t.created_at DESC`);
}

async function domainsOf(tenantId) {
  return db.many('SELECT * FROM platform.tenant_domains WHERE tenant_id = $1 ORDER BY is_primary DESC, domain', [tenantId]);
}

async function get(id) {
  return db.one('SELECT * FROM platform.tenants WHERE id = $1', [id]);
}

async function applyPlatformSchema() {
  await db.query(fs.readFileSync(path.join(DB_DIR, 'platform.sql'), 'utf8'));
  // every tenant needs a unique generated hostname (CNAME target)
  for (const t of await db.many('SELECT id, slug FROM platform.tenants WHERE cname_target IS NULL')) {
    await db.query('UPDATE platform.tenants SET cname_target = $1 WHERE id = $2', [domains.generateTarget(t.slug), t.id]);
  }
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
/**
 * @param {object} o
 * @param {string|null} [o.design='saving_credit'] starter design key (src/lib/starter.js); null = leave the defaults untouched
 * @param {boolean} [o.starterContent=true] also create starter content (services, rates, FAQs, committees, slides…)
 */
async function createTenant({ slug, name, nameEn = '', domains: domainList = [], adminUsername = 'admin', adminPassword, contactEmail = null, design = 'saving_credit', starterContent = true, plan = 'extra' }) {
  slug = String(slug || '').toLowerCase().trim();
  if (!SLUG_RE.test(slug)) throw new Error('Slug must be 2–40 chars: lowercase letters, digits, underscore; start with a letter');
  if (!name) throw new Error('Name is required');
  if (!adminPassword || adminPassword.length < 8) throw new Error('Admin password must be at least 8 characters');
  const schemaName = 'tenant_' + slug;

  const exists = await db.value('SELECT 1 FROM platform.tenants WHERE slug = $1', [slug]);
  if (exists) throw new Error(`Tenant "${slug}" already exists`);

  const tenant = await db.one(
    `INSERT INTO platform.tenants (slug, name, schema_name, contact_email, cname_target, plan) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [slug, name, schemaName, contactEmail, domainsLib.generateTarget(slug), require('./plans').isPlan(plan) ? plan : 'extra']);
  try {
    for (const d of domainList.map(normalizeHost).filter(Boolean)) await addDomain(tenant.id, d, { verifyNow: false });
    if (domainList.length) await refreshPrimary(tenant.id);
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
      if (design) await require('./starter').apply(design, { content: starterContent });
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

/**
 * Add a domain. Domains in our own zone are active immediately; client domains start
 * 'pending' and become 'active' once DNS points at the tenant (verifyDomain).
 */
async function addDomain(tenantId, domain, { verifyNow = true } = {}) {
  const v = domainsLib.validate(domain);
  if (v.error) throw new Error(v.error);
  const own = domainsLib.inOwnZone(v.domain);
  const row = await db.one(`INSERT INTO platform.tenant_domains (tenant_id, domain, status, verified_at) VALUES ($1, $2, $3, $4) RETURNING *`,
    [tenantId, v.domain, own ? 'active' : 'pending', own ? new Date() : null]);
  clearCache();
  return verifyNow && !own ? verifyDomain(row.id) : row;
}

/** Check DNS for one domain row and update its status. */
async function verifyDomain(domainId) {
  const d = await db.one('SELECT d.*, t.cname_target FROM platform.tenant_domains d JOIN platform.tenants t ON t.id = d.tenant_id WHERE d.id = $1', [domainId]);
  if (!d) throw new Error('domain not found');
  const r = await domainsLib.verify(d.domain, d.cname_target);
  const status = r.ok ? 'active' : d.status === 'active' ? 'active' : (d.check_count >= 288 ? 'failed' : 'pending'); // ~3 days of 15-minute checks
  const row = await db.one(`UPDATE platform.tenant_domains SET status = $1, last_check_at = now(), check_count = check_count + 1,
                              last_error = $2, verified_at = CASE WHEN $3 THEN COALESCE(verified_at, now()) ELSE verified_at END
                            WHERE id = $4 RETURNING *`, [status, r.ok ? null : String(r.reason).slice(0, 255), r.ok, d.id]);
  if (r.ok) await refreshPrimary(d.tenant_id);
  clearCache();
  return { ...row, check: r };
}

/** Make sure a tenant with active client domains has one primary (prefer www.*, then the first verified). */
async function refreshPrimary(tenantId) {
  const rows = await db.many("SELECT * FROM platform.tenant_domains WHERE tenant_id = $1 ORDER BY verified_at NULLS LAST, id", [tenantId]);
  const current = rows.find(r => r.is_primary);
  const candidates = rows.filter(r => r.status === 'active' && !domainsLib.inOwnZone(r.domain));
  // keep an active primary, unless it is our own subdomain and the client now has a verified domain
  if (current && current.status === 'active' && (!domainsLib.inOwnZone(current.domain) || !candidates.length)) return current.domain;
  const pick = candidates.find(r => r.domain.startsWith('www.')) || candidates[0] || rows.find(r => r.status === 'active');
  if (!pick) return null;
  await setPrimary(tenantId, pick.id);
  return pick.domain;
}

async function setPrimary(tenantId, domainId) {
  await db.transaction(async () => {
    await db.query('UPDATE platform.tenant_domains SET is_primary = false WHERE tenant_id = $1 AND is_primary', [tenantId]);
    await db.query("UPDATE platform.tenant_domains SET is_primary = true WHERE tenant_id = $1 AND id = $2 AND status = 'active'", [tenantId, domainId]);
  });
  clearCache();
}

async function removeDomain(tenantId, domain) {
  await db.query('DELETE FROM platform.tenant_domains WHERE tenant_id = $1 AND domain = $2', [tenantId, normalizeHost(domain)]);
  await refreshPrimary(tenantId);
  clearCache();
}

/** Background: re-check pending domains every 15 minutes (started by server.js). */
function startDomainWorker(intervalMs = 15 * 60_000) {
  const tick = async () => {
    try {
      const due = await db.many("SELECT id FROM platform.tenant_domains WHERE status = 'pending' AND (last_check_at IS NULL OR last_check_at < now() - interval '14 minutes') LIMIT 50");
      for (const d of due) await verifyDomain(d.id).catch(() => {});
    } catch (e) { console.error('domain worker:', e.message); }
  };
  const t = setInterval(tick, intervalMs);
  t.unref();
  setTimeout(tick, 5_000).unref();
  return t;
}

module.exports = {
  resolveHost, list, get, createTenant, migrateTenant, applyPlatformSchema, setStatus,
  addDomain, removeDomain, verifyDomain, setPrimary, refreshPrimary, domainsOf, startDomainWorker, clearCache, normalizeHost, SLUG_RE,
};
