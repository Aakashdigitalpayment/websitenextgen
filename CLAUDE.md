# Project rules — websitenextgen

Multi-tenant cooperative (SACCOS) platform: Node.js 20+ / Express 5 / PostgreSQL (one schema per tenant) / server-rendered EJS.
It is the full rewrite of the old PHP/MySQL site `Aakashdigitalpayment/websourcecode`. These rules apply to every change.

## 1. Parity first: nothing from the PHP site may be lost
- Every piece of logic, rule, workflow, field, validation, setting, report and concept in the PHP site must exist here, done at least as well. If something is deliberately not ported (e.g. HRM, insecure temp passwords), record it with the reason in `docs/parity/`.
- Before building or changing a feature, read the PHP equivalent (`/home/user/websourcecode` or the GitHub repo) and the matching report in `docs/parity/`. `docs/parity/coverage.md` maps every PHP file to its Node equivalent and must be kept up to date.
- Data migrated from PHP must keep working: legacy setting names (`settings.mapLegacy`), legacy URLs (`src/lib/legacy-urls.js`), BS dates, `$2y$` password hashes, `pii1:/pii2:` values, old upload paths and Font Awesome icon values.

## 2. Modular monolith
- One deployable app. Each business area is a module with clear boundaries: `src/routes/<area>.js` (HTTP only), `src/lib/<area>.js` (domain logic, DB access), `views/<surface>/<area>*.ejs` (presentation).
- Routes stay thin: validate input, check permission, call the lib, render. No SQL in views; no business rules in routes that another route could also need.
- Modules talk through exported lib functions, never by reaching into another module's tables ad hoc when a lib function exists.
- Declarative registries are the extension points. Prefer adding to them over writing new hand-made pages:
  - `src/modules/resources.js`: admin CRUD content tables (fields, filters, delete guards)
  - `src/modules/applications.js`: public forms, inbox, tracker, notifications
  - `src/lib/setting-defs.js`: every setting key, with type, group and default
  - `src/lib/navigation.js`: public/admin menus
  - `src/lib/admin-perms.js`: roles and permissions
  - `src/lib/plans.js`: plan feature tiers

## 3. Single source of truth (SSOT) for data
- One table/field owns each fact. Members: `members` ↔ KYM `kyc_applications` linked by member number (`src/lib/kym.js`); never copy identity into a second place that can drift. Public forms take member identity from the record on the server, never from what the client posts.
- Settings: read only via `src/lib/settings.js` (handles defaults, legacy names, decryption); never query `settings` directly.
- Labels, status names, option lists, statuses and colours live in one place (`forms.js` STATUS_LABELS / optionSources, registries above) and are reused everywhere (admin, public, tracker, exports, notifications).
- Dates: store AD in DATE columns; convert and display BS through `src/lib/nepali-date.js` only.
- Schema changes only as new idempotent files in `db/migrations/NNN_name.sql` (next free number); never edit an applied migration.

## 4. Uniform UI and shared components
- Reuse partials in `views/partials/` (field, admin-field, page-head, pagination, request-row, request-progress, person-card, chart, notice-popup …). If markup appears twice, make it a partial.
- One design system: `public/css/app.css` (public), `admin.css`, `forms.css`, using CSS tokens. No per-page ad-hoc colours or inline `style=` for layout.
- Every page: bilingual Nepali/English labels as `[np, en]` pairs, mobile-first (works at 360 px, no horizontal scroll), light and dark mode, accessible (labels, focus states, alt text, keyboard).
- Same patterns everywhere: list → filters → table/cards → pagination; form → validation messages inline → flash on save; destructive actions confirm and are audited.

## 5. Icons: Lucide only
- All icons are Lucide (https://lucide.dev), rendered server-side as inline SVG through `src/lib/icons.js` (`icon(name)`), self-hosted from the `lucide-static` package. Never use a CDN, icon fonts, emoji-as-icons or hand-drawn SVGs.
- Use Lucide names. Legacy names (old app names, Font Awesome `fa-*` values from PHP data) are mapped to Lucide in one alias table in `icons.js`.

## 6. Security (never weaken)
- Strict CSP: no inline scripts or `on*=` handlers; JS goes in `public/js/`. No CDNs.
- CSRF on every POST; permission check on every admin route (GET and POST); rate limits on public endpoints; parameterised SQL only (whitelist any identifier or `ORDER BY`).
- Escape output (`<%=`); `<%-` only for sanitised HTML or `icon()`. Uploads go through `src/lib/uploads.js`.
- Tenant isolation: queries run under the request's schema; caches are keyed by schema; uploads are per tenant.
- PII: encrypt with `pii-crypto`, mask on display, never log it.

## 7. Workflow
- Tests: `npm test` (real PostgreSQL via `DATABASE_URL`, temp tenants) must pass; add tests for every new behaviour or bug fix.
- Run `npm run db:migrate` after adding a migration.
- UI changes: check them in a browser (Playwright) at 390 px and 1280 px: no console errors, no horizontal scroll.
