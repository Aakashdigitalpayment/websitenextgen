# Integration API (v1): CBS and DMS

This API connects the cooperative portal with a **core banking system (CBS)** and a **document management system (DMS)**.

- **Push into the portal:** members, account balances, loans, transactions and documents.
- **Pull from the portal:** applications and member changes.
- **Webhooks:** the portal POSTs signed events to your system when something happens.

Each cooperative has its own API. The base URL is the cooperative's own domain:

```
https://<cooperative-domain>/api/v1
```

The machine-readable spec is in [`openapi.yaml`](openapi.yaml) (OpenAPI 3.1). You can import it into Postman, Insomnia or a code generator.

## 1. Getting a key

1. A **superadmin** opens **Admin → CBS / DMS API → New API client**.
2. Pick the system type and the **scopes**. Give each system only what it needs.
3. Optionally restrict the key to the CBS server's IP addresses (`203.0.113.10, 10.20.0.0/16`). This is recommended.
4. The API key `cbk_xxxxxxxxxxxx.<secret>` is shown **once**. Store it in the CBS secret store. If it leaks, click **New key**; the old key stops working immediately.

| Scope | Allows |
|---|---|
| `members:read` | Read members and the change feed |
| `members:write` | Create or update members (single and bulk) |
| `accounts:write` | Push accounts, loans, shares and transactions |
| `applications:read` | Read applications (loan, account, KYC, grievance …) |
| `applications:write` | Update application status and remarks |
| `documents:read` | Download application files and member documents |
| `documents:write` | Upload or delete member documents (DMS) |

## 2. Conventions

- **Authentication:** `Authorization: Bearer cbk_xxxxxxxxxxxx.<secret>` on every request. HTTPS only.
- **Format:** request and response bodies are JSON (`Content-Type: application/json`), except document upload, which is `multipart/form-data`.
- **Dates:** dates are `YYYY-MM-DD` (AD) and timestamps are ISO 8601. Times are Nepal time (`Asia/Kathmandu`) when no offset is given. Member birth dates can also be sent in BS as `dob_bs`.
- **Member key:** `member_no` is the cooperative's membership number (सदस्यता नं.). Your own customer id (CIF) can be stored as `external_id`.
- **Idempotency:** send `Idempotency-Key: <unique id>` on writes. If the same key and body are sent again within 24 hours, you get the stored response (header `Idempotent-Replay: true`). The same key with a different body returns `422`.
- **Pagination:** list endpoints return `next_cursor`. Pass it back as `?cursor=` until it is `null`. Ordering is stable (changed-at, then id), so a sync never skips or repeats rows.
- **Rate limit:** 600 requests per minute per key. When exceeded you get `429` with a `Retry-After` header.
- **Errors:**

  ```json
  { "error": { "code": "validation_failed", "message": "Invalid member data", "details": { "phone": "invalid" } } }
  ```

  | HTTP | code |
  |---|---|
  | 400 | `bad_request`, `bad_json`, `bad_cursor` |
  | 401 | `unauthorized` |
  | 403 | `insufficient_scope`, `ip_not_allowed` |
  | 404 | `member_not_found`, `not_found`, `unknown_module` |
  | 409 | `conflict` |
  | 413 | `too_large` |
  | 415 | `unsupported_media_type` |
  | 422 | `validation_failed`, `idempotency_mismatch` |
  | 429 | `rate_limited` |

- **Logging:** every call is logged (client, path, status, IP, duration) and visible under Admin → CBS / DMS API.

## 3. Members (CBS → portal)

### Create or update one member

`PUT /members/{member_no}` creates the member if it doesn't exist (201) or updates the fields you send (200). Fields you leave out are not changed.

```bash
curl -X PUT https://aakash.coopcloud.com.np/api/v1/members/A-1001 \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: cif-77001-2026-11-04" \
  -d '{
    "name": "Krishna Thapa", "name_np": "कृष्ण थापा",
    "phone": "9851000001", "email": "krishna@example.com",
    "address": "काठमाडौं-१०", "dob_bs": "2040-02-15", "gender": "male",
    "card_no": "AAK000123", "external_id": "CIF-77001",
    "active": true, "approval_status": "approved"
  }'
```

**Fields:**
- **Required for a new member:** `name` or `name_np`.
- **Optional:** `phone`, `email`, `address`, `dob` (AD) or `dob_bs`, `gender` (`male|female|other`), `card_no`, `external_id`, `active`, `approval_status` (`pending|approved|rejected`).
- **`active: false`:** signs the member out of the portal immediately.

### Bulk (nightly sync)

`POST /members/bulk` takes `{ "members": [ { "member_no": "...", ... }, ... ] }` with at most 500 items.

The response has a result per row, so one bad row doesn't fail the batch:

```json
{ "data": [ { "index": 0, "member_no": "A-1", "id": 12, "status": "created" },
            { "index": 1, "member_no": "A-2", "status": "error", "error": { "code": "validation_failed", "details": { "email": "invalid" } } } ],
  "summary": { "created": 1, "error": 1 } }
```

### Read and change feed

- `GET /members/{member_no}` returns the member with their accounts.
- `GET /members?updated_since=2026-11-01T00:00:00+05:45&limit=200` lists members changed since that time.
  - Follow `next_cursor`.
  - Use `?q=` to search by name, phone or membership number.

## 4. Accounts, loans and transactions (CBS → portal)

Members see these figures under **Member portal → My accounts**.

`PUT /members/{member_no}/accounts`:

```json
{ "replace": true,
  "accounts": [
    { "account_no": "001-SAV-123", "kind": "saving", "product_name": "नियमित बचत", "balance": 125000.50, "interest_rate": 6.5, "as_of": "2026-11-04T18:00:00+05:45" },
    { "account_no": "001-FD-9", "kind": "fixed", "balance": 500000, "interest_rate": 9.0, "maturity_date": "2027-11-04" },
    { "account_no": "001-LN-77", "kind": "loan", "product_name": "व्यवसाय ऋण", "balance": 450000, "interest_rate": 13.5,
      "installment_amount": 15500, "next_due_date": "2026-12-01", "overdue_amount": 0 },
    { "account_no": "SH-1001", "kind": "share", "balance": 10000 }
  ] }
```

- **`kind`:** one of `saving|fixed|loan|share|other`.
- **`replace`:** `true` (the default) removes accounts that are not in the list.
- **Bulk:** `POST /accounts/bulk` with `{ "members": [ { "member_no": "...", "accounts": [...] } ] }`, at most 500 members.

`POST /members/{member_no}/transactions` adds statement lines. It accepts at most 1000 per call and keeps the latest 500 per member. A repeated `txn_id` updates the existing line instead of duplicating it.

```json
{ "transactions": [
  { "account_no": "001-SAV-123", "txn_id": "T20261101-0042", "txn_date": "2026-11-01T10:15:00+05:45",
    "description": "नगद जम्मा", "debit": 0, "credit": 5000, "balance_after": 125000.50 } ] }
```

## 5. Applications (portal → CBS / DMS)

The types are `loan, account, kyc, grievance, appointment, feedback, welfare, digital, vendor, survey, membership, honor, job, bid, contact`. `GET /applications` lists them.

- `GET /applications/{type}?status=pending&updated_since=…&limit=100` pulls applications (follow `next_cursor`).
- `GET /applications/{type}/{tracking_id}` returns one application with its status history.
- `GET /applications/{type}/{tracking_id}/files/{field}` downloads an attached file (needs `documents:read`). The URL is included in each application's `files[]`.
- `PATCH /applications/{type}/{tracking_id}` writes a decision back from the CBS:

  ```json
  { "status": "approved", "remarks": "ऋण स्वीकृत — शाखामा सम्पर्क गर्नुहोस्", "notify": true }
  ```

  - **`status` values** depend on the type, e.g. loan: `pending, processing, approved, rejected, disbursed`. An invalid value returns `422` with the allowed list.
  - **History:** each change is recorded, with `API: <client name>` as the actor.
  - **`notify: true`:** also sends the applicant an SMS and email, using the templates and limits configured in the portal.

Example application object:

```json
{ "id": 42, "tracking_id": "LN-830718-7KVC335S", "type": "loan", "status": "pending", "remarks": null,
  "applicant": { "name": "राम", "phone": "9841000001", "email": null, "member_no": "A-1001" },
  "fields": { "loan_type": "business", "loan_amount": 500000, "loan_tenure": 36, "...": "..." },
  "files": [ { "field": "documents", "label": "Documents (PDF/photo)", "url": "https://…/api/v1/applications/loan/LN-…/files/documents" } ],
  "created_at": "…", "updated_at": "…" }
```

## 6. Member documents (DMS ↔ portal)

- `POST /members/{member_no}/documents` uploads a file as `multipart/form-data`, max 25 MB.
  - **Fields:** `file`, `title`, `doc_type` (e.g. `kyc`, `citizenship`, `statement`), `external_ref`, `visible_to_member` (`1` shows it in the member portal).
  - **Allowed types:** PDF, Office documents, CSV/TXT and JPG/PNG/WEBP/GIF. The file content is checked as well as the extension.
- `GET /members/{member_no}/documents` lists documents.
- `GET /members/{member_no}/documents/{id}/file` downloads one.
- `DELETE /members/{member_no}/documents/{id}` deletes one.

Files are stored outside the public web folder. They can only be opened through this API, by staff in the admin panel, or by the member themselves when `visible_to_member` is set.

## 7. Webhooks (portal → your system)

In the API client settings, set a **webhook URL** (public https) and choose events:

| Event | When |
|---|---|
| `application.submitted` | Someone submits any online form |
| `application.status_changed` | Staff (or another API client) change an application's status |
| `member.created` / `member.updated` | A member is added or changed in the portal (admin, CSV import, another client) |

Changes made with **your own** API key are **not** sent back to you, so two-way sync can't loop.

**Request:** `POST <your url>` with these headers:

```
Content-Type: application/json
X-Coop-Event: application.submitted
X-Coop-Delivery: 1234
X-Coop-Signature: t=1793800000,v1=5f2c…(hex)
```

```json
{ "id": "1234", "event": "application.submitted", "created_at": "…", "tenant": "aakash",
  "data": { "type": "loan", "id": 42, "tracking_id": "LN-…", "status": "pending", "applicant": { "name": "…", "phone": "…" } } }
```

**Response:** reply with any `2xx` within 10 seconds.

**Retries:** after a failure the portal retries after 1 min, 5 min, 15 min, 1 h, 3 h, 6 h, 12 h and 24 h, then marks the delivery *failed*. You can retry failed deliveries from the admin page. Use `X-Coop-Delivery` to ignore duplicates.

**Verify every webhook.** Compute `HMAC-SHA256(secret, "<t>.<raw body>")`, compare it in constant time with `v1`, and reject timestamps older than 5 minutes.

```js
// Node.js (Express): app.post('/hooks/portal', express.raw({ type: 'application/json' }), handler)
const crypto = require('crypto');
function verify(req, secret) {
  const sig = Object.fromEntries(String(req.get('x-coop-signature')).split(',').map(p => p.split('=')));
  if (Math.abs(Date.now() / 1000 - Number(sig.t)) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${sig.t}.${req.body}`).digest('hex');
  return sig.v1 && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig.v1));
}
```

```php
// PHP
$raw = file_get_contents('php://input');
parse_str(str_replace(',', '&', $_SERVER['HTTP_X_COOP_SIGNATURE'] ?? ''), $sig);
$ok = abs(time() - (int)($sig['t'] ?? 0)) <= 300
   && hash_equals(hash_hmac('sha256', ($sig['t'] ?? '') . '.' . $raw, $secret), $sig['v1'] ?? '');
```

```python
# Python
import hmac, hashlib, time
def verify(raw: bytes, header: str, secret: str) -> bool:
    sig = dict(p.split('=', 1) for p in header.split(','))
    if abs(time.time() - int(sig.get('t', 0))) > 300: return False
    expected = hmac.new(secret.encode(), f"{sig['t']}.".encode() + raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sig.get('v1', ''))
```

## 8. Typical sync design

| Direction | How | When |
|---|---|---|
| CBS → portal: members | `POST /members/bulk` with changed members | every 15 min, or nightly full |
| CBS → portal: balances | `POST /accounts/bulk` | end of day, or after each posting batch |
| CBS → portal: statements | `POST /members/{no}/transactions` | after posting |
| Portal → CBS: new applications | webhook `application.submitted`, plus a fallback pull with `GET /applications/{type}?updated_since=` | real time + every hour |
| CBS → portal: decisions | `PATCH /applications/{type}/{tracking_id}` with `notify: true` | when the loan or account is decided |
| DMS → portal: documents | `POST /members/{no}/documents` | when scanned or approved |

Keep the last successful `updated_since` time (or `next_cursor`) on your side, and send an `Idempotency-Key` on every write so retries are safe.

## 9. Quick test

```bash
KEY='cbk_…'; BASE='https://aakash.coopcloud.com.np/api/v1'
curl -s -H "Authorization: Bearer $KEY" $BASE/ping
curl -s -H "Authorization: Bearer $KEY" "$BASE/applications/loan?status=pending&limit=5"
```
