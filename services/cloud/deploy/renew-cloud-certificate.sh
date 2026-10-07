#!/bin/sh
# Certbot deploy hook; other certificate lineages do not restart these services.
set -eu
if [ "${RENEWED_LINEAGE:-}" = /etc/letsencrypt/live/weftmate-cloud ]; then
    nginx -t
    systemctl reload nginx
    # LoadCredential takes a snapshot at service start, so restart after renewal.
    systemctl try-restart weftmate-frps.service
fi
