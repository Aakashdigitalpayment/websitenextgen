# websitenextgen — Cooperative platform (Node.js + PostgreSQL, multi-tenant)

The next-generation rewrite of the Aakash cooperative PHP/MySQL website: **one Node.js app serves many cooperatives**. Each cooperative (tenant) has its own data, admins, members, uploads and domain.

The original MySQL schema is kept at `db/legacy/install.sql` (input for the schema converter and the MySQL importer).

## Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 20+ (tested on 22), Express 5 |
| Views | Server-rendered EJS, no build step, ~4 KB of vanilla JS |
| Database | PostgreSQL 14+ (tested on 16) |
| Sessions | PostgreSQL (`platform.user_sessions`) |
| Design | Own CSS design system (`public/css/app.css`): Inter + Noto Sans Devanagari at **400/500/600** (no heavy weights), neutral surfaces, one brand colour per tenant, dark mode |

## Multi-tenancy: one schema per tenant

```
platform.tenants          slug, name, schema_name, status
platform.tenant_domains   custom domains → tenant
platform.operators        people who manage tenants (/platform)
platform.user_sessions    sessions (bound to a tenant id)

tenant_aakash.*           the 102 tables from database/install.sql
tenant_janata.*           …same tables, separate data
```

- **Resolution:** each request's `Host` is matched to a custom domain (`www.coop.com.np`) or a subdomain (`<slug>.BASE_DOMAIN`). Then every query in that request runs with `search_path = tenant_<slug>` (see `src/db.js`, AsyncLocalStorage).
- **Isolation:** a session is bound to the tenant it signed in on, so a cookie replayed on another tenant's domain is not accepted. Uploads live in `uploads/<slug>/` and are only served on that tenant's domain.
- **Why schemas, not a `tenant_id` column:** every legacy MySQL database maps 1:1 onto one schema, and a missing `WHERE tenant_id = …` can't leak data. Backups and restores can be done per tenant (`pg_dump -n tenant_x`).

## Quick start

```bash
cp .env.example .env            # set DATABASE_URL, SESSION_SECRET, BASE_DOMAIN …
npm install
npm run db:migrate              # creates the platform schema, migrates all tenants
npm run tenant:create -- --slug=aakash --name="आकाश सहकारी" --name-en="Aakash Cooperative" \
     --domain=aakash.localhost --password='ChangeMe@12345'
npm run demo:seed -- aakash     # optional sample content
npm start                       # http://aakash.localhost:3000  (admin: /admin)
```

`*.localhost` resolves to 127.0.0.1 in most browsers. For local development you can also set `DEFAULT_TENANT=aakash` so that plain `http://localhost:3000` serves that tenant.

**Production:** see **[docs/DEPLOY.md](docs/DEPLOY.md)**. It covers Docker Compose (app, PostgreSQL, Caddy with automatic HTTPS for every cooperative domain, and nightly backups) or systemd with Caddy/Nginx, plus DNS, tenant setup, moving the PHP sites, backup/restore, updates and a go-live checklist.

## Moving an existing PHP site over

```bash
npm run tenant:create -- --slug=aakash --name="आकाश सहकारी" --domain=www.aakashsaccos.com.np --password='Temp@12345678'
npm run db:import-mysql -- --tenant=aakash --mysql=mysql://user:pass@host:3306/old_db \
     --uploads=/path/to/old-site/assets/uploads --truncate
```

- Every table and column that exists on both sides is copied. MySQL zero dates become `NULL`, and id sequences are reset.
- PHP `password_hash()` ($2y$) hashes keep working, so admins and members sign in with their old passwords.
- Old stored paths like `assets/uploads/news/x.jpg` keep resolving. Executable files (`.php`, `.html`, `.js`) are **not** copied from the old uploads folder.
- `--truncate` only empties tables that have rows in the source.
- If the tenant ends up with no active admin, run `npm run tenant:admin -- --tenant=aakash --username=admin --password=…`.

Tested against the legacy `install.sql` loaded into MariaDB.

## What is included

**Public site:** home (slider, stats, quick links, notices, rates, news, popup notice), about, vision/mission, chairman and CEO messages, team, committees by tenure, awards, success stories, services and products, interest rates, digital services, branches, partner discounts, news, notices, gallery with albums, downloads (with counter), reports and institutional profile (member-only items hidden), careers, auctions, elections (candidates and schedule), EMI calculator with schedule, BS⇄AD date converter, Nepali calendar, NRB exchange rates, FAQs, useful links, CMS pages, contact, sitemap.xml, robots.txt, Nepali/English switch.

**Online forms** (one declarative definition each, in `src/modules/applications.js`): loan, account opening, KYC, membership, grievance, appointment, feedback, welfare claim, digital service, vendor enlistment, satisfaction survey, honour programme, job application, auction bid, contact. Each gets validation, uploads, a tracking number, a public tracker (tracking number + phone), an admin inbox and a member view.

**Admin** (`/admin`):
- dashboard
- generic CRUD for 48 content tables (`src/modules/resources.js`)
- application inboxes with status changes, remarks, status history, member notification, CSV export and print
- members, with ID card issue (verification code + CVV)
- password-reset requests, settings with logo upload, admin users, audit log
- roles: `editor` (content only) < `staff` (+ applications, members) < `admin` (+ settings, audit) < `superadmin` (+ users)

**Member portal** (`/member`): sign-in by phone, member number or email; dashboard; my applications; notifications; profile and password; digital ID card; information room (access logged); online election voting (one ballot per member, enforced in a transaction); forgot-password request.

**Platform console** (`/platform` on `PLATFORM_HOST`): create, suspend or activate tenants, map custom domains, run migrations. The first operator is created from `PLATFORM_ADMIN_USER` / `PLATFORM_ADMIN_PASSWORD`.

## Security notes

- CSRF tokens on every POST. Multipart forms also send the token in the action URL, so file-upload routes can't bypass the check.
- Uploads: extension and MIME allow-list, a magic-byte check, random file names, and `nosniff` plus a restrictive CSP on served files.
- Rate limits on public forms and ID-card verification, plus failed-login throttling via `login_attempts`.
- Admin rich text is sanitised. Helmet with a strict CSP (no inline scripts).

## Add-on modules

| Module | Where | Notes |
|---|---|---|
| **SMS / email / web push** | Admin → SMS / email / push; Settings → SMS / email | Sparrow, Aakash or a custom webhook for SMS; SMTP for email; editable templates (`{{name}} {{tracking_id}} {{module}} {{status}} {{remarks}} {{site}}`); delivery log; test send. The applicant and office are notified on submit, and the applicant on status change. Members can turn on browser push (VAPID keys per tenant); admins can broadcast to all members. Webhook URLs must be public https. |
| **Admin 2FA** | Admin → 2-step login | TOTP (Google/Microsoft Authenticator, Authy) with 8 single-use backup codes. Compatible with 2FA secrets imported from the PHP site; superadmins can reset another user's 2FA. |
| **Member CSV import** | Admin → Members → Import CSV | Validate and preview first, then commit. Modes: update or skip existing members (matched by member number, else mobile). Use `dob_bs` / `dob_ad` columns for dates of birth. A sample CSV is provided. |
| **Programmes & QR attendance** | Admin → Programme attendance; member `/member/programs` | A QR code per programme or per location, with open/close times. Check-in is instant or needs approval. The registration desk can check in by member number, card or phone. Also: void, pre-registration, CSV export, and one valid check-in per member, enforced by the database. |
| **Member marketplace** | `/marketplace`, `/member/marketplace`, Admin → Marketplace | Products and skills; the office approves listings (and re-approves after edits); public inquiries notify the seller. |
| **AI chat** | Settings → AI chat; FAQ answers in Admin → Chatbot answers | Instant FAQ answers first, then Gemini, OpenAI or DeepSeek (the same providers as the PHP site), answering from the cooperative's own facts only. Rate-limited; never asks for passwords or OTPs. |
| **Office credentials** | Admin → Office credentials (superadmin) | AES-256-GCM with a key per tenant derived from `CREDENTIALS_KEY`. Every reveal or copy is logged. PHP-encrypted entries open with `CREDENTIALS_LEGACY_KEY` and upgrade automatically. |
| **Site licence** | Platform console (date); Admin → Licence (renewal notice) | Warning 30 days before expiry. Once expired, the public site shows a notice and only superadmins can sign in. Admins submit eSewa, Khalti or bank payment notices; the operator verifies them and sets the new date. |

| **Election results** | Admin → Election results | Tallies per position, leading candidates, turnout, latest ballots. Printable. |
| **System & backup** | Admin → System / backup (superadmin) | Health checks (SMTP, SMS, AI, vault key, 2FA coverage, licence), database and upload sizes, migrations, and a JSON export of all tenant data with secrets removed. |
| **PWA** | — | Web manifest per tenant and an offline page. The service worker caches only static files, never admin or member pages. |

### Extra environment variables

```
CREDENTIALS_KEY=          # office credential vault, min 32 chars (openssl rand -hex 32). Never change once used.
CREDENTIALS_LEGACY_KEY=   # optional: PHP CRED_MASTER_KEY, to open imported credentials
PLATFORM_HOST=platform.example.com
PLATFORM_ADMIN_USER= / PLATFORM_ADMIN_PASSWORD=   # bootstrap the first platform operator
```

## Development

```bash
npm run dev               # auto-restart
npm test                  # 18 tests (needs DATABASE_URL); creates & drops two temp tenants
npm run schema:convert    # regenerate db/schema.sql from db/legacy/install.sql
```

New schema changes go in `db/migrations/NNN_name.sql`. They are applied to every tenant by `npm run db:migrate`, or per tenant from the platform console.
