#!/bin/bash
# Root-only backup-path selects the archive captured before this deployment.
set -euo pipefail
root=/root/weftmate-deploy
backup=$(cat "$root/backup-path")
sha256sum -c "$backup/nginx.sha256"
tar -tzf "$backup/nginx.tar.gz" >/dev/null
if [[ ${1:-} == --dry-run ]]; then
    nginx -t
    echo 'DRY RUN: archive verified; restore nginx, validate, reload, disable new services. No mutation.'
    exit 0
fi
# Preserve current configuration, then restore exactly, including removed files.
mv /etc/nginx "$root/nginx-replaced-$(date -u +%Y%m%dT%H%M%SZ)"
tar -C / -xzf "$backup/nginx.tar.gz"
nginx -t
systemctl reload nginx
systemctl disable --now weftmate-frps.service weftmate-cloud.service
echo 'Restored nginx; new services disabled; private cloud data retained.'
