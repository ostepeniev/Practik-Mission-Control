#!/bin/bash
# Setup SSL for Practik Dashboard
# Run on the server: bash setup-ssl.sh

set -e

DOMAIN="practik.swipescape.eu"
NGINX_CONF="/etc/nginx/sites-available/practik-dashboard"

echo "🔒 Setting up SSL for $DOMAIN..."

# Install certbot if not present
if ! command -v certbot &> /dev/null; then
    apt-get update
    apt-get install -y certbot python3-certbot-nginx
fi

# Get SSL certificate
certbot --nginx -d $DOMAIN --non-interactive --agree-tos --email admin@swipescape.eu --redirect

# Update nginx config for better security
cat > $NGINX_CONF << 'NGINX'
server {
    listen 80;
    server_name practik.swipescape.eu;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name practik.swipescape.eu;

    ssl_certificate /etc/letsencrypt/live/practik.swipescape.eu/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/practik.swipescape.eu/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # Security headers
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    location / {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
NGINX

# Test and reload
nginx -t && systemctl reload nginx

# Setup auto-renewal cron
(crontab -l 2>/dev/null; echo "0 3 * * 0 certbot renew --quiet --post-hook 'systemctl reload nginx'") | crontab -

echo "✅ SSL configured for $DOMAIN"
echo "🔄 Auto-renewal enabled (every Sunday 3:00 AM)"
