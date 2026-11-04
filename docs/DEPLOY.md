# Deploying the cooperative platform

This guide covers one server (VPS) hosting many cooperatives. Each cooperative gets `https://<slug>.<BASE_DOMAIN>` and can add its own domain.

> **cPanel shared hosting:** this is a Node.js + PostgreSQL app. It does not run like the PHP site on ordinary cPanel hosting. It works only on cPanel plans that offer both *Setup Node.js App* and PostgreSQL, and even then a VPS is strongly recommended. The PHP site can keep running on cPanel until you switch DNS.

## 1. Server

Ubuntu 24.04, at least 2 vCPU, 2–4 GB RAM and 40 GB disk for about 10 cooperatives.

Pick **one** of the two routes below. Docker is the shortest.

### Route A — Docker (recommended)

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2 git
git clone https://github.com/Aakashdigitalpayment/websitenextgen.git /opt/websitenextgen
cd /opt/websitenextgen
cp .env.example .env
```

Edit `.env`:

```
SESSION_SECRET=<openssl rand -hex 32>
CREDENTIALS_KEY=<openssl rand -hex 32>     # never change after first use
POSTGRES_PASSWORD=<openssl rand -hex 16>
BASE_DOMAIN=coopcloud.com.np               # your platform domain
PLATFORM_HOST=platform.coopcloud.com.np
PLATFORM_ADMIN_USER=operator
PLATFORM_ADMIN_PASSWORD=<strong password>
```

Set your e-mail address in `deploy/Caddyfile.docker` (`email ops@example.com`), then:

```bash
docker compose up -d --build
docker compose exec app npm run db:migrate
```

### Route B — systemd + Caddy

```bash
# Node.js 22, PostgreSQL 16, Caddy
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs postgresql caddy git
sudo -u postgres psql -c "CREATE USER coop WITH PASSWORD 'CHANGE_ME';" -c "CREATE DATABASE coop OWNER coop;"

sudo useradd --system --home /opt/websitenextgen --shell /usr/sbin/nologin coop
sudo git clone https://github.com/Aakashdigitalpayment/websitenextgen.git /opt/websitenextgen
cd /opt/websitenextgen && sudo npm ci --omit=dev
sudo cp .env.example .env && sudo nano .env      # as above, plus DATABASE_URL=postgres://coop:CHANGE_ME@localhost:5432/coop
sudo mkdir -p uploads && sudo chown -R coop:coop uploads .env && sudo chmod 600 .env
sudo -u coop npm run db:migrate

sudo cp deploy/coop.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now coop
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile && sudo nano /etc/caddy/Caddyfile   # set your e-mail
sudo systemctl reload caddy
```

Prefer Nginx? See `deploy/nginx.conf`. It needs a wildcard certificate, plus one block per custom domain.

## 2. DNS

### Your platform domain (once)

| Record | Value |
|---|---|
| `A coopcloud.com.np` | server IP |
| `A *.coopcloud.com.np` | server IP. This makes every tenant subdomain **and every generated CNAME target** resolve. |

Set `SERVER_IPS=<server IP>` in `.env`. It is used to verify client domains that point an A record at the server.

### Each cooperative's own domain

Every cooperative gets a **unique generated address** (its CNAME target) when it is created, e.g. `aakash-7k2mq.coopcloud.com.np`. You can see it in the platform console, or in **Admin → Website domain** (superadmin).

1. Add the client's domain (e.g. `www.aakashsaccos.com.np`) in the platform console or in the cooperative's admin. It starts as **waiting for DNS**.
2. At the client's domain provider, create the records shown on screen:

   | Domain | Record |
   |---|---|
   | `www.aakashsaccos.com.np` | `CNAME → aakash-7k2mq.coopcloud.com.np` |
   | `aakashsaccos.com.np` (bare / apex) | `A → <server IP>`, or ALIAS / ANAME / CNAME-flattening → the generated target. Apex domains cannot use a plain CNAME. |

3. The platform checks DNS every 15 minutes, or immediately with **Check now**. When the record matches, the domain becomes **active** and Caddy issues its HTTPS certificate on the first visit.

Behaviour once a domain is active:
- The first verified client domain becomes the **primary** (`www.` is preferred); you can change it.
- With **Redirect to primary** on (the default), the generated address, the platform subdomain and any other domain answer with a `301` to the primary. The API (`/api/v1`) is never redirected.
- A client domain is **never served, and never gets a certificate, until its DNS has been verified**, so nobody can claim someone else's domain.
- A domain can belong to only one cooperative.

## 3. Add cooperatives

1. Open `https://platform.coopcloud.com.np/platform` and sign in with `PLATFORM_ADMIN_USER` / `PLATFORM_ADMIN_PASSWORD`.
2. **New cooperative**: enter the slug, Nepali/English name, an optional custom domain and the first admin password.
3. Sign in at `https://<slug>.coopcloud.com.np/admin`, change the password, turn on **2-step login**, then fill in **Settings** (logo, contact details, SMS/SMTP, AI).
4. Connect the cooperative's own domain: see section 2.
5. Optional: **Google sign-in for members.** In Google Cloud Console create an OAuth client (Web application), add the redirect URI shown in **Settings → Google sign-in**, and paste the client ID and secret there.

From the command line instead:

```bash
npm run tenant:create -- --slug=aakash --name="आकाश सहकारी" --domain=www.aakashsaccos.com.np --password='Temp@12345678'
```

## 4. Move an existing PHP site (migration tool)

The tool copies the database, uploaded files, settings, admins (with their passwords), members (with their passwords), 2FA and the office-credential vault from an old PHP site into one tenant. Run it on the new server, with read access to the old site's folder or database.

```bash
npm install mysql2      # once; only needed for migrations

# 1) Check first. Nothing is written; you get a plan and an HTML report.
npm run migrate:site -- --tenant=aakash --php-root=/home/olduser/public_html --dry-run

# 2) Migrate. --create also creates the tenant if it does not exist yet.
npm run migrate:site -- --tenant=aakash --create --name="आकाश सहकारी" --domain=www.aakashsaccos.com.np \
     --admin-password='Temp@12345678' --php-root=/home/olduser/public_html
```

**`--php-root`** points at the old site's folder. The tool reads:
- `includes/database.local.php` (MySQL connection)
- `assets/uploads` (files)
- `includes/.cred-master.key` (vault key)

If the database is on another machine, or the files were copied elsewhere, use `--mysql=mysql://user:pass@host:3306/db` and `--uploads=/path` instead.

What it does:
1. **Checks:** MySQL connection and charset, garbled ("double-encoded") Nepali text, tables and columns that have no place in the new system, file counts and free disk space.
2. **Copies data:** every table and column that exists in both systems.
   - `--mode=fresh` (the default) first replaces the tenant's rows in those tables.
   - `--mode=incremental` only adds rows that are new since the last run.
3. **Copies uploads:** PHP, HTML and other executable files are never copied.
4. **Protects confidential files:** application documents (citizenship copies, CVs, KYC photos) and information-room files move to private storage and their paths are updated.
5. **Re-encrypts** office credentials from the PHP AES-CBC vault to the new AES-GCM vault. This needs `CREDENTIALS_KEY`.
6. **Verifies:** row counts, old vs new, per table; files the database points to that are missing; members who can sign in with their old password; active admins.
7. **Writes a report:** `reports/migration-<tenant>-<time>.html`, plus a `.json` version.

**Recommended cut-over:**
1. Run with `--dry-run` and fix any warnings (e.g. charset).
2. Migrate to a test subdomain (`aakash.coopcloud.com.np`) and check the site and admin.
3. Right before switching, run the migration again (`fresh`) so the last day's applications come along.
4. Map the real domain in the platform console and switch DNS.

### Images up to 8K UHD
Every public photo (slides, news, gallery, team, logo…) gets AVIF + WebP copies at 640, 1280, 1920, 3840 (4K)
and 7680 (8K) px wide, made in the background right after upload. Pages send `srcset`/`sizes`, so an 8K or
Retina screen downloads the 8K file and a phone downloads the small one. Built-in illustrations, icons and
fonts are vector, so they are sharp at any resolution.

- Upload limit for images: `MAX_IMAGE_MB` (default 40). The proxy configs in `deploy/` allow 64 MB bodies.
- After migrating a PHP site, or for images uploaded before this feature, create the copies once:
  `npm run images:variants` (all tenants) or `npm run images:variants -- <slug>`.
- Admin shows each photo's size (e.g. `7680×4320 · 8K`) and warns when a slide is smaller than 1920 px.

## 5. Backups

- **Docker:** the `backup` service writes a nightly `pg_dump` per tenant plus uploads to `./backups/` and keeps 14 days.
- **systemd:** add cron jobs for the backup and the daily cleanup (old login attempts, used OTPs, expired sessions, old logs):

  ```
  15 2 * * *  cd /opt/websitenextgen && scripts/backup.sh /var/backups/coop >> /var/log/coop-backup.log 2>&1
  45 2 * * *  cd /opt/websitenextgen && /usr/bin/node scripts/cleanup.js >> /var/log/coop-cleanup.log 2>&1
  ```

  With Docker, the `cleanup` service runs the same job daily.

- Copy the backups off the server as well (e.g. `rclone`/`rsync` to another location).
- **Restore one tenant:** `pg_restore --clean --if-exists -d "$DATABASE_URL" /var/backups/coop/<date>/tenant_aakash.dump`
- A superadmin can also download a JSON export (secrets removed) from **Admin → System / backup**.

## 6. Updates

```bash
cd /opt/websitenextgen && git pull
# Docker
docker compose up -d --build && docker compose exec app npm run db:migrate
# systemd
sudo npm ci --omit=dev && sudo -u coop npm run db:migrate && sudo systemctl restart coop
```

Migrations in `db/migrations/` are applied to every tenant, and each one runs only once.

## 7. Checklist before going live

- `PII_KEY` set (and backed up offline) so citizenship numbers are encrypted at rest.

- [ ] `SESSION_SECRET`, `CREDENTIALS_KEY` and the database password are long, random and backed up somewhere safe.
- [ ] `NODE_ENV=production` (secure cookies, generic error pages).
- [ ] Every admin has turned on 2-step login (**Admin → System / backup** shows the count).
- [ ] SMTP and SMS tested from **Admin → SMS / email / push → Send a test**.
- [ ] A backup has run and a restore has been tested.
- [ ] Port 3000 is not reachable from the internet (only 80/443).
- [ ] `TRUST_PROXY` matches your setup (`loopback` for systemd + Caddy/Nginx, `1` for Docker). With more proxies in front (e.g. Cloudflare → Caddy), set the number of hops or the proxy IP ranges.
- [ ] `DEFAULT_TENANT` is empty.
- [ ] Every platform operator has turned on 2FA (`/platform/2fa`).
