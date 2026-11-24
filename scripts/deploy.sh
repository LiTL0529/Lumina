#!/usr/bin/env bash
set -euo pipefail

# One-command production deployment script for Lumina Supply-Chain Traceability & ERP
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/LiTL0529/beauty/main/scripts/deploy.sh | bash
#   Or inside cloned repo: bash scripts/deploy.sh

APP_DIR="${APP_DIR:-/opt/lumina-beauty}"
REPO_URL="${REPO_URL:-https://github.com/LiTL0529/beauty.git}"
PUBLIC_HOST="${PUBLIC_HOST:-39.106.59.4}"
WEB_PORT="${WEB_PORT:-}"

echo "============================================================"
echo "  Lumina 品牌供销溯源与轻量化 ERP - 生产一键部署脚本"
echo "============================================================"

# 1. Install Docker + Compose plugin if missing
if ! command -v docker >/dev/null 2>&1; then
  echo "📦 Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "❌ Docker Compose v2 plugin not found. Please install docker-compose-plugin."
  exit 1
fi

# 2. Clone or update repository
if [ -d "$APP_DIR/.git" ]; then
  echo "🔄 Updating existing repo in $APP_DIR..."
  git -C "$APP_DIR" fetch origin main
  git -C "$APP_DIR" reset --hard origin/main
else
  echo "📥 Cloning repository into $APP_DIR..."
  mkdir -p "$(dirname "$APP_DIR")"
  git clone --depth 1 "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"

# 3. Auto-detect port 80 availability if WEB_PORT not specified
if [ -z "$WEB_PORT" ]; then
  if ss -tln 2>/dev/null | awk '{print $4}' | grep -Eq '(:80$|\.80$)' && ! docker ps --format '{{.Names}}' | grep -q '^lumina-prod-web$'; then
    echo "⚠️  Port 80 is already occupied by another service; defaulting Lumina to port 8088."
    WEB_PORT="8088"
  else
    WEB_PORT="80"
  fi
fi

PORT_SUFFIX=""
if [ "$WEB_PORT" != "80" ]; then
  PORT_SUFFIX=":${WEB_PORT}"
fi

# 4. Generate .env.prod once with strong random secrets
if [ ! -f ".env.prod" ]; then
  echo "🔐 Generating .env.prod with cryptographic random secrets..."
  RAND_PG=$(openssl rand -hex 12)
  RAND_JWT=$(openssl rand -hex 24)
  RAND_HMAC=$(openssl rand -hex 24)
  cat > .env.prod <<EOF
POSTGRES_USER=lumina
POSTGRES_PASSWORD=${RAND_PG}
POSTGRES_DB=lumina_beauty
JWT_SECRET=${RAND_JWT}
JWT_EXPIRES_IN=7d
TRACE_HMAC_SECRET=${RAND_HMAC}
VERIFY_BASE_URL=http://${PUBLIC_HOST}${PORT_SUFFIX}/v
WEB_PORT=${WEB_PORT}
SEED_ON_BOOT=true
EOF
else
  echo "✅ Keeping existing .env.prod (updating WEB_PORT=${WEB_PORT} if needed)..."
fi

# 5. Build and launch full stack
echo "🐳 Building and starting PostgreSQL, Redis, API, and Web containers..."
docker compose --env-file .env.prod -f docker/docker-compose.prod.yml up -d --build

# 6. Wait for API readiness
echo "⏳ Waiting for API & database initialization..."
for i in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${WEB_PORT}/api/v1/auth/demo-accounts" >/dev/null 2>&1; then
    echo ""
    echo "============================================================"
    echo "🎉 部署成功！所有服务运行健康："
    echo "   PC 品牌总控 & 仓管端 : http://${PUBLIC_HOST}${PORT_SUFFIX}/"
    echo "   C端扫码防伪验真页    : http://${PUBLIC_HOST}${PORT_SUFFIX}/v"
    echo "   外勤销售移动工作台   : http://${PUBLIC_HOST}${PORT_SUFFIX}/m/workbench"
    echo "   演示账号(密码123456) : admin / hq_warehouse / dealer_nc / sales_nc"
    echo "============================================================"
    exit 0
  fi
  sleep 2
done

echo "⚠️  Containers started, checking recent API logs:"
docker logs --tail 40 lumina-prod-api
exit 1
