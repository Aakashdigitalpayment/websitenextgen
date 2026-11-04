#!/usr/bin/env bash
# Fresh Yeti Node.js (pm2) container → running site, in one go (docs/YETI.md).
# Needs nothing on the server: `npm run yeti -- setup` copies this file over SSH and runs it (it can also be
# pasted into Web SSH). Safe to run again.
#
#   bash bootstrap.sh [--repo owner/name] [--branch main] [install.sh options…]
#
# 1. read-only deploy key ~/.ssh/coopweb_deploy + Host alias github-coopweb (port 443). With $GITHUB_TOKEN
#    (allowed to manage this repo's deploy keys) it is added on GitHub automatically; otherwise it is shown
#    and the script waits until you have added it (GitHub → repo → Settings → Deploy keys).
# 2. clone into /home/jelastic/ROOT (the old ROOT is moved aside only after the clone succeeded).
# 3. bash deploy/yeti/install.sh with the remaining options.
set -Eeuo pipefail

REPO=Aakashdigitalpayment/websitenextgen; BRANCH=main; PASS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO=$2; shift 2 ;;
    --branch) BRANCH=$2; shift 2 ;;
    *) PASS+=("$1"); shift ;;
  esac
done
HOME_DIR=/home/jelastic; [ -d "$HOME_DIR" ] || HOME_DIR=$HOME
ROOT="$HOME_DIR/ROOT"
KEY="$HOME/.ssh/coopweb_deploy"
ALIAS=github-coopweb
step() { printf '\n==> %s\n' "$*"; }
trap 'printf "\n✗ Stopped (line %s). Run the same command again after fixing the cause.\n" "$LINENO"' ERR

step "Deploy key (read-only, $REPO only)"
mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
[ -f "$KEY" ] || ssh-keygen -q -t ed25519 -C "yeti coopweb deploy" -f "$KEY" -N ""
chmod 600 "$KEY"
grep -q "^Host $ALIAS\$" "$HOME/.ssh/config" 2>/dev/null || \
  printf 'Host %s\n  HostName ssh.github.com\n  Port 443\n  User git\n  IdentityFile %s\n  IdentitiesOnly yes\n' "$ALIAS" "$KEY" >> "$HOME/.ssh/config"
chmod 600 "$HOME/.ssh/config"
# GitHub's published Ed25519 host key (SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU), so no "yes" prompt
grep -q '^\[ssh.github.com\]:443 ssh-ed25519' "$HOME/.ssh/known_hosts" 2>/dev/null || \
  echo '[ssh.github.com]:443 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl' >> "$HOME/.ssh/known_hosts"

can_read() { ssh -o BatchMode=yes -o ConnectTimeout=15 -T "git@$ALIAS" 2>&1 | grep -q "successfully authenticated"; }
if can_read; then echo "  ✓ GitHub accepts the key"
else
  pub=$(cat "$KEY.pub")
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $GITHUB_TOKEN" -H 'Accept: application/vnd.github+json' \
      "https://api.github.com/repos/$REPO/keys" -d "{\"title\":\"Yeti server $(hostname)\",\"key\":\"$pub\",\"read_only\":true}" || echo 000)
    case "$code" in 201) echo "  ✓ deploy key added on GitHub" ;; 422) echo "  · the key is already on GitHub" ;; *) echo "  ! GitHub API answered $code: add the key by hand (below)" ;; esac
  fi
  if ! can_read; then
    printf '\n  Add this key: GitHub → %s → Settings → Deploy keys → Add deploy key\n  (title "Yeti server", Allow write access OFF)\n\n%s\n\n' "$REPO" "$pub"
    if [ -t 0 ]; then read -rp "  Press Enter once it is added… " _; else echo "  (no terminal: waiting up to 10 minutes)"; fi
    for _ in $(seq 1 60); do can_read && break; sleep 10; done
    can_read || { echo "✗ GitHub still refuses the key"; exit 1; }
    echo "  ✓ GitHub accepts the key"
  fi
fi

step "Code → $ROOT ($BRANCH)"
if git -C "$ROOT" rev-parse HEAD >/dev/null 2>&1 && git -C "$ROOT" remote get-url origin 2>/dev/null | grep -q "${REPO#*/}"; then
  git -C "$ROOT" fetch origin "$BRANCH" && git -C "$ROOT" reset --hard "origin/$BRANCH"
  echo "  ✓ existing checkout updated"
else
  rm -rf "$ROOT.new"
  git clone --branch "$BRANCH" "git@$ALIAS:$REPO.git" "$ROOT.new"
  [ -d "$ROOT" ] && mv "$ROOT" "$ROOT.sample.$(date +%s)"
  mv "$ROOT.new" "$ROOT"
  echo "  ✓ cloned (Yeti's sample app moved aside)"
fi
git -C "$ROOT" log -1 --oneline

step "Install"
exec bash "$ROOT/deploy/yeti/install.sh" "${PASS[@]}"
