# Gap report 2: public online forms, member portal, member auth

Scope: PHP `/home/user/websourcecode` (online-kyc, loan-apply, online-account, appointment, grievance, honor-apply, member-welfare, digital-services form, vendor-enlistment, member-survey, verify, tracker-id-card, career-detail apply, auction bid, contact, attend, login/oauth/password-reset stubs, upload-file, member-marketplace/skills, the whole `member/` folder and the related `includes/*`) compared with Node `/home/user/websitenextgen`.

Abbreviations: **PHP** = websourcecode, **N** = websitenextgen. "apps.js" = `src/modules/applications.js`, "forms.js" = `src/lib/forms.js`, "subs.js" = `src/lib/submissions.js`, "public.js" = `src/routes/public.js`, "pm.js" = `src/routes/public-members.js`, "portal.js" = `src/lib/member-portal.js`.

Nothing in either repo was modified.

---

## (a) Summary table

Status key: DONE = parity or better · PARTIAL = exists, with something missing · MISSING = not in Node. Priority: P1 = users or staff would notice / data-integrity risk, P2 = noticeable but has a workaround, P3 = polish.

### Public forms (shared engine)

| # | Feature | Status | Pri | Note |
|---|---|---|---|---|
| F1 | One declarative engine: validation, uploads, tracking IDs, admin inbox, applicant SMS/email, webhooks | DONE (better) | – | apps.js + forms.js + subs.js |
| F2 | "Are you a cooperative member? Yes/No" on loan, account, appointment, grievance, welfare, digital, honor, feedback. With Yes, Member ID + mobile are checked against KYM and name, mobile, email, address and citizenship come from KYM on the server | MISSING | P1 | `includes/kyc-public-form.php`. Node trusts whatever is typed |
| F3 | Signed-in member: identity fields locked and taken on the server from the linked KYM/member, not from the POST (`member-prefill-block.php`) | PARTIAL | P1 | N prefills the values but they stay editable and the server keeps what was posted |
| F4 | Services that need an approved KYM (appointment member visit, grievance, welfare, digital, honor, feedback when "member=yes" or signed in) | MISSING | P1 | `verifyPublicFormKycApprovedByMemberId` |
| F5 | Math captcha (`coop_math_challenge_*`) on every public form | MISSING | P2 | N has honeypot, rate limit and optional Turnstile. With no Turnstile keys there is no human check |
| F6 | Spam/link scan on loan (purpose, collateral, other income), welfare (description), KYC (remarks), auction (message), digital, vendor | PARTIAL | P2 | N scans only grievance, feedback, appointment and survey (`SPAM_SCAN`, public.js:473) |
| F7 | 10-digit `9XXXXXXXXX` mobile on loan, account, grievance, welfare, digital, job, bid | PARTIAL | P2 | N `isPhone` also accepts landlines. The 10-digit rule is only enforced in the KYC, membership and appointment hooks |
| F8 | Email required for guests (loan, account, grievance, digital, appointment) | PARTIAL | P2 | N: optional everywhere except KYC and job |
| F9 | Multi-step wizard UI (loan: 4 steps; KYC: section wizard with step counter, progress bar, Save & Next, per-step validation) | MISSING | P2 | N renders one long page. KYC has a section TOC only |
| F10 | Success page: copy button for the tracking ID, "new application", EMI link | PARTIAL | P3 | apply-done.ejs has no copy button |
| F11 | Legacy option values (loan repayment/collateral, appointment purpose, account type) | PARTIAL | P2 | Option keys differ, so imported rows show raw keys |

### Per-form

| # | Form | Status | Pri | What is missing |
|---|---|---|---|---|
| K1 | KYC: path selector "I am a member / Become a new member / Portal login" | PARTIAL | P2 | N has separate /apply/kyc and /apply/membership pages, and the KYC page does not link to membership |
| K2 | KYC public **verify-first gate** (Member ID + ledger mobile → session for 2 h) before the full form | MISSING | P1 | N only finds a mismatch after the user has filled the whole form and uploaded documents |
| K3 | KYC public: existing values shown **read-only (locked)**, only empty fields editable (`memberSsotPrefillEmptyOnlyFromKyc`) | MISSING | P1 | N merges server-side but shows a blank form, so the user cannot see what is already on file |
| K4 | KYC "Quick fill" (name, email, NID only; fill-empty) | MISSING | P3 | |
| K5 | KYC camera capture with crop/rotate, signature pad, thumb-print capture with quality check, photo quality score (<30 rejected) | MISSING | P2 | N: plain `<input type=file capture>`. `photo_quality_score` column exists but is unused |
| K6 | KYC map picker (Leaflet + OSM, draggable marker, Nominatim reverse geocode → `map_resolved_address`) | PARTIAL | P3 | N: GPS button and OSM link only |
| K7 | KYC draft autosave to localStorage, step memory, section "filled/incomplete" badges, Enter key does not submit | MISSING | P2 | |
| K8 | KYC: all fields, family table, AML JSON, income/expense, nominee-from-family, business/rented/coop conditional fields, NID rules, fill-empty merge, portal re-review, member SSOT sync, want_id_card auto-issue | DONE | – | apps.js:101-213, kym.js |
| L1 | Loan: `other_income`, `guarantor_address` fields | MISSING | P2 | Columns already exist in `loan_applications` |
| L2 | Loan: multiple documents (`documents[]`, comma-joined) | PARTIAL | P2 | N: single file |
| L3 | Loan type dropdown shows the rate "(x.xx%)" | MISSING | P3 | |
| A1 | Account: member verify path (`account_member_id`), KYM-sourced identity | MISSING | P1 | see F2 |
| A2 | Account: DOB AD↔BS normalisation, citizenship issued date validated | PARTIAL | P3 | N `citizenship_issued_date` is free text |
| P1a | Appointment: time slots from `office_time_start`/`office_time_end` settings, 30-minute steps, server-side check against the list | PARTIAL | P2 | N: hard-coded hourly 10:00–16:00 |
| P1b | Appointment: purpose keys `account_inquiry, loan_inquiry, kyc_update, loan_repayment, account_opening, other` | PARTIAL | P2 | N keys differ (`account, loan, membership, meeting, other`) |
| P1c | Appointment: separate `organization_name` input for a cooperative visit | DONE (mapped into `name`) | – | |
| G1 | Grievance: anonymous → name optional, but mobile and email required | PARTIAL | P3 | N: name always required |
| W1 | Welfare: member verification (approved KYM) when member=yes or signed in | MISSING | P1 | Money claims accept any typed Member ID |
| W2 | Welfare: multiple `documents[]` | PARTIAL | P3 | |
| W3 | Welfare statuses `under_review`, `paid`, `completed` + `approved_amount` shown to the applicant | PARTIAL | P2 | N CHECK allows only pending/processing/approved/rejected, and the tracker does not show `approved_amount` |
| D1 | Digital: conditional fields per service: bill (`biller_name`, `bill_reference`), recharge (`recharge_number`, `recharge_amount`), share refund/increase (`service_amount`, required >0), statement dates only for `statement_request` | MISSING | P1 | Columns exist. N shows statement dates for every service |
| H1 | Honor: "applications closed / opening soon" state with upcoming programmes (opens/closes in BS), active-programme banner with `closes_at` and instructions | MISSING | P2 | N shows an empty dropdown |
| H2 | Honor: `business_note` field | MISSING | P3 | Column exists |
| H3 | Honor: discoverable (link from the menu or dashboard when a programme is open) | MISSING | P2 | `honor` is `hidden: true` and nothing in N links to /apply/honor |
| J1 | Job: duplicate check (same career + same email or phone) | MISSING | P2 | career-detail.php:113-124 |
| J2 | Job: `certificates` upload | MISSING | P3 | `certificates_path` column exists |
| J3 | Job: server-side `allow_online_apply` + deadline check | PARTIAL | P2 | N filters by deadline only. `allow_online_apply` is checked only in the view |
| B1 | Auction bid: open-for-bids check (status upcoming/ongoing **and** end date/time not passed) | PARTIAL | P1 | N's `auctions` option source checks status only |
| B2 | Auction bid: `bid_amount >= minimum_price` | MISSING | P1 | |
| B3 | Auction bid: one pending bid per phone per auction in 24 h; double-submit token | MISSING | P2 | |
| B4 | Auction bid: tracking ID (BID-…) and tracker support | MISSING | P2 | `auction_bids` has no `tracking_id` in N, and the module is `noTracking` |
| V1 | Vendor: `business_type` required select (stationery, electronics, furniture, printing, software, security, maintenance, other) | PARTIAL | P3 | N: free text, optional |
| S1 | Feedback (member-survey.php): phone required, member verify | PARTIAL | P3 | |
| C1 | Contact form + spam guard | DONE (minus math captcha, F5) | – | |
| M1 | Membership request (soft duplicate on pending mobile, tracking) | DONE (better: the existing tracking ID is not leaked) | – | N requires citizenship_no. PHP only recommends it (P3) |

### Tracker / verify / ID card

| # | Feature | Status | Pri | Note |
|---|---|---|---|---|
| T1 | Track by tracking ID (N also requires phone: safer) | DONE (better) | – | |
| T2 | Phone + email + one tracking ID → all applications | DONE (better: lists all) | – | |
| T3 | Per-session fail guard (7 fails → 15-minute block) | DONE | – | |
| T4 | Signed 15-minute ID-card preview link | DONE | – | |
| T5 | Per-type **details grid** (loan type/amount/purpose/guarantor/collateral, account type/deposit/nominee, appointment date/time/purpose, grievance category/subject, welfare claim type/amount/approved amount, digital service details, bid amount + auction title, job title, vendor company/PAN) | MISSING | P2 | N shows only name, date, remarks, attachment, history |
| T6 | Per-type **progress stepper** (expected stages, e.g. loan pending→processing→approved→disbursed) | MISSING | P3 | N shows history entries only |
| T7 | Membership request: show **assigned Member ID** (`assigned_sadasyata`) with a "now fill KYM" link | MISSING | P1 | The applicant needs this ID for KYM |
| T8 | Tracker covers auction bids | MISSING | P2 | see B4 |
| T9 | Legacy deep links `grievance.php?track=`, `member-welfare.php?track=`, `online-kyc.php?path=new`, `member-skills.php` | PARTIAL | P3 | legacy-urls.js drops the param or points to the wrong page |
| Y1 | Verify card by code + CVV with lock after 5 wrong tries | DONE | – | |
| Y2 | Verify card by **name + Member ID + mobile (+ optional CVV)**, the method printed on PHP-issued cards ("Verify: name + member ID + mobile") | MISSING | P1 | card-verify-helpers.php:616-807 |
| Y3 | Verify result shows **photo (from KYM)**, Member ID, father's name, DOB, member since, expiry, verify count | PARTIAL | P2 | N shows name, card no, issued and expiry dates |
| Y4 | Partner desk service log after verify (30 min, PIN) | DONE | – | |
| Y5 | Partner preselect via `?partner_id=` / `?partner=CODE` (desk QR) | MISSING | P3 | |
| Y6 | Public programme pre-registration by member number (verify.php `program_preregister`) | PARTIAL | P3 | N requires portal login |
| I1 | Member ID card page: active card, CVV, print, locked-card unlock request | DONE | – | |
| I2 | ID card: **KYM photo** as card photo, expiry warning (≤60 days) / expired notice, card back (Member ID, mobile, coop address/phone/website, verify instructions), flip | PARTIAL | P2 | N uses `avatar_url` only, with no expiry notice |
| I3 | ID card: programme-attendance star rating | MISSING | P3 | |
| I4 | ID card: auto-create card on the fly for approved members without one | MISSING | P3 | N: "not issued yet" (arguably safer) |

### Member auth

| # | Feature | Status | Pri | Note |
|---|---|---|---|---|
| U1 | Login by email / member no. (N adds mobile and card no.) | DONE (better) | – | |
| U2 | Login matches normalised mobile (+977, dashes) and Devanagari-digit member numbers | PARTIAL | P2 | auth.js:83 `phone = $1` exact. Member ID ignores `idVariants` |
| U3 | Pending / rejected (with reason) messages | DONE | – | |
| U4 | **Card expiry → `renewal_pending`, login blocked with a renewal message** | MISSING | P2 | member-auth.php:737-753 |
| U5 | TOTP 2FA **mandatory for every member** (PHP) | PARTIAL | P2 | N: optional unless `member_2fa_required=1` (default 0) |
| U6 | Google / Facebook login, link and unlink, email auto-link only for 2FA accounts | DONE | – | N does not copy the OAuth avatar (P3) |
| U7 | Self-registration (Member ID + mobile + email vs ledger/KYM), live availability check | DONE | – | |
| U8 | Forgot password: OTP via SMS/email, resend, office-request fallback | DONE | – | |
| U9 | Login lockout / rate limit, session invalidation on password change | DONE | – | |

### Member portal

| # | Feature | Status | Pri | Note |
|---|---|---|---|---|
| D1m | Dashboard: greeting + BS date, KPIs | PARTIAL | P2 | N lacks Pending / Approved / Partner-services counters |
| D2m | Dashboard: recent applications with **status filter + search** | MISSING | P3 | |
| D3m | Dashboard: **Quick-apply grid** (appointment, KYM, loan, account, digital, grievance, welfare, honor when open, marketplace, service request, career, EMI) | MISSING | P2 | N has a nav menu only |
| D4m | Dashboard: Digital-services strip (internet banking, web login, iOS/Android app links from settings, ID card status) | MISSING | P3 | Settings keys exist in N |
| D5m | Partner services history | DONE | – | |
| D6m | Open elections banner, push opt-in | DONE (N extra) | – | |
| R1 | My applications list | DONE | – | |
| R2 | My applications: **filter by type, search, detail page** (all fields, status timeline, status/comment history, office attachment) | PARTIAL | P2 | N: flat table, no detail view |
| R3 | Member applications matched by member_portal_id / member no. + phone | PARTIAL | P2 | N matches by exact phone (+ member no.). If the phone changes, history disappears. Only honor/welfare store `member_portal_id` |
| X1 | Accounts/balances/transactions/documents (CBS push) | DONE (N only, PHP `transactions.php` was a stub) | – | |
| PR1 | Profile: details edit (blocked when KYM approved), phone change by OTP or office approval, email/password, KYC documents (add missing only), 2FA, OAuth links | DONE | – | |
| PR2 | Profile: **read-only KYC details tab** (all KYM + AML fields, family, photo score) and "Edit KYM" link | PARTIAL | P3 | N has /member/kyc-print (printable), not on the profile |
| PR3 | Profile avatar from KYM photo | PARTIAL | P3 | |
| N1 | Notifications list, unread badge, push | DONE | – | |
| N2 | Notifications: per-item mark read + "mark all read" button (N marks all read when the page is opened) | PARTIAL | P3 | |
| SR | **Service request** (one pre-filled form → appointment or grievance with types: appointment, loan inquiry, account info, welfare inquiry, document request NOC/statement, grievance, general) | MISSING | P3 | member/service-request.php |
| EV | Election vote: window, one ballot, attendance-only, max per position | DONE | – | |
| EV2 | Vote confirmation modal listing the chosen candidates | PARTIAL | P3 | N: generic confirm |
| IR | Information room: access flag, access log, download vs view | DONE | – | |
| IR2 | Information room: in-page viewer with watermark (member name + time), category labels | PARTIAL | P3 | |
| AT | QR attend, scan, programmes, pre-registration | DONE | – | |
| CE | Certificate, KYC print | DONE | – | |
| MK | Member marketplace | DONE | – | |
| WF | Member welfare page with claim history tab | DONE (via /member/requests) | – | |
| OF | Offline page, PWA | DONE | – | |

---

## (b) Implementation specs (PARTIAL / MISSING items)

Order below is by priority. Every spec gives the PHP source, the DB columns involved and the Node changes.

### P1-1 (F2, F3, F4, A1, W1): member identity verification on public forms

**PHP**
- `includes/kyc-public-form.php`:
  - `verifyPublicFormKycByMemberId` (lines 21-81): finds the newest non-rejected KYM for the Member ID, preferring approved. The posted mobile (`mobile|phone|account_mobile|member_mobile|contact_phone`, last 10 digits) must equal `kyc.mobile` or the ledger `members.phone`.
  - `verifyPublicFormKycApprovedByMemberId` (lines 84-101): same check, and additionally `status = 'approved'`.
- Callers:
  - loan-apply.php:99-148 (any KYM)
  - online-account.php:69-120 (any KYM; Member ID field is `account_member_id`)
  - appointment.php:98-122 (approved; a signed-in member is also blocked without an approved KYM)
  - grievance.php:64-95 (approved, skipped when anonymous)
  - member-welfare.php:96-134 (approved)
  - digital-services.php:85-110 (approved)
  - honor-apply.php:70-90 (approved)
  - member-survey.php:40-66 (approved, feedback)
- On success, name, Member ID, mobile, email, address (`temporary` ‖ `permanent` joined with " / ") and citizenship come **from the KYM row**, ignoring the POST. Email becomes optional (`require_email = !member`).
- Signed-in member: `loadKycRowForLoggedMemberPublic` (lines 147-174) and the same override. The UI shows `includes/member-prefill-block.php` (a read-only card) instead of the personal inputs.

**Node: tables.** No new tables. Uses `kyc_applications` (member_id, mobile, email, full_name, full_name_en, permanent_address, temporary_address, citizenship_no, dob_bs, dob_ad, gender, marital_status, citizenship_issued_*, father_name, mother_name, status) and `members` (sadasyata_number, phone, kyc_application_id).

**Node: changes**

1. `src/lib/kym.js`: add `verifyForForm(memberId, mobile, { approved })`:
   - `id = normalizeId(memberId)`. Empty → `err('सदस्यता नम्बर अनिवार्य छ।','Member ID is required.')`.
   - `kyc = findKycByMemberId(id)` (non-rejected, approved first).
   - Mobile check: `phonesMatch(mobile, kyc.mobile) || phonesMatch(mobile, (await findMemberBySadasyata(id))?.phone)`. On failure: `['सदस्यता नम्बरसँग मोबाइल नम्बर मिलेन। KYM/सदस्यता दर्ता गर्दा दिएकै मोबाइल नम्बर लेख्नुहोस्।','Mobile number does not match this Member ID. Enter the mobile number given at KYC/registration.']`.
   - No KYM: `['यो सदस्यता नम्बरको केवाइएम रेकर्ड भेटिएन।','No KYC record found for this Member ID.']`.
   - `approved && kyc.status !== 'approved'`: `['यो सेवा प्रयोग गर्न KYM verify (approved) हुनुपर्छ। कृपया पहिले केवाइएम स्वीकृत गराउनुहोस्।','KYC must be verified (approved) before using this service.']`.
   - Returns `{ok, kyc}`. Count failures in the same throttle as the tracker (`auth.recordFailure('kycgate:'+id, ip)`) to stop Member ID enumeration.
2. `src/modules/applications.js`: add to each affected module a `memberGate` meta, `{ approved: bool, map: {nameCol, phoneCol, email:'email', memberCol, address:'address', citizenship:'citizenship_no', …} }`:
   - loan `{approved:false}`, account `{approved:false}`
   - appointment, grievance, welfare, digital, honor, feedback `{approved:true}`
   - Add a radio field `is_coop_member` (store `'none'`, default `no`, options yes/no, labels `['तपाईं सहकारी सदस्य हुनुहुन्छ?','Are you an existing cooperative member?']`) as the first field.
   - Personal fields (name, email, address, citizenship) get `showIf: { field:'is_coop_member', ne:'yes' }`. Phone **stays visible** (it is the second factor; PHP loan hides it, which is a PHP bug). `member_id` gets `requiredIf is_coop_member=yes` (add support for `requiredIf: {field, eq}` in forms.js `isRequired`).
3. `src/routes/public.js` POST `/apply/:key` (lines 474-517), before `submissions.submit`:
   - If `req.member`: `kyc = await kym.loadLinkedKyc(req.member)`. If `mod.memberGate.approved && kyc?.status !== 'approved'` → error `['भेटघाट बुक गर्न KYC verified (approved) हुनुपर्छ।','KYM verification is required…']` (use a generic wording). Then **overwrite** `data[nameCol]` (`kyc.full_name || member.name_np || member.name`), `data[memberCol]` (`member.sadasyata_number`), `data[phoneCol]` (`kyc.mobile || member.phone`), `data.email`, and address/citizenship if empty. Set `extra.member_portal_id = req.member.id` for every table that has the column (see P2-11).
   - Else if `body.is_coop_member === 'yes'`: run `kym.verifyForForm(body.member_id, body[mod.phoneCol], mod.memberGate)` and apply the same overwrite from `kyc`.
   - Do this in a new `subs.js` helper `applyMemberIdentity(ctx)` so every module shares it. Grievance with `is_anonymous` skips it.
4. `views/public/apply-form.ejs`: when `member` is set, render a read-only "तपाईंको जानकारी (KYM / प्रोफाइलबाट)" card (name, Member ID, phone, email, address) and **omit** the personal inputs (`field.identity: true` flag on those fields, skipped when `member`).
5. Tests: guest with mismatched mobile → 422. Member=yes with a valid ID+mobile → row stores the KYM name even if another name was typed. Signed-in member POSTing another phone → the stored phone is the member's.

### P1-2 (K2, K3): KYC verify-first gate and locked existing fields (public)

**PHP:** online-kyc.php
- 120-143: `public_kym_verify` POST → `memberSsotRequireMemberIdAndMobile`, then `memberSsotPublicGateStore` (session `public_kym_gate {member_id, mobile, at}`, TTL 7200 s, member-ssot.php:947-1004). Redirect to `?path=member&verified=1`.
- 1119-1150: when the gate is OK, prefill `member_id` and `mobile` (read-only) plus every non-empty KYM value via `memberSsotPrefillEmptyOnlyFromKyc` (member-ssot.php:1006-1034, list of keys there). Those inputs are rendered `readonly` (`$publicKycLockedFields`).
- UI 1295-1350: verify box (Member ID, mobile, "Verify & continue", "Request portal login" → /member/register). After verification: green "Verified (ID). Empty fields below can be filled. Locked fields stay as-is."

**Node changes**
1. `src/routes/public.js`: new `POST /apply/kyc/verify` (submitLimiter + `auth.tooManyAttempts('kycgate:'+ip)`):
   - `g = await kym.requireMemberIdAndMobile(body.member_id, body.mobile)`.
   - OK → `req.session.kymGate = { memberId: kym.normalizeId(id), mobile: kym.normalizeMobile(mobile), at: Date.now(), tenantId: req.tenant.id }` and redirect `/apply/kyc`.
   - Error → re-render with the error.
2. `GET /apply/kyc` (`renderForm`, public.js:451-465), when `!req.member`:
   - Gate absent or expired (2 h) → render a new view `views/public/kyc-gate.ejs`. It has three tabs/buttons: "म सदस्य हुँ (Online केवाइएम)" (the verify form), "नयाँ सदस्य बन्नुस्" (link to `/apply/membership`) and "पोर्टल लगइन" (`/member/login`), plus the intro text from online-kyc.php:1293-1296.
   - Gate OK → `own = await kym.findKycByMemberId(gate.memberId, true)`, then `values = { ...forms.rowToValues(mod, own), member_id, mobile }`, `existingDocs` as for members, and `locked = Set(keys with non-empty value)`. Pass `locked` to the view.
3. `views/partials/field.ejs`: if `locals.locked && locked.has(fl.name)`, render `readonly` (text/textarea), `disabled` plus a hidden input (select/radio/address parts), and a hint "पहिले भरिएको — परिवर्तनका लागि पोर्टल लगइन गर्नुहोस्" ("Already on file — log in to the portal to change it").
4. `POST /apply/kyc`: when not signed in, require a valid `req.session.kymGate` whose memberId/mobile equal the posted (normalised) ones. Otherwise 403 → redirect to the gate. Keep `kym.submit` fill-empty logic as is.
5. Clear `kymGate` on successful submit.

### P1-3 (D1): digital-service conditional fields

**PHP:** digital-services.php:56-64 (POST), 463-545 (HTML panels), 600-640 (JS toggles). digital-service-submit-helper.php:91-100 (sanitise), 170-176 (share amount rule).

**DB:** `digital_service_requests.biller_name, bill_reference, recharge_number, recharge_amount, service_amount, statement_from, statement_to`. All exist.

**Node: apps.js `digital` module**
- Change `statement_from` and `statement_to` to `showIf: {field:'service_type', in:['statement_request','statement']}`.
- Add:
  - `biller_name` (`['बिल/सेवा प्रदायक','Biller / service provider']`, showIf in `['bill_payment']`)
  - `bill_reference` (`['बिल/ग्राहक नं.','Bill / customer no.']`, same showIf)
  - `recharge_number` (tel, `['रिचार्ज नम्बर','Recharge number']`, showIf `['mobile_recharge']`)
  - `recharge_amount` (number, min 10, `['रकम (रु.)','Amount (Rs.)']`, same showIf)
  - `service_amount` (number, min 1, `requiredWhenShown: true`, `['रकम (रु.)','Amount (Rs.)']`, showIf `['share_refund','share_increase']`)
- Update the fallback `digitalTypes` in forms.js to the PHP slugs: `statement_request, bill_payment, mobile_recharge, fund_transfer, share_refund, share_increase, mobile_banking, qr, sms, other`. Get the full map from `includes/digital-service-types.php` or the `dsLabels` in application-tracker.php:989.
- Validation note: forms.js `requiredWhenShown` already works with `showIf.in`.

### P1-4 (B1, B2): auction bid open-window and minimum price

**PHP:** auction.php:60-104; includes/auction-tables.php:46-83 (`auctionEndTimestamp` = `auction_date` + `auction_time` in Asia/Kathmandu; open = `is_active=1`, status in upcoming/ongoing, now ≤ end).

**Node**
- `subs.js`: add `hooks.bid(ctx)`:
  - `a = SELECT * FROM auction_notices WHERE id=$1`.
  - Not open → `fail(['यो लिलामीमा अहिले बोलपत्र खुला छैन।','This auction is not open for bids.'],'auction_id')`.
  - Add `auctionOpen(a)` to a new `src/lib/auctions.js`, computing the end as `(auction_date + ' ' + (auction_time||'23:59'))` in Nepal time.
  - `Number(a.minimum_price) > 0 && bid < min` → `fail([\`बोल रकम कम्तीमा रु. ${money(min)} हुनुपर्छ।\`, \`Bid must be at least Rs. ${money(min)}\`],'bid_amount')`.
  - Phone must match `/^9\d{9}$/` (`['नाम र सही १० अङ्कको मोबाइल (९XXXXXXXXX) आवश्यक।', …]`).
  - Duplicate (P2, B3): `SELECT 1 FROM auction_bids WHERE auction_id=$1 AND bidder_phone=$2 AND status='pending' AND created_at >= now()-interval '24 hours'` → `['पछिल्लो २४ घण्टामा यस लिलामीमा तपाईंको बोलपत्र पेश भइसकेको छ।','You already have a pending bid for this auction in the last 24 hours.']`.
- forms.js `optionSources.auctions`: filter out ended auctions with the same helper.
- `views/public/auction-detail.ejs`: hide the bid button when `!auctionOpen` and show the minimum price next to it.

### P1-5 (T7): tracker shows the assigned Member ID for membership requests

**PHP:** application-tracker.php:993-998 and 1086 (`assigned_sadasyata` in the title and in the details grid).

**Node:** `views/public/track.ejs`, inside the result card: `<% if (m.key === 'membership' && r.assigned_sadasyata) { %>` add a row "दिइएको सदस्यता नं. / Assigned Member ID" with `<code>`, plus a primary button "अब Online केवाइएम भर्नुहोस्" → `/apply/kyc`. Also include it in `/member/requests` rows (request-row.ejs).

### P1-6 (Y2, Y3): card verification by name + Member ID + mobile, and a richer result

**PHP:** verify.php:64-88 (modes `name` default / `legacy` code+CVV), card-verify-helpers.php:
- 135-197: `normalizeMemberNameForMatch` / `memberNamesMatch`. Case and space insensitive, Devanagari ↔ English via `kyc.full_name` or `members.name`, tolerant to middle names. Port exactly.
- 616-807: `verifyCardByNameAndMemberId`.
  - Rows: `members m LEFT JOIN member_id_cards c LEFT JOIN kyc_applications k`, where `m.sadasyata_number = id OR m.member_card_no = id OR m.id = id OR c.member_id = id`.
  - The name must match `kyc.full_name` or `m.name`. The mobile must match the ledger or KYM phone.
  - Optional CVV.
  - Wrong attempts increment `failed_verify_count` and lock at 5. Status gate: locked / not active / `renewal_pending` (453-552).
- 453-520: `_finalizeCardVerifySuccess` returns photo (`kyc.photo` ‖ `avatar_url`), Member ID, father name, DOB BS/AD, member since, expiry and verify count.

**DB:** `member_id_cards` (failed_verify_count, locked_at, verify_count, last_verified_at), `card_verify_attempts`. All exist.

**Node**
1. `src/lib/member-portal.js`: add `namesMatch(a, b)` (port) and `verifyByNameIdMobile({name, memberId, mobile, cvv})` returning `{ok, card, member, kyc}` or `{ok:false, message, left}`. Reuse `CARD_LOCK_AFTER` and the `card_verify_attempts` logging. Use `idVariants`.
2. `src/routes/public-members.js` `POST /verify`: if `body.mode === 'name'` (or `name` + `member_no` + `mobile` are present), use the new function. Otherwise keep the code+CVV flow. Same `verifyLimiter` and same `partnerVerify` session on success.
3. `views/public/verify.ejs`: two tabs, "नाम + सदस्यता नं. + मोबाइल" (default, matching what PHP cards print) and "कोड + CVV". Result card: photo (`/verify/photo/:memberId` served via `uploads.sendStored` only when `req.session.partnerVerify?.mid === memberId` within 30 min), Member ID, name NP/EN, father's name, DOB (BS), member since (BS), valid until, verify count, status badge.
4. Optional: prefill from QR `?code=` (already done).

### P2-1 (F5): math captcha fallback

**PHP:** contact-spam-guard.php:32-90 (issue/verify per bucket, 1 h TTL, one-shot), 218-247 (`coop_public_form_bot_block` order: honeypot → math → spam → turnstile), 345-399 (HTML).

**Node**
- `src/lib/antispam.js`: `mathIssue(req, bucket)` stores `req.session.math[bucket] = {a, b, sum, ts}` and returns the prompt. `mathVerify(req, bucket, answer)` is one-shot with a 1 h TTL.
- In `check()`, when Turnstile is **not** configured and setting `spam_math_captcha !== '0'` (default on), require `mathVerify(req, bucketFromPath, body.math_answer)` → `{reason:'math', message:['कृपया साधारण गणित जाँच सही मिलाउनुहोस्।','Please solve the simple math check correctly.']}`.
- `views/partials/turnstile.ejs`: when Turnstile is off, render `<label>के हो a + b ?</label><input name="math_answer" inputmode="numeric" required>`. The prompt is passed in via `res.locals.mathPrompt`, set in `renderForm`, the contact GET and the track GET.
- Re-issue after a failed POST.

### P2-2 (F6): spam scanning on every free-text field

public.js:472: replace `SPAM_SCAN` with "every module": `scan = mod.fields.filter(f => f.type === 'textarea' || ['subject','message','loan_purpose','collateral_description','other_income','description','request_details','cover_letter'].includes(f.name)).map(f => req.body[f.name])`. Skip the `kyc` AML fields (addresses look like domains). Keep the `spam_block_links` setting.

### P2-3 (F7, F8): stricter mobile and email requirements for guests

Add a module flag `mobile10: true` (loan, account, grievance, welfare, digital, honor, job, bid, feedback) and `guestEmail: true` (loan, account, grievance, digital, appointment member-visit).
- In forms.validate: the phone field for `mobile10` modules → `kym.normalizeMobile(v)` must match `/^9\d{9}$/` (job and bid in PHP) or `/^\d{10}$/` (others), with message `['कृपया १० अंकको मोबाइल नम्बर राख्नुहोस्।','Please enter a valid 10-digit mobile number.']`. Store the normalised value.
- `guestEmail`: required when `!req.member && body.is_coop_member !== 'yes'` (do this in the identity helper from P1-1).

### P2-4 (F9, K7): wizard UI and KYC draft autosave

**PHP:** loan-apply.php:281-300 (4-step bar), 670-740 (`showStep`, `validatePane`: HTML5 validity per pane, "चरण n / 4"). online-kyc.php:2751-2990 (`kym_form_step_v2`, `kym_form_draft_v2` (all inputs except files and `_csrf`), `kym_visited_v2` in localStorage; nav buttons per `.form-section`; restore on load unless server data exists; clear after success; Enter key blocked outside textarea).

**Node:** progressive enhancement in `public/js/forms.js`:
- If `form[data-wizard]` (set when `mod.wizard` is true: loan, account, kyc), turn each `.form-section` into a step. Add a step nav (titles from `.form-section-title`), Prev/Next buttons, and "चरण n / N" plus a progress bar. On Next, validate only that section via `checkValidity()` on visible inputs.
- Draft: `localStorage['draft:'+tenant+':'+module]` saves non-file values on `input` (debounced 500 ms) and restores when `values` are empty (`data-has-values="0"`). Clear on `apply-done` (inline flag) or on submit success.
- With server errors (422), jump to the first section that has `.has-error`.
- Never store citizenship/NID in the draft (privacy). Skip `name="citizenship_no"`, `national_id_number` and `passport_no`.

### P2-5 (K5): KYC capture tools

**PHP:** assets/js/kyc-capture.js (1008 lines):
- Camera modal (getUserMedia, front/back switch), then crop mode (drag/zoom/rotate, field aspect ratios) and export JPEG 0.88.
- Signature pad (canvas → `data:image/png`).
- Thumb-print capture with a line-density quality check.
- Photo quality score (brightness/contrast heuristic) into `photo_quality_score`.

includes/kyc-capture-helpers.php:22-72 (`saveBase64Image`: accepts `data:image/(jpeg|png|webp)`, max 5 MB, verifies the type with `getimagesizefromstring`), 111-137 (`captureOrUpload`: base64 or file; NID is JPEG-only). online-kyc.php:624-630: the server rejects score 1-29.

**Node**
1. Server: `src/lib/uploads.js` add `saveDataUrl(req, folder, field, dataUrl, {private:true, maxMb:5, types:['jpeg','png','webp']})`. It decodes and runs the same magic-byte check as file uploads. In POST /apply/:key, for `mod.fileFields` with no file but `req.body[name]` starting with `data:image/`, call it and put the result into `req.uploaded[name]`.
2. Client: new `public/js/kyc-capture.js`, loaded only when `mod.key === 'kyc'`:
   - For `fl.capture` fields, add a "क्यामेरा" button that opens a `<dialog>` with video, capture, crop (canvas drag/zoom/rotate). It writes a hidden `<input name=photo value=data:…>` and a preview.
   - Signature: a canvas pad (`data-sign`) writing hidden `signature`.
   - Photo quality: compute mean luminance and the variance of the Laplacian on a 256 px downscale, normalise to 0-100, write hidden `photo_quality_score` and show a hint "70+ सिफारिस".
3. apps.js kyc: add a hidden field `photo_quality_score` (number, store direct). In `kym.submit`, reject 1-29 with the PHP message (online-kyc.php:625-629).
4. CSP: camera needs `Permissions-Policy: camera=(self)` on `/apply/kyc` and `/member/profile`. Helmet config is in `src/app.js`.

### P2-6 (L1, L2, W2): loan fields and multiple documents

- apps.js loan:
  - Add `{ name:'other_income', label:['अन्य आम्दानी','Other income'], type:'textarea', rows:2 }` after `monthly_income`.
  - Add `{ name:'guarantor_address', label:['जमानीको ठेगाना','Guarantor address'] }` after `guarantor_phone`.
  - `documents`: `{ type:'file', kind:'any', multiple: 5 }`.
- public.js upload chain (line 478): pass `maxCount: f.multiple || 1`.
- forms.validate file branch: if `Array.isArray(v)`, store `v.join(',')` (PHP format, loan-submit-helper.php:8-53).
- field.ejs: add `multiple` to the input when `fl.multiple`.
- Admin inbox file rendering must split on `,` (check `views/admin/inbox-view.ejs`).
- Welfare: same for a new `documents` (stored into `supporting_documents`, comma-joined) with `multiple: 5`.

### P2-7 (P1a, P1b, F11): appointment times and legacy option keys

- forms.js: new option source `officeTimes()`. Read settings `office_time_start` (default `10:00`) and `office_time_end` (default `17:00`), step 30 min, values formatted `h:mm A` like PHP (config.php:3360-3410, `getUnifiedTimeOptions`), so imported rows match. Use it for appointment `preferred_time` (`optionsFrom:'officeTimes'`).
- Appointment `purpose` options: use the PHP keys `account_inquiry` (खाता जानकारी), `loan_inquiry` (ऋण जानकारी), `kyc_update` (केवाइएम अपडेट), `loan_repayment` (ऋण भुक्तानी), `account_opening` (खाता खोल्ने), `other` (अन्य). Keep `membership`/`meeting` as extra options if wanted.
- Loan `repayment_method`: `emi` (ईएमआई मासिक किस्ता), `quarterly`, `bullet` (एकमुष्ट). Accept the old N values via `legacyOptions` for display.
- Loan `collateral_type`: `land` (जग्गा), `house` (घर/भवन), `vehicle`, `fd`, `gold` (सुन/गहना), `share` (शेयर प्रमाणपत्र), `guarantor` (व्यक्तिगत जमानत).
- Display fallback: in `submissions.details` / the tracker / the admin view, when a stored value is not among the options, show it raw (already happens). Mapping the keys avoids that.

### P2-8 (W3): welfare statuses and approved amount

- New migration `db/migrations/060_welfare_status.sql`:
  ```sql
  ALTER TABLE member_welfare_claims DROP CONSTRAINT IF EXISTS member_welfare_claims_status_check;
  ALTER TABLE member_welfare_claims ADD CONSTRAINT member_welfare_claims_status_check
    CHECK (status IN ('pending','processing','under_review','approved','rejected','paid','completed'));
  ```
  Look up the actual constraint name with `pg_constraint`.
- forms.js `STATUS_LABELS`: add `paid: ['भुक्तानी भयो','Paid']`.
- The admin welfare status form (admin-applications.js) must allow `approved_amount` input (check whether it already does).
- Tracker and member request detail: show `approved_amount` when set (`रु. money()`).

### P2-9 (H1, H3): honour programme state and discoverability

**PHP:** honor-apply.php:150-250 (`honorHasPublicProgram`, upcoming list with opens/closes in BS, "Applications are closed" explanation, active banner with `closes_at` and `instructions_np/en`). member/index.php:162-176 (quick action only while a programme is open).

**Node**
- In `renderForm` for `honor`: `open = await optionSources.honorPrograms()`. If empty, render the new view `views/public/honor-closed.ejs`, listing `SELECT * FROM honor_programs WHERE is_active=1 AND opens_at > now() ORDER BY opens_at` with BS dates, or show the closed message.
- If open, pass `activeProgram` (first open, or `?program=`) and show a banner with `f(p,'title')`, `event_label`, `fiscal_year`, "बन्द हुने: BS closes_at", and the instructions.
- Discoverability: `res.locals.honorOpen` (cached 60 s per tenant) adds a menu item, an apply-index card (keep `hidden` but show when open) and a member-dashboard quick action.
- Add `business_note` (text, 255, `['खाता / उत्पादन नोट (ऐच्छिक)','Account / product note (optional)']`).

### P2-10 (J1, J2, J3): job application rules

`hooks.job` in subs.js:
- `c = SELECT allow_online_apply, deadline, is_active FROM careers WHERE id=$1`. Reject if not active, `allow_online_apply = 0`, or deadline passed: `['यस पदको अनलाइन आवेदन बन्द छ।','Online applications for this position are closed.']`.
- Duplicate: `SELECT 1 FROM job_applications WHERE career_id=$1 AND (lower(email)=lower($2) OR phone=$3) AND deleted_at IS NULL` → `['तपाईंले यस पदको लागि पहिले नै आवेदन दिनुभएको छ।','You have already applied for this position.']`.
- Phone `/^9\d{9}$/`.
- apps.js job: add `{ name:'certificates_path', label:['शैक्षिक प्रमाणपत्र','Certificates'], type:'file', kind:'any' }`.
- forms.js `careers()`: add `AND COALESCE(allow_online_apply,1) = 1`.

### P2-11 (B4, T8, R3): auction-bid tracking and `member_portal_id` everywhere

- Migration: `ALTER TABLE auction_bids ADD COLUMN IF NOT EXISTS tracking_id VARCHAR(40) UNIQUE;`. Also add `member_portal_id INTEGER` to loan_applications, account_applications, appointments, grievances, digital_service_requests, member_feedback, job_applications and kyc_applications where missing (welfare and honor have it).
- apps.js bid: remove `noTracking`, `prefix:'BID'` (PHP uses `BID-`), `memberCol: null`. The tracker then picks it up automatically.
- public.js POST: `if (req.member) extra.member_portal_id = req.member.id` for all modules (`db.pick` drops unknown columns).
- member.js `myRequests` (lines 89-109): add `member_portal_id = $n` as an OR condition when the column exists, and compare phones with `portal.phoneDigitsSql` instead of exact equality.

### P2-12 (T5, R2): details grid in the public tracker and member request detail page

**PHP:** application-tracker.php:1065-1130 (details grid per type), member/tracker.php:57-95 (type filter: loan, account, kyc, appointment, grievance, welfare, digital, job, honor; free-text search on service/tracking/status), 95-300 (detail page with timeline, history `old → new` with comment and date, office attachment, all non-internal fields).

**Node**
- apps.js: add `track: [...]` (field names) per module for the public tracker grid. Default to the `show: true` fields plus `branch`, `purpose`, `preferred_date`, `preferred_time`, `loan_purpose`, `approved_amount`. Render via `submissions.details`-like formatting (options → labels, money, dates in BS). **Never** show citizenship, NID or documents on the public tracker.
- New route `GET /member/requests/:module/:id` in member.js: ownership via `myRequests` (as in the attachment route). Render `views/member/request-detail.ejs` with `forms.displayData` (all fields of the module, skipping file fields and internal columns), `request_status_history` timeline, office remarks and attachment.
- `/member/requests`: query `?type=<module>&q=` filters (server side over the `myRequests` result). Add filter pills plus a search box. Each row links to the detail page.

### P2-13 (U2): login identifier normalisation

`src/lib/auth.js` `memberLogin` (line 82):
```sql
WHERE deleted_at IS NULL AND (
  lower(email) = lower($1)
  OR upper(trim(sadasyata_number)) = ANY($2)          -- portal.idVariants(identifier)
  OR member_card_no = $1
  OR ($3 <> '' AND right(regexp_replace(COALESCE(phone,''),'[^0-9]','','g'),10) = $3)   -- normalizeMobile(identifier) if 10 digits
)
ORDER BY (password_hash IS NOT NULL) DESC, id LIMIT 1
```
Prefer the row with a password when several match.

### P2-14 (U4, I2): card expiry → renewal

**PHP:** member-auth.php:737-753. member/id-card.php:300-360 (`isExpired`, `daysLeft <= 60` warning, renewal notice).

**Node**
- `portal.eligibilityError(m, t)`: if `m.card_expires_at && new Date(m.card_expires_at) < now && m.approval_status === 'approved'`, run `UPDATE members SET approval_status='renewal_pending'` (make it async, or do it in `memberLogin`). If `approval_status === 'renewal_pending'`, return `t('तपाईंको Member Card को ५ बर्षे म्याद सकिएको छ। कार्यालयमा सम्पर्क गरी renew गर्नुहोस्।','Your 5-year member card has expired. Please contact the office to renew it.')`.
- Admin approve already resets `card_expires_at` to +5 years (portal.js:169).
- Check `members.approval_status` for a CHECK constraint that must include `renewal_pending`.
- `views/member/id-card.ejs`: expired → red notice. ≤60 days → amber "कार्ड म्याद N दिनमा सकिँदैछ". Photo source: `(await portal.linkedKyc(m))?.photo`, served through `/member/profile/kyc-file/photo`, falling back to `avatar_url`. Add the card back side (Member ID, mobile, `MM/YY` validity, coop address/phone/website from settings, "प्रमाणीकरण: <site>/verify").

### P2-15 (U5): mandatory member 2FA option

PHP forces TOTP for every member (member/login.php:70-100, member-auth.php OAuth path). N has the switch `member_2fa_required` (default `0`).
- Make the migration tool (`site-migration.js` / `site-import.js`) set `member_2fa_required = '1'` for tenants imported from PHP, so behaviour does not silently weaken.
- Document the setting in the admin settings UI.
- No code change beyond the default.

### P2-16 (D1m, D3m, D4m): dashboard widgets

**PHP:** member/index.php:50-75 (counts + filter), 150-176 (quick actions), 255-275 (digital services from `internet_banking_url`, `web_login_url`, `app_store_url`, `play_store_url`).

**Node:** `views/member/dashboard.ejs` and member.js GET `/`:
- KPIs: add Pending (`pending|under_review|processing`), Approved (`approved|completed|resolved|accepted|selected`) and Partner services (`partnerHistory.length`). Each links to `/member/requests?status=`.
- Quick-apply grid using `applyModules` (already in `res.locals`), plus honor when open, marketplace, EMI (`/emi-calculator`) and careers (`/careers`).
- Digital strip: render links for the settings keys when set (the keys exist in tenants.js:129-131; add `web_login_url`).

### P2-17 (Y3, part of P1-6): verify page photo

Covered in P1-6.

### P3 items (brief specs)

- **K1 / T9 legacy URLs** (`src/lib/legacy-urls.js`):
  - `'online-kyc.php': q => q.path === 'new' ? '/apply/membership' : '/apply/kyc'`
  - `'grievance.php': q => q.track ? '/track?id=' + clean(q.track) : '/apply/grievance'`
  - `'member-welfare.php'` the same way
  - `'member-skills.php': () => '/marketplace?kind=skill'`
  - In the KYC intro add a link "Member ID छैन? सदस्यता आवेदन दिनुहोस्" → `/apply/membership`.
- **K4 Quick fill**: optional form on the gated KYC page (name, email, NID) that posts to the same KYM fill-empty merge (online-kyc.php:144-256). It inserts `status='partial'` when there is no KYM.
- **K6 map picker**: with an `<dialog>` using Leaflet 1.9.4 from unpkg (allow in CSP) plus OSM tiles: draggable marker writes `longitude_latitude` and calls Nominatim reverse (`format=jsonv2`, `accept-language=ne`) to fill `map_resolved_address` (online-kyc.php:2990-3117). Lazy-load only when the user clicks "नक्सामा छान्नुहोस्".
- **L3**: loan type labels with rate. In forms.js `loanTypes()` select `rate` and label `${name_np} (${rate}%)`.
- **A2**: account `citizenship_issued_date` → `type:'bsdate'`.
- **G1**: grievance with `is_anonymous` → name optional (`requiredUnless`), store `name = 'गोप्य'` when empty. Phone and email stay required.
- **V1**: vendor `business_type` → required select with the PHP option list.
- **S1**: feedback phone required.
- **M1**: membership `citizenship_no` optional (PHP "recommended").
- **F10**: apply-done.ejs copy button (`navigator.clipboard.writeText`) and a "नयाँ आवेदन" link. For loan, add the EMI calculator link.
- **T6**: per-module `stages` array in apps.js (e.g. loan `['pending','processing','approved','disbursed']`, appointment `['pending','confirmed','completed']`, welfare `['pending','under_review','approved','paid']`, job `['pending','shortlisted','interviewed','selected']`, grievance `['pending','in_progress','resolved']`). Render a horizontal stepper in track.ejs and the member request detail. Rejected/cancelled shows a red final step.
- **Y5**: verify.ejs preselects the partner from `?partner_id=` or `?partner=CODE` (`partner_facilities.partner_code` if present).
- **Y6**: public programme pre-registration with Member ID + registered mobile (reuse `portal.phonesMatch`, insert source `public_verify`, duplicate → "पहिले नै दर्ता"). This is safer than PHP, which used the member number alone.
- **I3**: card star rating = attended / eligible programmes (program-reports.js has the ELIGIBLE query).
- **I4**: optional "auto-issue on first view for approved members", behind setting `card_auto_issue`.
- **D2m**: status filter and search on recent applications (reuse P2-12).
- **PR2/PR3**: profile tab "ग. KYC विवरण" showing read-only `forms.displayData(modules.kyc, kyc)` (AML labels from apps.js) plus a link to `/apply/kyc` (edit) and `/member/kyc-print`. Avatar from KYM photo.
- **N2**: notifications: mark read per item via `POST /member/notifications/:id/read` (or on link click). Mark all only with a "सबै पढियो" button instead of on open.
- **SR**: `/member/service-request`, a single form (type select from member/service-request.php:31-39, message, preferred date/time, branch) that inserts into `appointments` (purpose mapped) or `grievances`, with identity from the member.
- **EV2**: vote confirmation `<dialog>` listing the selected candidates per position before submit (member/election-vote.php:311-360).
- **IR2**: information room viewer page `/member/information-room/:id/view` with an iframe/`<embed>` of the file route and a CSS watermark overlay `member.name · BS date time`. Show the category label.
- **U6**: on OAuth link, set `avatar_url` if empty (Google `picture`).

---

## Places where PHP was better (UX / validation / labels) — quick list

1. Identity integrity: PHP never trusted typed name/phone/email for members (server took KYM values). N does (P1-1).
2. KYC public flow: verify first, then see locked existing data. N makes users fill everything blind (P1-2).
3. Mobile-first KYC capture (camera, crop, signature pad, thumb, photo quality) and draft autosave (P2-4, P2-5).
4. Digital services: service-specific fields (P1-3). Auction: minimum price and end time (P1-4).
5. Tracker: shows the assigned Member ID and per-type details and stages (P1-5, P2-12, T6).
6. Card verification by name + Member ID + mobile, which is what PHP-printed cards tell people to use (P1-6).
7. Appointment slots from office-hours settings, and Nepali labels for every option (`ईएमआई (मासिक किस्ता)`, `केवाइएम अपडेट`, `शेयर प्रमाणपत्र` …) (P2-7).
8. Math captcha fallback when Turnstile is not set (P2-1).

## Places where Node is already better

- Tracker requires phone with the tracking ID, and phone+email lists all applications (PHP leaked status by tracking ID alone).
- The membership duplicate notice does not leak the existing tracking ID.
- Random CVV (PHP derived the CVV from name + member number) and a signed ID-card link tied to the tenant.
- Login by mobile / card number too, and session invalidation on password change.
- Phone change by OTP, office approval fallback.
- Member accounts / balances / transactions / documents via the CBS API (PHP had a stub).
- One declarative engine with webhooks, templated SMS/email and per-tenant isolation.
