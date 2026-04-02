#!/bin/bash
# ============================================
# Practik Dashboard — Backup Script
# ============================================
# Run: bash backup.sh [daily|weekly|manual]
# Cron: 0 3 * * * /path/to/backup.sh daily
# ============================================

set -euo pipefail

BACKUP_TYPE="${1:-daily}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
APP_DIR="${APP_DIR:-/opt/practik-dashboard/frontend}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/practik}"
RETAIN_DAILY=7
RETAIN_WEEKLY=4

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log() { echo -e "${GREEN}[BACKUP]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Create backup directory
DEST="${BACKUP_DIR}/${BACKUP_TYPE}"
mkdir -p "$DEST"

# ─── SQLite Backup ───
SQLITE_DB="${APP_DIR}/data/practik.db"
if [ -f "$SQLITE_DB" ]; then
  BACKUP_FILE="${DEST}/practik_${TIMESTAMP}.db"
  log "Backing up SQLite: ${SQLITE_DB}"
  
  # Use .backup command for consistent snapshot
  sqlite3 "$SQLITE_DB" ".backup '${BACKUP_FILE}'"
  
  # Compress
  gzip "$BACKUP_FILE"
  log "SQLite backup: ${BACKUP_FILE}.gz ($(du -h "${BACKUP_FILE}.gz" | cut -f1))"
else
  warn "SQLite DB not found at ${SQLITE_DB}"
fi

# ─── PostgreSQL Backup (if configured) ───
if [ -n "${DATABASE_URL:-}" ]; then
  PG_BACKUP="${DEST}/practik_pg_${TIMESTAMP}.sql"
  log "Backing up PostgreSQL..."
  pg_dump "$DATABASE_URL" --no-owner --no-acl > "$PG_BACKUP"
  gzip "$PG_BACKUP"
  log "PostgreSQL backup: ${PG_BACKUP}.gz ($(du -h "${PG_BACKUP}.gz" | cut -f1))"
fi

# ─── Environment backup ───
ENV_FILE="${APP_DIR}/.env.local"
if [ -f "$ENV_FILE" ]; then
  cp "$ENV_FILE" "${DEST}/env_${TIMESTAMP}.enc"
  log "Environment backed up"
fi

# ─── Cleanup old backups ───
cleanup_old() {
  local dir="$1"
  local keep="$2"
  local count
  count=$(ls -1 "$dir" 2>/dev/null | wc -l)
  if [ "$count" -gt "$keep" ]; then
    ls -1t "$dir" | tail -n +"$((keep + 1))" | while IFS= read -r f; do
      rm -f "${dir}/${f}"
      log "Removed old backup: $f"
    done
  fi
}

if [ "$BACKUP_TYPE" = "daily" ]; then
  cleanup_old "$DEST" "$RETAIN_DAILY"
elif [ "$BACKUP_TYPE" = "weekly" ]; then
  cleanup_old "$DEST" "$RETAIN_WEEKLY"
fi

# ─── Verification ───
LATEST=$(ls -1t "$DEST" 2>/dev/null | head -1)
if [ -n "$LATEST" ]; then
  SIZE=$(du -h "${DEST}/${LATEST}" | cut -f1)
  log "✅ Backup completed: ${LATEST} (${SIZE})"
else
  error "❌ No backup file created!"
  exit 1
fi

# ─── Summary ───
echo ""
echo "════════════════════════════════════════"
echo "  Backup Summary"
echo "════════════════════════════════════════"
echo "  Type:      $BACKUP_TYPE"
echo "  Timestamp: $TIMESTAMP"
echo "  Location:  $DEST"
echo "  Files:     $(ls -1 "$DEST" | wc -l)"
echo "════════════════════════════════════════"
echo ""
echo "To restore:"
echo "  gunzip ${DEST}/${LATEST}"
echo "  cp ${DEST}/practik_*.db ${SQLITE_DB}"
echo "  # or: psql \$DATABASE_URL < ${DEST}/practik_pg_*.sql"
echo ""

# ─── Cron setup instructions ───
# Add to crontab (crontab -e):
#   Daily at 3 AM:
#   0 3 * * * /opt/practik-dashboard/backup.sh daily >> /var/log/practik-backup.log 2>&1
#
#   Weekly on Sunday at 4 AM:
#   0 4 * * 0 /opt/practik-dashboard/backup.sh weekly >> /var/log/practik-backup.log 2>&1
