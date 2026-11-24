#!/bin/sh
set -e

cd /app/apps/api

echo "⏳ Syncing PostgreSQL schema via Prisma..."
./node_modules/.bin/prisma db push --skip-generate

if [ "${SEED_ON_BOOT:-true}" = "true" ]; then
  echo "🌱 Running idempotent seed script..."
  ./node_modules/.bin/tsx prisma/seed.ts || true
fi

echo "🚀 Starting Lumina API server..."
exec node dist/main.js
