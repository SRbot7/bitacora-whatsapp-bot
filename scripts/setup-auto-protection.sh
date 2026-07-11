#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"
BACKUP_SCRIPT="$ROOT_DIR/scripts/backup-daily.sh"
PM2_BIN="$(command -v pm2 || true)"

mkdir -p "$LOG_DIR"

if [[ ! -x "$BACKUP_SCRIPT" ]]; then
    chmod +x "$BACKUP_SCRIPT"
fi

if [[ -z "$PM2_BIN" ]]; then
    echo "No se encontro pm2 en PATH. Instala pm2 o ajusta PATH antes de continuar."
    exit 1
fi

TMP_CRON="$(mktemp)"
crontab -l 2>/dev/null | grep -v 'bitacora-mtto auto backup' | grep -v 'bitacora-mtto pm2 resurrect' > "$TMP_CRON" || true

echo "30 2 * * * $BACKUP_SCRIPT >> $LOG_DIR/backup-cron.log 2>&1 # bitacora-mtto auto backup" >> "$TMP_CRON"
echo "@reboot $PM2_BIN resurrect >> $LOG_DIR/pm2-resurrect.log 2>&1 # bitacora-mtto pm2 resurrect" >> "$TMP_CRON"

crontab "$TMP_CRON"
rm -f "$TMP_CRON"

echo "Cron configurado. Tareas activas:"
crontab -l
