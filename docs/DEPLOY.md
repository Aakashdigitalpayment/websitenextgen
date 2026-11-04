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

| Record | Value |
|---|---|
| `A coopcloud.com.np` | server IP |
| `A *.coopcloud.com.np` | server IP (every tenant subdomain) |
| `A platform.coopcloud.com.np` | server IP (covered by the wildcard) |
| Custom domain, e.g. `www.aakashsaccos.com.np` | `CNAME aakash.coopcloud.com.np`, or `A` to the server IP |

Caddy issues HTTPS certificates automatically for each host, but only after the app confirms the host belongs to a cooperative (`/__tls/allowed`, reachable from localhost only). Map a custom domain in the platform console **before** pointing its DNS at the server.

## 3. Add cooperatives

1. Open `https://platform.coopcloud.com.np/platform` and sign in with `PLATFORM_ADMIN_USER` / `PLATFORM_ADMIN_PASSWORD`.
2. **New cooperative**: enter the slug, Nepali/English name, an optional custom domain and the first admin password.
3. Sign in at `https://<slug>.coopcloud.com.np/admin`, change the password, turn on **2-step login**, then fill in **Settings** (logo, contact details, SMS/SMTP, AI).

From the command line instead:

```bash
npm run tenant:create -- --slug=aakash --name="आकाश सहकारी" --domain=www.aakashsaccos.com.np --password='Temp@12345678'
```

## 4. Move an existing PHP site

On the server (or anywhere that can reach both databases):

```bash
npm install mysql2      # optional dependency, only needed for the import
npm run db:import-mysql -- --tenant=aakash --mysql=mysql://USER:PASS@OLD_HOST:3306/OLD_DB \
     --uploads=/path/to/old/public_html/assets/uploads --truncate
```

- Admin and member passwords keep working.
- Old upload paths keep working.
- Executable files are skipped.
- Credentials saved in the old vault open if you set `CREDENTIALS_LEGACY_KEY` to the PHP `CRED_MASTER_KEY`.

**Recommended cut-over:** import to a test subdomain → check it → re-run the import with `--truncate` right before switching → change DNS.

## 5. Backups

- **Docker:** the `backup` service writes a nightly `pg_dump` per tenant plus uploads to `./backups/` and keeps 14 days.
- **systemd:** add a cron job:

  ```
  15 2 * * *  cd /opt/websitenextgen && scripts/backup.sh /var/backups/coop >> /var/log/coop-backup.log 2>&1
  ```

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

- [ ] `SESSION_SECRET`, `CREDENTIALS_KEY` and the database password are long, random and backed up somewhere safe.
- [ ] `NODE_ENV=production` (secure cookies, generic error pages).
- [ ] Every admin has turned on 2-step login (**Admin → System / backup** shows the count).
- [ ] SMTP and SMS tested from **Admin → SMS / email / push → Send a test**.
- [ ] A backup has run and a restore has been tested.
- [ ] Port 3000 is not reachable from the internet (only 80/443).
