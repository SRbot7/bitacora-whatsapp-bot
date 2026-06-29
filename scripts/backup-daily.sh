#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="$(date +%Y%m%d_%H%M%S)"

LOCAL_BACKUP_DIR="${LOCAL_BACKUP_DIR:-$ROOT_DIR/backups}"
EXTERNAL_BACKUP_DIR="${EXTERNAL_BACKUP_DIR:-/srv/storage/backups/bitacora-mtto}"
LOG_DIR="${LOG_DIR:-$ROOT_DIR/logs}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

DB_CONTAINER="${DB_CONTAINER:-postgres-operaciones}"
DB_USER="${DB_USER:-admin}"
DB_NAME="${DB_NAME:-operaciones}"

mkdir -p "$LOCAL_BACKUP_DIR" "$EXTERNAL_BACKUP_DIR" "$LOG_DIR"

if [[ -f "$ROOT_DIR/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$ROOT_DIR/.env"
    set +a
fi

SQL_FILE="$LOCAL_BACKUP_DIR/operaciones_${STAMP}.sql"
PROJECT_TAR="$LOCAL_BACKUP_DIR/bitacora-mtto_${STAMP}.tar.gz"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

log "Iniciando respaldo de base de datos"
docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" > "$SQL_FILE"

log "Creando respaldo comprimido del proyecto"
tar \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='backups' \
    -czf "$PROJECT_TAR" \
    -C "$ROOT_DIR" .

log "Copiando respaldos a almacenamiento externo"
cp -f "$SQL_FILE" "$PROJECT_TAR" "$EXTERNAL_BACKUP_DIR/"

log "Aplicando retencion de ${RETENTION_DAYS} dias"
find "$LOCAL_BACKUP_DIR" -type f \( -name 'operaciones_*.sql' -o -name 'bitacora-mtto_*.tar.gz' \) -mtime +"$RETENTION_DAYS" -delete
find "$EXTERNAL_BACKUP_DIR" -type f \( -name 'operaciones_*.sql' -o -name 'bitacora-mtto_*.tar.gz' \) -mtime +"$RETENTION_DAYS" -delete

log "Respaldo completado"
log "SQL: $SQL_FILE"
log "TAR: $PROJECT_TAR"
