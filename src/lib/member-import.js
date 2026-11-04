'use strict';
/** Bulk member import from CSV: parse → validate & stage (member_import_rows) → commit. */
const db = require('../db');
const nd = require('./nepali-date');
const auth = require('./auth');
const util = require('./util');

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

const ALIASES = {
  sadasyata_number: ['sadasyata_number', 'member_no', 'membership_no', 'member_id', 'sadasyata', 'सदस्यता नं', 'सदस्यता नम्बर'],
  full_name: ['full_name', 'name', 'name_en', 'नाम (english)'],
  name_np: ['name_np', 'नाम', 'नेपाली नाम'],
  mobile: ['mobile', 'phone', 'contact', 'मोबाइल', 'फोन'],
  email: ['email', 'इमेल'],
  address: ['address', 'ठेगाना'],
  dob: ['dob', 'date_of_birth', 'जन्म मिति'],
  dob_bs: ['dob_bs', 'जन्म मिति (वि.सं.)'],
  dob_ad: ['dob_ad', 'जन्म मिति (ई.सं.)'],
  gender: ['gender', 'लिङ्ग'],
  branch: ['branch', 'शाखा'],
  remarks: ['remarks', 'note', 'कैफियत'],
  password: ['password', 'पासवर्ड'],
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
      };
      if (!rec.full_name && !rec.name_np) errs.push('name missing');
      if (!rec.sadasyata_number && !rec.mobile) errs.push('member no. or mobile required');
      if (rec.email && !util.isEmail(rec.email)) errs.push('bad email');
      if (rec.mobile && !util.isPhone(rec.mobile)) errs.push('bad mobile');
      const dob = get('dob_bs') ? normDob(get('dob_bs'), 'bs') : get('dob_ad') ? normDob(get('dob_ad'), 'ad') : normDob(get('dob'));
      if (dob.error) errs.push(dob.error);
      const key = rec.sadasyata_number || rec.mobile;
      if (seen.has(key)) errs.push('duplicate in file');
      seen.add(key);
      const pw = get('password');
      if (pw && pw.length < 6) errs.push('password < 6 chars');
      errs.length ? invalid++ : valid++;
      await db.query(`INSERT INTO member_import_rows (job_id, row_num, sadasyata_number, full_name, name_np, mobile, email, address, dob, gender, branch, remarks, status, message, password_hash)
                      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [job.id, r + 1, rec.sadasyata_number, rec.full_name || rec.name_np, rec.name_np, rec.mobile, rec.email, rec.address, dob.value || '', rec.gender || '', rec.branch, rec.remarks,
          errs.length ? 'invalid' : 'pending', errs.join('; '), pw && !errs.length ? await auth.hashPassword(pw) : null]);
    }
    await db.query('UPDATE member_import_jobs SET parsed_rows = $1, fail_count = $2 WHERE id = $3', [rows.length - 1, invalid, job.id]);
    return { ...job, valid, invalid };
  });
}

/** Apply a staged job: create new members, update or skip existing ones. */
async function commit(jobId, adminId) {
  const job = await db.one("SELECT * FROM member_import_jobs WHERE id = $1 AND status = 'staged'", [jobId]);
  if (!job) throw new Error('Job not found or already imported');
  let ok = 0, skip = 0, fail = 0;
  const rows = await db.many("SELECT * FROM member_import_rows WHERE job_id = $1 AND status = 'pending' ORDER BY row_num", [jobId]);
  for (const r of rows) {
    try {
      await db.transaction(async () => {
        const existing = await db.one(
          `SELECT id FROM members WHERE deleted_at IS NULL AND ((sadasyata_number <> '' AND sadasyata_number = $1) OR ($1 = '' AND phone = $2)) LIMIT 1`,
          [r.sadasyata_number || '', r.mobile || '']);
        const data = {
          name: r.full_name || r.name_np, name_np: r.name_np || '', phone: r.mobile || null, email: r.email || null,
          address: r.address || null, dob: r.dob || null, gender: r.gender || null, sadasyata_number: r.sadasyata_number || '',
        };
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
        await db.query("UPDATE member_import_rows SET status = $1, message = '', member_id = $2 WHERE id = $3", [existing ? 'updated' : 'created', id, r.id]);
        ok++;
      });
    } catch (e) {
      fail++;
      await db.query("UPDATE member_import_rows SET status = 'failed', message = $1 WHERE id = $2", [e.code === '23505' ? 'email already used by another member' : e.message.slice(0, 250), r.id]);
    }
  }
  await db.query("UPDATE member_import_jobs SET status = 'done', ok_count = $1, skip_count = $2, fail_count = fail_count + $3 WHERE id = $4", [ok, skip, fail, jobId]);
  return { ok, skip, fail };
}

const SAMPLE = '﻿sadasyata_number,full_name,name_np,mobile,email,address,dob,gender,branch,password\n'
  + 'A-1001,Ram Bahadur Thapa,राम बहादुर थापा,9841000001,ram@example.com,"काठमाडौं-१०, बानेश्वर",2045-05-12,male,केन्द्रीय कार्यालय,\n'
  + 'A-1002,Sita Sharma,सीता शर्मा,9841000002,,ललितपुर-३,1990-01-20,female,,Welcome@123\n';

module.exports = { parseCsv, stage, commit, SAMPLE, normDob };
