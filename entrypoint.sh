#!/bin/sh
set -e

echo "[ENTRYPOINT] Setting up environment..."

# โหลด environment (หากจำเป็น)
if [ -f ./docker.env ]; then
  export $(grep -v '^#' ./docker.env | xargs)
fi

#Run Prisma migration deploy
echo "[ENTRYPOINT] Running Prisma Migrations..."
npx prisma migrate deploy

#Start the app
echo "[ENTRYPOINT] Starting application..."
exec "$@"