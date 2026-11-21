'use strict';
/** Bulk member import from CSV: parse → validate & stage (member_import_rows) → commit. */
const db = require('../db');
const nd = require('./nepali-date');
const auth = require('./auth');
const util = require('./util');
const pii = require('./pii-crypto');

/** RFC 4180 CSV parser (quotes, escaped quotes, CRLF, BOM). */
function parseCsv(text) {
  const s = String(text).replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(v => v.trim() !== ''));
}

// header aliases (legacy includes/member-import-helpers.php)
const ALIASES = {
  sadasyata_number: ['sadasyata_number', 'member_no', 'membership_no', 'member_id', 'memberid', 'sadasyata', 'sadasyata_no', 'membership_number', 'coop_member_id', 'सदस्यता नं', 'सदस्यता नम्बर'],
  full_name: ['full_name', 'name', 'name_en', 'member_name', 'name_of_member', 'नाम (english)'],
  name_np: ['name_np', 'full_name_np', 'nepali_name', 'नाम', 'नेपाली नाम'],
  mobile: ['mobile', 'phone', 'contact', 'mobile_no', 'contact_number', 'contact_no', 'मोबाइल', 'फोन'],
  email: ['email', 'e_mail', 'e-mail', 'इमेल'],
  address: ['address', 'permanent_address', 'addr', 'ठेगाना'],
  dob: ['dob', 'date_of_birth', 'birth_date', 'जन्म मिति'],
  dob_bs: ['dob_bs', 'janma_miti', 'जन्म मिति (वि.सं.)'],
  dob_ad: ['dob_ad', 'जन्म मिति (ई.सं.)'],
  gender: ['gender', 'sex', 'लिङ्ग'],
  father_name: ['father_name', 'father', 'fathers_name', "father's_name", 'baba_ko_nam', 'बुबाको नाम'],
  citizenship_no: ['citizenship_no', 'citizenship', 'citizenship_number', 'nagarikta_no', 'नागरिकता नं'],
  membership_date: ['membership_date', 'member_since', 'join_date', 'सदस्यता मिति'],
  membership_date_bs: ['membership_date_bs', 'sadasyata_miti'],
  membership_date_ad: ['membership_date_ad'],
  branch: ['branch', 'शाखा'],
  remarks: ['remarks', 'note', 'कैफियत'],
  password: ['password', 'पासवर्ड'],
  monthly_saving: ['monthly_saving', 'monthly saving', 'monthly_saving_regular', 'monthly_saving_status', 'saving_regular', 'masik_bachat', 'masik bachat', 'मासिक_बचत', 'मासिक बचत'],
};

function mapHeader(header) {
  const idx = {};
  header.forEach((h, i) => {
    const k = String(h).trim().toLowerCase();
    for (const [field, names] of Object.entries(ALIASES)) if (names.includes(k) && idx[field] === undefined) idx[field] = i;
  });
  return idx;
}

function normGender(g) {
  const v = String(g || '').trim().toLowerCase();
  if (['m', 'male', 'पुरुष'].includes(v)) return 'male';
  if (['f', 'female', 'महिला'].includes(v)) return 'female';
  return v ? 'other' : null;
}

const realAdDate = (y, m, d) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};

/**
 * Date of birth → AD 'YYYY-MM-DD'. kind: 'bs' | 'ad' | 'auto'.
 * BS and AD years overlap (BS 2020 ≈ AD 1963), so 'auto' only treats a year
 * later than the current AD year as BS; use dob_bs / dob_ad columns to be explicit.
 */
function normDob(raw, kind = 'auto') {
  const v = nd.toLatinDigits(String(raw || '').trim()).replace(/[/.]/g, '-');
  if (!v) return { value: null };
  const m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return { error: 'dob: YYYY-MM-DD' };
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const isBs = kind === 'bs' || (kind === 'auto' && y > new Date().getFullYear());
  if (isBs) {
    const ad = nd.isValidBs(y, mo, d) ? nd.bsToAd(`${y}-${mo}-${d}`) : null;
    return ad ? { value: ad } : { error: 'dob: invalid BS date' };
  }
  if (!realAdDate(y, mo, d) || y < 1900 || Date.UTC(y, mo - 1, d) > Date.now()) return { error: 'dob: invalid date' };
  return { value: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` };
}

/** Parse + validate a CSV buffer and stage it as an import job. */
async function stage(buf, filename, adminId, mode) {
  const rows = parseCsv(buf.toString('utf8'));
  if (rows.length < 2) throw new Error('CSV मा header र कम्तीमा एक row चाहिन्छ / CSV needs a header and at least one row');
  if (rows.length > 20001) throw new Error('बढीमा २०,००० row / max 20,000 rows');
  const idx = mapHeader(rows[0]);
  if (idx.full_name === undefined && idx.name_np === undefined) throw new Error('header मा name वा name_np column चाहिन्छ / a name column is required');
  if (idx.sadasyata_number === undefined && idx.mobile === undefined) throw new Error('sadasyata_number वा mobile column चाहिन्छ / a member number or mobile column is required');

  return db.transaction(async () => {
    const job = await db.one(`INSERT INTO member_import_jobs (admin_id, filename, stored_path, status, mode, total_rows, parsed_rows, ok_count, skip_count, fail_count, cards_count, parse_offset, parse_byte_offset, created_at)
                              VALUES ($1, $2, '', 'staged', $3, $4, 0, 0, 0, 0, 0, 0, 0, now()) RETURNING *`, [adminId, String(filename).slice(0, 255), mode, rows.length - 1]);
    const seen = new Set();
    let valid = 0, invalid = 0;
    for (let r = 1; r < rows.length; r++) {
      const get = f => (idx[f] === undefined ? '' : String(rows[r][idx[f]] ?? '').trim());
      const errs = [];
      const rec = {
        sadasyata_number: get('sadasyata_number').slice(0, 50), full_name: get('full_name').slice(0, 255), name_np: get('name_np').slice(0, 255),
        mobile: nd.toLatinDigits(get('mobile')).replace(/[^\d+]/g, '').slice(0, 20), email: get('email').toLowerCase().slice(0, 255),
        address: get('address').slice(0, 500), gender: normGender(get('gender')), branch: get('branch').slice(0, 100), remarks: get('remarks').slice(0, 255),
        father_name: get('father_name').slice(0, 150), citizenship_no: nd.toLatinDigits(get('citizenship_no')).slice(0, 60),
      };
      if (!rec.full_name && !rec.name_np) errs.push('name missing');
      if (!rec.sadasyata_number && !rec.mobile) errs.push('member no. or mobile required');
      if (rec.email && !util.isEmail(rec.email)) errs.push('bad email');
      if (rec.mobile && !util.isPhone(rec.mobile)) errs.push('bad mobile');
      const dob = get('dob_bs') ? normDob(get('dob_bs'), 'bs') : get('dob_ad') ? normDob(get('dob_ad'), 'ad') : normDob(get('dob'));
      if (dob.error) errs.push(dob.error);
      // membership date: BS or AD (auto: a year later than the current AD year is BS), any past date
      const md = get('membership_date_bs') ? normDob(get('membership_date_bs'), 'bs') : get('membership_date_ad') ? normDob(get('membership_date_ad'), 'ad') : normDob(get('membership_date'));
      if (md.error) errs.push(md.error.replace(/^dob/, 'membership_date'));
      const key = rec.sadasyata_number || rec.mobile;
      if (seen.has(key)) errs.push('duplicate in file');
      seen.add(key);
      const ms = require('./member-portal').parseMonthlySaving(get('monthly_saving'));
      if (!ms.ok) errs.push('monthly_saving: नियमित / नियमित नभएको (1 / 0)');
      const pw = get('password');
      if (pw && pw.length < 6) errs.push('password < 6 chars');
      errs.length ? invalid++ : valid++;
      const cit = rec.citizenship_no ? pii.encryptFields('member_import_rows', { citizenship_no: rec.citizenship_no }, db.currentSchema()).citizenship_no : null;
      await db.query(`INSERT INTO member_import_rows (job_id, row_num, sadasyata_number, full_name, name_np, mobile, email, address, dob, gender, branch, remarks, status, message, password_hash, monthly_saving,
                                                      father_name, citizenship_no, membership_date)
                      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
        [job.id, r + 1, rec.sadasyata_number, rec.full_name || rec.name_np, rec.name_np, rec.mobile, rec.email, rec.address, dob.value || '', rec.gender || '', rec.branch, rec.remarks,
          errs.length ? 'invalid' : 'pending', errs.join('; '), pw && !errs.length ? await auth.hashPassword(pw) : null, ms.value === null ? '' : String(ms.value),
          rec.father_name || null, cit, md.value || null]);
    }
    await db.query('UPDATE member_import_jobs SET parsed_rows = $1, fail_count = $2 WHERE id = $3', [rows.length - 1, invalid, job.id]);
    return { ...job, valid, invalid };
  });
}

/** Jobs up to this many rows also get a KYM stub and an ID card per member (legacy MEMBER_IMPORT_CARD_ROW_LIMIT). */
const CARD_ROW_LIMIT = 400;

/**
 * Apply a staged job: create new members, update or skip existing ones. Then (legacy memberImportApplyOptionalExtras)
 * membership_date is set, father_name / citizenship_no soft-fill the member's KYM (a stub is created when needed),
 * and small jobs (≤ CARD_ROW_LIMIT rows) get a KYM stub and a digital ID card for members without an active card.
 */
const CHUNK = 200;
/**
 * Commit the next batch (default 200) of pending rows of a staged / running job (member-import.php chunked commit).
 * The job is 'running' until no pending row is left, then 'done'; counts grow per batch, so a crash or a closed
 * browser tab resumes where it stopped (rows already saved are no longer 'pending').
 * @returns {Promise<{ok, skip, fail, cards, remaining, done}>}
 */
async function commitChunk(jobId, adminId, { tenant = null, limit = CHUNK } = {}) {
  const job = await db.one("SELECT * FROM member_import_jobs WHERE id = $1 AND status IN ('staged', 'running')", [jobId]);
  if (!job) throw new Error('Job not found or already imported');
  if (job.status === 'staged') await db.query("UPDATE member_import_jobs SET status = 'running', error_message = NULL, updated_at = now() WHERE id = $1", [jobId]);
  let ok = 0, skip = 0, fail = 0, cards = 0;
  const small = Number(job.total_rows) <= CARD_ROW_LIMIT;
  const kym = require('./kym');
  const rows = await db.many("SELECT * FROM member_import_rows WHERE job_id = $1 AND status = 'pending' ORDER BY row_num LIMIT $2", [jobId, Math.max(1, Number(limit) || CHUNK)]);
  for (const r of rows) {
    try {
      await db.transaction(async () => {
        const existing = await db.one(
          `SELECT id FROM members WHERE deleted_at IS NULL AND ((trim(sadasyata_number) <> '' AND upper(trim(sadasyata_number)) = upper(trim($1))) OR ($1 = '' AND phone = $2)) LIMIT 1`,
          [r.sadasyata_number || '', r.mobile || '']);
        const data = {
          name: r.full_name || r.name_np, name_np: r.name_np || '', phone: r.mobile || null, email: r.email || null,
          address: r.address || null, dob: r.dob || null, gender: r.gender || null, sadasyata_number: r.sadasyata_number || '',
        };
        // मासिक बचत: blank in the sheet keeps what the member already has
        if (r.monthly_saving === '1' || r.monthly_saving === '0') data.monthly_saving_regular = Number(r.monthly_saving);
        if (existing && job.mode === 'skip') {
          await db.query("UPDATE member_import_rows SET status = 'skipped', message = 'exists', member_id = $1 WHERE id = $2", [existing.id, r.id]);
          skip++; return;
        }
        let id;
        if (existing) {
          const upd = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null && v !== ''));
          if (r.password_hash) upd.password_hash = r.password_hash;
          await db.update('members', existing.id, upd);
          id = existing.id;
        } else {
          const row = await db.insert('members', { ...data, password_hash: r.password_hash || null, approval_status: 'approved', approved_at: new Date(), approved_by: adminId, is_active: 1, is_verified: 1, created_by: adminId });
          id = row.id;
        }
        if (r.membership_date) await db.query('UPDATE members SET membership_date = $1 WHERE id = $2', [r.membership_date, id]);
        if (r.father_name || r.citizenship_no || small) await kym.ensureStubFromMember(id, { father_name: r.father_name, citizenship_no: r.citizenship_no });
        await db.query("UPDATE member_import_rows SET status = $1, message = '', member_id = $2 WHERE id = $3", [existing ? 'updated' : 'created', id, r.id]);
        r.member_id = id;
        await require('./webhooks').emit(existing ? 'member.updated' : 'member.created', { id, member_no: data.sadasyata_number || null, name: data.name, name_np: data.name_np || null, phone: data.phone, email: data.email, source: 'csv_import' });
        ok++;
      });
      if (small && r.member_id && tenant && !(await db.value("SELECT 1 FROM member_id_cards WHERE member_id = $1 AND status = 'active' AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)", [String(r.member_id)]))) {
        try {
          await require('./member-portal').issueCard(await db.one('SELECT * FROM members WHERE id = $1', [r.member_id]), adminId, tenant);
          cards++;
        } catch (e) { console.error('import card:', e.message); }
      }
    } catch (e) {
      fail++;
      await db.query("UPDATE member_import_rows SET status = 'failed', message = $1 WHERE id = $2", [e.code === '23505' ? (/sadasyata/.test(e.constraint || '') ? 'membership number already used by another member' : 'email already used by another member') : e.message.slice(0, 250), r.id]);
    }
  }
  const remaining = Number(await db.value("SELECT count(*) FROM member_import_rows WHERE job_id = $1 AND status = 'pending'", [jobId]));
  await db.query(`UPDATE member_import_jobs SET status = $6, ok_count = ok_count + $1, skip_count = skip_count + $2, fail_count = fail_count + $3, cards_count = cards_count + $4,
                    parsed_rows = (SELECT count(*) FROM member_import_rows WHERE job_id = $5 AND status <> 'pending'), updated_at = now() WHERE id = $5`,
  [ok, skip, fail, cards, jobId, remaining ? 'running' : 'done']);
  return { ok, skip, fail, cards, remaining, done: !remaining };
}

/** Whole job in one go (CLI, tests, small files): batches until nothing is pending. Totals are cumulative. */
async function commit(jobId, adminId, opts = {}) {
  const sum = { ok: 0, skip: 0, fail: 0, cards: 0 };
  for (;;) {
    const r = await commitChunk(jobId, adminId, opts);
    for (const k of Object.keys(sum)) sum[k] += r[k];
    if (r.done) return sum;
  }
}

/** Failed rows back to pending so the next commit retries them (failure counts are taken off the job). */
async function retryFailed(jobId) {
  const n = (await db.query("UPDATE member_import_rows SET status = 'pending', message = '' WHERE job_id = $1 AND status = 'failed'", [jobId])).rowCount;
  if (n) await db.query("UPDATE member_import_jobs SET status = 'running', fail_count = GREATEST(0, fail_count - $2), error_message = NULL, updated_at = now() WHERE id = $1 AND status IN ('running', 'done')", [jobId, n]);
  return n;
}

/** Progress for the job page's polling (member-import.php status ticks). */
async function progress(jobId) {
  const job = await db.one('SELECT id, status, total_rows, ok_count, skip_count, fail_count, cards_count, error_message FROM member_import_jobs WHERE id = $1', [jobId]);
  if (!job) return null;
  const c = Object.fromEntries((await db.many('SELECT status, count(*)::int AS n FROM member_import_rows WHERE job_id = $1 GROUP BY status', [jobId])).map(r => [r.status, r.n]));
  const pending = c.pending || 0, invalid = c.invalid || 0;
  const todo = Math.max(0, Number(job.total_rows) - invalid);
  return { id: job.id, status: job.status, total: todo, processed: Math.max(0, todo - pending), pending, saved: job.ok_count, skipped: job.skip_count, failed: job.fail_count, cards: job.cards_count, error: job.error_message || null };
}

/** Store a job-level failure (member_import_jobs.error_message). */
const setError = (jobId, msg) => db.query('UPDATE member_import_jobs SET error_message = $2, updated_at = now() WHERE id = $1', [jobId, String(msg || '').slice(0, 1000)]);

// aligned with the legacy member-import-sample.php (BS dates; father / citizenship soft-fill the KYM)
const SAMPLE = '﻿member_id,full_name,name_np,mobile,email,address,dob_bs,gender,father_name,citizenship_no,membership_date_bs,monthly_saving,branch,password\n'
  + 'A-1001,Ram Bahadur Thapa,राम बहादुर थापा,9841000001,ram@example.com,"काठमाडौं-१०, बानेश्वर",2045-05-12,male,Hari Bahadur Thapa,27-01-75-01234,2070-01-15,नियमित,केन्द्रीय कार्यालय,\n'
  + 'A-1002,Sita Sharma,सीता शर्मा,9841000002,,ललितपुर-३,2046-10-06,female,,,2075-04-01,नियमित नभएको,,Welcome@123\n';

/** Failed and invalid rows of a job, for the errors CSV (legacy memberImportExportErrors). */
const errorRows = jobId => db.many("SELECT row_num, sadasyata_number, full_name, mobile, status, message FROM member_import_rows WHERE job_id = $1 AND status IN ('invalid', 'failed') ORDER BY row_num", [jobId]);

module.exports = { parseCsv, stage, commit, commitChunk, retryFailed, progress, setError, errorRows, SAMPLE, normDob, CARD_ROW_LIMIT, CHUNK };
