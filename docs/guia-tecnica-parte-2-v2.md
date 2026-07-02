# Guia Tecnica del Sistema - Parte 2 (V2)

## Objetivo
Ejecutar el plan definido en Parte 1 (V1): respaldo, pre-chequeo, limpieza de esquema no usado, optimizacion de indices y validacion operativa.

## Fecha de ejecucion
2026-06-30

## Actividades ejecutadas
1. Respaldo completo de base:
   - backups/operaciones_20260630_173812.sql
2. Snapshot previo:
   - docs/db-snapshot-v2-pre-20260630_173834.json
3. Cambios de esquema aplicados en transaccion:
   - CREATE INDEX idx_pendientes_estado_categoria_fecha ON pendientes_supervisor (estado, categoria, fecha DESC)
   - CREATE INDEX idx_limpieza_grupo_fecha ON actividades_limpieza (grupo, fecha DESC)
   - CREATE INDEX idx_preventivos_semana ON preventivos_semanales (semana_inicio, semana_fin)
   - DROP TABLE movimientos_inventario
   - DROP TABLE inventario_materiales
   - DROP TABLE incidentes_mtto
   - DROP TABLE eventos_sistema
   - DROP TABLE alertas_operativas
   - DROP TABLE actividades_supervisor_historico
   - DROP TABLE actividades_mtto_backup
   - DROP TABLE preventivos_programados
4. Snapshot posterior:
   - docs/db-snapshot-v2-post-20260630_173856.json
5. Validacion operativa:
   - node --check api.js index.js handlers/supervisor.js handlers/preventivos.js
   - pm2 restart bitacora-api --update-env
   - pm2 restart bitacora-bot --update-env
   - Estado final: ambos servicios online.

## Resultado
- Esquema simplificado removiendo tablas no usadas por runtime.
- Mejoras de rendimiento en consultas frecuentes de pendientes, limpieza y preventivos por semana.
- Sistema operativo sin errores de sintaxis y servicios levantados.

## Tablas retiradas en V2
1. movimientos_inventario
2. inventario_materiales
3. incidentes_mtto
4. eventos_sistema
5. alertas_operativas
6. actividades_supervisor_historico
7. actividades_mtto_backup
8. preventivos_programados

## Recomendaciones siguientes
1. Monitorear 48-72 horas endpoints de dashboard y comandos LISTAR/PREVENTIVOS.
2. Si no hay incidentes, consolidar una etiqueta de version de esquema (ej. db-v2).
3. Para Parte 3, evaluar archivado historico por rango de fecha en actividades_mtto y evidencias_mtto.
