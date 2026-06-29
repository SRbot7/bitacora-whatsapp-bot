#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"
BACKUP_SCRIPT="$ROOT_DIR/scripts/backup-daily.sh"

mkdir -p "$LOG_DIR"

if [[ ! -x "$BACKUP_SCRIPT" ]]; then
    chmod +x "$BACKUP_SCRIPT"
fi

TMP_CRON="$(mktemp)"
crontab -l 2>/dev/null | grep -v 'bitacora-mtto auto backup' | grep -v 'bitacora-mtto pm2 resurrect' > "$TMP_CRON" || true

echo "30 2 * * * $BACKUP_SCRIPT >> $LOG_DIR/backup-cron.log 2>&1 # bitacora-mtto auto backup" >> "$TMP_CRON"
echo "@reboot /usr/bin/pm2 resurrect >> $LOG_DIR/pm2-resurrect.log 2>&1 # bitacora-mtto pm2 resurrect" >> "$TMP_CRON"

crontab "$TMP_CRON"
rm -f "$TMP_CRON"

echo "Cron configurado. Tareas activas:"
crontab -l
