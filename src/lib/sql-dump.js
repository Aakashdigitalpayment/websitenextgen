'use strict';
/**
 * Read a MySQL dump (phpMyAdmin "Export" or mysqldump, .sql or .sql.gz) without a MySQL server.
 * Only CREATE TABLE (for the column order) and INSERT / REPLACE rows are read; everything else
 * (SET, LOCK, ALTER, views, triggers, procedures) is skipped. Nothing in the file is ever executed.
 *
 * The result is a "source" with the same small interface the site migration uses for a live MySQL
 * connection (src/lib/site-migration.js → mysqlSource), so both paths share one import.
 */
const fs = require('fs');
const zlib = require('zlib');

const MAX_DUMP_BYTES = Number(process.env.MIGRATION_MAX_DUMP_MB || 400) * 1024 * 1024; // a JS string tops out near 512 MB

class DumpError extends Error {}

/** Read a .sql / .sql.gz file into text (size-checked). */
function readDumpFile(file) {
  const st = fs.statSync(file);
  let buf;
  if (/\.gz$/i.test(file)) {
    if (st.size > MAX_DUMP_BYTES) throw new DumpError(`SQL dump is too large (${Math.round(st.size / 1e6)} MB compressed)`);
    buf = zlib.gunzipSync(fs.readFileSync(file), { maxOutputLength: MAX_DUMP_BYTES });
  } else {
    if (st.size > MAX_DUMP_BYTES) throw new DumpError(`SQL dump is larger than ${Math.round(MAX_DUMP_BYTES / 1048576)} MB — raise MIGRATION_MAX_DUMP_MB or export the big tables separately`);
    buf = fs.readFileSync(file);
  }
  let text = buf.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

const COLUMN_SKIP = /^(PRIMARY|KEY|UNIQUE|INDEX|CONSTRAINT|FOREIGN|FULLTEXT|SPATIAL|CHECK)\b/i;
const ESCAPES = { 0: '\0', b: '\b', n: '\n', r: '\r', t: '\t', Z: '\x1a' };

/**
 * Parse dump text.
 * @returns {{ tables: Map<string, { columns: string[], rows: any[][] }>, warnings: string[], statements: number }}
 */
function parseDump(text) {
  const tables = new Map();
  const warnings = [];
  const n = text.length;
  let i = 0, statements = 0;

  const table = name => {
    if (!tables.has(name)) tables.set(name, { columns: [], rows: [] });
    return tables.get(name);
  };
  const isWs = c => c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '\f';

  // skip whitespace and comments (-- …, # …, /* … */ including /*!40101 … */)
  function skipBlank() {
    for (;;) {
      while (i < n && isWs(text[i])) i++;
      if (text.startsWith('--', i) && (i + 2 >= n || isWs(text[i + 2]))) { i = lineEnd(i); continue; }
      if (text[i] === '#') { i = lineEnd(i); continue; }
      if (text.startsWith('/*', i)) { const e = text.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
      return;
    }
  }
  function lineEnd(p) { const e = text.indexOf('\n', p); return e < 0 ? n : e + 1; }

  // read a quoted string starting at text[i] (', " or `); returns the unescaped value
  function readQuoted() {
    const q = text[i++];
    let out = '', start = i;
    while (i < n) {
      const c = text[i];
      if (c === '\\' && q !== '`') {
        out += text.slice(start, i);
        const e = text[i + 1];
        if (e === '%' || e === '_') out += '\\' + e; // MySQL keeps the backslash before % and _
        else out += ESCAPES[e] ?? e ?? '';
        i += 2; start = i; continue;
      }
      if (c === q) {
        if (text[i + 1] === q) { out += text.slice(start, i + 1); i += 2; start = i; continue; } // '' → '
        out += text.slice(start, i); i++;
        return out;
      }
      i++;
    }
    throw new DumpError('unterminated string in the dump (file cut off?)');
  }

  function readIdent() {
    skipBlank();
    let name;
    if (text[i] === '`' || text[i] === '"') name = readQuoted();
    else { const m = /^[A-Za-z0-9_$]+/.exec(text.slice(i, i + 200)); if (!m) return null; name = m[0]; i += name.length; }
    if (text[i] === '.') { i++; return readIdent(); } // db.table → table
    return name;
  }

  // skip to the end of the current statement (`;` outside strings and comments)
  function skipStatement() {
    while (i < n) {
      const c = text[i];
      if (c === "'" || c === '"' || c === '`') { readQuoted(); continue; }
      if (c === ';') { i++; return; }
      if (c === '-' && text[i + 1] === '-' && (i + 2 >= n || isWs(text[i + 2]))) { i = lineEnd(i); continue; }
      if (c === '#') { i = lineEnd(i); continue; }
      if (c === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
      i++;
    }
  }

  // text of a balanced (...) group starting at text[i] === '('; returns inner text, i after ')'
  function readGroup() {
    const start = ++i;
    let depth = 1;
    while (i < n) {
      const c = text[i];
      if (c === "'" || c === '"' || c === '`') { readQuoted(); continue; }
      if (c === '(') depth++;
      else if (c === ')' && --depth === 0) { i++; return text.slice(start, i - 1); }
      i++;
    }
    throw new DumpError('unbalanced brackets in CREATE TABLE');
  }

  // split a definition list on top-level commas
  function splitTop(s) {
    const parts = [];
    let depth = 0, start = 0;
    for (let k = 0; k < s.length; k++) {
      const c = s[k];
      if (c === "'" || c === '"' || c === '`') {
        const q = c; k++;
        while (k < s.length && s[k] !== q) { if (s[k] === '\\' && q !== '`') k++; else if (s[k] === q && s[k + 1] === q) k++; k++; }
        continue;
      }
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (c === ',' && depth === 0) { parts.push(s.slice(start, k)); start = k + 1; }
    }
    parts.push(s.slice(start));
    return parts.map(p => p.trim()).filter(Boolean);
  }

  function parseCreate() {
    // after CREATE [TEMPORARY] TABLE [IF NOT EXISTS]
    skipBlank();
    if (/^IF\s+NOT\s+EXISTS\b/i.test(text.slice(i, i + 20))) i += /^IF\s+NOT\s+EXISTS/i.exec(text.slice(i, i + 30))[0].length;
    const name = readIdent();
    skipBlank();
    if (!name || text[i] !== '(') { skipStatement(); return; } // CREATE TABLE … LIKE / AS SELECT
    const body = readGroup();
    const cols = [];
    for (const def of splitTop(body)) {
      if (COLUMN_SKIP.test(def)) continue;
      const m = /^`((?:[^`]|``)+)`|^"([^"]+)"|^([A-Za-z0-9_$]+)/.exec(def);
      if (m) cols.push((m[1] || m[2] || m[3]).replace(/``/g, '`'));
    }
    const t = table(name);
    if (t.rows.length && t.columns.length && t.columns.join() !== cols.join()) warnings.push(`table ${name} is defined twice in the dump; the first definition is used`);
    else t.columns = cols;
    skipStatement();
  }

  function readValue() {
    skipBlank();
    const c = text[i];
    if (c === "'" || c === '"') return readQuoted();
    // charset introducers: _utf8mb4'…', _binary'…', N'…'
    let m = /^(?:_[A-Za-z0-9]+\s*|N)(?=['"])/.exec(text.slice(i, i + 24));
    if (m) { i += m[0].length; return readQuoted(); }
    m = /^[xX]'([0-9A-Fa-f]*)'/.exec(text.slice(i, i + 64));
    if (m && m[0].length < 64) { i += m[0].length; return Buffer.from(m[1], 'hex'); }
    if (/^[xX]'/.test(text.slice(i, i + 2))) { i++; return Buffer.from(readQuoted(), 'hex'); }
    m = /^0x([0-9A-Fa-f]+)/.exec(text.slice(i, i + 4096));
    if (m && m[0].length < 4096) { i += m[0].length; return Buffer.from(m[1].length % 2 ? '0' + m[1] : m[1], 'hex'); }
    m = /^[bB]'([01]*)'/.exec(text.slice(i, i + 80));
    if (m) { i += m[0].length; return m[1] ? parseInt(m[1], 2) : 0; }
    // bare token: number, NULL, TRUE/FALSE, CURRENT_TIMESTAMP …
    const start = i;
    let depth = 0;
    while (i < n) {
      const ch = text[i];
      if (ch === '(') depth++;
      else if (ch === ')') { if (!depth) break; depth--; }
      else if (ch === ',' && !depth) break;
      else if (ch === "'" || ch === '"') { readQuoted(); continue; }
      i++;
    }
    const tok = text.slice(start, i).trim();
    if (/^null$/i.test(tok)) return null;
    if (/^true$/i.test(tok)) return 1;
    if (/^false$/i.test(tok)) return 0;
    if (/^[+-]?\d+$/.test(tok)) { const v = Number(tok); return Number.isSafeInteger(v) ? v : tok; }
    if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(tok)) return tok; // decimals stay exact as text
    return tok;
  }

  function parseInsert() {
    // after INSERT / REPLACE
    skipBlank();
    for (;;) { // modifiers
      const m = /^(LOW_PRIORITY|DELAYED|HIGH_PRIORITY|IGNORE)\b/i.exec(text.slice(i, i + 20));
      if (!m) break;
      i += m[0].length; skipBlank();
    }
    if (/^INTO\b/i.test(text.slice(i, i + 5))) i += 4;
    const name = readIdent();
    if (!name) { skipStatement(); return; }
    const t = table(name);
    skipBlank();
    let cols = null;
    if (text[i] === '(') cols = splitTop(readGroup()).map(c => c.replace(/^[`"]|[`"]$/g, '').replace(/``/g, '`'));
    skipBlank();
    const kw = /^VALUES?\b/i.exec(text.slice(i, i + 7));
    if (!kw) { skipStatement(); warnings.push(`INSERT … SELECT / SET into ${name} was skipped`); return; }
    i += kw[0].length;
    if (!t.columns.length) {
      if (cols) t.columns = cols.slice();
      else { warnings.push(`rows for ${name} were skipped: the dump has no CREATE TABLE and no column list for it`); skipStatement(); return; }
    }
    // map this statement's column order onto the table's
    let map = null;
    if (cols && cols.join() !== t.columns.join()) {
      for (const c of cols) if (!t.columns.includes(c)) t.columns.push(c);
      map = cols.map(c => t.columns.indexOf(c));
    }
    for (;;) {
      skipBlank();
      if (text[i] !== '(') break;
      i++;
      const vals = [];
      for (;;) {
        vals.push(readValue());
        skipBlank();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ')') { i++; break; }
        throw new DumpError(`unexpected "${text.slice(i, i + 20)}" in INSERT INTO ${name}`);
      }
      if (map) { const row = new Array(t.columns.length).fill(undefined); map.forEach((k, j) => { row[k] = vals[j]; }); t.rows.push(row); }
      else t.rows.push(vals);
      skipBlank();
      if (text[i] === ',') { i++; continue; }
      break;
    }
    skipStatement(); // ; or ON DUPLICATE KEY UPDATE … ;
  }

  while (i < n) {
    skipBlank();
    if (i >= n) break;
    const head = text.slice(i, i + 40);
    let m;
    if ((m = /^DELIMITER\s+(\S+)/i.exec(head))) {
      // stored routines / triggers: skip everything up to "DELIMITER ;"
      const end = text.slice(i).search(/\n\s*DELIMITER\s+;/i);
      i = end < 0 ? n : lineEnd(i + end + 1);
      continue;
    }
    statements++;
    if ((m = /^CREATE\s+(?:TEMPORARY\s+)?TABLE\b/i.exec(head))) { i += m[0].length; parseCreate(); continue; }
    if ((m = /^(?:INSERT|REPLACE)\b/i.exec(head))) { i += m[0].length; parseInsert(); continue; }
    skipStatement();
  }
  return { tables, warnings, statements };
}

/** Rows of a parsed table as objects of the given columns, sorted by id when it has one. */
function sortById(t) {
  const k = t.columns.indexOf('id');
  if (k >= 0 && !t._sorted) { t.rows.sort((a, b) => Number(a[k]) - Number(b[k])); t._sorted = true; }
}

/**
 * A migration source over a parsed dump (same interface as the live MySQL source).
 * @param {{tables: Map}} parsed result of parseDump
 * @param {string} label shown in the report
 */
function dumpSource(parsed, label = 'SQL dump') {
  const T = parsed.tables;
  const get = name => { const t = T.get(name); if (!t) throw new DumpError('no table ' + name + ' in the dump'); return t; };
  return {
    label,
    async info() { return { version: 'SQL dump file', charset: 'utf8mb4' }; },
    async tables() { return [...T.keys()]; },
    async count(name) { return get(name).rows.length; },
    async columns(name) { return get(name).columns.slice(); },
    async rows(name, cols, offset, limit) {
      const t = get(name);
      sortById(t);
      const idx = cols.map(c => t.columns.indexOf(c));
      // a column the INSERT did not name stays undefined: the import writes DEFAULT, as MySQL would have
      return t.rows.slice(offset, offset + limit).map(r => Object.fromEntries(cols.map((c, j) => [c, idx[j] < 0 ? undefined : r[idx[j]]])));
    },
    async sample(name, col, limit) {
      const t = T.get(name); if (!t) return [];
      const k = t.columns.indexOf(col); if (k < 0) return [];
      return t.rows.map(r => r[k]).filter(v => v !== null && v !== undefined && v !== '').slice(0, limit);
    },
    async end() {},
  };
}

module.exports = { parseDump, readDumpFile, dumpSource, DumpError, MAX_DUMP_BYTES };
