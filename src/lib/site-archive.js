'use strict';
/**
 * Unpack the old PHP site's public_html.zip for the migration — only what the migration needs:
 *   includes/database.local.php · database.php · config.local.php   (DB name, SITE_URL, PII_ENC_KEY)
 *   includes/.cred-master.key · includes/.pii-master.key           (old encryption keys)
 *   assets/uploads/**                                              (photos, documents — no scripts)
 *   *.sql / *.sql.gz anywhere in the zip                            (a database export, if it was put there)
 * PHP code, scripts and dot-files are never written to disk. Paths are checked (no "..", no absolute
 * paths, no symlinks), and declared sizes are checked against the real ones (zip bombs) and free disk.
 */
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');

const SKIP_FILE = /\.(php\d?|phtml|phar|htaccess|html?|js|cgi|pl|py|sh|exe|bat)$/i;
const CONFIG_FILES = ['includes/database.local.php', 'includes/database.php', 'includes/config.local.php', 'includes/.cred-master.key', 'includes/.pii-master.key'];
const MARKERS = [/(^|\/)includes\/database(\.local)?\.php$/i, /(^|\/)includes\/config(\.local)?\.php$/i, /(^|\/)assets\/uploads\//i];
const MAX_EXTRACT_BYTES = Number(process.env.MIGRATION_MAX_EXTRACT_GB || 30) * 1024 ** 3;
const MAX_ENTRIES = 500_000;

class ArchiveError extends Error {}

function openZip(file) {
  const yauzl = require('yauzl');
  return new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true, autoClose: false, validateEntrySizes: true }, (e, zip) => (e ? reject(new ArchiveError('Not a readable zip file: ' + e.message)) : resolve(zip))));
}

function readEntries(zip) {
  return new Promise((resolve, reject) => {
    const list = [];
    zip.on('entry', e => { list.push(e); if (list.length > MAX_ENTRIES) { reject(new ArchiveError(`more than ${MAX_ENTRIES} files in the zip`)); return; } zip.readEntry(); });
    zip.on('end', () => resolve(list));
    zip.on('error', e => reject(new ArchiveError('Zip error: ' + e.message)));
    zip.readEntry();
  });
}

/** The folder inside the zip that holds includes/ and assets/ ("" or e.g. "public_html/"). */
function findRoot(names) {
  const roots = new Map();
  for (const name of names) for (const re of MARKERS) {
    const m = re.exec(name);
    if (m) { const r = name.slice(0, m.index + (m[1] ? m[1].length : 0)); roots.set(r, (roots.get(r) || 0) + 1); }
  }
  if (!roots.size) return null;
  return [...roots.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0];
}

const isSymlink = e => ((e.externalFileAttributes >>> 16) & 0o170000) === 0o120000;
function safeRel(rel) {
  if (!rel || rel.includes('\0') || rel.startsWith('/') || /^[a-z]:/i.test(rel)) return null;
  const parts = rel.split('/');
  if (parts.some(p => p === '..' || p === '.' || p === '')) return null;
  return parts.join('/');
}

/**
 * @param {string} zipFile
 * @param {string} dest     empty work folder; the site is rebuilt under dest/site, dumps under dest/sql
 * @returns {{ siteRoot: string, root: string|null, sqlFiles: string[], stats: object, notes: string[] }}
 */
async function extractSite(zipFile, dest, { log = () => {} } = {}) {
  const zip = await openZip(zipFile);
  try {
    const entries = await readEntries(zip);
    const names = entries.map(e => e.fileName.replace(/\\/g, '/'));
    const root = findRoot(names);
    const notes = [];
    if (root === null) notes.push('includes/ or assets/uploads/ not found in the zip — is it the public_html folder of the old site?');
    else notes.push(`site folder in the zip: ${root || '(top level)'}`);
    const siteRoot = path.join(dest, 'site'), sqlDir = path.join(dest, 'sql');
    const plan = [];
    let bytes = 0, skipped = 0;
    entries.forEach((e, k) => {
      const name = names[k];
      if (name.endsWith('/') || isSymlink(e)) return;
      if (/\.sql(\.gz)?$/i.test(name) && !/(^|\/)assets\/uploads\//i.test(name)) {
        const base = safeRel(path.posix.basename(name));
        if (base) plan.push({ e, to: path.join(sqlDir, `${plan.length}-${base}`), sql: true });
        return;
      }
      if (root === null || !name.startsWith(root)) return;
      const rel = safeRel(name.slice(root.length));
      if (!rel) { skipped++; return; }
      const wanted = CONFIG_FILES.some(c => c.toLowerCase() === rel.toLowerCase())
        || (/^assets\/uploads\//i.test(rel) && !SKIP_FILE.test(rel) && !rel.split('/').some(p => p.startsWith('.')));
      if (!wanted) { if (/^assets\/uploads\//i.test(rel)) skipped++; return; }
      plan.push({ e, to: path.join(siteRoot, rel) });
    });
    for (const p of plan) bytes += p.e.uncompressedSize;
    if (bytes > MAX_EXTRACT_BYTES) throw new ArchiveError(`the files to unpack are ${(bytes / 1e9).toFixed(1)} GB — more than MIGRATION_MAX_EXTRACT_GB`);
    fs.mkdirSync(dest, { recursive: true });
    try {
      const sf = fs.statfsSync(dest);
      if (sf.bavail * sf.bsize < bytes * 1.1) throw new ArchiveError(`not enough disk space: ${(bytes / 1e9).toFixed(2)} GB needed, ${(sf.bavail * sf.bsize / 1e9).toFixed(2)} GB free`);
    } catch (e) { if (e instanceof ArchiveError) throw e; }
    log(`  unpacking ${plan.length} files (${(bytes / 1e6).toFixed(1)} MB) of ${entries.length} in the zip`);
    const base = path.resolve(dest) + path.sep;
    let done = 0;
    for (const p of plan) {
      const to = path.resolve(p.to);
      if (!to.startsWith(base)) continue; // never outside the work folder
      fs.mkdirSync(path.dirname(to), { recursive: true });
      const rs = await new Promise((resolve, reject) => zip.openReadStream(p.e, (err, s) => (err ? reject(new ArchiveError(`cannot read ${p.e.fileName}: ${err.message}`)) : resolve(s))));
      await pipeline(rs, fs.createWriteStream(to, { flags: 'wx' }));
      if (++done % 2000 === 0) log(`  … ${done} / ${plan.length} files`);
    }
    const sqlFiles = plan.filter(p => p.sql).map(p => p.to);
    return { siteRoot, root, sqlFiles, notes, stats: { entries: entries.length, extracted: done, bytes, skipped } };
  } finally { zip.close(); }
}

module.exports = { extractSite, findRoot, safeRel, ArchiveError, SKIP_FILE };
