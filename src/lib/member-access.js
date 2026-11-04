'use strict';
/**
 * Members-only public documents (port of includes/public-member-access.php):
 * a visitor may open access_level = 'member' items when signed in as a member, signed in as staff,
 * or after unlocking with an approved, active membership number (rate limited, generic errors).
 */
const db = require('../db');
const nd = require('./nepali-date');

const SESSION_KEY = 'memberUnlock';
const GUARD_KEY = 'memberUnlockGuard';
const MAX_FAILS = 8, BLOCK_MS = 15 * 60_000, UNLOCK_TTL = 8 * 3600_000;

const normalizeLevel = v => (String(v || '').trim().toLowerCase() === 'member' ? 'member' : 'none');

function unlocked(req) {
  if (req.admin || req.member) return true;
  const u = req.session && req.session[SESSION_KEY];
  return !!(u && Date.now() - u.at < UNLOCK_TTL);
}
const canOpen = (req, level) => normalizeLevel(level) !== 'member' || unlocked(req);

function guard(req) {
  const g = req.session[GUARD_KEY] || { fails: 0, until: 0 };
  return g.until > Date.now() ? { blocked: true, retry: Math.ceil((g.until - Date.now()) / 1000) } : { blocked: false };
}
function fail(req) {
  const g = req.session[GUARD_KEY] || { fails: 0, until: 0 };
  g.fails = (g.fails || 0) + 1;
  if (g.fails >= MAX_FAILS) { g.until = Date.now() + BLOCK_MS; g.fails = 0; }
  req.session[GUARD_KEY] = g;
}

/** @returns {Promise<{ok:true}|{ok:false,error:[np,en]}>} */
async function tryUnlock(req, raw) {
  if (guard(req).blocked) return { ok: false, error: ['धेरै पटक प्रयास भयो। केही समयपछि फेरि प्रयास गर्नुहोस्।', 'Too many attempts. Please try again later.'] };
  const id = nd.toLatinDigits(String(raw || '')).replace(/\s+/g, '').toUpperCase().slice(0, 50);
  if (id.length < 2) { fail(req); return { ok: false, error: ['मान्य सदस्यता नम्बर लेख्नुहोस्।', 'Enter a valid membership number.'] }; }
  const variants = [...new Set([id, nd.toNepaliDigits ? nd.toNepaliDigits(id) : id])];
  const row = await db.one(`SELECT id FROM members WHERE deleted_at IS NULL AND is_active = 1 AND approval_status = 'approved'
                            AND upper(trim(sadasyata_number)) = ANY($1::text[]) LIMIT 1`, [variants]);
  if (!row) { fail(req); return { ok: false, error: ['सदस्यता नम्बर प्रमाणित हुन सकेन।', 'Membership number could not be verified.'] }; }
  req.session[SESSION_KEY] = { at: Date.now(), via: 'membership_no', memberId: row.id };
  delete req.session[GUARD_KEY];
  return { ok: true };
}

module.exports = { normalizeLevel, unlocked, canOpen, tryUnlock, guard };
