FROM nginx:alpine

# openssl is used by the entrypoint to generate a self-signed fallback cert
# when no real certificate is mounted. Real certs are provided at runtime
# (see nginx/entrypoint.sh and `make cert`), not baked into the image.
RUN apk add --no-cache openssl

COPY entrypoint.sh /docker-entrypoint.d/40-ensure-cert.sh
RUN chmod +x /docker-entrypoint.d/40-ensure-cert.sh
