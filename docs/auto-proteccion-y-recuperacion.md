# Auto proteccion y recuperacion

## Que pasa si se reinicia o apaga el servidor

- Los procesos del bot y API se detienen durante el apagado.
- Al iniciar, PM2 puede restaurarlos automaticamente.
- PostgreSQL en Docker se levanta solo por restart always.
- Si no hay respaldo reciente, puedes perder datos recientes por falla de disco.

## Lo que ya quedo configurado

- Respaldo diario por cron a las 02:30.
- Respaldo local en carpeta backups del proyecto.
- Copia externa en /srv/storage/backups/bitacora-mtto.
- Tarea @reboot para ejecutar pm2 resurrect.

## Scripts operativos

- Respaldo manual:
  - npm run backup:run
  - o bash scripts/backup-daily.sh

- Configurar o refrescar cron:
  - npm run backup:setup
  - o bash scripts/setup-auto-protection.sh

- Restaurar base de datos:
  - bash scripts/restore-db.sh backups/operaciones_YYYYMMDD_HHMMSS.sql

## Verificacion rapida

1. Revisar tareas cron:
   - crontab -l
2. Revisar respaldos locales:
   - ls -lh backups | tail -n 6
3. Revisar respaldos externos:
   - ls -lh /srv/storage/backups/bitacora-mtto | tail -n 6
4. Revisar procesos:
   - pm2 ls

## Paso pendiente de privilegios root

Para que PM2 quede integrado con systemd a nivel sistema, ejecutar una sola vez con sudo:

sudo env PATH=$PATH:/usr/bin /usr/local/lib/node_modules/pm2/bin/pm2 startup systemd -u pc-ubuntu --hp /home/pc-ubuntu
pm2 save

## Recomendaciones de endurecimiento

- Cambiar password de PostgreSQL y mover secretos fuera de scripts.
- Mantener retencion de respaldos y monitorear espacio en disco.
- Probar restauracion al menos una vez por semana.
