# Moving a PHP cooperative site to the platform · PHP साइटबाट प्लेटफर्ममा सार्ने

Operator guide. Every row of the old MySQL database ends up in exactly one place: **imported**, **imported after a
repair**, **quarantined** (kept whole until someone fixes it) or **archived** (kept, because the platform has no table or
column for it). Nothing is dropped. The report proves it: *Every row accounted for: yes*.

पुरानो डाटाबेसको हरेक पङ्क्ति कहीँ न कहीँ पुग्छ: आयात, मिलाएर आयात, क्वारेन्टाइन (मिलाउन बाँकी) वा अभिलेख
(legacy_archive)। केही पनि हराउँदैन — रिपोर्टमा *Every row accounted for: yes* देखिनुपर्छ।

## 1. Steps · चरणहरू

1. **Export the old site.** phpMyAdmin → Export → Quick → SQL (or `mysqldump --single-transaction`), and a zip of
   `public_html` (uploads, `includes/database.local.php`, `.cred-master.key`, `.pii-master.key`, `push-vapid.local.php`).
   पुरानो साइटको SQL export र public_html को zip लिनुहोस्।
2. **Create the tenant** (once): `npm run tenant:create -- --slug=<slug> --name="…" --domain=…`.
3. **Dry run · परीक्षण.** Platform console → *Demo data & old site import* (tick *Dry run*), or
   `npm run migrate:site -- --tenant=<slug> --zip=public_html.zip --sql=coop.sql --dry-run`.
   The dry run performs the whole import inside a transaction and rolls it back, so its report is exactly what the real
   run will do. (Only pending platform migrations are applied to the tenant schema.)
   Dry run ले सबै आयात गरेर फिर्ता लिन्छ — रिपोर्ट वास्तविक जस्तै हुन्छ, डाटा लेखिँदैन।
4. **Read the report** (section 2). Fix the source where it makes sense (e.g. charset), then run the dry run again.
5. **Real run · वास्तविक आयात.** Same command without `--dry-run` (console: untick and type the slug). A safety copy of
   every table it replaces is written first (`<IMPORT_DIR>/reports/<job>-before.json.gz`). The database part runs in one
   transaction: it either completes or changes nothing.
6. **Verify · जाँच.** `npm run migrate:site -- --tenant=<slug> --sql=coop.sql --verify` compares the old database and
   the tenant row by row (counts, keys and a checksum of identifying columns). It writes nothing; run it any time.
   A real run also verifies automatically.
7. **Fix quarantined rows** (section 3), check the site, then switch DNS.

Live MySQL instead of a dump: `--php-root=/path/public_html` (reads `database.local.php`) or `--mysql=mysql://…`.
`npm run db:import-mysql` runs the same import (`--truncate` = mode fresh).
Re-running: `--mode=fresh` (default) replaces the tenant's rows for the tables the source has; `--mode=incremental` only
adds rows whose key is new. Both are safe to repeat.

## 2. The report · रिपोर्टको अर्थ

HTML + JSON (`reports/migration-<slug>-<time>.*`, console: *Open the report*), and a short summary on screen.

| Section | Meaning |
|---|---|
| Summary | source rows = imported + quarantined + archived + already present + skipped. *Every row accounted for* must be **yes**. |
| Repairs | values changed so the stricter platform accepts them (list below). The original value of every changed cell is kept in `legacy_archive`. |
| Tables | per table: old rows, new rows, imported, repaired, quarantined, archived; older column names that were mapped. |
| Columns without a platform equivalent | columns found in this database that the platform has no column for, with sample values; kept per row in `legacy_archive`. |
| Duplicates and links | unique rules that could not be put back (duplicate membership numbers, two institutional profiles for one month) and links to missing rows. |
| Quarantined rows | rows the platform refused even after repair. |
| Verify | per table: missing / differing rows and the checksums of both sides (`=` when equal). |

Repairs (legacy-map.js): `zero_date` (0000-00-00 → empty), `bs_date` (a B.S. date in an A.D. column, also in Devanagari
digits; birth dates in the future are B.S.), `invalid_date` (2024-02-30 → empty), `mojibake` (double-encoded Nepali
text), `status` / `status_mapped` / `status_default` (legacy status words → the platform's), `role`
(super_admin → superadmin), `json_wrapped` (text in a JSON column), `truncated`, `null_default`, `unique_suffixed`
(a duplicate tracking id gets `-dup1`), `orphan_link_cleared` (a link to a deleted row), `card_lock` (PHP card status
`locked` → `locked_at`), `pii_converted` (pii1:/pii2: citizenship numbers re-encrypted), `mapped_from_*` (older column
names), `gallery_album_linked` (photos/videos of older installs without an album go into albums by their album text, as the PHP site did). Members are also linked to their KYM by membership number (`members ↔ KYM`).

## 3. Quarantined rows · क्वारेन्टाइन मिलाउने

```bash
npm run migrate:site -- --tenant=<slug> --quarantine            # list (citizenship numbers and secrets masked)
npm run migrate:site -- --tenant=<slug> --retry-quarantine       # try every open row again
npm run migrate:site -- --tenant=<slug> --retry-quarantine=12,13 # only these
npm run migrate:site -- --tenant=<slug> --discard-quarantine=12  # close without importing (row stays on record)
```

Each row is kept whole in the tenant's `import_quarantine` table (`data` = the source row, `error` = why). Typical
causes and fixes:

- **duplicate** — the same primary key twice in the dump. Give the row a new id, then retry:
  `UPDATE import_quarantine SET data = jsonb_set(data, '{id}', '9001') WHERE id = 12;`
- **invalid_value / missing_value** — fix the value in `data` the same way, or fix the conflicting row in the platform.
- After a fix, `--retry-quarantine` imports it and marks it `resolved` (`resolution = imported`).

Duplicate membership numbers are not quarantined: every member is imported and the unique rule waits. Fix them in
**Admin → Members → Duplicate member IDs**, which puts the rule back. दोहोरो सदस्यता नम्बर: Admin → Members → Duplicate
member IDs मा मिलाउनुहोस्।

`legacy_archive` (kind `row` = a whole row of a table without a platform equivalent such as the retired HRM tables;
kind `columns` = extra or changed values of an imported row) is for reference; nothing reads it at runtime.

## 4. Rollback · फिर्ता

- The real run is one database transaction: an error leaves the tenant unchanged.
- To undo a finished run: `gunzip <job>-before.json.gz` and upload the JSON in **Admin → System → Backup → Restore**
  (same `{ tenant, schema, tables }` format; it holds every table the run replaced, the tables a cascade emptied, and
  the quarantine/archive tables). Or drop and re-create the tenant and import again. Uploaded files are copied, never
  moved out of the source folder.
- The old PHP site keeps running until DNS is switched; you can migrate again (`--mode=fresh`) as often as needed.

## 5. What maps where (developers)

- Source inventory: `db/legacy/php-runtime-schema.sql` — install.sql **plus** every table/column the PHP app creates
  at runtime (105 tables, 1424 columns), generated by `scripts/legacy/inventory-php-schema.php` against MariaDB.
- `src/lib/legacy-map.js` is the single map used by both importers: skipped tables (`schema_migrations`), archived tables
  (`hrm_*`, unknown), renamed/merged columns (`admin_users.name`, `members.full_name`/`member_id`, `careers.status`,
  `institutional_profile.net_profit`), derived columns (`member_welfare_claims.full_name`,
  `member_program_attendance.valid_lock`), value cleaning, status/role vocabulary, logical relations, unique rules
  that are deferred, verify columns.
- `db/migrations/066_legacy_data_parity.sql`: columns that were lost before (`member_feedback.admin_attachment`,
  `services.is_new`/`new_until`), columns that were narrower than on PHP (appointments name/branch/preferred_time,
  gallery.media_type), and the `import_quarantine` / `legacy_archive` tables.
- `test/legacy-migration.test.js` + `test/fixtures/legacy-dump.js`: a synthetic dump of every table with dirty data;
  the inventory test fails when a PHP column has no destination.

Before this work the importer copied only "tables and columns on both sides" and swallowed failing rows: on the test
dump 18 of 337 rows (members, KYM, notices, loans, welfare claims, appointments …), 4 tables and 12 columns were lost
without trace.
