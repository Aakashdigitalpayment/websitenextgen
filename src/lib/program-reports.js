'use strict';
/**
 * Programme attendance reports and live stats (legacy admin/program-reports-*.php, program-member-history.php,
 * includes/program-member-insights.php, admin/api/program-live-stats.php).
 * In this app member_program_attendance.program_id is always the parent programme, so "unique attended"
 * for a multi-location programme = distinct members across its locations.
 */
const db = require('../db');

const DISPLAY_LIMIT = 500;

const METHODS = {
  MEMBER_SELF: ['सदस्य पोर्टल', 'Member portal'], ADMIN_MANUAL: ['दर्ता डेस्क', 'Registration desk'], QR_SCAN: ['QR स्क्यान', 'QR scan'],
  STAFF_VERIFY: ['स्टाफ प्रमाणीकरण (पुरानो)', 'Staff verify (legacy)'], ADMIN_APPROVE: ['प्रशासक स्वीकृति', 'Admin approval'], ADMIN_PREREG: ['पूर्व दर्ता', 'Pre-registration'],
};
const methodLabel = m => METHODS[String(m || '').toUpperCase()] || [m || '—', m || '—'];

const TYPES = {
  General: ['सामान्य कार्यक्रम', 'General programme'], AGM: ['वार्षिक साधारण सभा (AGM)', 'Annual general meeting'], SGM: ['विशेष साधारण सभा (SGM)', 'Special general meeting'],
  Orientation: ['सदस्य परिचय', 'Member orientation'], Training: ['प्रशिक्षण', 'Training'], Seminar: ['गोष्ठी', 'Seminar'], Workshop: ['कार्यशाला', 'Workshop'],
  Financial_Literacy: ['वित्तीय साक्षरता', 'Financial literacy'], Other: ['अन्य', 'Other'],
};
const typeLabel = t => TYPES[t] || TYPES.General;

const ATTEMPT_RESULTS = {
  DUPLICATE_BLOCKED: ['दोहोरो (पहिले नै उपस्थित)', 'Duplicate (already attended)'], INELIGIBLE: ['अयोग्य सदस्य', 'Ineligible member'],
  WINDOW_CLOSED: ['समय बाहिर', 'Outside the window'], INVALID_MEMBER: ['अमान्य सदस्य', 'Invalid member'], INVALID_PROGRAM: ['अमान्य कार्यक्रम', 'Invalid programme'], OTHER: ['अन्य', 'Other'],
};

const GENDERS = {
  male: ['male', 'm', 'man', 'पुरुष', 'purush', 'purus', 'boy'],
  female: ['female', 'f', 'woman', 'महिला', 'mahila', 'स्त्री', 'girl'],
  other: ['other', 'o', 'others', 'अन्य', 'third', 'third gender', 'तेस्रो लिङ्गी'],
};
const GENDER_LABELS = { male: ['पुरुष', 'Male'], female: ['महिला', 'Female'], other: ['अन्य', 'Other'], unknown: ['उल्लेख नभएको', 'Not stated'] };
function genderKey(raw) {
  const g = String(raw || '').trim().toLowerCase();
  if (!g) return 'unknown';
  for (const [k, list] of Object.entries(GENDERS)) if (list.includes(g)) return k;
  return 'unknown';
}

// eligible = same rule as legacy programCountActiveMembers()
const ELIGIBLE = "m.is_active = 1 AND m.deleted_at IS NULL AND lower(COALESCE(m.approval_status, '')) IN ('approved', 'active', 'confirmed', 'renewal_pending', '')";
const GENDER_SQL = "lower(trim(COALESCE(NULLIF(trim(m.gender), ''), NULLIF(trim(k.gender), ''), '')))";
const KYC_JOIN = 'LEFT JOIN kyc_applications k ON k.id = m.kyc_application_id';

const programList = () => db.many('SELECT id, title, program_type, event_date, is_multi_location FROM upcoming_programs WHERE parent_program_id IS NULL ORDER BY event_date DESC NULLS LAST, id DESC LIMIT 300');
const program = id => (id ? db.one('SELECT * FROM upcoming_programs WHERE id = $1 AND parent_program_id IS NULL', [id]) : null);
const eligibleCount = async () => Number(await db.value(`SELECT count(*) FROM members m WHERE ${ELIGIBLE}`));

async function occurrenceCounts(programId) {
  return db.many(`SELECT o.id, o.location_name, o.event_date, o.is_active, count(a.id) AS attended_count
                  FROM program_occurrences o LEFT JOIN member_program_attendance a ON a.occurrence_id = o.id AND a.attendance_status = 'VALID'
                  WHERE o.parent_program_id = $1 GROUP BY o.id ORDER BY o.sort_order, o.id`, [programId]);
}

/** Live numbers for one programme (legacy programLiveStatsForProgram). */
async function liveStats(p) {
  const [attended, eligible, prereg, occurrences, recent] = await Promise.all([
    db.value("SELECT count(DISTINCT member_id) FROM member_program_attendance WHERE program_id = $1 AND attendance_status = 'VALID'", [p.id]),
    eligibleCount(),
    db.value('SELECT count(*) FROM member_program_preregistrations WHERE program_id = $1', [p.id]),
    occurrenceCounts(p.id),
    db.many(`SELECT a.attended_at, a.location_label, a.attendance_method, m.name, m.name_np, m.sadasyata_number
             FROM member_program_attendance a LEFT JOIN members m ON m.id = a.member_id
             WHERE a.program_id = $1 AND a.attendance_status = 'VALID' ORDER BY a.attended_at DESC LIMIT 5`, [p.id]),
  ]);
  const a = Number(attended), e = Number(eligible);
  return { title: p.title, attended: a, eligible: e, prereg: Number(prereg), pct: e > 0 ? Math.round((a / e) * 1000) / 10 : 0, occurrences, recent };
}

/** VALID attendance rows of a programme (optionally one occurrence); limit 0 = all (CSV). */
async function validAttendance(programId, { occurrenceId = null, limit = DISPLAY_LIMIT } = {}) {
  const params = [programId];
  let where = "a.program_id = $1 AND a.attendance_status = 'VALID'";
  if (occurrenceId) { params.push(occurrenceId); where += ' AND a.occurrence_id = $2'; }
  return db.many(`SELECT a.*, m.name AS member_name, m.name_np AS member_name_np, m.phone, m.sadasyata_number, COALESCE(k.father_name, '') AS father_name
                  FROM member_program_attendance a LEFT JOIN members m ON m.id = a.member_id ${KYC_JOIN}
                  WHERE ${where} ORDER BY a.attended_at DESC ${limit ? 'LIMIT ' + Number(limit) : ''}`, params);
}

/** Eligible active members with no VALID attendance in the programme. */
async function absent(programId, { limit = DISPLAY_LIMIT } = {}) {
  const from = `FROM members m WHERE ${ELIGIBLE} AND NOT EXISTS (SELECT 1 FROM member_program_attendance a WHERE a.member_id = m.id AND a.program_id = $1 AND a.attendance_status = 'VALID')`;
  const [total, rows] = await Promise.all([
    db.value(`SELECT count(*) ${from}`, [programId]),
    db.many(`SELECT m.id, m.sadasyata_number, m.name, m.name_np, m.phone ${from} ORDER BY m.name ${limit ? 'LIMIT ' + Number(limit) : ''}`, [programId]),
  ]);
  return { total: Number(total), rows };
}

/** Drill-down filters (legacy programBreakdownFilterSpec). */
function breakdownFilters(src = {}) {
  const f = {};
  for (const k of ['gender', 'staff', 'desk', 'location', 'method', 'q']) f[k] = String(src[k] || '').trim().slice(0, 120);
  if (!['', 'male', 'female', 'other', 'unknown'].includes(f.gender)) f.gender = '';
  if (f.staff && !/^\d+$/.test(f.staff)) f.staff = '';
  if (f.desk && !/^\d+$/.test(f.desk)) f.desk = '';
  if (f.method && !METHODS[f.method]) f.method = '';
  return f;
}

function breakdownBase(programId, f) {
  const p = [programId];
  const add = v => { p.push(v); return '$' + p.length; };
  let sql = `FROM member_program_attendance a LEFT JOIN members m ON m.id = a.member_id ${KYC_JOIN}
             LEFT JOIN program_registration_desks d ON d.id = a.desk_id LEFT JOIN program_occurrences o ON o.id = d.occurrence_id
             LEFT JOIN admin_users u ON u.id = a.staff_admin_id
             WHERE a.program_id = $1 AND a.attendance_status = 'VALID'`;
  if (f.gender) {
    if (f.gender === 'unknown') sql += ` AND NOT (${GENDER_SQL} = ANY(${add(Object.values(GENDERS).flat())}))`;
    else sql += ` AND ${GENDER_SQL} = ANY(${add(GENDERS[f.gender])})`;
  }
  if (f.staff) sql += f.staff === '0' ? ' AND COALESCE(a.staff_admin_id, 0) = 0' : ` AND a.staff_admin_id = ${add(Number(f.staff))}`;
  if (f.desk) sql += f.desk === '0' ? ' AND COALESCE(a.desk_id, 0) = 0' : ` AND a.desk_id = ${add(Number(f.desk))}`;
  if (f.location) sql += ` AND COALESCE(NULLIF(a.location_label, ''), 'मुख्य स्थान') = ${add(f.location)}`;
  if (f.method) sql += ` AND a.attendance_method = ${add(f.method)}`;
  if (f.q) { const like = add('%' + f.q + '%'); sql += ` AND (a.member_card_no ILIKE ${like} OR m.name ILIKE ${like} OR m.name_np ILIKE ${like} OR m.phone ILIKE ${like})`; }
  return [sql, p];
}

/** Counts by gender / staff / desk / location / method (legacy programAttendanceBreakdownFiltered). */
async function breakdown(programId, f) {
  const [base, p] = breakdownBase(programId, f);
  const q = (sel, group) => db.many(`SELECT ${sel}, count(*) AS c ${base} GROUP BY ${group} ORDER BY c DESC`, p);
  const [g, desks, staff, methods, locs] = await Promise.all([
    q(`${GENDER_SQL} AS g`, 'g'),
    q('a.desk_id, d.desk_label, o.location_name', 'a.desk_id, d.desk_label, o.location_name'),
    q('a.staff_admin_id, u.full_name, u.username', 'a.staff_admin_id, u.full_name, u.username'),
    q('a.attendance_method', 'a.attendance_method'),
    q("COALESCE(NULLIF(a.location_label, ''), 'मुख्य स्थान') AS loc", 'loc'),
  ]);
  const gender = { male: 0, female: 0, other: 0, unknown: 0 };
  for (const r of g) gender[genderKey(r.g)] += Number(r.c);
  return {
    gender: Object.entries(gender).filter(([, c]) => c > 0).map(([k, c]) => ({ key: k, label: GENDER_LABELS[k], count: c })),
    desk: desks.map(r => ({ key: String(r.desk_id || 0), count: Number(r.c), label: r.desk_id ? [(r.desk_label || 'Desk #' + r.desk_id) + (r.location_name ? ' — ' + r.location_name : ''), (r.desk_label || 'Desk #' + r.desk_id) + (r.location_name ? ' — ' + r.location_name : '')] : ['डेस्क नतोकिएको (QR / स्वीकृति)', 'No desk (QR / approval)'] })),
    staff: staff.map(r => { const n = r.staff_admin_id ? (r.full_name || r.username || 'Admin #' + r.staff_admin_id) + (r.username ? ` (@${r.username})` : '') : null; return { key: String(r.staff_admin_id || 0), count: Number(r.c), label: n ? [n, n] : ['स्टाफ बिना (सदस्य आफैं / QR)', 'No staff (member / QR)'] }; }),
    method: methods.map(r => ({ key: r.attendance_method || '', count: Number(r.c), label: methodLabel(r.attendance_method) })),
    location: locs.map(r => ({ key: r.loc, count: Number(r.c), label: [r.loc, r.loc === 'मुख्य स्थान' ? 'Main venue' : r.loc] })),
  };
}

/** One row per attendance with member details (legacy programAttendanceDetailRows); limit 0 = all. */
async function breakdownDetail(programId, f, { limit = 0, offset = 0 } = {}) {
  const [base, p] = breakdownBase(programId, f);
  const total = Number(await db.value(`SELECT count(*) ${base}`, p));
  const rows = await db.many(`SELECT a.id, a.member_card_no, m.sadasyata_number, m.name, m.name_np, m.phone, m.address, ${GENDER_SQL} AS gender_raw, COALESCE(k.father_name, '') AS father_name,
      COALESCE(NULLIF(a.location_label, ''), 'मुख्य स्थान') AS loc, a.desk_id, d.desk_label, a.staff_admin_id, u.full_name AS staff_name, u.username AS staff_user, a.attendance_method, a.attended_at
    ${base} ORDER BY a.attended_at, a.id ${limit ? `LIMIT ${Number(limit)} OFFSET ${Math.max(0, Number(offset))}` : ''}`, p);
  return { total, rows };
}

async function attempts(programId, result, { limit = DISPLAY_LIMIT } = {}) {
  const params = [], where = [];
  if (programId) { params.push(programId); where.push(`pa.parent_program_id = $${params.length}`); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const counts = Object.fromEntries((await db.many(`SELECT pa.result, count(*) AS n FROM program_attendance_attempts pa ${w} GROUP BY pa.result`, params)).map(r => [r.result, Number(r.n)]));
  if (result) { params.push(result); where.push(`pa.result = $${params.length}`); }
  const w2 = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = await db.many(`SELECT pa.*, m.name AS member_name, m.name_np AS member_name_np, m.sadasyata_number, p.title AS program_title,
      prev.location_label AS prev_location, prev.attended_at AS prev_attended_at, d.desk_label, u.full_name AS staff_name
    FROM program_attendance_attempts pa LEFT JOIN members m ON m.id = pa.member_id LEFT JOIN upcoming_programs p ON p.id = pa.parent_program_id
    LEFT JOIN member_program_attendance prev ON prev.id = pa.previous_attendance_id LEFT JOIN program_registration_desks d ON d.id = pa.desk_id
    LEFT JOIN admin_users u ON u.id = pa.staff_admin_id ${w2} ORDER BY pa.attempted_at DESC ${limit ? 'LIMIT ' + Number(limit) : ''}`, params);
  return { counts, rows, total: result ? counts[result] || 0 : Object.values(counts).reduce((s, n) => s + n, 0) };
}

/** Member-wise register across all programmes; limit 0 = all. */
async function memberRegister(q, { limit = DISPLAY_LIMIT } = {}) {
  const params = [];
  let where = "a.attendance_status = 'VALID'";
  if (q) { params.push('%' + q + '%'); where += ' AND (a.member_card_no ILIKE $1 OR m.sadasyata_number ILIKE $1 OR m.name ILIKE $1 OR m.name_np ILIKE $1 OR a.program_title ILIKE $1)'; }
  const from = `FROM member_program_attendance a LEFT JOIN members m ON m.id = a.member_id ${KYC_JOIN} WHERE ${where}`;
  const [total, rows] = await Promise.all([
    db.value(`SELECT count(*) ${from}`, params),
    db.many(`SELECT a.*, m.name AS member_name, m.name_np AS member_name_np, m.sadasyata_number, COALESCE(k.father_name, '') AS father_name ${from} ORDER BY a.attended_at DESC ${limit ? 'LIMIT ' + Number(limit) : ''}`, params),
  ]);
  return { total: Number(total), rows };
}

const findMemberByNo = q => db.one(`SELECT m.*, COALESCE(k.father_name, '') AS father_name FROM members m ${KYC_JOIN}
  WHERE m.deleted_at IS NULL AND (m.sadasyata_number = $1 OR m.member_card_no = $1 OR m.phone = $1) ORDER BY m.is_active DESC, m.id LIMIT 1`, [String(q || '').trim()]);

/** All VALID attendances of a member with parent programme info (legacy programMemberAttendanceLog). */
const memberLog = (memberId, limit = 300) => db.many(`SELECT a.id, a.program_title, a.location_label, a.attendance_method, a.attended_at, a.occurrence_id,
    p.title AS parent_title, p.program_type, p.event_date
  FROM member_program_attendance a LEFT JOIN upcoming_programs p ON p.id = a.program_id
  WHERE a.member_id = $1 AND a.attendance_status = 'VALID' ORDER BY a.attended_at DESC LIMIT ${Number(limit)}`, [memberId]);

/**
 * Held programmes of one type (default AGM), newest first, each marked attended/absent, with the current streak
 * (legacy programMemberTypeRegister). "Held" = has at least one VALID attendance.
 */
async function memberTypeRegister(memberId, type = 'AGM', limit = 10) {
  const params = [memberId];
  if (type) params.push(type);
  const rows = await db.many(`SELECT p.id, p.title, p.program_type, p.event_date,
      EXISTS (SELECT 1 FROM member_program_attendance x WHERE x.program_id = p.id AND x.member_id = $1 AND x.attendance_status = 'VALID') AS attended
    FROM upcoming_programs p WHERE p.parent_program_id IS NULL ${type ? 'AND p.program_type = $2' : ''}
      AND EXISTS (SELECT 1 FROM member_program_attendance h WHERE h.program_id = p.id AND h.attendance_status = 'VALID')
    ORDER BY COALESCE(p.event_date, p.created_at::date) DESC, p.id DESC LIMIT ${Number(limit)}`, params);
  let streak = 0, open = true, attended = 0;
  for (const r of rows) { if (r.attended) { attended++; if (open) streak++; } else open = false; }
  return { rows, attended, total: rows.length, streak };
}

const desksFor = (programId, activeOnly = false) => db.many(`SELECT d.*, o.location_name, u.full_name AS staff_name, u.username AS staff_username,
    (SELECT count(*) FROM member_program_attendance a WHERE a.desk_id = d.id AND a.attendance_status = 'VALID') AS attended_count
  FROM program_registration_desks d LEFT JOIN program_occurrences o ON o.id = d.occurrence_id LEFT JOIN admin_users u ON u.id = d.assigned_staff_admin_id
  WHERE d.parent_program_id = $1 ${activeOnly ? 'AND d.is_active = 1' : ''} ORDER BY d.is_active DESC, d.desk_label, d.id`, [programId]);

module.exports = {
  DISPLAY_LIMIT, METHODS, TYPES, ATTEMPT_RESULTS, GENDER_LABELS, methodLabel, typeLabel, genderKey, programList, program, eligibleCount, occurrenceCounts,
  liveStats, validAttendance, absent, breakdownFilters, breakdown, breakdownDetail, attempts, memberRegister, findMemberByNo, memberLog, memberTypeRegister, desksFor,
};
