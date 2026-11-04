'use strict';
/**
 * Election rules shared by the member ballot, the admin in-person desk and the results page
 * (legacy includes/election-tables.php, admin/election-voting-attendance.php, admin/election-results.php).
 *
 * Voting is open only when the cycle is published, voting_enabled = 1 and now (Nepal time) lies
 * inside [vote_start_at, vote_end_at]. A submission row is either a ballot (is_ballot = 1) or
 * "attendance only" (is_ballot = 0): an in-person check-in that still lets the member vote online.
 * Vote rows never record who voted (secret ballot) — the submission row does.
 */
const db = require('../db');

const PROOF_TYPES = [
  ['id_card', 'सदस्य परिचयपत्र', 'Member ID card'], ['license', 'सवारी चालक अनुमतिपत्र', 'Driving licence'],
  ['citizenship', 'नागरिकता', 'Citizenship'], ['passport', 'राहदानी', 'Passport'], ['other', 'अन्य', 'Other'],
];

/** 'draft' | 'disabled' | 'upcoming' | 'open' | 'ended' | 'unset' — same states as electionVoteWindowState(). */
function windowState(cycle, now = new Date()) {
  if (!cycle) return 'unset';
  if (!Number(cycle.is_published)) return 'draft';
  const enabled = !!Number(cycle.voting_enabled);
  if (!cycle.vote_start_at || !cycle.vote_end_at) return enabled ? 'unset' : 'disabled';
  const s = new Date(cycle.vote_start_at), e = new Date(cycle.vote_end_at);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 'unset';
  if (now < s) return enabled ? 'upcoming' : 'disabled';
  if (now > e) return 'ended';
  return enabled ? 'open' : 'disabled';
}
const isOpen = (cycle, now) => windowState(cycle, now) === 'open';

const STATE_LABELS = {
  draft: ['मस्यौदा', 'Draft'], disabled: ['मतदान बन्द', 'Voting off'], upcoming: ['चाँडै खुल्ने', 'Opens soon'],
  open: ['मतदान खुला', 'Voting open'], ended: ['मतदान सकियो', 'Voting ended'], unset: ['समय सेट छैन', 'Window not set'],
};

/** Results stay hidden while a ballot can still be cast (secrecy), unless finalised. */
function resultsVisible(cycle, now) {
  if (Number(cycle.results_finalized)) return true;
  const st = windowState(cycle, now);
  return !['open', 'upcoming'].includes(st);
}

const submissionOf = (cycleId, memberId) => db.one('SELECT * FROM election_vote_submissions WHERE cycle_id = $1 AND member_id = $2', [cycleId, memberId]);

/**
 * Validate picks against the cycle's positions/candidates.
 * picks: { [positionId]: candidateId | candidateId[] } → [[positionId, candidateId], ...]; throws {code:'too_many'|'invalid'}.
 * clamp = true silently cuts extra picks (legacy staff desk); otherwise too many is an error (member ballot).
 */
async function normalisePicks(cycleId, picks, { clamp = false } = {}) {
  const positions = await db.many('SELECT id, title_np, title_en, seats, max_votes_per_voter FROM election_positions WHERE cycle_id = $1 AND is_active = 1', [cycleId]);
  const candidates = await db.many('SELECT id, position_id FROM election_candidates WHERE cycle_id = $1 AND is_active = 1', [cycleId]);
  const out = [];
  for (const p of positions) {
    const raw = picks[p.id];
    let chosen = [...new Set((Array.isArray(raw) ? raw : raw ? [raw] : []).map(Number).filter(Boolean))];
    const max = Math.max(1, Number(p.max_votes_per_voter || p.seats || 1));
    if (chosen.length > max) {
      if (!clamp) throw Object.assign(new Error('too many'), { code: 'too_many', position: p, max });
      chosen = chosen.slice(0, max);
    }
    for (const c of chosen) {
      if (!candidates.some(x => x.id === c && x.position_id === p.id)) {
        if (clamp) continue;
        throw Object.assign(new Error('invalid ballot'), { code: 'invalid' });
      }
      out.push([p.id, c]);
    }
  }
  return out;
}

/**
 * Record a ballot or an attendance-only row in one transaction.
 * Returns { ok, kind: 'ballot'|'attendance'|'upgraded' } or { ok:false, code:'duplicate_ballot'|'duplicate_attendance'|'closed' }.
 */
async function submit({ cycle, memberId, picks, source, proofType = '', adminId = null, adminName = '', note = '', ip = null, userAgent = null }) {
  const isBallot = picks.length > 0;
  if (isBallot && !isOpen(cycle)) return { ok: false, code: 'closed' };
  return db.transaction(async () => {
    await db.query('SELECT pg_advisory_xact_lock($1, $2)', [cycle.id, memberId]);
    const old = await submissionOf(cycle.id, memberId);
    let kind;
    if (old) {
      if (Number(old.is_ballot) === 1) return { ok: false, code: 'duplicate_ballot', previous: old };
      if (!isBallot) return { ok: false, code: 'duplicate_attendance', previous: old };
      // attendance-only → ballot
      const upd = { source, is_ballot: 1, ip: ip ? String(ip).slice(0, 64) : old.ip, user_agent: userAgent ? String(userAgent).slice(0, 255) : old.user_agent };
      if (adminId) Object.assign(upd, { proof_type: proofType, verified_by_admin_id: adminId, verified_by_name: String(adminName || '').slice(0, 120), note: String(note || '').slice(0, 500) });
      await db.update('election_vote_submissions', old.id, upd);
      kind = 'upgraded';
    } else {
      await db.insert('election_vote_submissions', {
        cycle_id: cycle.id, member_id: memberId, submitted_at: new Date(), source, proof_type: proofType || '', verified_by_admin_id: adminId,
        verified_by_name: String(adminName || '').slice(0, 120), note: String(note || '').slice(0, 500), is_ballot: isBallot ? 1 : 0,
        ip: ip ? String(ip).slice(0, 64) : null, user_agent: userAgent ? String(userAgent).slice(0, 255) : null,
      });
      kind = isBallot ? 'ballot' : 'attendance';
    }
    // secret ballot: vote rows carry neither the voter nor the exact time, and are written in random order
    for (const [pos, cand] of [...picks].sort(() => Math.random() - 0.5)) {
      // random id (column default): retry on the rare collision
      for (let tries = 0; ; tries++) {
        try {
          await db.query('SAVEPOINT vote_row');
          await db.query('INSERT INTO election_votes (cycle_id, position_id, candidate_id, member_id, created_at) VALUES ($1, $2, $3, NULL, CURRENT_DATE)', [cycle.id, pos, cand]);
          await db.query('RELEASE SAVEPOINT vote_row');
          break;
        } catch (e) {
          await db.query('ROLLBACK TO SAVEPOINT vote_row');
          if (e.code !== '23505' || tries > 4) throw e;
        }
      }
    }
    return { ok: true, kind };
  });
}

/** Mark results final and close voting (legacy finalize_results). */
async function finalize(cycleId) {
  await db.query('UPDATE election_cycles SET results_finalized = 1, voting_enabled = 0, updated_at = now() WHERE id = $1', [cycleId]);
}

/**
 * Winners → committee members of a new tenure per committee (legacy convert_winners).
 * Positions without a committee are skipped. Ties broken by display order, then id.
 */
async function convertWinners(cycleId, { tenureName, tenureNameNp, startDate, endDate }) {
  return db.transaction(async () => {
    const positions = await db.many('SELECT * FROM election_positions WHERE cycle_id = $1 AND is_active = 1 AND committee_type_id IS NOT NULL ORDER BY display_order, id LIMIT 200', [cycleId]);
    const skipped = Number(await db.value('SELECT count(*) FROM election_positions WHERE cycle_id = $1 AND is_active = 1 AND committee_type_id IS NULL', [cycleId]));
    const tenures = new Map();
    let added = 0;
    for (const pos of positions) {
      const ct = Number(pos.committee_type_id);
      if (!tenures.has(ct)) {
        await db.query('UPDATE committee_tenures SET is_current = 0 WHERE committee_type_id = $1', [ct]);
        const t = await db.insert('committee_tenures', { committee_type_id: ct, tenure_name: tenureName, tenure_name_np: tenureNameNp, start_date: startDate, end_date: endDate, is_current: 1, is_active: 1 });
        tenures.set(ct, t.id);
      }
      const tid = tenures.get(ct);
      const seats = Math.max(1, Number(pos.seats) || 1);
      const winners = await db.many(`SELECT c.id, c.name, c.name_en, c.phone, c.email, c.address, c.photo, count(v.id) AS votes
                                     FROM election_candidates c LEFT JOIN election_votes v ON v.candidate_id = c.id
                                     WHERE c.cycle_id = $1 AND c.position_id = $2 AND c.is_active = 1
                                     GROUP BY c.id ORDER BY votes DESC, c.display_order ASC, c.id ASC LIMIT ${seats}`, [cycleId, pos.id]);
      let ord = 0;
      for (const w of winners) {
        ord++;
        if (await db.value('SELECT 1 FROM committee_members WHERE tenure_id = $1 AND name = $2 AND position = $3 LIMIT 1', [tid, w.name, pos.title_np])) continue;
        await db.insert('committee_members', {
          tenure_id: tid, name: w.name, name_en: w.name_en || null, position: pos.title_np, position_en: pos.title_en || null,
          phone: w.phone, email: w.email, address: w.address, photo: w.photo, display_order: ord, is_active: 1,
        });
        added++;
      }
    }
    await finalize(cycleId);
    return { added, skipped, tenures: tenures.size };
  });
}

/** Fill a position from the post master (legacy election-candidates.php save_position). */
async function applyPostDefaults(data, body = {}) {
  const postId = Number(data.post_id) || 0;
  if (!postId) return data;
  const pm = await db.one('SELECT * FROM election_posts WHERE id = $1', [postId]);
  if (!pm) return data;
  if (!data.title_np) data.title_np = pm.title_np;
  if (!data.title_en) data.title_en = pm.title_en;
  if (!data.committee_type_id) data.committee_type_id = pm.committee_type_id || null;
  if (!String(body.seats || '').trim()) data.seats = Math.max(1, Number(pm.default_seats) || 1);
  if (!String(body.max_votes_per_voter || '').trim()) data.max_votes_per_voter = Math.max(1, Number(pm.default_max_votes) || 1);
  return data;
}

module.exports = { PROOF_TYPES, STATE_LABELS, windowState, isOpen, resultsVisible, submissionOf, normalisePicks, submit, finalize, convertWinners, applyPostDefaults };
