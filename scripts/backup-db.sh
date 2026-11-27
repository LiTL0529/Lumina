#!/usr/bin/env bash
set -euo pipefail

BACKUP_ROOT="/opt/lumina-beauty/backups"
RETENTION_DAYS=14
DAY="$(date +%F)"
TS="$(date +%Y%m%d_%H%M%S)"
DEST="${BACKUP_ROOT}/${DAY}"

mkdir -p "${DEST}"
chmod 700 "${BACKUP_ROOT}" "${DEST}"

OUT_FILE="${DEST}/lumina_beauty_${TS}.dump"
su - postgres -c "pg_dump -Fc -d lumina_beauty" > "${OUT_FILE}"
chmod 600 "${OUT_FILE}"

SIZE="$(stat -c%s "${OUT_FILE}")"
if [ "${SIZE}" -lt 1024 ]; then
  echo "[$(date '+%F %T')] ERROR: backup file too small (${SIZE} bytes): ${OUT_FILE}" >&2
  exit 1
fi

# Verify archive integrity via pg_restore --list
pg_restore --list "${OUT_FILE}" > /dev/null

# Rolling cleanup of backups older than RETENTION_DAYS
find "${BACKUP_ROOT}" -mindepth 1 -maxdepth 1 -type d -mtime "+${RETENTION_DAYS}" -exec rm -rf {} +

echo "[$(date '+%F %T')] OK: lumina_beauty backed up to ${OUT_FILE} (${SIZE} bytes)"
