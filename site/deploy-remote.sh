#!/usr/bin/env bash
# 在目标服务器执行：原子替换落地页，并安全接入现有 nginx / Let's Encrypt。
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

SOURCE_FILE="${1:-/tmp/weftmate-index.html}"
SITE_ROOT="${SITE_ROOT:-/var/www/weftmate}"
SITE_NAME="${SITE_NAME:-weftmate}"
DOMAIN="${DOMAIN:-weftmate.com}"
CONF="/etc/nginx/sites-available/${SITE_NAME}"
CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"

if [[ ! -f "$SOURCE_FILE" ]]; then
  echo "找不到待部署页面：$SOURCE_FILE" >&2
  exit 1
fi

if ! command -v nginx >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq
    apt-get install -y -qq nginx
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y -q nginx
  elif command -v yum >/dev/null 2>&1; then
    yum install -y -q nginx
  else
    echo "未找到 apt、dnf 或 yum，无法自动安装 nginx。" >&2
    exit 1
  fi
fi

install -d -m 0755 "$SITE_ROOT"
if [[ -f "$SITE_ROOT/index.html" ]]; then
  install -m 0644 "$SITE_ROOT/index.html" "$SITE_ROOT/index.html.backup-${STAMP}"
fi
install -m 0644 "$SOURCE_FILE" "$SITE_ROOT/.index.html.new"
mv -f "$SITE_ROOT/.index.html.new" "$SITE_ROOT/index.html"

if [[ -f "$CONF" ]]; then
  install -m 0644 "$CONF" "${CONF}.backup-${STAMP}"
fi

if [[ -f "$CERT_DIR/fullchain.pem" && -f "$CERT_DIR/privkey.pem" ]]; then
  cat >"$CONF" <<NGINX
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    root $SITE_ROOT;
    index index.html;

    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header X-Frame-Options SAMEORIGIN always;

    location / { try_files \$uri \$uri/ =404; }
}

server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN www.$DOMAIN;
    return 301 https://$DOMAIN\$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name $DOMAIN www.$DOMAIN;
    root $SITE_ROOT;
    index index.html;

    ssl_certificate $CERT_DIR/fullchain.pem;
    ssl_certificate_key $CERT_DIR/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header X-Frame-Options SAMEORIGIN always;

    location / { try_files \$uri \$uri/ =404; }
}
NGINX
else
  cat >"$CONF" <<NGINX
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _ $DOMAIN www.$DOMAIN;
    root $SITE_ROOT;
    index index.html;

    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header X-Frame-Options SAMEORIGIN always;

    location / { try_files \$uri \$uri/ =404; }
}
NGINX
fi

ln -sfn "$CONF" "/etc/nginx/sites-enabled/${SITE_NAME}"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx >/dev/null 2>&1 || true
if systemctl is-active --quiet nginx; then
  systemctl reload nginx
else
  systemctl start nginx
fi

echo "部署完成：http://服务器IP/ 以及 https://${DOMAIN}/"
