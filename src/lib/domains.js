'use strict';
/**
 * Custom domains for tenants.
 *
 * Every tenant gets a unique generated hostname   <slug>-<5 random>.<CNAME_ZONE>   (its "CNAME target").
 * A wildcard DNS record  *.<CNAME_ZONE> → server  makes all targets resolve.
 * A client points their own domain at it:
 *   www.client.com.np   CNAME  aakash-7k2mq.coopcloud.com.np
 *   client.com.np       A      <server IP>           (apex domains cannot use CNAME; ALIAS/ANAME/flattening also works)
 * The platform serves (and issues HTTPS for) a client domain only after DNS has been verified.
 */
const dnsp = require('dns').promises;
const crypto = require('crypto');
const config = require('../config');

const ZONE = () => (process.env.CNAME_ZONE || config.baseDomain).toLowerCase();
const SERVER_IPS = () => String(process.env.SERVER_IPS || '').split(/[\s,]+/).filter(Boolean);
const skipDns = () => process.env.SKIP_DNS_VERIFY === '1' && !config.isProd;

const DOMAIN_RE = /^(?=.{3,253}$)(?!-)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/;
const ALPHA = 'abcdefghijkmnpqrstuvwxyz23456789';

function generateTarget(slug) {
  const rnd = Array.from(crypto.randomBytes(5), b => ALPHA[b % ALPHA.length]).join('');
  return `${String(slug).replace(/_/g, '-')}-${rnd}.${ZONE()}`;
}

/** Domains inside our own zone need no client DNS (we control the wildcard). */
const inOwnZone = d => d === ZONE() || d.endsWith('.' + ZONE()) || d === config.baseDomain || d.endsWith('.' + config.baseDomain);

/** A domain is an apex if it has only two labels, or matches a known 2-level public suffix (com.np, org.np, …). */
function isApex(d) {
  const parts = d.split('.');
  if (parts.length <= 2) return true;
  const SECOND_LEVEL = /^(com|org|net|edu|gov|mil|co|ac|info|name|coop)$/;
  return parts.length === 3 && SECOND_LEVEL.test(parts[1]) && parts[2].length === 2;
}

/** @param {{allowPlatformHost?: boolean}} [opts] operator/CLI only: let one cooperative share the platform host */
function validate(domain, { allowPlatformHost = false } = {}) {
  const d = String(domain || '').trim().toLowerCase().replace(/\.$/, '');
  if (!DOMAIN_RE.test(d)) return { error: 'Not a valid domain name (example: www.mycoop.com.np)' };
  if (d === config.platformHost && !allowPlatformHost) return { error: 'This host is reserved for the platform' };
  return { domain: d };
}

async function resolveSafe(fn, name) {
  try { return await fn(name); } catch (e) { return e.code === 'ENODATA' || e.code === 'ENOTFOUND' ? [] : null; }
}

/**
 * Check that `domain` points at the tenant: CNAME chain reaches the target,
 * or its A/AAAA addresses are all server addresses (SERVER_IPS, or whatever the target resolves to).
 * @returns {Promise<{ok:boolean, method?:string, found?:string, reason?:string}>}
 */
async function verify(domain, target, resolver = dnsp) {
  if (inOwnZone(domain)) return { ok: true, method: 'own-zone' };
  if (skipDns()) return { ok: true, method: 'skipped (SKIP_DNS_VERIFY=1, dev only)' };
  // 1) CNAME (follow up to 5 hops)
  let name = domain;
  const chain = [];
  for (let i = 0; i < 5; i++) {
    const c = await resolveSafe(n => resolver.resolveCname(n), name);
    if (c === null) return { ok: false, reason: 'DNS lookup failed — try again in a few minutes' };
    if (!c.length) break;
    name = c[0].toLowerCase().replace(/\.$/, '');
    chain.push(name);
    if (name === target) return { ok: true, method: 'CNAME', found: chain.join(' → ') };
  }
  if (chain.length) return { ok: false, reason: `CNAME points to ${chain.join(' → ')} instead of ${target}`, found: chain.join(' → ') };
  // 2) A / AAAA (apex domains, ALIAS / flattening)
  const [a4, a6] = await Promise.all([resolveSafe(n => resolver.resolve4(n), domain), resolveSafe(n => resolver.resolve6(n), domain)]);
  const addrs = [...(a4 || []), ...(a6 || [])];
  if (!addrs.length) return { ok: false, reason: 'No CNAME or A record found yet (DNS changes can take up to a few hours)' };
  let allowed = SERVER_IPS();
  if (!allowed.length) {
    const [t4, t6] = await Promise.all([resolveSafe(n => resolver.resolve4(n), target), resolveSafe(n => resolver.resolve6(n), target)]);
    allowed = [...(t4 || []), ...(t6 || [])];
  }
  if (!allowed.length) return { ok: false, reason: 'Server address unknown — set SERVER_IPS on the server' };
  const foreign = addrs.filter(ip => !allowed.includes(ip));
  if (foreign.length) return { ok: false, reason: `A record points to ${foreign.join(', ')} — it must point to ${allowed.join(', ')}`, found: addrs.join(', ') };
  return { ok: true, method: 'A record', found: addrs.join(', ') };
}

/** DNS records the client must create, for display. */
function instructions(domain, target) {
  if (inOwnZone(domain)) return [];
  if (isApex(domain)) {
    const ips = SERVER_IPS();
    return [
      { type: ips.length ? 'A' : 'ALIAS / ANAME', host: '@', value: ips.length ? ips.join(', ') : target, note: 'Apex domain: use an A record to the server IP, or ALIAS/ANAME/CNAME-flattening (Cloudflare) to the target.' },
      { type: 'CNAME', host: 'www', value: target, note: 'Recommended: also add www and make it the primary domain.' },
    ];
  }
  return [{ type: 'CNAME', host: domain, value: target, note: '' }];
}

module.exports = { generateTarget, verify, instructions, validate, inOwnZone, isApex, ZONE, skipDns };
