#!/bin/sh
# Ensure a TLS certificate exists before nginx starts.
#
# Production: mount a real certificate into /etc/nginx/ssl as fullchain.pem +
# privkey.pem (that is where `make cert` deposits the Let's Encrypt files).
# Development / no cert mounted: generate a self-signed one so HTTPS still
# works locally. Runs from /docker-entrypoint.d before nginx starts.
set -e

SSL_DIR=/etc/nginx/ssl
CRT="$SSL_DIR/fullchain.pem"
KEY="$SSL_DIR/privkey.pem"

if [ ! -s "$CRT" ] || [ ! -s "$KEY" ]; then
  echo "nginx: no certificate at $SSL_DIR — generating a self-signed one (development only)."
  mkdir -p "$SSL_DIR"
  openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout "$KEY" -out "$CRT" \
    -subj "/CN=${SERVER_NAME:-localhost}" 2>/dev/null
else
  echo "nginx: using the certificate mounted at $SSL_DIR."
fi
