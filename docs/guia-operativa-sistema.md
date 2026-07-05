# Guia Operativa del Sistema SHP1

## 1. Objetivo

Esta guia resume como funciona el sistema actual de SHP1 Pachuca para que puedas estudiarlo y operarlo con seguridad.

El sistema tiene dos frentes principales:

1. Bot de WhatsApp para captura operativa.
2. API + Dashboard para consulta, supervision y seguimiento.

## 2. Ubicacion del proyecto

Ruta base del proyecto:

`/home/pc-ubuntu/servicios/bitacora-mtto`

## 3. Procesos principales

En PM2 existen dos procesos importantes:

1. `bitacora-bot`
   Procesa mensajes de WhatsApp.
2. `bitacora-api`
   Sirve el dashboard y los endpoints de consulta.

Comandos utiles:

```bash
pm2 status
pm2 logs bitacora-bot --nostream --lines 100
pm2 logs bitacora-api --nostream --lines 100
pm2 restart bitacora-bot
pm2 restart bitacora-api
```

## 4. Estructura general

Archivos y carpetas clave:

1. `index.js`
   Entrada principal del bot de WhatsApp.
2. `api.js`
   Servidor Express y endpoints del dashboard.
3. `db.js`
   Conexion a PostgreSQL.
4. `handlers/`
   Logica por tipo de grupo o flujo.
5. `services/`
   Consultas y reglas de negocio.
6. `lib/`
   Parsing, storage y utilidades.
7. `dashboard/`
   Interfaz web.
8. `docs/`
   Documentacion interna.
9. `backups/`
   Respaldos SQL.

## 5. Grupos aceptados

El bot solo escucha los grupos definidos en `index.js`:

1. `BITACORA-MTTO-SHP1` -> `BITACORA`
2. `Mantenimiento SHP1` -> `MANTENIMIENTO_FALLAS`
3. `MELI SVC PACHUCA - BATIA LIMPIEZA` -> `LIMPIEZA`
4. `Asistencia SHP1 Pachuca` -> `MANTENIMIENTO_ASISTENCIA`
5. `Ordenes preventivas semanales` -> `PREVENTIVO`
6. `Centro Operativo SHP1` -> `SUPERVISOR`

Si un mensaje llega de otro grupo, el bot lo ignora.

## 6. Flujo del bot

El router principal esta en `index.js`.

Secuencia general:

1. Recibe mensaje.
2. Verifica si pertenece a un grupo permitido.
3. Extrae texto o caption con `lib/bitacora-parser.js`.
4. Identifica el tipo de fuente.
5. Envia el mensaje al handler correcto.
6. Guarda en base de datos, archivos o evidencias segun el caso.

## 7. Modulos por dominio

### 7.1 Bitacora

Handler:

`handlers/bitacora.js`

Responsabilidad:

1. Registrar actividades de mantenimiento tipo bitacora.
2. Guardar texto estructurado.
3. Guardar evidencias.
4. Relacionar evidencias con actividades.

Apoyos:

1. `lib/bitacora-parser.js`
2. `lib/bitacora-storage.js`

### 7.2 Limpieza

Handler:

`handlers/limpieza.js`

Responsabilidad:

1. Registrar actividades de limpieza.
2. Guardar imagenes de evidencia.
3. Actualizar asistencia de limpieza.
4. Reutilizar actividad reciente si llegan imagenes seguidas sin texto.

Servicios:

1. `services/limpieza.js`
2. `services/asistencia-limpieza.js`

Detalle importante:

Si llegan varias imagenes seguidas sin texto del mismo autor, ahora se reutiliza un placeholder reciente y se evita duplicar actividades vacias.

### 7.3 Mantenimiento fallas y asistencia

Handler:

`handlers/mantenimiento.js`

Responsabilidad:

1. Registrar fallas de mantenimiento.
2. Registrar asistencia de ingenieria.
3. Guardar evidencias si aplica.

Servicios:

1. `services/mantenimiento-fallas.js`
2. `services/asistencia-mantenimiento.js`

### 7.4 Preventivos

Handler:

`handlers/preventivos.js`

Responsabilidad:

1. Procesar preventivos semanales.
2. Leer imagenes con OCR local.
3. Detectar etiqueta SHP1 por caption u OCR.
4. Generar uno o varios pendientes preventivos.

Servicios y librerias:

1. `services/preventivos.js`
2. `services/pendientes.js`
3. `lib/ocr.js`
4. `eng.traineddata`
5. `spa.traineddata`

### 7.5 Supervisor / Centro Operativo

Handler:

`handlers/supervisor.js`

Es el modulo de operacion central.

Responsabilidad:

1. Registrar pendientes.
2. Registrar proyectos.
3. Cerrar pendientes y preventivos.
4. Consultar abiertos, cerrados, historico y alertas.
5. Mostrar ayudas y guias paso a paso.
6. Consultar asistencia y estado en turno.

## 8. Comandos de Centro Operativo

Comandos principales activos:

1. `AYUDA`
2. `AYUDA PENDIENTES`
3. `AYUDA PROYECTOS`
4. `AYUDA EVIDENCIAS`
5. `AYUDA PREVENTIVOS`
6. `AYUDA ALERTAS`
7. `AYUDA HISTORICO`
8. `REPORTE`
9. `RESUMEN`
10. `LISTAR`
11. `ABIERTOS`
12. `CERRADOS`
13. `COMPLETADOS`
14. `HISTORICO`
15. `LISTAR CERRADOS`
16. `PREVENTIVOS`
17. `LISTAR PREVENTIVOS`
18. `PREVENTIVOS CERRADOS`
19. `LISTAR PREVENTIVOS CERRADOS`
20. `HISTORICO PREVENTIVOS`
21. `ALERTAS`
22. `ALERTAS ASISTENCIA`
23. `ASISTENCIA`
24. `ASISTENCIA HOY`
25. `EN TURNO`
26. `RIESGOS`
27. `PROYECTOS`
28. `CERRAR <ID>`
29. `CERRAR PREVENTIVO <ID>`

Guias disponibles:

1. `GUIA PENDIENTE`
2. `GUIA PROYECTO`
3. `CANCELAR`
4. `SALIR`

## 9. Dashboard

Archivos:

1. `dashboard/index.html`
2. `dashboard/app.js`
3. `dashboard/style.css`

Pestanas principales:

1. Principal
2. Bitacora
3. Supervisor
4. Limpieza y Asistencia

Vistas relevantes ya conectadas:

1. Pendientes
2. Preventivos
3. Preventivos cerrados por comandos de WhatsApp
4. Completados
5. Asistencia de ingenieria
6. Marcador de limpieza
7. Alertas activas de asistencia

En Principal ya hay tarjetas clicables que te direccionan a las vistas detalladas.

## 10. Asistencia y turnos

Hay dos dominios de asistencia.

### 10.1 Ingenieria

Grupo:

`Asistencia SHP1 Pachuca`

Personal configurado:

1. Saul Romero Romero
2. Eliezer Romero Romero
3. Flavio Cruz Santiago

### 10.2 Limpieza

Grupo:

`MELI SVC PACHUCA - BATIA LIMPIEZA`

Archivo base de reglas:

`services/limpieza-personal.js`

Personal y turnos:

1. Hugo Sanchez Calixto -> `1er turno 06:00-14:00`
2. Rosa Yuridia Lopez Dominguez -> `1er turno 06:00-14:00`
3. Lucila Castillo Labastida -> `1er turno 06:00-14:00`
4. Gloria Velazquez Tolentino -> `2do turno 12:00-20:00`
5. Margarita Reyes Santiago -> `2do turno 12:00-20:00`
6. Jose Luis Velazquez Herrera -> `3er turno 22:00-06:00`

## 11. Alertas de asistencia

Archivo principal:

`services/alertas-asistencia.js`

Funcion:

1. Detectar quien esta en turno.
2. Aplicar tolerancia de 60 minutos.
3. Detectar si hay evidencia o no.
4. Generar alertas activas.
5. Exponer ese estado al bot y al dashboard.

Las alertas actuales son para limpieza y se notifican a `Centro Operativo SHP1`.

## 12. Reglas de descanso

Tambien viven en `services/limpieza-personal.js`.

Puntos importantes:

1. Nadie descansa en jueves.
2. Primer turno rota en ciclo de 3 semanas: semana base viernes Yuri, sabado Hugo, domingo Luci; despues viernes Luci, sabado Yuri, domingo Hugo; despues viernes Hugo, sabado Luci, domingo Yuri; y se repite.
3. Segundo turno rota semanalmente: semana base sabado Margarita y domingo Gloria; la siguiente semana sabado Gloria y domingo Margarita.
4. Jose Luis descansa sabado fijo.
5. Existen ajustes manuales en la tabla `asistencia_limpieza_ajustes`.

## 13. Tablas importantes

1. `actividades_mtto`
   Bitacora de mantenimiento.
2. `actividades_limpieza`
   Actividades de limpieza.
3. `evidencias_limpieza`
   Evidencias de limpieza.
4. `asistencia_limpieza_diaria`
   Acumulado por fecha, autor y grupo.
5. `asistencia_mantenimiento_eventos`
   Eventos de entrada y salida de ingenieria.
6. `pendientes_supervisor`
   Pendientes y preventivos.
7. `mantenimiento_fallas`
   Fallas registradas.
8. `preventivos_semanales`
   Preventivo maestro semanal.
9. `asistencia_limpieza_ajustes`
   Ajustes manuales de descanso o labora.

## 14. Logging y trazabilidad

El bot ya deja trazabilidad fuerte.

Comando recomendado:

```bash
pm2 logs bitacora-bot --nostream --lines 100
```

Senales utiles:

1. `NUEVO MENSAJE`
2. `GRUPO`
3. `TIPO`
4. `AUTOR`
5. `mensajeId`
6. `TEXTO`
7. `DB_PERSIST`

`DB_PERSIST` ya usa formato fijo:

1. `tabla`
2. `id`
3. `autor`
4. `grupo`
5. `mensajeId`

## 15. Respaldo y proteccion

Respaldo creado hoy:

`backups/operaciones_20260629_233157.sql`

Scripts utiles:

1. `scripts/backup-daily.sh`
2. `scripts/setup-auto-protection.sh`
3. `scripts/restore-db.sh`

Documento relacionado:

`docs/auto-proteccion-y-recuperacion.md`

## 16. Archivos mas importantes para estudiar

### Nivel 1: mapa general

1. `index.js`
2. `api.js`
3. `package.json`

### Nivel 2: operacion por dominio

1. `handlers/supervisor.js`
2. `handlers/limpieza.js`
3. `handlers/mantenimiento.js`
4. `handlers/preventivos.js`
5. `handlers/bitacora.js`

### Nivel 3: reglas y persistencia

1. `services/alertas-asistencia.js`
2. `services/limpieza-personal.js`
3. `services/pendientes.js`
4. `services/limpieza.js`
5. `services/asistencia-limpieza.js`
6. `services/asistencia-mantenimiento.js`
7. `lib/persistence-log.js`

### Nivel 4: interfaz

1. `dashboard/app.js`
2. `dashboard/style.css`
3. `dashboard/index.html`

## 17. Cosas que conviene vigilar estos dias

1. Que la asistencia real de ingenieria entre limpia desde WhatsApp.
2. Que no haya falsos positivos en alertas de limpieza.
3. Que no se vuelvan a duplicar placeholders de limpieza sin texto.
4. Que los comandos nuevos de Centro Operativo respondan como se espera.
5. Que el dashboard refleje la misma realidad que el bot.

## 18. Observaciones finales

El sistema ya esta funcional para operar, pero sigue en fase de observacion real.

Todavia conviene reevaluar despues de algunos dias de uso antes de cerrar definitivamente con consolidacion de codigo o etiquetado final.