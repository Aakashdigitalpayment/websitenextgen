'use strict';
/** Programme attendance rules shared by the member QR flow and the admin desk. */
const crypto = require('crypto');
const db = require('../db');

const newToken = () => crypto.randomBytes(18).toString('base64url');
// one VALID row per member per programme (or per occurrence for multi-location programmes)
const scopeKey = (programId, occurrenceId) => (occurrenceId ? 1_000_000 + Number(occurrenceId) : Number(programId));

/** Resolve a QR token to { program, occurrence }. */
async function byToken(token) {
  const t = String(token || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (t.length < 16) return null;
  const occ = await db.one('SELECT * FROM program_occurrences WHERE qr_token = $1 AND is_active = 1', [t]);
  if (occ) {
    const program = await db.one('SELECT * FROM upcoming_programs WHERE id = $1 AND is_active = 1', [occ.parent_program_id]);
    return program ? { program, occurrence: occ, qr: occ } : null;
  }
  const program = await db.one('SELECT * FROM upcoming_programs WHERE qr_token = $1 AND is_active = 1', [t]);
  return program ? { program, occurrence: null, qr: program } : null;
}

/** Is check-in open now? returns null if open, else a bilingual reason. */
function closedReason(program, qr, now = new Date()) {
  if (!Number(qr.qr_enabled)) return ['यो QR हाल बन्द छ।', 'This QR code is not active.'];
  const open = qr.attendance_open_at || qr.qr_starts_at || program.attendance_open_at || program.qr_starts_at;
  const close = qr.attendance_close_at || qr.qr_expires_at || program.attendance_close_at || program.qr_expires_at;
  if (open && now < new Date(open)) return ['उपस्थिति अझै खुलेको छैन।', 'Check-in has not opened yet.'];
  if (close && now > new Date(close)) return ['उपस्थितिको समय सकियो।', 'Check-in has closed.'];
  return null;
}

async function existing(memberId, programId, occurrenceId) {
  return db.one("SELECT * FROM member_program_attendance WHERE member_id = $1 AND attendance_scope_key = $2 AND attendance_status = 'VALID'", [memberId, scopeKey(programId, occurrenceId)]);
}

/** Record a VALID check-in. Returns { row } or { duplicate } */
async function record({ member, program, occurrence = null, method, source, ip = null, staffAdminId = null, deskId = null, note = null }) {
  const prev = await existing(member.id, program.id, occurrence?.id);
  if (prev) {
    await logAttempt(member.id, program, occurrence, method, 'DUPLICATE_BLOCKED', 'already attended', prev.id, ip, staffAdminId);
    return { duplicate: prev };
  }
  try {
    const row = await db.insert('member_program_attendance', {
      member_id: member.id, member_card_no: member.member_card_no || member.sadasyata_number || null,
      program_id: occurrence ? occurrence.parent_program_id : program.id, occurrence_id: occurrence?.id || null,
      parent_program_id: program.parent_program_id || (occurrence ? program.id : null), attendance_scope_key: scopeKey(program.id, occurrence?.id),
      program_title: String(program.title || '').slice(0, 255), attendance_method: method, attendance_status: 'VALID', source,
      location_label: occurrence?.location_name || program.location || null, verified_by_ip: ip, staff_admin_id: staffAdminId, desk_id: deskId,
      attendance_note: note, attended_at: new Date(),
    });
    return { row };
  } catch (e) {
    if (e.code === '23505') return { duplicate: await existing(member.id, program.id, occurrence?.id) };
    throw e;
  }
}

/** Failed attempts only (legacy CHECK: DUPLICATE_BLOCKED, WINDOW_CLOSED, INELIGIBLE, INVALID_MEMBER, INVALID_PROGRAM, OTHER). */
async function logAttempt(memberId, program, occurrence, method, result, message, prevId, ip, staffAdminId) {
  await db.query(`INSERT INTO program_attendance_attempts (member_id, parent_program_id, program_id, occurrence_id, attempted_method, attempted_at, previous_attendance_id, result, result_message, verified_by_ip, staff_admin_id)
                  VALUES ($1, $2, $3, $4, $5, now(), $6, $7, $8, $9, $10)`,
    [memberId, program.parent_program_id || program.id, program.id, occurrence?.id || null, method, prevId, result, message, ip, staffAdminId]).catch(() => {});
}

async function voidAttendance(id, adminId, reason) {
  return db.transaction(async () => {
    const row = await db.one("SELECT * FROM member_program_attendance WHERE id = $1 AND attendance_status = 'VALID' FOR UPDATE", [id]);
    if (!row) return null;
    // legacy unique (scope, member, status) allows a single VOID row per scope — replace an older one
    await db.query("DELETE FROM member_program_attendance WHERE attendance_scope_key = $1 AND member_id = $2 AND attendance_status = 'VOID'", [row.attendance_scope_key, row.member_id]);
    await db.query("UPDATE member_program_attendance SET attendance_status = 'VOID', voided_by = $1, voided_at = now(), void_reason = $2 WHERE id = $3", [adminId, String(reason || '').slice(0, 255), id]);
    await db.query(`INSERT INTO program_audit_logs (action_type, program_id, occurrence_id, attendance_id, member_id, admin_id, reason, created_at) VALUES ('void', $1, $2, $3, $4, $5, $6, now())`,
      [row.program_id, row.occurrence_id, row.id, row.member_id, adminId, String(reason || '').slice(0, 255)]);
    return row;
  });
}

/** Find a member by membership no., card no. or phone (desk check-in). */
async function findMember(q) {
  const v = String(q || '').trim();
  if (!v) return null;
  return db.one(`SELECT * FROM members WHERE deleted_at IS NULL AND is_active = 1 AND (sadasyata_number = $1 OR member_card_no = $1 OR phone = $1) ORDER BY id LIMIT 1`, [v]);
}

module.exports = { logAttempt, newToken, scopeKey, byToken, closedReason, record, voidAttendance, findMember, existing };
