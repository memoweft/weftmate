#!/bin/bash
# Upgrade rollback restores a stopped, complete StateDirectory snapshot.
# Backups contain private data and must stay under the root-only deploy directory.
set -euo pipefail
umask 077
backup=${1:?Usage: rollback-upgrade.sh /root/weftmate-deploy/dep-1-backup-TIMESTAMP [--dry-run]}
if [[ $# -gt 2 || ( $# -eq 2 && $2 != --dry-run ) ]]; then exit 2; fi
backup=$(realpath "$backup")
case "$backup" in /root/weftmate-deploy/dep-1-backup-*) ;; *) exit 2 ;; esac
test "$(stat -c '%a %U' "$backup")" = '700 root'
(cd "$backup"; sha256sum -c SHA256SUMS)
old=$(<"$backup/old-release")
case "$old" in /opt/weftmate-cloud/releases/*) ;; *) exit 2 ;; esac
test -f "$old/src/main.mjs"
for archive in config current-link state; do tar -tzf "$backup/$archive.tar.gz" >/dev/null; done
if [[ ${2:-} == --dry-run ]]; then
  scratch=$(mktemp -d "$backup/dry-run.XXXXXX")
  trap 'rm -rf -- "$scratch"' EXIT
  tar -C "$scratch" -xzf "$backup/state.tar.gz"
  python3 - "$scratch/weftmate-cloud/cloud.sqlite" <<'PY'
import sqlite3, sys
db = sqlite3.connect('file:' + sys.argv[1] + '?mode=ro', uri=True)
assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
print('DRY RUN: complete state archive extracted; SQLite integrity_check=ok')
PY
  nginx -t
  printf 'DRY RUN: restore release %s, state, nginx, env, frps and units; restart cloud/frps. No live mutation.\n' "$old"
  exit 0
fi
nginx -t
systemctl stop weftmate-frps weftmate-cloud
stamp=$(date -u +%Y%m%dT%H%M%SZ)
mv /var/lib/private/weftmate-cloud "$backup/state-replaced-$stamp"
tar --acls --xattrs --numeric-owner -C /var/lib/private -xzf "$backup/state.tar.gz"
mv /etc/nginx "$backup/nginx-replaced-$stamp"
tar -C / -xzf "$backup/config.tar.gz"
if test -f "$backup/journal-config-absent"; then rm -f /etc/systemd/journald@weftmate-cloud.conf; fi
ln -sfn "$old" /opt/weftmate-cloud/current
nginx -t
systemctl daemon-reload
systemctl reload nginx
systemctl start weftmate-cloud
for attempt in {1..30}; do
  if curl -fsS http://127.0.0.1:8787/healthz 2>/dev/null; then break; fi
  sleep 1
done
curl -fsS http://127.0.0.1:8787/healthz
systemctl start weftmate-frps
systemctl is-active weftmate-cloud weftmate-frps nginx
printf 'Restored release %s and complete pre-upgrade state/configuration.\n' "$old"
