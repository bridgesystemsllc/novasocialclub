#!/usr/bin/env bash
set -euo pipefail

# Nova Social Club - Postgres Backup Script
# Usage: ./scripts/backup-postgres.sh
# Requires: DATABASE_URL environment variable

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Error: DATABASE_URL environment variable is not set." >&2
  echo "Set it to your Postgres connection string before running this script." >&2
  exit 1
fi

BACKUP_DIR="backups"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/nova-${TIMESTAMP}.dump"

mkdir -p "$BACKUP_DIR"

echo "Backing up database to ${BACKUP_FILE}..."

if pg_dump "$DATABASE_URL" -Fc -f "$BACKUP_FILE"; then
  echo "Backup complete: ${BACKUP_FILE}"
  ls -lh "$BACKUP_FILE"
else
  echo "Error: pg_dump failed." >&2
  exit 1
fi
