#!/usr/bin/env bash
# One command from your computer (or CI) to Yeti Cloud, through the Jelastic SSH gate (docs/YETI.md):
#
#   npm run yeti -- setup --db-host nodeNNNNN-…   first time: deploy key, clone, database, env, deploy, first co-op
#   npm run yeti -- deploy                        every release: fetch main, install, migrate, switch, health check
#   npm run yeti -- rollback                      previous release (seconds)
#   npm run yeti -- status | logs [N] | ssh       pm2 status + health / last N log lines / a shell on the node
#
# Where to connect: YETI_SSH as shown in the dashboard (Node.js node → Web SSH ▾ → SSH tab), e.g.
#   YETI_SSH="12345-67890@gate.ktm.yetiappcloud.com -p 3022"
# once in deploy/yeti/remote.env (git-ignored). Your SSH public key must be in the dashboard (account → SSH Keys).
set -Eeuo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck disable=SC1091
[ -f "$HERE/remote.env" ] && . "$HERE/remote.env"
: "${YETI_SSH:?set YETI_SSH (dashboard → Web SSH ▾ → SSH), e.g. YETI_SSH=\"12345-67890@gate.ktm.yetiappcloud.com -p 3022\" — or put it in deploy/yeti/remote.env}"
read -r -a TARGET <<< "$YETI_SSH"
SSH_OPTS=(-o ServerAliveInterval=30 -o ServerAliveCountMax=10)
[ -n "${YETI_SSH_KEY_FILE:-}" ] && SSH_OPTS+=(-i "$YETI_SSH_KEY_FILE")
[ "${YETI_STRICT:-1}" = 0 ] && SSH_OPTS+=(-o StrictHostKeyChecking=accept-new)
TT=(); [ -t 0 ] && [ -t 1 ] && TT=(-t)   # a terminal for the hidden password prompts
ROOT=/home/jelastic/ROOT

run() { ssh "${SSH_OPTS[@]}" "${TT[@]}" "${TARGET[@]}" "$@"; }
quote() { [ $# -gt 0 ] && printf '%q ' "$@"; return 0; }

cmd=${1:-deploy}; shift || true
case "$cmd" in
  setup)
    # bootstrap.sh needs nothing on the server; an optional GitHub token travels inside the copied file
    # (umask 077, removed afterwards), never on a command line
    { [ -n "${GITHUB_TOKEN:-}" ] && printf 'export GITHUB_TOKEN=%q\n' "$GITHUB_TOKEN"; cat "$HERE/bootstrap.sh"; } |
      ssh "${SSH_OPTS[@]}" "${TARGET[@]}" 'umask 077; cat > /tmp/coop-bootstrap.sh'
    run "bash /tmp/coop-bootstrap.sh $(quote "$@"); s=\$?; rm -f /tmp/coop-bootstrap.sh; exit \$s"
    ;;
  deploy)   run "cd $ROOT && bash deploy/yeti/deploy.sh $(quote "$@")" ;;
  rollback) run "cd $ROOT && bash deploy/yeti/deploy.sh --rollback" ;;
  status)   run "pm2 status; curl -fsS http://127.0.0.1:8080/healthz; echo; cd $ROOT && git log -1 --oneline; readlink -f /home/jelastic/coop-releases/current" ;;
  logs)     run "pm2 logs coop-web --nostream --lines $(printf %q "${1:-80}")" ;;
  ssh)      run ;;
  *) sed -n '2,12p' "$0"; exit 1 ;;
esac
