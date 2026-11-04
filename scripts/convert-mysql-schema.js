#!/usr/bin/env node
/**
 * Converts the legacy MySQL schema (database/install.sql) into PostgreSQL DDL.
 * Usage: node scripts/convert-mysql-schema.js db/legacy/install.sql > db/schema.sql
 *
 * Handles: CREATE TABLE, ALTER TABLE ... ADD COLUMN/INDEX, CREATE INDEX,
 * and the legacy helper procedures (sp_v3_add_column / sp_v3_add_index /
 * add_index_if_missing). Stored procedures, SET, UPDATE and DROP are skipped.
 */
const fs = require('fs');

const src = fs.readFileSync(process.argv[2] || 'db/legacy/install.sql', 'utf8');

// 1. strip DELIMITER blocks (procedure bodies)
let sql = src.replace(/DELIMITER \$\$[\s\S]*?DELIMITER ;/g, '');
// 2. strip comments
sql = stripComments(sql);

function stripComments(text) {
  let out = '', q = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { out += ch; if (ch === '\\') { out += text[++i] || ''; continue; } if (ch === q) q = null; continue; }
    if (ch === "'" || ch === '"') { q = ch; out += ch; continue; }
    if (ch === '-' && text[i + 1] === '-') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (ch === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i + 2) + 1; if (i === 0) break; continue; }
    out += ch;
  }
  return out;
}

const statements = sql.split(/;\s*(?:\n|$)/).map(s => s.trim()).filter(Boolean);

const tables = new Map(); // name -> {cols: Map(name->def), constraints:[], indexes:[]}
const extraIndexes = [];
let idxCounter = 0;

function splitTopLevel(body) {
  const parts = []; let depth = 0, cur = '', q = null;
  for (const ch of body) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === "'" || ch === '"') { q = ch; cur += ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function colList(s) {
  return s.split(',').map(c => c.trim().replace(/`/g, '').replace(/\(\d+\)$/, '')).filter(Boolean).join(', ');
}

function convertType(def, table, col) {
  let d = def.replace(/`/g, '');
  let checks = [];
  let isSerial = /AUTO_INCREMENT/i.test(d);
  d = d.replace(/\s+COMMENT\s+'(?:[^'\\]|\\.|'')*'/gi, '')
       .replace(/\s+CHARACTER SET \w+/gi, '').replace(/\s+COLLATE \w+/gi, '')
       .replace(/\s+ON UPDATE CURRENT_TIMESTAMP(\(\))?/gi, '')
       .replace(/\s+AFTER\s+\w+/gi, '').replace(/\s+FIRST\b/gi, '')
       .replace(/\bUNSIGNED\b/gi, '').replace(/\bZEROFILL\b/gi, '');
  // ENUM -> VARCHAR + CHECK
  d = d.replace(/^ENUM\s*\(([^)]*)\)/i, (m, vals) => {
    checks.push(`CHECK (${col} IN (${vals}))`);
    const max = Math.max(...vals.split(',').map(v => v.trim().length - 2), 10);
    return `VARCHAR(${Math.max(max, 20)})`;
  });
  d = d.replace(/^SET\s*\(([^)]*)\)/i, 'TEXT');
  if (isSerial) {
    const big = /^BIGINT/i.test(d);
    const pk = /PRIMARY KEY/i.test(d);
    return { def: (big ? 'BIGSERIAL' : 'SERIAL') + (pk ? ' PRIMARY KEY' : ''), checks: [] };
  }
  d = d.replace(/^TINYINT\s*\(\s*1\s*\)/i, 'SMALLINT')
       .replace(/^TINYINT(\s*\(\d+\))?/i, 'SMALLINT')
       .replace(/^SMALLINT\s*\(\d+\)/i, 'SMALLINT')
       .replace(/^MEDIUMINT(\s*\(\d+\))?/i, 'INTEGER')
       .replace(/^INT(EGER)?\s*\(\d+\)/i, 'INTEGER')
       .replace(/^INT\b/i, 'INTEGER')
       .replace(/^BIGINT\s*\(\d+\)/i, 'BIGINT')
       .replace(/^DOUBLE(\s*\(\d+,\s*\d+\))?/i, 'DOUBLE PRECISION')
       .replace(/^FLOAT(\s*\(\d+,\s*\d+\))?/i, 'REAL')
       .replace(/^(LONG|MEDIUM|TINY)TEXT/i, 'TEXT')
       .replace(/^(LONG|MEDIUM|TINY)?BLOB/i, 'BYTEA')
       .replace(/^DATETIME(\s*\(\d\))?/i, 'TIMESTAMP')
       .replace(/^YEAR(\s*\(\d\))?/i, 'SMALLINT')
       .replace(/^JSON/i, 'JSONB');
  // zero dates are not valid in Postgres
  d = d.replace(/DEFAULT\s+'0000-00-00( 00:00:00)?'/gi, 'DEFAULT NULL');
  d = d.replace(/DEFAULT\s+CURRENT_TIMESTAMP\(\)/gi, 'DEFAULT CURRENT_TIMESTAMP');
  // inline UNIQUE stays valid; inline INDEX not
  // JSON default
  d = d.replace(/\bNULL\s+NULL\b/gi, 'NULL');
  return { def: d.replace(/\s+/g, ' ').trim(), checks };
}

function ensureTable(name) {
  if (!tables.has(name)) tables.set(name, { cols: new Map(), constraints: [], indexes: [] });
  return tables.get(name);
}

function addIndex(table, name, cols, unique) {
  idxCounter++;
  const iname = `${table}_${(name || 'idx' + idxCounter).replace(/`/g, '')}`.slice(0, 60);
  extraIndexes.push(`CREATE ${unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${iname} ON ${table} (${colList(cols)});`);
}

function handleCreate(stmt) {
  const m = stmt.match(/CREATE TABLE (?:IF NOT EXISTS )?`?(\w+)`?\s*\(([\s\S]*)\)[^)]*$/i);
  if (!m) return;
  const [, name, body] = m;
  const t = ensureTable(name);
  for (const part of splitTopLevel(body)) {
    const p = part.trim();
    let mm;
    if ((mm = p.match(/^PRIMARY KEY\s*\(([^)]+)\)/i))) { t.constraints.push(`PRIMARY KEY (${colList(mm[1])})`); continue; }
    if ((mm = p.match(/^(?:CONSTRAINT\s+`?\w+`?\s+)?UNIQUE(?: KEY| INDEX)?\s*`?(\w+)?`?\s*\(([^)]+)\)/i))) { addIndex(name, mm[1] || null, mm[2], true); continue; }
    if ((mm = p.match(/^(?:KEY|INDEX)\s*`?(\w+)?`?\s*\(([^)]+)\)/i))) { addIndex(name, mm[1] || null, mm[2], false); continue; }
    if (/^FULLTEXT/i.test(p)) continue;
    if (/^(CONSTRAINT|FOREIGN KEY)/i.test(p)) continue; // FKs dropped (legacy used FOREIGN_KEY_CHECKS=0)
    if (/^CHECK/i.test(p)) { t.constraints.push(p); continue; }
    const cm = p.match(/^`?(\w+)`?\s+([\s\S]+)$/);
    if (!cm) continue;
    const col = cm[1];
    if (t.cols.has(col)) continue;
    const { def, checks } = convertType(cm[2], name, col);
    t.cols.set(col, def);
    checks.forEach(c => t.constraints.push(c));
  }
}

const alters = [];
function handleAlter(stmt) {
  const m = stmt.match(/ALTER TABLE `?(\w+)`?\s+([\s\S]+)/i);
  if (!m) return;
  const [, name, rest] = m;
  for (const part of splitTopLevel(rest)) {
    let mm;
    if ((mm = part.match(/^ADD COLUMN(?: IF NOT EXISTS)?\s+`?(\w+)`?\s+([\s\S]+)$/i))) {
      const t = tables.get(name);
      const { def, checks } = convertType(mm[2], name, mm[1]);
      if (t && !t.cols.has(mm[1])) { t.cols.set(mm[1], def); checks.forEach(c => t.constraints.push(c)); }
      else if (!t) alters.push(`ALTER TABLE ${name} ADD COLUMN IF NOT EXISTS ${mm[1]} ${def};`);
    } else if ((mm = part.match(/^ADD (UNIQUE )?(?:INDEX|KEY)(?: IF NOT EXISTS)?\s+`?(\w+)`?\s*\(([^)]+)\)/i))) {
      addIndex(name, mm[2], mm[3], !!mm[1]);
    }
  }
}

for (const stmt of statements) {
  if (/^CREATE TABLE/i.test(stmt)) handleCreate(stmt);
  else if (/^ALTER TABLE/i.test(stmt)) handleAlter(stmt);
  else if (/^CREATE (UNIQUE )?INDEX/i.test(stmt)) {
    const m = stmt.match(/CREATE (UNIQUE )?INDEX(?: IF NOT EXISTS)?\s+`?(\w+)`?\s+ON\s+`?(\w+)`?\s*\(([^)]+)\)/i);
    if (m) addIndex(m[3], m[2], m[4], !!m[1]);
  } else if (/^CALL (sp_v3_add_column)/i.test(stmt)) {
    const m = stmt.match(/\('(\w+)',\s*'(\w+)',\s*'([^']+)'\)/);
    if (m && tables.has(m[1]) && !tables.get(m[1]).cols.has(m[2])) tables.get(m[1]).cols.set(m[2], convertType(m[3], m[1], m[2]).def);
  } else if (/^CALL (sp_v3_add_index|add_index_if_missing)/i.test(stmt)) {
    const m = stmt.match(/\('(\w+)',\s*'(\w+)',\s*'([^']+)'\)/);
    if (m) addIndex(m[1], m[2], m[3], false);
  }
}

let out = `-- =====================================================================
-- Aakash Cooperative — PostgreSQL schema (generated from database/install.sql)
-- Regenerate: npm run schema:convert
-- =====================================================================
SET client_min_messages = warning;

`;
for (const [name, t] of tables) {
  const lines = [...t.cols].map(([c, d]) => `  ${c} ${d}`);
  t.constraints.forEach(c => lines.push(`  ${c}`));
  out += `CREATE TABLE IF NOT EXISTS ${name} (\n${lines.join(',\n')}\n);\n\n`;
}
out += alters.join('\n') + '\n\n';
// drop indexes that reference unknown columns
const seen = new Set();
for (const ix of extraIndexes) {
  const m = ix.match(/INDEX IF NOT EXISTS (\w+) ON (\w+) \(([^)]+)\)/);
  const t = tables.get(m[2]);
  if (!t) continue;
  const cols = m[3].split(',').map(s => s.trim().split(' ')[0]);
  if (!cols.every(c => t.cols.has(c))) continue;
  const key = m[2] + ':' + cols.join(',') + ':' + /UNIQUE/.test(ix);
  if (seen.has(key)) continue; seen.add(key);
  out += ix + '\n';
}
process.stdout.write(out);
