'use strict';
/**
 * Admin: election results, finalisation, winners → committee, in-person voting desk. Mounted at /admin/elections.
 * Legacy: admin/election-results.php, admin/election-voting-attendance.php. Staff may view; admins change things.
 */
const express = require('express');
const db = require('../db');
const auth = require('../lib/auth');
const util = require('../lib/util');
const nd = require('../lib/nepali-date');
const elections = require('../lib/elections');
const { flash } = require('../lib/security');

const router = express.Router();
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
router.use(auth.requireAdmin('staff'));
const adminOnly = auth.requireAdmin('admin');

const today = () => new Date(Date.now() + 345 * 60_000).toISOString().slice(0, 10);

router.get('/', ah(async (req, res) => {
  const cycles = await db.many(`SELECT c.*,
      (SELECT count(*) FROM election_vote_submissions s WHERE s.cycle_id = c.id AND s.is_ballot = 1) AS ballots,
      (SELECT count(*) FROM election_vote_submissions s WHERE s.cycle_id = c.id AND s.is_ballot = 0) AS attendance_only
    FROM election_cycles c ORDER BY c.voting_enabled DESC, c.sort_order, c.id DESC`);
  for (const c of cycles) c.state = elections.windowState(c);
  res.render('admin/elections', { title: res.locals.t('निर्वाचन नतिजा', 'Election results'), cycles, STATE_LABELS: elections.STATE_LABELS });
}));

async function loadCycle(req, res, next) {
  const cycle = await db.one('SELECT * FROM election_cycles WHERE id = $1', [util.int(req.params.id)]);
  if (!cycle) return next('route');
  req.cycle = cycle;
  next();
}

router.get('/:id', ah(loadCycle), ah(async (req, res) => {
  const cycle = req.cycle;
  const [positions, tallies, counts, eligible, recent, committees] = await Promise.all([
    db.many(`SELECT p.*, ct.name_np AS committee_name FROM election_positions p LEFT JOIN committee_types ct ON ct.id = p.committee_type_id
             WHERE p.cycle_id = $1 AND p.is_active = 1 ORDER BY p.display_order, p.id`, [cycle.id]),
    db.many(`SELECT c.id, c.position_id, c.name, c.name_en, c.symbol_no, c.photo, count(v.id) AS votes
             FROM election_candidates c LEFT JOIN election_votes v ON v.candidate_id = c.id AND v.cycle_id = c.cycle_id
             WHERE c.cycle_id = $1 AND c.is_active = 1 GROUP BY c.id ORDER BY c.position_id, votes DESC, c.display_order, c.id`, [cycle.id]),
    db.one(`SELECT count(*) FILTER (WHERE is_ballot = 1) AS ballots, count(*) FILTER (WHERE is_ballot = 0) AS attendance,
                   count(*) FILTER (WHERE is_ballot = 1 AND source = 'member_portal') AS digital, count(*) FILTER (WHERE source = 'manual_staff') AS manual
            FROM election_vote_submissions WHERE cycle_id = $1`, [cycle.id]),
    db.value("SELECT count(*) FROM members WHERE deleted_at IS NULL AND is_active = 1 AND approval_status = 'approved'"),
    db.many(`SELECT s.submitted_at, s.source, s.is_ballot, m.name, m.sadasyata_number FROM election_vote_submissions s LEFT JOIN members m ON m.id = s.member_id
             WHERE s.cycle_id = $1 ORDER BY s.submitted_at DESC LIMIT 20`, [cycle.id]),
    db.value('SELECT count(*) FROM election_positions WHERE cycle_id = $1 AND is_active = 1 AND committee_type_id IS NOT NULL', [cycle.id]),
  ]);
  const state = elections.windowState(cycle);
  const closed = elections.resultsVisible(cycle);
  const y = new Date().getFullYear();
  res.render('admin/election-results', {
    title: res.locals.f(cycle, 'title'), cycle, positions, tallies: closed ? tallies : [], closed, ballots: counts.ballots, counts, eligible, recent,
    state, stateLabel: elections.STATE_LABELS[state], committees, convertDefaults: { start: today(), end: `${y + 4}${today().slice(4)}`, name: `Tenure ${nd.adToBs(today())?.slice(0, 4) || y}` },
  });
}));

router.post('/:id/finalize', adminOnly, ah(loadCycle), ah(async (req, res) => {
  await elections.finalize(req.cycle.id);
  await auth.audit(req, 'election_finalize', 'election_cycles', req.cycle.id, 'Results finalised, voting closed');
  flash(req, 'success', res.locals.t('नतिजा अन्तिम (publish) गरियो। मतदान बन्द भयो।', 'Results finalised. Voting is closed.'));
  res.redirect('/admin/elections/' + req.cycle.id);
}));

router.post('/:id/convert', adminOnly, ah(loadCycle), ah(async (req, res) => {
  const b = req.body;
  const tenureName = String(b.tenure_name || '').trim().slice(0, 100) || `Tenure ${new Date().getFullYear()}`;
  const tenureNameNp = String(b.tenure_name_np || '').trim().slice(0, 100) || tenureName;
  const startDate = String(b.start_date || '').trim() || today();
  const endDate = String(b.end_date || '').trim() || `${Number(today().slice(0, 4)) + 4}${today().slice(4)}`;
  if (![startDate, endDate].every(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)))) {
    flash(req, 'error', res.locals.t('सुरु/अन्त्य मिति सही ढाँचामा राख्नुहोस् (YYYY-MM-DD)।', 'Enter start/end dates as YYYY-MM-DD.'));
    return res.redirect('/admin/elections/' + req.cycle.id);
  }
  const r = await elections.convertWinners(req.cycle.id, { tenureName, tenureNameNp, startDate, endDate });
  await auth.audit(req, 'election_convert_winners', 'election_cycles', req.cycle.id, `${r.added} winners → committee members (${r.tenures} tenures)`);
  let msg = res.locals.t(`${r.added} विजेता समिति सदस्यमा रूपान्तरण भयो। मतदान बन्द गरियो।`, `${r.added} winners added as committee members. Voting closed.`);
  if (r.skipped) msg += ' ' + res.locals.t(`(${r.skipped} पदमा समिति तोकिएको छैन — छोडियो।)`, `(${r.skipped} positions have no committee — skipped.)`);
  flash(req, 'success', msg);
  res.redirect('/admin/elections/' + req.cycle.id);
}));

// ---------------------------------------------------------------- in-person voting desk (manual ballot / attendance only)
router.get('/:id/desk', ah(loadCycle), ah(async (req, res) => {
  const cycle = req.cycle;
  const [positions, candidates, recent, counts] = await Promise.all([
    db.many('SELECT * FROM election_positions WHERE cycle_id = $1 AND is_active = 1 ORDER BY display_order, id', [cycle.id]),
    db.many('SELECT * FROM election_candidates WHERE cycle_id = $1 AND is_active = 1 ORDER BY position_id, display_order, id', [cycle.id]),
    db.many(`SELECT s.*, m.name, m.name_np, m.sadasyata_number, m.phone FROM election_vote_submissions s LEFT JOIN members m ON m.id = s.member_id
             WHERE s.cycle_id = $1 ORDER BY s.submitted_at DESC LIMIT 50`, [cycle.id]),
    db.one(`SELECT count(*) FILTER (WHERE is_ballot = 1) AS ballots, count(*) FILTER (WHERE source = 'member_portal' AND is_ballot = 1) AS digital,
                   count(*) FILTER (WHERE source = 'manual_staff') AS manual, count(*) FILTER (WHERE source = 'manual_attendance' OR is_ballot = 0) AS attendance
            FROM election_vote_submissions WHERE cycle_id = $1`, [cycle.id]),
  ]);
  res.render('admin/election-desk', { title: res.locals.t('मतदान उपस्थिति', 'Voting desk') + ' — ' + res.locals.f(cycle, 'title'), cycle, positions, candidates, recent, counts, open: elections.isOpen(cycle), PROOF_TYPES: elections.PROOF_TYPES });
}));

router.post('/:id/desk', adminOnly, ah(loadCycle), ah(async (req, res) => {
  const cycle = req.cycle;
  const back = `/admin/elections/${cycle.id}/desk`;
  const key = String(req.body.member_key || '').trim().slice(0, 60);
  const phone = nd.toLatinDigits(String(req.body.phone || '')).replace(/\D/g, '').slice(0, 15);
  const proofType = elections.PROOF_TYPES.some(p => p[0] === req.body.proof_type) ? req.body.proof_type : 'other';
  const note = String(req.body.note || '').trim().slice(0, 500);
  if (!key && !phone) { flash(req, 'error', res.locals.t('सदस्य नं. वा फोन आवश्यक छ।', 'Member no. or phone is required.')); return res.redirect(back); }
  const where = [], params = [];
  if (key) { params.push(key); where.push(`(sadasyata_number = $${params.length} OR member_card_no = $${params.length} OR id::text = $${params.length})`); }
  if (phone) { params.push(phone); where.push(`phone = $${params.length}`); }
  const member = await db.one(`SELECT id, name, name_np, sadasyata_number FROM members WHERE (${where.join(' OR ')}) AND is_active = 1 AND deleted_at IS NULL ORDER BY id LIMIT 1`, params);
  if (!member) { flash(req, 'error', res.locals.t('सदस्य नं./फोन मिल्ने सक्रिय सदस्य भेटिएन।', 'No active member matches that number/phone.')); return res.redirect(back); }
  const raw = {};
  for (const [k, v] of Object.entries(req.body)) if (/^pos_\d+$/.test(k)) raw[k.slice(4)] = v;
  const picks = await elections.normalisePicks(cycle.id, raw, { clamp: true });
  const r = await elections.submit({
    cycle, memberId: member.id, picks, source: picks.length ? 'manual_staff' : 'manual_attendance', proofType, note,
    adminId: req.admin.id, adminName: req.admin.full_name || req.admin.username, ip: req.ip, userAgent: req.get('user-agent'),
  });
  const who = `${member.name_np || member.name} (${member.sadasyata_number || '#' + member.id})`;
  const msgs = {
    closed: res.locals.t('मतदान समय बन्द छ — उम्मेदवार नछानी उपस्थिति मात्र दर्ता गर्नुहोस्, वा मतदान समय खोल्नुहोस्।', 'Voting is closed — record attendance only (no candidates), or open the voting window.'),
    duplicate_ballot: res.locals.t('दोहोरो: यो सदस्यले पहिल्यै मत हालिसक्नुभएको छ।', 'Duplicate: this member has already cast a ballot.') + ` (${r.previous?.source || ''})`,
    duplicate_attendance: res.locals.t('दोहोरो: यो सदस्यको उपस्थिति पहिल्यै दर्ता छ। पोर्टलबाट मत हाल्न सक्नुहुन्छ।', 'Duplicate: attendance is already recorded. The member can still vote online.'),
  };
  if (!r.ok) flash(req, 'error', msgs[r.code] + ' — ' + who);
  else {
    await auth.audit(req, 'election_' + (picks.length ? 'manual_ballot' : 'attendance'), 'election_vote_submissions', null, `Cycle #${cycle.id}: ${who} (${proofType})`);
    flash(req, 'success', who + ': ' + (r.kind === 'upgraded' ? res.locals.t('उपस्थितिबाट मतपत्रमा अपग्रेड भयो।', 'attendance upgraded to a manual ballot.')
      : r.kind === 'ballot' ? res.locals.t('मतपत्र सुरक्षित भयो।', 'manual ballot saved.')
        : res.locals.t('उपस्थिति मात्र सुरक्षित भयो — सदस्यले पोर्टलबाट अझै मत हाल्न सक्नुहुन्छ।', 'attendance only saved — the member can still vote online.')));
  }
  res.redirect(back);
}));

module.exports = router;
