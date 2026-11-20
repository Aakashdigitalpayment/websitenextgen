# Gap report 4: admin operational modules (PHP `admin/*` ops slice → Node `websitenextgen`)

Reviewer scope: application inboxes, members, member import, member portal/activities/duplicates/marketplace, KYC/risk, programmes and attendance (every `program-*`), elections, welfare, partners/vendors, information room, honour, jobs, digital services, auctions/bids, print form, reports, and the `includes/*` helpers and `scripts/*` named in the brief.

Paths: PHP = `/home/user/websourcecode`, Node = `/home/user/websitenextgen`. Line numbers refer to the files as they are now.

**How the Node app is built (keep this in mind when reading the specs).** Every application module is one declarative definition in `src/modules/applications.js`. All of them are served by one generic inbox, `src/routes/admin-applications.js`, with the views `views/admin/inbox-list.ejs`, `inbox-view.ejs` and `inbox-print.ejs`. CRUD-only masters go through `src/modules/resources.js` and the generic `/admin/r/:resource` routes in `src/routes/admin.js` (that file has the `beforeSave`/`beforeDelete` hooks). Most fixes below are therefore **one generic extension** (a new key on the module or resource definition) and not a page per module.

---

## (a) Summary table

Legend: **DONE** = the Node app is at parity or better. **PARTIAL** = some features are missing (see §b). **MISSING** = not in the Node app. **N/A** = no port needed.

| # | PHP area | Node equivalent | Status | Pri | Notes |
|---|---|---|---|---|---|
| 1 | `applications/*.php`, `members/*.php` (301 redirect stubs) | — | PARTIAL | P3 | No legacy `/admin/*.php` → Node redirect map (old bookmarks and links in old emails) |
| 2 | loan / account / kyc / grievance / appointment / feedback / welfare / digital / vendor / membership / honor / job inboxes: list, search, date range, status filter, quick status, detail, remarks, internal note, office attachment, history, notify toggle, single/filtered CSV, print | `/admin/inbox/:module` | DONE (better: bulk actions, read/unread, one engine) | — | — |
| 3 | Per-inbox **status count cards** (stat-mini) on every PHP inbox | — | MISSING | P2 | e.g. `loan-applications.php:216-225`, `appointments.php:248-253`, `grievances.php:269`, `job-applications.php:236-260`, `welfare-claims.php:486-505` |
| 4 | Per-module **extra list filters** (appointment kind, feedback type, digital service type, welfare claim type, honour programme/category, job bucket, bids by auction, KYC link status) | only `job.career` and `kyc.risk` | PARTIAL | P2 | see §b-3 |
| 5 | Per-module **list ordering** (appointments by preferred_date, bids by amount, jobs by pipeline stage) | always created_at DESC | PARTIAL | P3 | §b-3 |
| 6 | Per-channel **notify outcome** (email/SMS sent/failed/skipped, reason, to) stored in `request_status_history` and shown in the history log | columns exist; never written (`notify_sent=1` set blindly) | PARTIAL | P2 | §b-4 |
| 7 | Quick status from the list also sends SMS/email (PHP `loan-applications.php:122-125` etc.) | quick status never notifies | PARTIAL (intentional?) | P3 | Arguably safer; make it a setting |
| 8 | Auction bids (`auction-bids.php`): accepting one bid rejects the others and completes the auction; rejecting the winner reopens it; per-auction view; sorted by amount; admin-only changes | generic `bid` inbox | PARTIAL | **P1** | §b-2 |
| 9 | Welfare claims: `under_review`/`paid`/`completed` statuses, `paid_at` stamp, claim-type filter, type badge colour | approved_amount only; CHECK has pending/processing/approved/rejected | PARTIAL | P2 | §b-5 |
| 10 | KYC (`kyc-applications.php`): link filter (linked / kym_only / no_password / unlinked_member), link badge per row, SSOT divergence alert (member vs KYM shared fields), back-to-member link | member link/sync, profile edit, risk, AML export done | PARTIAL | P2 | §b-6 |
| 11 | `kyc-risk-reviews.php` | `/admin/kyc-risk-reviews` | DONE | — | — |
| 12 | `kyc-import-sample.php` | — | N/A | — | PHP only redirects (KYM import was removed) |
| 13 | `membership-applications.php` approve with Member ID / reject | `/admin/inbox/membership/:id/approve` | DONE | — | — |
| 14 | `print-form.php` (bank-style print for 9 types, photo, signature, thumbs, office block) | `inbox-print.ejs` (all modules) | DONE (better) | — | — |
| 15 | `vendor-enlistment.php` (status tabs, promote to partner) | vendor inbox + `/admin/partners/promote-vendor` | DONE | — | Status tabs covered by item 3 |
| 16 | `partner-facilities.php` (CRUD, desk PIN, usage counts, type filter, featured) | resource + `/admin/partners` | DONE | P3 | PIN rule mismatch: `partners.validPin` needs 6–12 characters but the flash text says 4–12 (`src/lib/partners.js:32`, `src/routes/admin-partners.js:42`) |
| 17 | `members.php`: list, search, live/archive, monthly-saving filter, export CSV, edit, 2FA reset, ID card, IR toggle, active toggle | `/admin/members*` | PARTIAL | P2 | Missing: KYC link filter, stats strip, **audience bulk notification** (§b-7) |
| 18 | `member-online-portal.php` (approve/reject, toggle, card generate/unlock, reset requests, stats) | `/admin/member-portal`, `/admin/password-requests` | DONE (better: profile-change queue, policy settings) | P3 | Missing: per-member partner-service history and programme "attendance rating" (§b-8) |
| 19 | `member-activities.php` (search any member, tables/timeline, CSV) | `/admin/members/:id/activities(.csv)` | PARTIAL | P3 | Missing source: `member_partner_services` (§b-8) |
| 20 | `member-import.php` + `includes/member-import-helpers.php` | `/admin/members/import*` | PARTIAL | P2 | Missing: father_name / citizenship_no → KYM stub soft-fill, membership_date (BS/AD), auto ID card for ≤400 rows, KYM stub/sync, per-job error CSV, more header aliases (§b-9). Node is better on one point: no predictable temp password (PHP used last4 mobile + last4 ID, `member-import-helpers.php:116-123`) |
| 21 | `member-import-sample.php` (+ `?type=monthly_saving`) | `/members/import/sample.csv`, `/field-sample.csv` | PARTIAL | P3 | Sample lacks father_name, citizenship_no, membership_date, monthly_saving columns |
| 22 | `member-ssot-duplicates.php` | `/admin/members/duplicates` (+ UNIQUE guard) | DONE (better) | — | — |
| 23 | `member-marketplace.php` (tabs, approve/reject/expire/extend/delete, **detail with inquiries**) | `/admin/marketplace` | PARTIAL | P3 | No detail page with full listing and inquiry list (§b-10) |
| 24 | `programs.php` (CRUD, multi-location, instant, shared QR, eligible scope, QR window, gen/clear QR, toggle, **delete guard**) | resource `upcoming_programs` + `/admin/programs/:id/qr` | PARTIAL | **P1** (delete guard) / P3 (fields) | §b-1, §b-11 |
| 25 | `program-occurrences.php` (add / **edit** / delete / gen-clear QR / open-close window / sort / active) | add + delete + QR only | PARTIAL | P2 | No edit (§b-12) |
| 26 | `program-detail.php` (desks add/update/toggle, void) | `/admin/programs/:id` | DONE | — | — |
| 27 | `program-registration-desk.php` + `api/program-desk-lookup.php`: lookup → member card (photo, history summary, AGM streak) → confirm, **monthly-saving capture**, eligibility check, void own entry | one-shot POST check-in by number | PARTIAL | P2 | §b-13. Node desk also checks in **unapproved** members (no eligibility gate) |
| 28 | `program-attendance.php`: cross-programme attendance list with filters (q, date range, active_only, show_done) + 3 CSV exports (attendance, prereg, requests incl. processed); request approve/reject/link/create; prereg bulk SMS/email | per-programme only; one minimal attendance CSV | PARTIAL | P2 | §b-14 |
| 29 | `program-dashboard.php`, `program-settings.php`, `program-reports-{absent,breakdown,consolidated,duplicates,location,member}.php`, `program-member-history.php` | `/admin/programs/dashboard`, `/settings`, `/reports/*`, live.json | DONE | — | — |
| 30 | `includes/program-member-insights.php`, `program-attendance-helpers.php`, `program-tables.php` | `src/lib/program-reports.js`, `attendance.js` | PARTIAL | P2 | `programValidateMemberEligible` (`program-attendance-helpers.php:385-412`) is not ported; `programMemberHistorySummary` (`program-member-insights.php:232-250`) is not ported |
| 31 | `scripts/migrate-program-v2.php` | migrations | N/A | — | Schema already v2 |
| 32 | `election-information.php` (cycles + milestones), `election-posts.php`, `election-candidates.php` | resources `election_*` | PARTIAL | **P1** (delete guards) / P3 (fields) | §b-1, §b-15 |
| 33 | `election-results.php` (tallies, finalise, convert winners → committee) | `/admin/elections/:id` | DONE (better: turnout, print) | — | — |
| 34 | `election-voting-attendance.php` (manual ballot / attendance only) | `/admin/elections/:id/desk` | DONE | — | — |
| 35 | `institutional-welfare-opening.php` + `includes/institutional-profile-welfare.php` | `/admin/institutional-welfare` | DONE | — | — |
| 36 | `welfare-claim-types.php`, `digital-service-types.php` (CRUD, icon, colour, builtin, **deactivate instead of delete when in use / builtin**) | resources | PARTIAL | P2 | §b-1 (delete rule), §b-16 (icon/colour fields) |
| 37 | `honor-programs.php` (CRUD + categories, event_label, show_new_badge, instructions_en, BS open/close) | resource + `/admin/honor-programs/:id/categories` | PARTIAL | P3 | Missing fields; no delete guard when applications exist |
| 38 | `honor-applications.php` (program/category filters) | honor inbox | PARTIAL | P2 | Filters in §b-3 |
| 39 | `job-applications.php` (career filter, active/done bucket, mark read, pipeline order) | job inbox | PARTIAL | P3 | Bucket and order in §b-3 |
| 40 | `digital-service-requests.php` (type filter) | digital inbox | PARTIAL | P2 | Filter in §b-3 |
| 41 | `information-room*.php` (CRUD, bulk status, browse, view, logs, fixed category list, per-member access) | resource + `/admin/information-room/{browse,logs,view}` + member flag | DONE | P3 | Category is free text (PHP `irCategories()` fixed list, `information-room-tables.php:157`); no bulk activate/deactivate on this resource (`bulk:true` missing) |
| 42 | `reports.php` (publications: typed report_type select, fiscal-year/month/quarter selects, access_level, **view_only**) | resource `reports` | PARTIAL | P3 | §b-17 |
| 43 | `includes/request-status-history.php` | `request_status_history` writes | PARTIAL | P2 | = item 6 |
| 44 | `includes/notification-log-tables.php` | `notification_log` + `/admin/notifications` | DONE | — | — |
| 45 | `includes/satisfaction-links-tables.php` | resource + `/admin/satisfaction` | DONE | — | — |
| 46 | `includes/careers-tables.php`, `auction-tables.php`, `vendors-tables.php`, `honor-tables.php`, `membership-applications.php`, `member-marketplace-tables.php`, `member-partner-services-tables.php`, `election-tables.php`, `digital-service-*`, `welfare-claims-*` | schema.sql + libs | DONE | — | Table DDL ported; behaviour gaps are listed per page above |
| 47 | `scripts/pii-encrypt.php` (status / keygen / migrate --dry-run / decrypt rollback) | `src/lib/pii-crypto.js` (transparent), legacy decrypt in site-migration | MISSING (CLI) | P2 | §b-18. With no tool, rows stored as plaintext before `PII_KEY` was set stay plaintext for ever |
| 48 | `scripts/reports/*` (CSS audit JSON/txt) | — | N/A | — | Build artefacts, not features |
| 49 | Assignment of applications to staff | — | N/A | — | The PHP app never had it (searched `assigned_to` etc.) |
| 50 | Auction bid inbox: option label for a completed auction | `forms.auctions()` lists only upcoming/ongoing | PARTIAL (bug) | P3 | Bids on completed/cancelled auctions show the raw `auction_id` in the list, print and CSV (`src/lib/forms.js:76-77`) |

**Where PHP was better:** delete guards on data-bearing masters (programmes, election cycles, positions and candidates, type tables); exclusive auction winner; the desk lookup/confirm UX with member card and history; status count cards; per-channel notify audit; cross-programme attendance exports; welfare paid stage.
**Where Node is better:** one inbox engine with bulk actions and read/unread; formula-safe CSV; transactional ballots; UNIQUE guard on member IDs; no predictable import passwords; profile-change queue; webhooks on status change; private files gated by role.

---

## (b) Implementation specs (PARTIAL / MISSING)

### b-1 [P1] Delete guards: "deactivate instead of delete" when data references the row
**PHP:**
- `admin/programs.php:160-174`: if attendance, requests or pre-registrations exist, set `is_active=0` and flash a warning. Otherwise delete occurrences, desks and the programme.
- `admin/election-information.php:78-100`: refuse to delete a cycle that has `election_vote_submissions`. Otherwise delete votes, submissions, candidates, positions and milestones in one transaction.
- `admin/election-candidates.php` delete_position / delete_candidate (about lines 75-135): if `election_votes` exist, deactivate.
- `admin/digital-service-types.php:105-123` and `admin/welfare-claim-types.php:120-135`: if `is_builtin` or the type is in use, deactivate.

**Node today:** `src/routes/admin.js:316-331` supports `beforeDelete` returning a message only (block). Only `election_posts` has a guard (`resources.js:243`).

**Change:**
1. Let `beforeDelete(id, {db})` return either `[np,en]` (block, as now) or `{ deactivate: true, message: [np,en] }`. In `admin.js` delete route: if `deactivate`, run `UPDATE ${r.table} SET is_active = 0 WHERE id=$1`, audit `deactivate`, flash a warning and redirect. Add an optional `afterDelete(id,{db})` for cascades, run inside a `db.transaction` together with the delete.
2. Add the hooks in `src/modules/resources.js`:
   - `upcoming_programs.beforeDelete`: `SELECT (SELECT count(*) FROM member_program_attendance WHERE program_id=$1 OR parent_program_id=$1)+(SELECT count(*) FROM member_program_attendance_requests WHERE program_id=$1)+(SELECT count(*) FROM member_program_preregistrations WHERE program_id=$1)` → >0 ⇒ deactivate. `afterDelete`: `DELETE FROM program_occurrences WHERE parent_program_id=$1; DELETE FROM program_registration_desks WHERE parent_program_id=$1`.
   - `election_cycles.beforeDelete`: `count(*) FROM election_vote_submissions WHERE cycle_id=$1` > 0 ⇒ block ("cycle has ballots/attendance; turn voting off instead"). `afterDelete`: delete `election_votes`, `election_vote_submissions`, `election_candidates`, `election_positions` and `election_milestones` WHERE cycle_id.
   - `election_positions.beforeDelete`: `count(*) FROM election_votes WHERE position_id=$1` > 0 ⇒ deactivate. `afterDelete`: delete candidates of that position.
   - `election_candidates.beforeDelete`: `count(*) FROM election_votes WHERE candidate_id=$1` > 0 ⇒ deactivate.
   - `digital_service_types.beforeDelete`: `is_builtin=1 OR EXISTS(SELECT 1 FROM digital_service_requests WHERE service_type = (SELECT slug FROM digital_service_types WHERE id=$1))` ⇒ deactivate.
   - `welfare_claim_types`: same rule against `member_welfare_claims.claim_type`.
   - `honor_programs`: applications exist (`honor_applications.program_id`) ⇒ deactivate. `honor_categories`: used ⇒ deactivate.
   - `auction_notices`: bids exist ⇒ block (or set status `cancelled`).
3. Optional: make `slug` read-only on edit when `is_builtin=1` (in `beforeSave`, keep `existing.slug`).

### b-2 [P1] Auction bids: exclusive winner, per-auction view, amount order
**PHP:** `admin/auction-bids.php`:
- `:9`: POST requires the admin role.
- `:30-55`: in one transaction, accepting bid X runs `UPDATE auction_bids SET status='rejected' WHERE auction_id=? AND id<>? AND status<>'rejected'`, then sets X `accepted`, then `UPDATE auction_notices SET status='completed'`.
- `:56-70`: rejecting the bid that was `accepted`, when no accepted bid is left, runs `UPDATE auction_notices SET status='ongoing' WHERE id=? AND status='completed'`.
- `:71-82`: each change is logged to `request_status_history` under module `auction_bid`.
- `:96-130`: filters `auction_id`, `bid_status` and `bid_search` (name, phone, email); `ORDER BY bid_amount DESC, created_at DESC`; per-auction status counts; header with the auction title.

**Node:** `src/modules/applications.js:404-416` (`bid`, `noTracking`, staff level). `changeStatus()` in `src/routes/admin-applications.js:164-220`.

**Change:**
- In `EXTRA.bid` add `adminOnly: false, mutateRole: 'admin', listOrder: 'bid_amount DESC NULLS LAST, created_at DESC', filters: [{ name: 'auction', col: 'auction_id', type: 'int', optionsFrom: 'auctionsAll' }]` (see b-3 for `filters`/`listOrder`). In `getModule`, for POST routes require `m.mutateRole` if it is set.
- In `changeStatus`, inside the existing `db.transaction`:
  ```js
  if (m.key === 'bid' && data.status === 'accepted' && row.status !== 'accepted') {
    await db.query("UPDATE auction_bids SET status='rejected' WHERE auction_id=$1 AND id<>$2 AND status<>'rejected'", [row.auction_id, row.id]);
    await db.query("UPDATE auction_notices SET status='completed' WHERE id=$1", [row.auction_id]);
  }
  if (m.key === 'bid' && row.status === 'accepted' && data.status === 'rejected'
      && !(await db.value("SELECT 1 FROM auction_bids WHERE auction_id=$1 AND status='accepted' AND id<>$2", [row.auction_id, row.id])))
    await db.query("UPDATE auction_notices SET status='ongoing' WHERE id=$1 AND status='completed'", [row.auction_id]);
  ```
  Write history rows for the bids that were auto-rejected (module `bid`).
- Add the option source `auctionsAll` in `src/lib/forms.js` (all auction_notices, any status) and use it for display (fixes item 50). Keep `auctions` (open only) for the public form.
- Link from the auction resource rows: `resources.auction_notices.rowLinks: [{ href: '/admin/inbox/bid?auction=:id', label: ['बोलपत्र','Bids'], icon: 'gavel' }]`.

### b-3 [P2] Generic inbox: status cards, module filters, module ordering
**PHP refs:**
- Cards: `loan-applications.php:216-225`, `account-applications.php:245-247`, `appointments.php:248-253` (also kind counts), `grievances.php:269-270`, `feedbacks.php:200-205, 249-270`, `job-applications.php:236-260` (+ unread), `welfare-claims.php:486-505`, `vendor-enlistment.php:263-280`, `auction-bids.php:117-125`.
- Filters:
  - `appointments.php:167-178`: `kind` ∈ member / cooperative → `COALESCE(visit_kind,'member')=?`.
  - `feedbacks.php:166-175`: `type`.
  - `digital-service-requests.php:124,137`: `type` → `service_type`.
  - `welfare-claims.php:128,142`: `type` → `claim_type`.
  - `honor-applications.php:117-118`: `program_id` and `category_id`.
  - `job-applications.php:153-180`: `bucket` active (pending, shortlisted, interviewed) / done (selected, rejected) / all. Default is active unless a status is chosen.
  - `auction-bids.php`: `auction_id`.
- Order:
  - `appointments.php:222`: `preferred_date DESC, created_at DESC`.
  - `job-applications.php:226`: `FIELD(status,'pending','shortlisted','interviewed','selected','rejected'), created_at DESC`.
  - `auction-bids.php:114`: `bid_amount DESC`.

**Node change:**
1. `src/modules/applications.js` `EXTRA`: add declarative `filters` and `listOrder`:
   ```js
   appointment: { …, listOrder: 'preferred_date DESC NULLS LAST, created_at DESC',
     filters: [{ name: 'kind', label: ['प्रकार','Visit type'], sql: "COALESCE(visit_kind,'member') = $?", optionsFromField: 'visit_kind' }] },
   feedback: { …, filters: [{ name: 'type', col: 'type', optionsFromField: 'type' }] },
   digital:  { …, filters: [{ name: 'type', col: 'service_type', optionsFromField: 'service_type' }] },
   welfare:  { …, filters: [{ name: 'type', col: 'claim_type', optionsFromField: 'claim_type' }] },
   honor:    { …, filters: [{ name: 'program', col: 'program_id', type: 'int', optionsFromField: 'program_id' }, { name: 'category', col: 'category_id', type: 'int', optionsFromField: 'category_id' }] },
   job:      { …, listOrder: "CASE status WHEN 'pending' THEN 1 WHEN 'shortlisted' THEN 2 WHEN 'interviewed' THEN 3 WHEN 'selected' THEN 4 ELSE 5 END, created_at DESC",
               buckets: { active: ['pending','shortlisted','interviewed'], done: ['selected','rejected'] } },
   bid:      { … see b-2 }
   ```
2. In `inboxQuery()` (`admin-applications.js:42-64`), loop over `m.filters`. Whitelist each value against the resolved options, `params.push(v)` and add `col = $n`. Replace the hard-coded `job.career` and `kyc.risk` with entries of the same kind. Add `bucket`: when there is no status and `m.buckets`, default to `active` and add `status = ANY($n)`.
3. List query (`:72`): `ORDER BY ${m.listOrder || 'created_at DESC NULLS LAST'}, id DESC`.
4. Status counts: `SELECT status, count(*) FROM ${m.table} ${softDeleteWhere} GROUP BY status`, plus `count(*) FILTER (WHERE is_read=0)` when that column exists. Pass `counts` to `inbox-list.ejs` and render a row of chips (`<a href="?status=s" class="chip ${active}">label <b>n</b></a>`) above the toolbar. For welfare and loan also show `SUM(amountCol) FILTER (WHERE status='pending')` (PHP `loan-applications.php:216`).
5. `inbox-list.ejs`: render a `<select name="<f.name>" data-autosubmit>` for each `m.filters` entry (options from `options[f.optionsFromField]`).

### b-4 [P2] Per-channel notification outcome in status history
**PHP:**
- `includes/request-status-history.php:26-31`: columns `notify_email_status|reason|to` and `notify_sms_status|reason|to`.
- `:64-110`: `logRequestStatusHistory(..., $notifyOutcome)`.
- Callers, e.g. `loan-applications.php:44-91`: they build `['admin_chose'=>bool, 'email'=>{status,reason,to}, 'sms'=>{…}]` and set `notify_sent` only if a channel succeeded.
- `arvLogList()` shows ✓/✗ per channel in the history log.

**Node:** the columns already exist (`db/schema.sql:1535-1552`). `notify.applicationEvent` (`src/lib/notify.js:229-241`) ignores the results. `changeStatus` sets `notify_sent=1` regardless (`admin-applications.js:209-212`).

**Change:**
1. `applicationEvent` returns `{ sms: {status, reason, to}, email: {…} }`. Map `sendSms`/`sendEmail` results as follows: `{ok:true}` → `sent`; `{skipped}` → `skipped` + reason; `{ok:false,error}` → `failed` + error; no template or contact → `not_attempted`.
2. In `changeStatus`: insert the history row first (keep the returned `id`). Inside the `notify.later` callback, after `applicationEvent`, run `UPDATE request_status_history SET admin_chose_to_notify=1, notify_sent=$2, notify_email_status=$3, notify_email_reason=$4, notify_email_to=$5, notify_sms_status=$6, notify_sms_reason=$7, notify_sms_to=$8 WHERE id=$1`. `later` keeps the schema, so this is safe.
3. Do the same in the membership approve route (`:358-360`).
4. `inbox-view.ejs` history `<li>`: append badges `Email ✓/✗/—` and `SMS ✓/✗/—`, with the reason as a `title`.
5. Optional (PHP parity for item 7): a setting `inbox_quick_status_notify` (default 0). When it is 1, quick and bulk status pass `notifyApplicant: true`.

### b-5 [P2] Welfare claim payment stage
**PHP:**
- `admin/welfare-claims.php:112-120`: statuses pending, under_review, approved, rejected, paid, completed.
- `:56-63`: `paid_at = CASE WHEN status='paid' THEN NOW() ELSE paid_at END`.
- `includes/welfare-claims-tables.php:63-67`: the `paid_at` column.
- Type badge colour/icon come from `welfare_claim_types.color/icon` (`:228-230`).

**Node:** the `member_welfare_claims` CHECK only allows pending, processing, approved and rejected (`db/schema.sql:951-957`). There is no `paid_at`.

**Change:**
- New migration `db/migrations/060_admin_ops_parity.sql`:
  ```sql
  ALTER TABLE member_welfare_claims ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP NULL;
  ALTER TABLE member_welfare_claims DROP CONSTRAINT IF EXISTS member_welfare_claims_status_check;
  ALTER TABLE member_welfare_claims ADD CONSTRAINT member_welfare_claims_status_check
    CHECK (status IN ('pending','processing','under_review','approved','rejected','paid','completed'));
  ```
  Check the real constraint name with `pg_constraint`. `forms.statusesFor` reads the CHECK, so the new statuses appear automatically. Clear `statusCache` on migrate/restart.
- In `changeStatus` (`admin-applications.js:175`): `if (m.key==='welfare' && data.status==='paid' && row.status!=='paid') data.paid_at = new Date();`.
- Add `paid: ['भुक्तानी भयो','Paid']` to `STATUS_LABELS` in `src/lib/forms.js:314` (`under_review` is already there).
- `inbox-view.ejs` welfare block: show `paid_at` and approved vs claimed. In the list, add a claim type chip coloured by `welfare_claim_types.color`. The type filter comes from b-3.

### b-6 [P2] KYC ↔ member SSOT tools on the KYC inbox
**PHP:**
- `admin/kyc-applications.php:712-720` and `includes/member-ssot.php:620-668`: `link` filter.
  - `linked`: a member with the same `upper(trim(sadasyata_number))`, `kyc_application_id` set and a password.
  - `kym_only`: member_id is empty or no member row matches.
  - `no_password`: a member row exists with an empty password_hash.
  - `unlinked_member`: a member row exists with `kyc_application_id` NULL or 0.
- Per-row badge: `memberSsotLinkStatusLabel` (`member-ssot.php:670-700`).
- Divergence alert on the detail page: `memberSsotCompareSharedContact` (`member-ssot.php:1536-1570`) compares member → KYM pairs: name/full_name_en, name_np/full_name, phone/mobile (normalised), email/email, address/permanent_address, gender/gender, dob/dob_ad. It shows a table field | member | KYM.
- `?from_member=` back link (`:824, 862-868`).

**Node change:**
- `admin-applications.js` `inboxQuery`: when `m.key==='kyc'`, accept `req.query.link` ∈ the four values and add the matching `EXISTS(...)` clause, using `members m WHERE upper(trim(m.sadasyata_number)) = upper(trim(kyc_applications.member_id)) AND m.deleted_at IS NULL`.
- In the list, fetch a link status for the rows on the page: one query `SELECT upper(sadasyata_number) sid, kyc_application_id, (password_hash IS NOT NULL AND password_hash<>'') has_pw FROM members WHERE upper(sadasyata_number)=ANY($1) AND deleted_at IS NULL`. Compute the code in JS and render a badge column for kyc.
- Add `kym.compareShared(member, kyc)` to `src/lib/kym.js` (port the pairs above; phone through `normalizeMobile`). In `GET /inbox/:module/:id` for kyc, load the full member (`SELECT *`) and pass `divergent`. In `inbox-view.ejs`, show a warning card with the diff table and the existing "Link / sync member" button.
- Member page (`views/admin/member-form.ejs`): the link to the KYM goes to `/admin/inbox/kyc/<id>?from_member=<memberId>`. The KYC view shows a "← Member" crumb when `from_member` is present.

### b-7 [P2] Members list: KYC filter, stats, audience bulk notification
**PHP:**
- `admin/members.php:385-388, 444-450`: `kyc` filter.
  - `linked`: kyc_application_id is set and a password exists.
  - `unlinked`: kyc_application_id is NULL or 0.
  - `no_password`: empty password_hash.
- `:588-610`: stats total, active, pending, renewal_pending, kyc_linked, google and facebook.
- `:73-117`: bulk notification `notif_target=all`. `notif_audience`:
  - `active` (default): is_active=1 AND approval_status IN (approved, active).
  - `pending`: approval_status='pending'.
  - `kyc_linked`: is_active=1 AND kyc_application_id IS NOT NULL.
  - `all_active`: is_active=1.
  - Fields: title, message, type (info, success, warning, error); link to member notifications.

**Node:** `src/routes/admin-members.js:30-45` filters only q, status, ms and view. The only broadcast is `/admin/notifications/push` (`src/routes/admin.js:549-561`): all active members, admin only.

**Change:**
- `memberFilter()`: add `kyc` ∈ linked / unlinked / no_password with the SQL above, plus `deleted_at IS NULL`. Carry it into `qs` and into the export (export uses the same filter).
- `GET /members`: one stats query using `count(*) FILTER (...)` for each of the stats above. Render a stats strip in `views/admin/members.ejs`; each chip links to its filter.
- New route `POST /admin/members/notify-bulk` (staff+, audited):
  - Body: `audience` ∈ active / pending / kyc_linked / all_active, `title` (required, ≤200), `message` (≤2000), `type`, and optional `push=1`, `sms=1`, `email=1` (SMS/email admin-only, capped by notify daily limits).
  - Build the WHERE from the audience (always `deleted_at IS NULL`). Insert into `member_notifications` set-wise: `INSERT … SELECT id, $title, … FROM members WHERE …`.
  - If `push`, call `push.sendToMembers(ids)` (or `sendToAll` for all_active).
  - Flash the count.
  - UI: a "Notify members" modal or details block in `members.ejs`.

### b-8 [P3] Member partner-service history + programme rating
**PHP:**
- `admin/member-online-portal.php:203-213`: the member view lists the last 20 `member_partner_services` rows (partner_name, service_name, service_taken, service_note, created_at), with a partner select that filters the table client-side (`:610-640`).
- `admin/member-activities.php:109`: partner services are a source.
- `member-online-portal.php:243-262`: attendance rating = distinct active programmes attended / count of active programmes.

**Node change:**
- `memberView()` (`admin-members.js:189-199`): add `db.many('SELECT partner_name, service_name, service_taken, service_note, created_at FROM member_partner_services WHERE member_id=$1 ORDER BY created_at DESC LIMIT 20', [item.id])` and a card in `member-form.ejs`.
- `src/lib/member-portal.js` `activities()`: add a source from `member_partner_services` with the type `['साझेदार सेवा','Partner service']`, status `service_taken? 'taken':'logged'` and detail `partner_name — service_name`.
- Optional: in `memberView`, compute `attended = count(DISTINCT program_id) … attendance_status='VALID'` against active programmes and show it as "n / N programmes".

### b-9 [P2] Member import parity (`includes/member-import-helpers.php`)
**PHP:**
- Header aliases `:136-232`: member_id, memberid, sadasyata_no, membership_number, coop_member_id → sadasyata_number; member_name, name_of_member → full_name; full_name_np, nepali_name → name_np; mobile_no, contact_number, contact_no → mobile; e_mail; permanent_address, addr; janma_miti → dob_bs; birth_date; sex; father, fathers_name, baba_ko_nam → father_name; citizenship, citizenship_number, nagarikta_no → citizenship_no; membership_date, membership_date_bs, membership_date_ad, member_since, join_date, sadasyata_miti.
- `memberImportApplyOptionalExtras` `:570-658`: sets `members.membership_date` (AD) and calls `memberSsotEnsureKycStubFromMember` (creates or links a KYM stub); then soft-fills `father_name` and `citizenship_no` (encrypted) into the KYM only where empty.
- Import tick `:1283-1290, 1515-1530`: when the job has ≤400 rows (`MEMBER_IMPORT_CARD_ROW_LIMIT`/`KYC_ROW_LIMIT`, `:19-24`), generate an ID card per created/updated member (`adminGenerateMemberIdCard`), ensure the KYM stub, run `memberSsotSyncKycFromMember(...,'soft')` and increment `cards_count`.
- `memberImportExportErrors` `:1845-1918`: CSV of failed and invalid rows per job.

**Node:** `src/lib/member-import.js` (aliases `:28-43`, stage `:87-131`, commit `:133-174`). Its `member_import_rows` lacks father_name and citizenship_no (the PII map at `src/lib/pii-crypto.js:24` already expects `citizenship_no`).

**Change:**
- Migration `060`: add `father_name VARCHAR(150)`, `citizenship_no VARCHAR(512)` and `membership_date DATE` to `member_import_rows`; add `membership_date DATE` to `members`.
- `ALIASES`: add the aliases above. Add `father_name`, `citizenship_no`, `membership_date` (auto), `membership_date_bs` and `membership_date_ad`. Parse dates with the existing `normDob(raw, kind)`, but allow any past date.
- `stage()`: store the new fields. Encrypt `citizenship_no` with `pii.encryptFields('member_import_rows', …)`; `db` decrypts on read.
- `commit()`: after the member insert/update:
  - `membership_date`: `UPDATE members SET membership_date = COALESCE($1, membership_date)`.
  - If `father_name || citizenship_no`, or the job has ≤400 rows: call a new helper `kym.ensureStubFromMember(memberId)`. It finds a KYM by `findKycByMemberId(sid)`. Otherwise it inserts a `kyc_applications` row with status `incomplete`, `member_id=sid`, `full_name=name_np||name`, `full_name_en=name`, `mobile`, `email`, `permanent_address`, `gender`, `dob_ad`, `tracking_id`, and links `members.kyc_application_id`. Then fill father_name and citizenship_no where empty (`mergeFillEmpty`).
  - If the job has ≤400 rows (constant `CARD_ROW_LIMIT=400`): `portal.issueCard(member, adminId, tenant)` when the member has no active card. Increment `cards_count`. Pass `tenant` from the route.
- New route `GET /admin/members/import/:id/errors.csv`: rows with `status IN ('invalid','failed')`, columns row_num, sadasyata_number, full_name, mobile, status, message. Add the link in `member-import-job.ejs`.
- `SAMPLE` (`member-import.js:177-179`): align with PHP `member-import-sample.php`: columns member_id, full_name, name_np, mobile, email, address, dob, gender, father_name, citizenship_no, membership_date, monthly_saving, with BS dates.
- Keep the Node rule of no temp password (members claim the account via Member ID + mobile in `member-portal.js:86-110`). Write this in the import page help text.

### b-10 [P3] Marketplace admin detail with inquiries
**PHP:** `admin/member-marketplace.php:174-194` and its view: `?view=id` shows the full listing (all fields, image, availability) and the last 50 `member_marketplace_inquiries` (name, phone, message, created_at). Actions approve, reject (note), extend, expire and delete are on the same page.

**Node:** `src/routes/marketplace.js:105-144` has a list only, with an inquiry count.

**Change:** add `admin.get('/:id', …)`. Load the listing joined with members, and `SELECT * FROM member_marketplace_inquiries WHERE listing_id=$1 ORDER BY id DESC LIMIT 50`. Render the new `views/admin/marketplace-view.ejs` with the existing action forms (POST `/admin/marketplace/:id`). Link the titles in `marketplace.ejs` to it. Also add an `all` tab (PHP `:132-150` counts all).

### b-11 [P3] Programme form fields + clear QR
**PHP:** `admin/programs.php:30-158` saves `is_multi_location`, `instant_attendance`, `shared_qr_mode`, `eligible_member_scope`, `qr_starts_at`/`qr_expires_at` (BS date + time) and `attendance_open_at`/`close_at`. `gen_qr` (`:175-200`) sets a default window: event day start → event day + 1 (or +7 days if there is no date). `clear_qr` nulls the token and disables the QR.

**Node:** `resources.upcoming_programs` (`resources.js:191-204`) edits only title, type, date, time, location, description, pre-registration and active. `/admin/programs/:id/qr` (`admin-programs.js:62-80`) covers enabled, open/close, rotate, instant and pre-registration.

**Change:**
- Add to the resource fields:
  - `B('is_multi_location', …)`
  - `SEL('eligible_member_scope', …, [['all_active',…],['shareholders',…],['voters',…]])`
  - `B('instant_attendance', …)`
  - `B('shared_qr_mode', …)`
- Leave the QR window on the programme page.
- In `/:id/qr`, accept `req.body.clear === '1'` → `qr_token=NULL, qr_enabled=0`, audit `program_qr_clear`. When the token is generated for the first time and no window is set, default `attendance_open_at` to the event date 00:00 NPT and `attendance_close_at` to event date + 1 day 23:59 (or now + 7 days with no date). This matches PHP.
- Note: neither app uses `shared_qr_mode` or the non-`all_active` scopes at check-in. Mark them "future" in the label, as `program-settings` already does.

### b-12 [P2] Edit programme occurrences
**PHP:** `admin/program-occurrences.php` (`save` with `id`): fields location_name, event_date (BS → AD), start_time, end_time, attendance_open (BS + time), attendance_close, sort_order and is_active; actions `gen_qr` and `clear_qr`.

**Node:** `admin-programs.js:82-100` has add and delete only. The QR window per occurrence goes through `/:id/qr` with `occurrence_id`.

**Change:** add `POST /admin/programs/:id/occurrences/:occ`:
- Validate that the occurrence belongs to the programme.
- Update `location_name` (required, ≤200), `event_date` (YYYY-MM-DD, or BS through `nd.bsToAd` when the input is BS), `start_time`, `end_time`, `sort_order` (int) and `is_active` (0/1). When it is deactivated, also set `qr_enabled=0`.
- Audit it.

In `views/admin/program-detail.ejs`, add an inline edit `<details>` per occurrence row. The list order is already `sort_order`.

### b-13 [P2] Registration desk: lookup → confirm, eligibility, history, monthly saving
**PHP:**
- `admin/program-registration-desk.php:100-140` and `admin/api/program-desk-lookup.php`. Typing a Member ID calls the lookup API, which returns name, name_np, photo URL (KYM photo or avatar), father name, phone, address, `monthly_saving`, eligibility (`programValidateMemberEligible`), existing attendance for this scope (with "can void" for the desk's own recent entry) and `programMemberHistorySummary` (total attended; AGM last 3 attended/total; streak; last 3 programmes).
- The staff confirms. The POST records the attendance and, if a `monthly_saving` radio was chosen, calls `coop_monthly_saving_set(member, value, 'Registration desk')` (`:130-134`).
- Eligibility (`includes/program-attendance-helpers.php:385-412`): the member must exist, have a sadasyata number, be `is_active=1` and have approval_status ∈ ('', approved, active, confirmed, renewal_pending). Otherwise log the attempt `INELIGIBLE`.

**Node:**
- `admin-programs.js:102-120` POSTs and checks in at once.
- `att.findMember` (`src/lib/attendance.js:84-89`) only checks `is_active`.
- `src/lib/program-reports.js:44` already has the `ELIGIBLE` SQL.

**Change:**
1. `src/lib/attendance.js`: add `eligibility(member)` → `null | [np,en,code]` using the rule above. In `record()`, when the caller passes `checkEligible: true` and the rule fails, call `logAttempt(..., 'INELIGIBLE', ...)` and return `{ ineligible: reason }`. Use it from the desk, prereg-attend and request-approve paths, and from the member QR flow if it does not already check.
2. New JSON route `GET /admin/programs/:id/desk/lookup?q=&occurrence_id=&desk_id=` (staff). It returns `{ ok, member: {id, name, name_np, sadasyata_number, phone, address, father_name (from the linked KYM), photo (KYM photo or avatar_url), monthly_saving}, eligible: bool, reason, existing: {id, attended_at, desk_id, can_void}, history: rep.memberHistorySummary(id, programId) }`.
3. `src/lib/program-reports.js`: add `memberHistorySummary(memberId, currentProgramId)` (port `program-member-insights.php:232-250` using the existing `memberLog` / `memberTypeRegister`).
4. Desk POST (`/:id/desk`): accept `member_id` (exact id from the lookup) as well as `q`, and the optional `monthly_saving` ∈ '1' / '0'. After a successful or duplicate check-in, run `UPDATE members SET monthly_saving_regular=$1` and audit `member_monthly_saving` "(Registration desk)".
5. Front end: a new `public/js/program-desk.js` (CSP: no inline script). Debounced lookup on input, a member card (photo, name, ID, history chips, monthly-saving radios), and the Confirm button submits. Without JS, the existing one-shot form still works.

### b-14 [P2] Cross-programme attendance register + exports
**PHP:** `admin/program-attendance.php`:
- Export block `:5-180`, run before the header.
- Filters `:472-530`: `program_id`, `q` (member name, ID, phone), `date_from`/`date_to` (BS or AD → `programFilterBsDateToAd`), `active_only` (active programmes) and `show_done` (requests that are already processed).
- `export=1`: attendance with columns Member ID, Name, Father, Phone, Program, Location, Method, Status, Attended At, Void reason.
- `export=prereg`: pre-registrations with Name, Member ID, Phone, Program, Source, Created, Attended?
- `export=requests`: attendance requests (pending, or all with show_done) with Name, Card no, Phone, Address, Program, Location, Status, Requested at, Processed at, Admin note.

**Node:** per programme only. `GET /:id/attendance.csv` has 9 raw columns. No prereg or requests export. Processed requests are never listed.

**Change:**
- `GET /admin/programs/register` (staff): a paginated table of `member_program_attendance a JOIN members m LEFT JOIN upcoming_programs p` with the filters above. Use `nd.bsToAd` when the date matches a BS year above 2050. Add tabs "Attendance | Pre-registrations | Requests (pending / all)". Link it from `programs.ejs` and the dashboard.
- `?export=attendance|prereg|requests`: CSV through `sendCsv` (the helper in `admin-program-reports.js:21-24`; move it to `util`), with the column lists above. Audit `program_report_export`.
- `program-detail.ejs` requests tab: add a "show processed" toggle (`status <> 'pending'`, last 200) and per-programme prereg/requests CSV links (`/admin/programs/register?program_id=X&export=prereg`).
- Extend `/:id/attendance.csv` with Father (from the KYM), Desk and Staff, or redirect it to the breakdown `export=detail`, which already has them.

### b-15 [P3] Election resource fields
**PHP:**
- `election-information.php` saves `intro_en` and `show_in_navbar`; milestones `m_detail_np` and `m_detail_en`.
- `election-candidates.php` saves `bio_en`, `email` and `address`.
- The columns exist in Node (`db/schema.sql` election_cycles, election_candidates, election_milestones).

**Change:** `src/modules/resources.js`:
- `election_cycles`: add `TA('intro_en', …)` and `B('show_in_navbar', …)`. Then honour `show_in_navbar` in `src/lib/navigation.js`: show the Elections item only when a published cycle has `show_in_navbar=1`. Check how PHP builds the nav before changing it.
- `election_candidates`: add `TA('bio_en')`, `T('email', …, {type:'email'})` and `T('address')`.
- `election_milestones`: add `TA('detail_np')` and `TA('detail_en')`, and render them on the public election page.

### b-16 [P3] Type tables: icon/colour; honour programme fields
- `digital_service_types` and `welfare_claim_types` resources: add `T('icon', 'आइकन', 'Icon (lucide name)')` and `T('color', 'रङ', 'Colour', { type: 'color' })`. PHP shows the colour badge in lists (`welfare-claims.php:228`).
- `honor_programs` resource (`resources.js:209-212`): add `T('event_label')`, `TA('instructions_en')` and `B('show_new_badge')`. PHP stores open/close as BS + time (`honor-programs.php` `opens_at_bs`, `opens_at_time`); Node uses a datetime input, which is acceptable.

### b-17 [P3] Reports (publications)
**PHP:** `admin/reports.php:14-36`:
- `report_type` select ∈ monthly, quarterly, progress, annual, financial, audit, agm, other.
- Fiscal year select from `getBSFiscalYears()`.
- Month select (baisakh…chaitra).
- Quarter select Q1–Q4.
- `view_only` flag: `report-file.php:40` streams inline and never as a download.

**Change:**
- Migration `060`: `ALTER TABLE reports ADD COLUMN IF NOT EXISTS view_only SMALLINT NOT NULL DEFAULT 0;`.
- Resource `reports`: `report_type` → `SEL` with the list above; `report_month` and `report_quarter` → `SEL`; `report_year` → `SEL` from a helper `nd.fiscalYears(10)` (e.g. "2081/82"); add `B('view_only', 'हेर्न मात्र', 'View only (no download)')`.
- Public report file route (in `src/routes/public.js`, the reports handler): when `view_only`, send `Content-Disposition: inline` and hide the download button.

### b-18 [P2] PII maintenance CLI (`scripts/pii-encrypt.php`)
**PHP:** `status` (configured? rows encrypted vs plaintext per table), `keygen`, `migrate [--dry-run]` (encrypt existing plaintext rows, verifying a round-trip before each UPDATE, with the guard `WHERE col = old`), and `decrypt` (rollback to plaintext).

**Node:** `src/lib/pii-crypto.js` encrypts on write only. Rows from before `PII_KEY`, and rows imported into an unencrypted tenant, stay plaintext.

**Change:** new `scripts/pii.js` and `"pii": "node scripts/pii.js"` in package.json. Usage: `npm run pii -- status|keygen|migrate|decrypt [--tenant=slug|--all] [--dry-run]`. For each tenant schema and each table/col in `PII_COLUMNS`:
- `status`: count `col LIKE 'pii3:%'` against other non-empty values.
- `keygen`: print `crypto.randomBytes(32).toString('hex')` once, with a backup warning. Never write to disk.
- `migrate`: select `id, col` where the value is non-empty and not encrypted (batches of 500). `enc = pii.encrypt(v, schema)`, check `pii.decrypt(enc, schema) === v`, then `UPDATE t SET col=$enc WHERE id=$id AND col=$v`. Before running, widen the column to VARCHAR(512) if it is narrower.
- `decrypt`: the reverse, with the same guard.

Run inside `db.withSchema`. Raw reads must skip `db.js` auto-decrypt; use a `pool.query` bypass or check `pii.isEncrypted`. Document it in `docs/DEPLOY.md`.

### b-19 [P3] Legacy admin URL redirects
Old SMS, emails and bookmarks point at `admin/<x>.php?view=N`. Add an admin map to `src/lib/legacy-urls.js`, or a small router mounted before `/admin`:
- `loan-applications.php?view=N` → `/admin/inbox/loan/N`
- `account-applications.php` → `account`
- `kyc-applications.php` → `kyc`
- `grievances.php` → `grievance`
- `appointments.php` → `appointment`
- `feedbacks.php` → `feedback`
- `welfare-claims.php?action=view&id=N` → `welfare`
- `digital-service-requests.php?action=view&id=N` → `digital`
- `honor-applications.php?action=view&id=N` → `honor`
- `job-applications.php?view=N` → `job`
- `vendor-enlistment.php?view=N` → `vendor`
- `membership-applications.php?view=N` → `membership`
- `auction-bids.php?auction_id=N` → `/admin/inbox/bid?auction=N`
- `members.php?view=N` → `/admin/members/N`
- `member-online-portal.php` → `/admin/member-portal`
- `member-import.php` → `/admin/members/import`
- `member-ssot-duplicates.php` → `/admin/members/duplicates`
- `programs.php` → `/admin/programs`
- `program-detail.php?id=N` → `/admin/programs/N`
- `program-reports-<x>.php` → `/admin/programs/reports/<x>`
- `program-member-history.php` → `/admin/programs/reports/history`
- `program-dashboard.php` → `/admin/programs/dashboard`
- `program-settings.php` → `/admin/programs/settings`
- `election-results.php?cycle=N` → `/admin/elections/N`
- `election-voting-attendance.php?cycle=N` → `/admin/elections/N/desk`
- `kyc-risk-reviews.php` → `/admin/kyc-risk-reviews`
- `information-room-logs.php` → `/admin/information-room/logs`
- `print-form.php?type=T&id=N` → `/admin/inbox/<T>/N/print`
- also the `applications/*` and `members/*` stubs

Use 301 for GET only and keep the auth checks (the redirect target enforces them).

---

## Priority roll-up
- **P1:** b-1 delete guards (programmes, election cycles/positions/candidates, type tables, honour, auctions); b-2 auction exclusive winner and per-auction bids.
- **P2:**
  - b-3 inbox status cards, module filters and ordering
  - b-4 per-channel notify audit
  - b-5 welfare paid stage
  - b-6 KYC SSOT filter, badge and divergence
  - b-7 member filters, stats and audience notify
  - b-9 import parity (KYM stub, cards, membership_date, errors CSV)
  - b-12 occurrence edit
  - b-13 desk lookup, eligibility and monthly saving
  - b-14 cross-programme register and exports
  - b-18 PII CLI
- **P3:**
  - b-8 partner-service history
  - b-10 marketplace detail
  - b-11 programme fields and clear QR
  - b-15 election fields
  - b-16 type and honour fields
  - b-17 reports view_only and selects
  - b-19 legacy URLs
  - item 7 (quick-status notify setting)
  - item 16 (PIN message)
  - item 50 (completed-auction labels; fixed by b-2)
  - item 41 (IR category list and bulk)

All schema changes for this slice go into one new migration, `db/migrations/060_admin_ops_parity.sql`:
- `member_welfare_claims`: `paid_at` and a widened status CHECK.
- `reports.view_only`.
- `members.membership_date`.
- `member_import_rows.father_name`, `citizenship_no` and `membership_date`.
