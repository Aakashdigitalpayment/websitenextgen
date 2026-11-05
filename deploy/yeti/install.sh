#!/usr/bin/env bash
# First-time set-up on Yeti Cloud in ONE command (docs/YETI.md). On the Node.js node, in /home/jelastic/ROOT —
# or let `npm run yeti -- setup` do everything (key, clone, this script) from your computer:
#
#   bash deploy/yeti/install.sh --db-host nodeNNNNN-coopweb.ktm.yetiappcloud.com [--base-domain coopcloud.com.np]
#
# Only what is still missing is done, so the same command can be run again after any error:
#   1. container checks (pm2 image, Node ≥ 20, memory, disk); Yeti's sample pm2 app removed (asks; --yes)
#   2. database + env file (deploy/yeti/setup-db.mjs: asks the webadmin password once, hidden)
#   3. first platform operator: PLATFORM_ADMIN_USER / PLATFORM_ADMIN_PASSWORD in the env file (asked, hidden)
#   4. first deploy (deploy/yeti/deploy.sh --no-fetch): packages, migrations, pm2, health check
#   5. optionally the first cooperative (design + plan) — or create it later in the platform console
#
# Options: --db-host HOST [--db-name coop --db-role coop]  --base-domain DOMAIN  --platform-host HOST  --yes
#          --tenant-slug SLUG --tenant-name NAME [--tenant-name-en NAME] [--tenant-domain DOMAIN]
#          [--design saving_credit|multipurpose|agriculture|women|microfinance] [--plan lite|basic|advance|extra]
# Passwords never go on the command line: they are asked hidden, or read from DMS-style env variables
# COOP_DB_ADMIN_PASSWORD / PLATFORM_ADMIN_PASSWORD / ADMIN_PASSWORD (CI).
set -Eeuo pipefail

cd "$(dirname "$0")/../.."
: "$(pwd)"  # all paths below are relative to the checkout
ENV_FILE=${COOP_ENV_FILE:-/home/jelastic/coop.env}
DB_HOST=${COOP_DB_HOST:-}; DB_NAME=coop; DB_ROLE=coop; BASE=""; PHOST=""; YES=0
T_SLUG=""; T_NAME=""; T_NAME_EN=""; T_DOMAIN=""; DESIGN=saving_credit; PLAN=advance
while [ $# -gt 0 ]; do
  case "$1" in
    --db-host) DB_HOST=$2; shift 2 ;;
    --db-name) DB_NAME=$2; shift 2 ;;
    --db-role) DB_ROLE=$2; shift 2 ;;
    --base-domain) BASE=$2; shift 2 ;;
    --platform-host) PHOST=$2; shift 2 ;;
    --tenant-slug) T_SLUG=$2; shift 2 ;;
    --tenant-name) T_NAME=$2; shift 2 ;;
    --tenant-name-en) T_NAME_EN=$2; shift 2 ;;
    --tenant-domain) T_DOMAIN=$2; shift 2 ;;
    --design) DESIGN=$2; shift 2 ;;
    --plan) PLAN=$2; shift 2 ;;
    --yes | -y) YES=1; shift ;;
    -h | --help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "✗ Unknown option: $1 (see --help)"; exit 1 ;;
  esac
done

step() { printf '\n==> %s\n' "$*"; }
ok() { printf '  ✓ %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*"; }
tty() { [ -t 0 ] && [ -t 1 ]; }
ask() { local __v=$1 q=$2 d=${3:-} a=""; if tty; then read -rp "  $q${d:+ [$d]}: " a; fi; printf -v "$__v" '%s' "${a:-$d}"; }
confirm() { [ "$YES" = 1 ] && return 0; tty || return 1; local a; read -rp "  $1 [y/N]: " a; [[ "$a" =~ ^[yY] ]]; }
secret() { # secret VAR "prompt": from the environment, else hidden prompt
  local __v=$1; [ -n "${!__v:-}" ] && return 0; tty || return 1
  local s; read -rsp "  $2: " s; echo; printf -v "$__v" '%s' "$s"
}
env_get() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true; }
env_put() { # replace or append KEY=VALUE (value never printed)
  local tmp; tmp=$(mktemp)
  if grep -qE "^$1=" "$ENV_FILE"; then awk -v k="$1" -v v="$2" 'BEGIN{FS=OFS="="} $1==k{print k"="v; next} {print}' "$ENV_FILE" > "$tmp"; else cat "$ENV_FILE" > "$tmp"; printf '%s=%s\n' "$1" "$2" >> "$tmp"; fi
  cat "$tmp" > "$ENV_FILE"; rm -f "$tmp"; chmod 600 "$ENV_FILE"
}
trap 'printf "\n✗ Stopped (line %s). Fix the cause and run the same command again — finished steps are skipped.\n" "$LINENO"' ERR

# ------------------------------------------------------------------------------------------- 1
step "1/5 Container"
command -v pm2 >/dev/null || { echo "✗ pm2 not found: the Node.js node must use an image tagged …-pm2 (docs/YETI.md §1)"; exit 1; }
major=$(node -p 'process.versions.node.split(".")[0]')
[ "$major" -ge 20 ] || { echo "✗ Node.js $major: 20 or newer needed (22 LTS recommended)"; exit 1; }
ok "Node.js $(node -v), pm2 $(pm2 -v 2>/dev/null | tail -1)"
mem=$(cat /sys/fs/cgroup/memory.max 2>/dev/null || cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null || echo max)
total_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
case "$mem" in max | "" | *[!0-9]*) mem_mb=$total_mb ;; *) mem_mb=$((mem / 1024 / 1024)) ;; esac
[ "$mem_mb" -gt "$total_mb" ] && mem_mb=$total_mb   # "no limit" (cgroup v1) reads as a huge number
[ "$mem_mb" -ge 900 ] && ok "memory limit ${mem_mb} MB" || warn "memory limit ${mem_mb} MB — set the scaling limit to at least 8 cloudlets (1 GiB); 16 for 8K photo processing"
others=$(pm2 jlist 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).map(p=>p.name).filter(n=>!n.startsWith("coop-")&&n!=="pm2-logrotate").join(" "))}catch{}})')
if [ -n "$others" ]; then
  if confirm "Other pm2 app(s) here: $others — remove them (Yeti's sample app holds port 8080)?"; then
    # shellcheck disable=SC2086
    pm2 delete $others >/dev/null && ok "removed $others"
  else echo "✗ Port 8080 is needed: pm2 delete $others (or run with --yes)"; exit 1; fi
fi

# ------------------------------------------------------------------------------------------- 2
step "2/5 Database and env file"
if [ -f "$ENV_FILE" ] && grep -q '^DATABASE_URL=postgres' "$ENV_FILE"; then
  ok "already set up ($ENV_FILE)"
else
  [ -n "$DB_HOST" ] || ask DB_HOST "PostgreSQL node (dashboard → SQL: nodeNNNNN-<env>.ktm.yetiappcloud.com)"
  [ -n "$DB_HOST" ] || { echo "✗ --db-host is needed the first time"; exit 1; }
  # setup-db needs `pg`: install the app's packages in the checkout once (releases get their own)
  [ -d node_modules/pg ] || npm ci --omit=dev --no-audit --no-fund >/dev/null
  extra=(--db "$DB_NAME" --role "$DB_ROLE"); [ -n "$BASE" ] && extra+=(--base-domain "$BASE"); [ -n "$PHOST" ] && extra+=(--platform-host "$PHOST")
  if [ -n "${COOP_DB_ADMIN_PASSWORD:-}" ]; then printf '%s\n' "$COOP_DB_ADMIN_PASSWORD" | node deploy/yeti/setup-db.mjs --host "$DB_HOST" --env-path "$ENV_FILE" "${extra[@]}"
  else node deploy/yeti/setup-db.mjs --host "$DB_HOST" --env-path "$ENV_FILE" "${extra[@]}"; fi
fi
mkdir -p "$(env_get UPLOAD_DIR)" && chmod 700 "$(dirname "$(env_get UPLOAD_DIR)")"
ok "BASE_DOMAIN=$(env_get BASE_DOMAIN)  PLATFORM_HOST=$(env_get PLATFORM_HOST)"

# ------------------------------------------------------------------------------------------- 3
step "3/5 Platform operator (console at https://$(env_get PLATFORM_HOST)/platform)"
if [ -n "$(env_get PLATFORM_ADMIN_USER)" ]; then ok "PLATFORM_ADMIN_USER already set"
else
  P_USER=${PLATFORM_ADMIN_USER:-}; [ -n "$P_USER" ] || ask P_USER "Operator username" "operator"
  if secret PLATFORM_ADMIN_PASSWORD "Operator password (12+ characters, not shown)"; then
    [ "${#PLATFORM_ADMIN_PASSWORD}" -ge 12 ] || { echo "✗ at least 12 characters"; exit 1; }
    env_put PLATFORM_ADMIN_USER "$P_USER"; env_put PLATFORM_ADMIN_PASSWORD "$PLATFORM_ADMIN_PASSWORD"
    ok "operator $P_USER (created at the first console login; then turn on 2FA and remove PLATFORM_ADMIN_PASSWORD from $ENV_FILE)"
  else warn "skipped: set PLATFORM_ADMIN_USER / PLATFORM_ADMIN_PASSWORD in $ENV_FILE later"; fi
  unset PLATFORM_ADMIN_PASSWORD
fi

# ------------------------------------------------------------------------------------------- 4
step "4/5 First deploy"
bash deploy/yeti/deploy.sh --no-fetch

# ------------------------------------------------------------------------------------------- 5
step "5/5 First cooperative"
# no own domain yet (platform host = Yeti address): the first cooperative shares it — site on /, console on /platform
if [ "$(env_get BASE_DOMAIN)" = "$(env_get PLATFORM_HOST)" ]; then SITE_DEFAULT=$(env_get PLATFORM_HOST); else SITE_DEFAULT="<slug>.$(env_get BASE_DOMAIN)"; fi
if [ -z "$T_SLUG" ] && tty && confirm "Create the first cooperative now (also possible later in the console)?"; then
  ask T_SLUG "Slug (letters/digits, e.g. aakash)"; ask T_NAME "Name (Nepali)"; ask T_NAME_EN "Name (English)"
  ask T_DOMAIN "Its own domain if ready (blank = $SITE_DEFAULT)"
  ask DESIGN "Design: saving_credit | multipurpose | agriculture | women | microfinance" "$DESIGN"
  ask PLAN "Plan: lite | basic | advance | extra" "$PLAN"
fi
if [ -n "$T_SLUG" ]; then
  [ -n "$T_NAME" ] || { echo "✗ --tenant-name is needed with --tenant-slug"; exit 1; }
  if secret ADMIN_PASSWORD "Cooperative admin password (12+ characters, not shown)"; then
    if [ "$(env_get BASE_DOMAIN)" = "$(env_get PLATFORM_HOST)" ]; then SITE_HOST=$(env_get PLATFORM_HOST); else SITE_HOST="$T_SLUG.$(env_get BASE_DOMAIN)"; fi
    domains=(--domain="$SITE_HOST"); [ -n "$T_DOMAIN" ] && domains+=(--domain="$T_DOMAIN")
    ( cd "$(readlink -f /home/jelastic/coop-releases/current)" && ADMIN_PASSWORD="$ADMIN_PASSWORD" node --env-file="$ENV_FILE" scripts/tenant-create.js \
        --slug="$T_SLUG" --name="$T_NAME" ${T_NAME_EN:+--name-en="$T_NAME_EN"} "${domains[@]}" --admin=admin --design="$DESIGN" --plan="$PLAN" )
    ok "cooperative $T_SLUG (admin login: admin)"
  else warn "no password given: skipped (create it in the platform console)"; fi
  unset ADMIN_PASSWORD
fi

pm2 save >/dev/null 2>&1 || true
# one-word commands in Web SSH (like the DMS server): coop-deploy · coop-rollback · coop-status · coop-logs
if ! grep -q 'alias coop-deploy=' "$HOME/.bashrc" 2>/dev/null; then
  cat >> "$HOME/.bashrc" <<'ALIASES'
# cooperative website (docs/YETI.md)
alias coop-deploy='cd /home/jelastic/ROOT && bash deploy/yeti/deploy.sh'
alias coop-rollback='cd /home/jelastic/ROOT && bash deploy/yeti/deploy.sh --rollback'
alias coop-status='pm2 status; curl -fsS http://127.0.0.1:8080/healthz; echo'
alias coop-logs='pm2 logs coop-web --nostream --lines 120'
ALIASES
  ok "commands added to ~/.bashrc: coop-deploy, coop-rollback, coop-status, coop-logs (open a new Web SSH tab)"
fi
printf '\n✓ Yeti set-up complete.\n'
printf '  Platform console: https://%s/platform\n' "$(env_get PLATFORM_HOST)"
[ -n "${SITE_HOST:-}" ] && printf '  Cooperative site: https://%s  (admin: https://%s/admin)\n' "$SITE_HOST" "$SITE_HOST"
printf '  Next releases:    coop-deploy   (Web SSH, new tab)  ·  npm run yeti -- deploy   (your computer)\n'
printf '  Keep a copy of %s (PII_KEY, CREDENTIALS_KEY) in your password manager.\n' "$ENV_FILE"
