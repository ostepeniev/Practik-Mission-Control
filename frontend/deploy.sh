#!/bin/bash
# Deploy Practik Dashboard to server
# Run from: d:\Antigraviti\Practik Dashboard\frontend\

set -e

SERVER="root@46.225.132.220"
REMOTE_DIR="/root/projects/practik-dashboard"

echo "📦 Deploying Practik Dashboard..."

# Create directory
ssh $SERVER "mkdir -p $REMOTE_DIR"

# Upload files (exclude node_modules, .next, .db)
scp -r ./app ./lib ./public ./package.json ./package-lock.json ./next.config.mjs ./practik-dashboard.service $SERVER:$REMOTE_DIR/

# Build and restart on server
ssh $SERVER << 'ENDSSH'
cd /root/projects/practik-dashboard

# Create .env if missing
if [ ! -f .env ]; then
  cat > .env << 'EOF'
NODE_ENV=production
PORT=3002
JWT_SECRET=practik-dashboard-jwt-secret-2026
EOF
fi

# Install and build
npm ci
npm run build

# Restart service
cp practik-dashboard.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable practik-dashboard
systemctl restart practik-dashboard
echo "✅ Practik Dashboard deployed!"
systemctl status practik-dashboard --no-pager
ENDSSH
