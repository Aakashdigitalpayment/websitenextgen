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

Docker:

```bash
SESSION_SECRET=$(openssl rand -hex 32) docker compose up -d
docker compose exec app npm run db:migrate
docker compose exec app npm run tenant:create -- --slug=aakash --name="आकाश सहकारी" --domain=aakash.example.com --password='ChangeMe@12345'
```

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
- generic CRUD for 46 content tables (`src/modules/resources.js`)
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

## Not ported yet

These PHP features still need work: HRM (employees, contracts, messenger), programme attendance with QR and registration desks, member marketplace, SMS/email/web-push notifications, AI chat, admin 2FA (TOTP), office credential manager, bulk member CSV import, and site-licence renewal. Their tables already exist in every tenant schema, and data is preserved by the importer.

## Development

```bash
npm run dev               # auto-restart
npm test                  # integration tests (needs DATABASE_URL); creates & drops two temp tenants
npm run schema:convert    # regenerate db/schema.sql from db/legacy/install.sql
```

New schema changes go in `db/migrations/NNN_name.sql`. They are applied to every tenant by `npm run db:migrate`, or per tenant from the platform console.
