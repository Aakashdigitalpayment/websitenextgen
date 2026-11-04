#!/usr/bin/env bash
# Put a new version live on Yeti Cloud (docs/YETI.md). On the Node.js node, from /home/jelastic/ROOT:
#
#   bash deploy/yeti/deploy.sh              fetch origin/main, new release, migrate, switch, health check
#   bash deploy/yeti/deploy.sh --no-fetch   the same with the code already in ROOT (first set-up)
#   bash deploy/yeti/deploy.sh --rollback   back to the previous release (seconds, nothing installed)
#
# Each version is installed in its own folder while the running one keeps serving; `current` moves to the
# new folder only after install + migrations succeed, and moves back by itself when the new version is not
# healthy. Migrations must be additive (add tables/columns), because the running version reads the database
# while the new one migrates it. The last $KEEP releases stay for --rollback.
set -Eeuo pipefail

cd "$(dirname "$0")/../.."
ROOT=$(pwd)
ENV_FILE=${COOP_ENV_FILE:-/home/jelastic/coop.env}
RELEASES=${COOP_RELEASES_DIR:-/home/jelastic/coop-releases}
BACKUPS=${COOP_PREDEPLOY_DIR:-/home/jelastic/coop-backups/pre-deploy}
KEEP=${COOP_KEEP_RELEASES:-3}
BRANCH=${COOP_BRANCH:-main}
PORT=8080
APPS=(coop-web coop-cleanup)

step() { printf '\n==> %s\n' "$*"; }
trap 'printf "\n✗ Stopped (line %s). The running version was not touched unless said above; fix the cause and run again.\n" "$LINENO"' ERR

mkdir -p "$RELEASES"
exec 9>"$RELEASES/.deploy.lock"
flock -n 9 || { echo "✗ Another deploy is running ($RELEASES/.deploy.lock)"; exit 1; }

env_value() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- || true; }
[ -f "$ENV_FILE" ] || { echo "✗ No env file ($ENV_FILE). First: bash deploy/yeti/install.sh --db-host <PostgreSQL node>"; exit 1; }
grep -q '^DATABASE_URL=postgres' "$ENV_FILE" || { echo "✗ DATABASE_URL is missing in $ENV_FILE"; exit 1; }
command -v pm2 >/dev/null || { echo "✗ pm2 not found (use the Node.js pm2 image on Yeti)"; exit 1; }
case "$(env_value UPLOAD_DIR)" in /*) ;; *) echo "✗ UPLOAD_DIR must be an absolute path outside the releases (e.g. /home/jelastic/coop-data/uploads)"; exit 1 ;; esac

switch_to() { ln -sfn "$1" "$RELEASES/.current.new"; mv -Tf "$RELEASES/.current.new" "$RELEASES/current"; }
reload() {
  local where
  where=$(pm2 jlist 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s).find(p=>p.name==="coop-web");console.log(a?a.pm2_env.pm_exec_path:"")}catch{console.log("")}})')
  case "$where" in
    "$RELEASES/current/"*) pm2 startOrReload "$RELEASES/current/ecosystem.config.js" --update-env ;;
    *) pm2 delete "${APPS[@]}" >/dev/null 2>&1 || true; pm2 start "$RELEASES/current/ecosystem.config.js" ;;
  esac
  pm2 save >/dev/null
}
healthy() {
  for _ in $(seq 1 40); do
    curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}
previous_release() {
  local live; live=$(readlink -f "$RELEASES/current" 2>/dev/null || true)
  for d in $(ls -1d "$RELEASES"/r-* 2>/dev/null | sort -r); do
    [ "$(readlink -f "$d")" = "$live" ] && continue
    [ -f "$d/.release-ok" ] && { echo "$d"; return 0; }
  done
  return 1
}

if [ "${1:-}" = "--rollback" ]; then
  step "Rollback"
  prev=$(previous_release) || { echo "✗ No earlier release"; exit 1; }
  echo "  from: $(readlink -f "$RELEASES/current")"; echo "  to:   $prev"
  switch_to "$prev"; reload
  healthy || { echo "✗ The previous release did not come up either: pm2 logs --lines 80 --nostream"; exit 1; }
  printf '\n✓ Back on: %s (migrations are not undone; they are additive)\n' "$(cat "$prev/.release-ok")"
  exit 0
fi

if [ "${1:-}" != "--no-fetch" ]; then
  step "Code: origin/$BRANCH"
  before=$(git hash-object deploy/yeti/deploy.sh)
  git fetch origin "$BRANCH" --tags
  git reset --hard "origin/$BRANCH"
  if [ "$(git hash-object deploy/yeti/deploy.sh)" != "$before" ]; then echo "  deploy.sh changed: continuing with the new one"; exec bash deploy/yeti/deploy.sh --no-fetch; fi
fi
SHA=$(git rev-parse --short HEAD)
git log -1 --oneline

step "Unfinished releases from earlier runs"
live=$(readlink -f "$RELEASES/current" 2>/dev/null || true)
for d in "$RELEASES"/r-*; do
  [ -e "$d" ] || continue
  [ "$(readlink -f "$d")" = "$live" ] || [ -f "$d/.release-ok" ] || { rm -rf "$d" && echo "  removed $(basename "$d")"; }
done

step "Disk"
free_kb=$(df -Pk "$RELEASES" | awk 'NR==2 {print $4}')
echo "  free: $((free_kb / 1024)) MB"
[ "$free_kb" -gt 800000 ] || { echo "✗ Less than 800 MB free: clean pm2 logs / $BACKUPS first"; exit 1; }

RELEASE="$RELEASES/r-$(date +%Y%m%d-%H%M%S)-$SHA"
step "New release: $RELEASE (the running version keeps serving)"
mkdir -p "$RELEASE"
git archive HEAD | tar -x -C "$RELEASE"
cd "$RELEASE"

step "Packages (npm ci, production only)"
npm ci --omit=dev --no-audit --no-fund
node -e "require('sharp')" 2>/dev/null && echo "  ✓ sharp (8K image variants)" || echo "  ! sharp did not load: photos are served as uploaded until it does"

step "Database copy before the migrations"
if command -v pg_dump >/dev/null; then
  mkdir -p "$BACKUPS" && chmod 700 "$BACKUPS"
  dump="$BACKUPS/before-$(basename "$RELEASE").dump"
  pg_dump --format=custom --no-owner --file="$dump" "$(env_value DATABASE_URL)"
  chmod 600 "$dump"; echo "  $dump ($(du -h "$dump" | cut -f1))"
  ls -1t "$BACKUPS"/before-*.dump 2>/dev/null | tail -n +4 | xargs -r rm -f
else
  echo "  ! pg_dump is not on this node: for data-changing releases take a dump on the PostgreSQL node first"
fi

step "Migrations (platform + every cooperative; additive)"
node --env-file="$ENV_FILE" scripts/migrate.js

step "Data folders"
mkdir -p "$(env_value UPLOAD_DIR)" && echo "  UPLOAD_DIR → $(env_value UPLOAD_DIR)"

step "Log rotation"
if pm2 jlist 2>/dev/null | grep -q '"name":"pm2-logrotate"' || pm2 install pm2-logrotate >/dev/null 2>&1; then
  pm2 set pm2-logrotate:max_size 20M >/dev/null; pm2 set pm2-logrotate:retain 14 >/dev/null; pm2 set pm2-logrotate:compress true >/dev/null
  echo "  pm2-logrotate: 20 MB × 14, compressed"
else echo "  ! pm2-logrotate could not be installed: logs are not rotated yet"; fi

step "Switch"
prev=$(readlink -f "$RELEASES/current" 2>/dev/null || true)
printf '%s %s\n' "$SHA" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$RELEASE/.release-ok"
switch_to "$RELEASE"
reload

step "Health check"
if ! healthy; then
  echo "✗ The new release is not healthy."
  if [ -n "$prev" ] && [ -d "$prev" ]; then
    rm -f "$RELEASE/.release-ok"; switch_to "$prev"; reload
    healthy && echo "  The previous release is serving again. Why: pm2 logs coop-web --lines 120 --nostream"
  fi
  exit 1
fi
echo "  /healthz → $(curl -fsS "http://127.0.0.1:$PORT/healthz")"
pm2 status

step "Old releases (the last $KEEP stay)"
for d in $(ls -1d "$RELEASES"/r-* 2>/dev/null | sort -r); do [ -f "$d/.release-ok" ] && echo "$d"; done | tail -n +"$((KEEP + 1))" | while read -r old; do
  [ "$(readlink -f "$old")" = "$(readlink -f "$RELEASES/current")" ] || { rm -rf "$old" && echo "  removed $(basename "$old")"; }
done
git -C "$ROOT" tag -f "deploy-$(date +%Y%m%d-%H%M)" HEAD >/dev/null 2>&1 || true
printf '\n✓ Live: %s\n' "$(git -C "$ROOT" log -1 --format='%h %s')"
