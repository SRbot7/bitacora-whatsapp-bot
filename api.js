require('dotenv').config();

const express = require('express');
const cors = require('cors');
const pool = require('./db');
const {
    asegurarTablaAsistenciaLimpieza,
    obtenerAutoresExcluidosAsistencia,
    autorPermitidoPorGrupo
} = require('./services/asistencia-limpieza');
const {
    asegurarTablaAsistenciaMantenimiento
} = require('./services/asistencia-mantenimiento');
const {
    sincronizarEstadosAsistencia,
    obtenerEstadosAsistenciaDia
} = require('./services/estado-asistencia');
const {
    MARCADOR_BASE_WEEK_ISO,
    MARCADOR_PERSONAL,
    DESCANSOS_FIJOS_PERSONAL,
    normalizarTexto,
    getWeekOffset,
    esDescansoProgramado,
    resolverPersonaMarcador
} = require('./services/limpieza-personal');
const {
    obtenerAlertasAsistenciaLimpieza,
    obtenerAlertasAsistenciaIngenieria
} = require('./services/alertas-asistencia');

process.on('uncaughtException', (err) => {
    console.error('❌ ERROR NO CAPTURADO:');
    console.error(err);
});

process.on('unhandledRejection', (err) => {
    console.error('❌ PROMESA RECHAZADA:');
    console.error(err);
});

const app = express();

const LIMPIEZA_GROUP_WINDOW_MINUTES = Math.max(
    5,
    Number.parseInt(process.env.LIMPIEZA_GROUP_WINDOW_MINUTES || '90', 10) || 90
);

const GRUPO_ASISTENCIA_INGENIERIA = 'Asistencia SHP1 Pachuca';
const ASISTENCIA_RETARDO_MINUTOS = Math.max(
    1,
    Number.parseInt(process.env.ASISTENCIA_RETARDO_MINUTOS || '60', 10) || 60
);

const EQUIPO_INGENIERIA = [
    {
        key: 'saul',
        nombre: 'Saul Romero Romero',
        puesto: 'Electromecanico',
        turno: '1er turno 06:00-14:00',
        aliases: ['saul romero romero', 'saul romero', 'saul']
    },
    {
        key: 'eliezer',
        nombre: 'Eliezer Romero Romero',
        puesto: 'Multitecnico',
        turno: '2do turno 14:00-22:00',
        aliases: ['eliezer romero romero', 'eliezer romero', 'eliezer']
    },
    {
        key: 'flavio',
        nombre: 'Flavio Cruz Santiago',
        puesto: 'Multitecnico',
        turno: '3er turno 22:00-06:00',
        aliases: ['flavio cruz santiago', 'flavio cruz', 'flavio']
    }
];

app.use(cors());
app.use(express.json());
app.use(express.static('dashboard'));
app.use('/evidencias_bitacora', express.static('evidencias_bitacora'));
app.use('/evidencias', express.static('evidencias_bitacora'));
app.use('/evidencias_limpieza', express.static('evidencias_limpieza'));

// =========================
// SEGURIDAD REMOTA (TAILSCALE)
// =========================

const PRIVATE_KEY = process.env.DASHBOARD_PRIVATE_KEY || '';

function esTailscaleIp(ip = '') {
    return ip.startsWith('100.') || ip.startsWith('fd7a:115c:a1e0:');
}

function getClientIp(req) {
    const xff = (req.headers['x-forwarded-for'] || '').toString();
    const ipRaw = xff ? xff.split(',')[0].trim() : (req.ip || req.socket.remoteAddress || '');
    return ipRaw.replace('::ffff:', '');
}

function accesoPermitido(req) {
    const ip = getClientIp(req);

    if (ip === '127.0.0.1' || ip === '::1' || esTailscaleIp(ip)) {
        return true;
    }

    if (!PRIVATE_KEY) {
        return false;
    }

    const keyHeader = req.headers['x-dashboard-key'];
    return keyHeader && keyHeader === PRIVATE_KEY;
}

app.use((req, res, next) => {
    if (req.path === '/') {
        return next();
    }

    if (!accesoPermitido(req)) {
        return res.status(403).json({
            error: 'Acceso denegado. Usa red Tailscale o x-dashboard-key.'
        });
    }

    next();
});

// =========================
// HELPERS API
// =========================

function toInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
}

function getPagination(req) {
    const page = Math.max(1, toInt(req.query.page, 1));
    const pageSize = Math.min(100, Math.max(1, toInt(req.query.pageSize, 20)));
    const offset = (page - 1) * pageSize;
    return { page, pageSize, offset };
}

function buildDateFilter({ from, to, column = 'fecha', idxStart = 1 }) {
    const where = [];
    const params = [];
    let idx = idxStart;

    if (from) {
        where.push(`${column} >= $${idx++}`);
        params.push(from);
    }

    if (to) {
        where.push(`${column} <= $${idx++}`);
        params.push(to);
    }

    return { where, params, nextIdx: idx };
}

function mod(valor, base) {
    return ((valor % base) + base) % base;
}

function toDateOnlyIso(dateObj) {
    return dateObj.toISOString().slice(0, 10);
}

function startOfWeekMonday(dateInput) {
    const base = new Date(dateInput);
    const utcDate = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
    const dayIndexMon0 = mod(utcDate.getUTCDay() - 1, 7);
    utcDate.setUTCDate(utcDate.getUTCDate() - dayIndexMon0);
    return utcDate;
}

function resolveWeekStartDate(weekStartRaw, fromRaw) {
    const parsed = weekStartRaw || fromRaw
        ? new Date(weekStartRaw || fromRaw)
        : new Date();

    if (Number.isNaN(parsed.getTime())) {
        return startOfWeekMonday(new Date());
    }

    return startOfWeekMonday(parsed);
}

function buildWeekDays(weekStartDate) {
    return Array.from({ length: 7 }, (_, idx) => {
        const dia = new Date(weekStartDate);
        dia.setUTCDate(weekStartDate.getUTCDate() + idx);

        return {
            idx,
            fecha: toDateOnlyIso(dia)
        };
    });
}

function extraerHorarioTurno(turno = '') {
    const match = (turno || '').match(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
    if (!match) {
        return null;
    }

    return {
        turnoInicio: match[1],
        turnoFin: match[2]
    };
}

function construirFechaConHoraIso(fechaIso = '', hhmm = '') {
    if (!fechaIso || !hhmm) {
        return null;
    }

    const iso = `${fechaIso}T${hhmm}:00`;
    const dt = new Date(iso);
    return Number.isNaN(dt.getTime()) ? null : dt;
}

function resolverEstadoAsistenciaDiaria({
    descanso = false,
    turno = '',
    fechaIso = '',
    primerReporte = null,
    totalReportes = 0,
    totalEvidencias = 0,
    requiereEvidencia = false
}) {
    if (descanso) {
        return 'D';
    }

    const reportes = Number(totalReportes || 0);
    const evidencias = Number(totalEvidencias || 0);
    const tieneActividad = reportes > 0 || evidencias > 0;

    if (!tieneActividad) {
        return 'F';
    }

    if (requiereEvidencia && evidencias <= 0) {
        return 'R';
    }

    const horario = extraerHorarioTurno(turno);
    if (!horario) {
        return 'A';
    }

    const inicioTurno = construirFechaConHoraIso(fechaIso, horario.turnoInicio);
    if (!inicioTurno) {
        return 'A';
    }

    const limiteRetardo = new Date(inicioTurno.getTime() + (ASISTENCIA_RETARDO_MINUTOS * 60 * 1000));
    const primer = primerReporte ? new Date(primerReporte) : null;

    if (!primer || Number.isNaN(primer.getTime())) {
        return 'R';
    }

    return primer <= limiteRetardo ? 'A' : 'R';
}

let tablaAjustesAsistenciaCreada = false;

async function asegurarTablaAjustesAsistencia() {
    if (tablaAjustesAsistenciaCreada) {
        return;
    }

    await pool.query(`
        CREATE TABLE IF NOT EXISTS asistencia_limpieza_ajustes (
            id SERIAL PRIMARY KEY,
            fecha DATE NOT NULL,
            persona_key TEXT NOT NULL,
            tipo TEXT NOT NULL,
            turno TEXT,
            motivo TEXT,
            creado_por TEXT,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
            UNIQUE (fecha, persona_key)
        )
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_asistencia_limpieza_ajustes_fecha
        ON asistencia_limpieza_ajustes (fecha)
    `);

    tablaAjustesAsistenciaCreada = true;
}

function resolverIngenieriaPersona(autor = '') {
    const autorN = normalizarTexto(autor);
    if (!autorN) {
        return null;
    }

    for (const persona of EQUIPO_INGENIERIA) {
        const matched = persona.aliases.some((alias) => {
            const aliasN = normalizarTexto(alias);
            return autorN.includes(aliasN) || aliasN.includes(autorN);
        });

        if (matched) {
            return persona;
        }
    }

    return null;
}

function buildIngenieriaRows({ rows, personaKeyByAutor = false }) {
    const mapa = new Map();

    for (const row of rows) {
        const persona = resolverIngenieriaPersona(row.autor);
        if (!persona) {
            continue;
        }

        if (!autorPermitidoPorGrupo(row.autor, GRUPO_ASISTENCIA_INGENIERIA)) {
            continue;
        }

        const previo = mapa.get(persona.key) || {
            total_reportes: 0,
            total_evidencias: 0,
            primer_reporte: null,
            ultimo_reporte: null,
            autores: [],
            dias_con_asistencia: new Set(),
            dias_con_evidencia: new Set(),
            fechas: new Set()
        };

        const fechaRow = row.fecha ? toDateOnlyIso(new Date(row.fecha)) : null;
        const reportes = Number(row.total_reportes || 0);
        const evidencias = Number(row.total_evidencias || 0);

        previo.total_reportes += reportes;
        previo.total_evidencias += evidencias;
        if (fechaRow && reportes > 0) {
            previo.dias_con_asistencia.add(fechaRow);
        }
        if (fechaRow && evidencias > 0) {
            previo.dias_con_evidencia.add(fechaRow);
        }
        if (fechaRow) {
            previo.fechas.add(fechaRow);
        }

        previo.primer_reporte = previo.primer_reporte
            ? (new Date(previo.primer_reporte) < new Date(row.primer_reporte) ? previo.primer_reporte : row.primer_reporte)
            : row.primer_reporte;
        previo.ultimo_reporte = previo.ultimo_reporte
            ? (new Date(previo.ultimo_reporte) > new Date(row.ultimo_reporte) ? previo.ultimo_reporte : row.ultimo_reporte)
            : row.ultimo_reporte;

        if (!previo.autores.includes(row.autor)) {
            previo.autores.push(row.autor);
        }

        mapa.set(persona.key, previo);
    }

    return EQUIPO_INGENIERIA.map((persona) => {
        const agg = mapa.get(persona.key) || {
            total_reportes: 0,
            total_evidencias: 0,
            primer_reporte: null,
            ultimo_reporte: null,
            autores: [],
            dias_con_asistencia: new Set(),
            dias_con_evidencia: new Set(),
            fechas: new Set()
        };

        let estado = agg.total_reportes > 0 || agg.total_evidencias > 0 ? 'A' : 'F';
        if (estado !== 'F' && agg.fechas.size === 1) {
            const [fechaUnica] = Array.from(agg.fechas.values());
            estado = resolverEstadoAsistenciaDiaria({
                descanso: false,
                turno: persona.turno,
                fechaIso: fechaUnica,
                primerReporte: agg.primer_reporte,
                totalReportes: agg.total_reportes,
                totalEvidencias: agg.total_evidencias,
                requiereEvidencia: false
            });
        }

        return {
            persona: persona.nombre,
            puesto: persona.puesto,
            turno: persona.turno,
            estado,
            total_reportes: agg.total_reportes,
            total_evidencias: agg.total_evidencias,
            dias_con_asistencia: agg.dias_con_asistencia.size,
            dias_con_evidencia: agg.dias_con_evidencia.size,
            primer_reporte: agg.primer_reporte,
            ultimo_reporte: agg.ultimo_reporte,
            autores_detectados: agg.autores
        };
    });
}

function buildIngenieriaMarcadorRows({ rows, weekStartDate, autorFiltro = '' }) {
    const dias = buildWeekDays(weekStartDate);
    const mapaAsistencia = new Map();

    for (const row of rows) {
        const persona = resolverIngenieriaPersona(row.autor);
        if (!persona) {
            continue;
        }

        if (!autorPermitidoPorGrupo(row.autor, GRUPO_ASISTENCIA_INGENIERIA)) {
            continue;
        }

        const fechaIso = row.fecha ? toDateOnlyIso(new Date(row.fecha)) : null;
        if (!fechaIso) {
            continue;
        }

        const key = `${persona.key}|${fechaIso}`;
        const previo = mapaAsistencia.get(key) || {
            total_reportes: 0,
            total_evidencias: 0,
            primer_reporte: null,
            autores: new Set()
        };

        previo.total_reportes += Number(row.total_reportes || 0);
        previo.total_evidencias += Number(row.total_evidencias || 0);
        if (row.primer_reporte) {
            const previoPrimer = previo.primer_reporte ? new Date(previo.primer_reporte) : null;
            const candidato = new Date(row.primer_reporte);
            if (!previoPrimer || candidato < previoPrimer) {
                previo.primer_reporte = row.primer_reporte;
            }
        }
        previo.autores.add(row.autor);

        mapaAsistencia.set(key, previo);
    }

    const autorFiltroN = normalizarTexto(autorFiltro || '');
    const personalFiltrado = EQUIPO_INGENIERIA.filter((persona) => {
        if (!autorFiltroN) {
            return true;
        }

        const nombreN = normalizarTexto(persona.nombre);
        if (nombreN.includes(autorFiltroN)) {
            return true;
        }

        return persona.aliases.some((alias) => normalizarTexto(alias).includes(autorFiltroN));
    });

    const items = personalFiltrado.map((persona) => {
        const marcador = dias.map((dia) => {
            const asistencia = mapaAsistencia.get(`${persona.key}|${dia.fecha}`) || {
                total_reportes: 0,
                total_evidencias: 0,
                primer_reporte: null,
                autores: new Set()
            };

            const estado = resolverEstadoAsistenciaDiaria({
                descanso: false,
                turno: persona.turno,
                fechaIso: dia.fecha,
                primerReporte: asistencia.primer_reporte,
                totalReportes: asistencia.total_reportes,
                totalEvidencias: asistencia.total_evidencias,
                requiereEvidencia: false
            });

            return {
                fecha: dia.fecha,
                estado,
                total_reportes: asistencia.total_reportes,
                total_evidencias: asistencia.total_evidencias,
                primer_reporte: asistencia.primer_reporte,
                autores: Array.from(asistencia.autores)
            };
        });

        const totales = marcador.reduce((acc, dia) => {
            acc[dia.estado] += 1;
            return acc;
        }, { A: 0, D: 0, R: 0, F: 0 });

        return {
            persona: persona.nombre,
            puesto: persona.puesto,
            turno: persona.turno,
            marcador,
            totales
        };
    });

    return {
        days: dias.map((dia) => dia.fecha),
        items
    };
}

async function queryIngenieriaByDateRange({ fechaInicio, fechaFin }) {
    await asegurarTablaAsistenciaMantenimiento();

    const rowsRes = await pool.query(
        `
        WITH base_mtto AS (
            SELECT
                fecha,
                autor,
                grupo,
                COUNT(*)::int AS total_reportes,
                0::int AS total_evidencias,
                MIN(created_at) AS primer_reporte,
                MAX(created_at) AS ultimo_reporte
            FROM asistencia_mantenimiento_eventos
            WHERE fecha >= $1
              AND fecha <= $2
              AND grupo ILIKE $3
            GROUP BY fecha, autor, grupo
        ),
        base_legacy AS (
            SELECT
                fecha,
                autor,
                grupo,
                total_reportes,
                total_evidencias,
                primer_reporte,
                ultimo_reporte
            FROM asistencia_limpieza_diaria
            WHERE fecha >= $1
              AND fecha <= $2
              AND grupo ILIKE $3
        ),
        consolidado AS (
            SELECT * FROM base_mtto
            UNION ALL
            SELECT * FROM base_legacy
        )
        SELECT
            fecha,
            autor,
            grupo,
            SUM(total_reportes)::int AS total_reportes,
            SUM(total_evidencias)::int AS total_evidencias,
            MIN(primer_reporte) AS primer_reporte,
            MAX(ultimo_reporte) AS ultimo_reporte
        FROM consolidado
        GROUP BY fecha, autor, grupo
        ORDER BY fecha ASC, autor ASC
        `,
        [fechaInicio, fechaFin, `%${GRUPO_ASISTENCIA_INGENIERIA}%`]
    );

    return rowsRes.rows;
}

async function runPaginatedQuery({
    baseFrom,
    where,
    params,
    orderBy,
    page,
    pageSize,
    offset,
    fields = '*'
}) {
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*)::int AS total ${baseFrom} ${whereSql}`;
    const countRes = await pool.query(countSql, params);
    const total = countRes.rows[0]?.total || 0;

    const listParams = [...params, pageSize, offset];
    const listSql = `
        SELECT ${fields}
        ${baseFrom}
        ${whereSql}
        ${orderBy}
        LIMIT $${params.length + 1}
        OFFSET $${params.length + 2}
    `;

    const listRes = await pool.query(listSql, listParams);

    return {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        items: listRes.rows
    };
}

// =========================
// HEALTH CHECK
// =========================

app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        servicio: 'Bitacora API'
    });
});

// =========================
// API UNIFICADA - RESUMEN
// =========================

app.get('/api/v1/summary', async (req, res) => {
    try {
        const [bitacora, limpieza, pendientes, preventivos, materiales, proyectos] = await Promise.all([
            pool.query(`SELECT COUNT(*)::int AS total FROM bitacora WHERE grupo = 'BITACORA-MTTO-SHP1'`),
            pool.query(`
                SELECT COUNT(*)::int AS total
                FROM actividades_limpieza
                WHERE actividad IS NOT NULL
                  AND BTRIM(actividad) <> ''
                  AND actividad <> '[Solo imagen]'
            `),
            pool.query(`SELECT COUNT(*)::int AS total FROM pendientes_supervisor WHERE estado = 'Pendiente'`),
            pool.query(`SELECT COUNT(*)::int AS total FROM pendientes_supervisor WHERE estado = 'Pendiente' AND categoria = 'PREVENTIVO'`),
            pool.query(`SELECT COUNT(*)::int AS total FROM materiales_solicitados`),
            pool.query(`SELECT COUNT(*)::int AS total FROM proyectos_mtto`)
        ]);

        res.json({
            bitacora: bitacora.rows[0].total,
            limpieza: limpieza.rows[0].total,
            pendientesAbiertos: pendientes.rows[0].total,
            pendientesPreventivos: preventivos.rows[0].total,
            materiales: materiales.rows[0].total,
            proyectos: proyectos.rows[0].total
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al consultar resumen' });
    }
});

// =========================
// API UNIFICADA - BITACORA
// =========================

app.get('/api/v1/bitacora/actividades', async (req, res) => {
    try {
        const { page, pageSize, offset } = getPagination(req);
        const { from, to, search, area, tecnico, turno } = req.query;

        const where = [`grupo = 'BITACORA-MTTO-SHP1'`];
        const params = [];
        let idx = 1;

        const dateFilter = buildDateFilter({ from, to, column: 'fecha', idxStart: idx });
        where.push(...dateFilter.where);
        params.push(...dateFilter.params);
        idx = dateFilter.nextIdx;

        if (search) {
            where.push(`(actividad ILIKE $${idx} OR pendientes ILIKE $${idx})`);
            params.push(`%${search}%`);
            idx += 1;
        }

        if (area) {
            where.push(`area ILIKE $${idx}`);
            params.push(`%${area}%`);
            idx += 1;
        }

        if (tecnico) {
            where.push(`tecnico ILIKE $${idx}`);
            params.push(`%${tecnico}%`);
            idx += 1;
        }

        if (turno) {
            where.push(`turno ILIKE $${idx}`);
            params.push(`%${turno}%`);
        }

        const data = await runPaginatedQuery({
            baseFrom: 'FROM bitacora',
            where,
            params,
            orderBy: 'ORDER BY fecha DESC, id DESC',
            page,
            pageSize,
            offset
        });

        res.json(data);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al consultar bitacora' });
    }
});

app.get('/api/v1/bitacora/actividades/:id/evidencias', async (req, res) => {
    try {
        const { id } = req.params;
        const resultado = await pool.query(
            `
            SELECT e.*
            FROM evidencias_mtto e
                        JOIN bitacora a ON a.id = e.actividad_id
            WHERE e.actividad_id = $1
              AND a.grupo = 'BITACORA-MTTO-SHP1'
            ORDER BY e.fecha ASC, e.id ASC
            `,
            [id]
        );

        res.json(resultado.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al consultar evidencias de bitacora' });
    }
});

// =========================
// API UNIFICADA - SUPERVISOR
// =========================

app.get('/api/v1/supervisor/pendientes', async (req, res) => {
    try {
        const { page, pageSize, offset } = getPagination(req);
        const { from, to, search, area, prioridad, estado } = req.query;

        const where = [];
        const params = [];
        let idx = 1;

        const dateFilter = buildDateFilter({ from, to, column: 'fecha', idxStart: idx });
        where.push(...dateFilter.where);
        params.push(...dateFilter.params);
        idx = dateFilter.nextIdx;

        if (search) {
            where.push(`descripcion ILIKE $${idx}`);
            params.push(`%${search}%`);
            idx += 1;
        }

        if (area) {
            where.push(`area ILIKE $${idx}`);
            params.push(`%${area}%`);
            idx += 1;
        }

        if (prioridad) {
            where.push(`prioridad = $${idx}`);
            params.push(prioridad.toUpperCase());
            idx += 1;
        }

        if (estado) {
            where.push(`estado = $${idx}`);
            params.push(estado);
        }

        const data = await runPaginatedQuery({
            baseFrom: 'FROM pendientes_supervisor',
            where,
            params,
            orderBy: 'ORDER BY fecha DESC, id DESC',
            page,
            pageSize,
            offset
        });

        res.json(data);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al consultar pendientes' });
    }
});

app.get('/api/v1/supervisor/preventivos', async (req, res) => {
    try {
        const { page, pageSize, offset } = getPagination(req);

        const data = await runPaginatedQuery({
            baseFrom: 'FROM pendientes_supervisor',
            where: [`estado = 'Pendiente'`, `categoria = 'PREVENTIVO'`],
            params: [],
            orderBy: 'ORDER BY fecha DESC, id DESC',
            page,
            pageSize,
            offset,
            fields: 'id, fecha, descripcion, prioridad, categoria, area, observaciones, creado_por'
        });

        res.json(data);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al consultar preventivos pendientes' });
    }
});

app.get('/api/v1/supervisor/completados', async (req, res) => {
    try {
        const { page, pageSize, offset } = getPagination(req);
        const { from, to, search, area, prioridad } = req.query;

        const where = [`estado = 'Completado'`];
        const params = [];
        let idx = 1;

        const dateFilter = buildDateFilter({ from, to, column: 'COALESCE(fecha_cierre, fecha)', idxStart: idx });
        where.push(...dateFilter.where);
        params.push(...dateFilter.params);
        idx = dateFilter.nextIdx;

        if (search) {
            where.push(`(descripcion ILIKE $${idx} OR COALESCE(observaciones, '') ILIKE $${idx})`);
            params.push(`%${search}%`);
            idx += 1;
        }

        if (area) {
            where.push(`area ILIKE $${idx}`);
            params.push(`%${area}%`);
            idx += 1;
        }

        if (prioridad) {
            where.push(`prioridad = $${idx}`);
            params.push(prioridad.toUpperCase());
        }

        const data = await runPaginatedQuery({
            baseFrom: 'FROM pendientes_supervisor',
            where,
            params,
            orderBy: 'ORDER BY COALESCE(fecha_cierre, fecha) DESC, id DESC',
            page,
            pageSize,
            offset,
            fields: 'id, fecha, fecha_cierre, descripcion, prioridad, categoria, area, observaciones, creado_por, estado'
        });

        res.json(data);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al consultar completados' });
    }
});

app.get('/api/v1/supervisor/materiales', async (req, res) => {
    try {
        const { page, pageSize, offset } = getPagination(req);
        const { from, to, search, area, prioridad, estado } = req.query;

        const where = [];
        const params = [];
        let idx = 1;

        const dateFilter = buildDateFilter({ from, to, column: 'fecha', idxStart: idx });
        where.push(...dateFilter.where);
        params.push(...dateFilter.params);
        idx = dateFilter.nextIdx;

        if (search) {
            where.push(`(material ILIKE $${idx} OR justificacion ILIKE $${idx})`);
            params.push(`%${search}%`);
            idx += 1;
        }

        if (area) {
            where.push(`area ILIKE $${idx}`);
            params.push(`%${area}%`);
            idx += 1;
        }

        if (prioridad) {
            where.push(`prioridad = $${idx}`);
            params.push(prioridad.toUpperCase());
            idx += 1;
        }

        if (estado) {
            where.push(`estado = $${idx}`);
            params.push(estado);
        }

        const data = await runPaginatedQuery({
            baseFrom: 'FROM materiales_solicitados',
            where,
            params,
            orderBy: 'ORDER BY fecha DESC, id DESC',
            page,
            pageSize,
            offset
        });

        res.json(data);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al consultar materiales' });
    }
});

app.get('/api/v1/supervisor/proyectos', async (req, res) => {
    try {
        const { page, pageSize, offset } = getPagination(req);
        const { from, to, search, area, prioridad, estado } = req.query;

        const where = [];
        const params = [];
        let idx = 1;

        const dateFilter = buildDateFilter({ from, to, column: 'creado_en', idxStart: idx });
        where.push(...dateFilter.where);
        params.push(...dateFilter.params);
        idx = dateFilter.nextIdx;

        if (search) {
            where.push(`(nombre ILIKE $${idx} OR descripcion ILIKE $${idx})`);
            params.push(`%${search}%`);
            idx += 1;
        }

        if (area) {
            where.push(`area ILIKE $${idx}`);
            params.push(`%${area}%`);
            idx += 1;
        }

        if (prioridad) {
            where.push(`prioridad = $${idx}`);
            params.push(prioridad.toUpperCase());
            idx += 1;
        }

        if (estado) {
            where.push(`estado = $${idx}`);
            params.push(estado);
        }

        const data = await runPaginatedQuery({
            baseFrom: 'FROM proyectos_mtto',
            where,
            params,
            orderBy: 'ORDER BY creado_en DESC, id DESC',
            page,
            pageSize,
            offset
        });

        res.json(data);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al consultar proyectos' });
    }
});

app.get('/api/v1/supervisor/pendientes/:id/evidencias', async (req, res) => {
    try {
        const { id } = req.params;
        const resultado = await pool.query(
            `
            SELECT *
            FROM evidencias_pendientes
            WHERE pendiente_id = $1
            ORDER BY fecha ASC, id ASC
            `,
            [id]
        );

        res.json(resultado.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al consultar evidencias de pendientes' });
    }
});

app.get('/api/v1/supervisor/materiales/:id/evidencias', async (req, res) => {
    try {
        const { id } = req.params;
        const resultado = await pool.query(
            `
            SELECT *
            FROM evidencias_materiales
            WHERE material_id = $1
            ORDER BY fecha ASC, id ASC
            `,
            [id]
        );

        res.json(resultado.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al consultar evidencias de materiales' });
    }
});

app.get('/api/v1/supervisor/proyectos/:id/evidencias', async (req, res) => {
    try {
        const { id } = req.params;
        const resultado = await pool.query(
            `
            SELECT *
            FROM evidencias_proyectos
            WHERE proyecto_id = $1
            ORDER BY fecha ASC, id ASC
            `,
            [id]
        );

        res.json(resultado.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al consultar evidencias de proyectos' });
    }
});

// =========================
// API UNIFICADA - LIMPIEZA
// =========================

app.get('/api/v1/limpieza/actividades', async (req, res) => {
    try {
        const { page, pageSize, offset } = getPagination(req);
        const { from, to, search, area, autor } = req.query;

        const where = [
            `(
                b.actividad IS NOT NULL
                AND BTRIM(b.actividad) <> ''
                AND b.actividad <> '[Solo imagen]'
            )`
        ];
        const params = [];
        let idx = 1;

        if (from) {
            where.push(`b.fecha >= $${idx++}`);
            params.push(from);
        }

        if (to) {
            where.push(`b.fecha <= $${idx++}`);
            params.push(to);
        }

        if (search) {
            where.push(`b.actividad ILIKE $${idx++}`);
            params.push(`%${search}%`);
        }

        if (area) {
            where.push(`b.area ILIKE $${idx++}`);
            params.push(`%${area}%`);
        }

        if (autor) {
            where.push(`b.autor ILIKE $${idx++}`);
            params.push(`%${autor}%`);
        }

        const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

        const countSql = `
            WITH base AS (
                SELECT b.id
                FROM actividades_limpieza b
                ${whereSql}
            )
            SELECT COUNT(*)::int AS total
            FROM base
        `;

        const countRes = await pool.query(countSql, params);
        const total = countRes.rows[0]?.total || 0;

        const listSql = `
            WITH base AS (
                SELECT b.id, b.fecha, b.autor, b.area, b.actividad, b.grupo, b.tipo_mensaje
                FROM actividades_limpieza b
                ${whereSql}
            )
            SELECT
                base.*,
                COALESCE((
                    SELECT COUNT(*)
                    FROM evidencias_limpieza e
                    WHERE e.actividad_id IN (
                        SELECT a.id
                        FROM actividades_limpieza a
                        WHERE a.autor = base.autor
                          AND a.grupo = base.grupo
                          AND a.fecha >= base.fecha
                          AND a.fecha < LEAST(
                              COALESCE(
                                  (
                                      SELECT MIN(a2.fecha)
                                      FROM actividades_limpieza a2
                                      WHERE a2.autor = base.autor
                                        AND a2.grupo = base.grupo
                                        AND a2.fecha > base.fecha
                                        AND (
                                            a2.actividad IS NOT NULL
                                            AND BTRIM(a2.actividad) <> ''
                                            AND a2.actividad <> '[Solo imagen]'
                                        )
                                  ),
                                  'infinity'::timestamp
                              ),
                              base.fecha + INTERVAL '${LIMPIEZA_GROUP_WINDOW_MINUTES} minutes'
                          )
                    )
                ), 0)::int AS fotos_agrupadas
            FROM base
            ORDER BY base.fecha DESC, base.id DESC
            LIMIT $${params.length + 1}
            OFFSET $${params.length + 2}
        `;

        const listRes = await pool.query(listSql, [...params, pageSize, offset]);

        res.json({
            page,
            pageSize,
            total,
            totalPages: Math.max(1, Math.ceil(total / pageSize)),
            items: listRes.rows
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al consultar limpieza' });
    }
});

app.get('/api/v1/limpieza/actividades/:id/evidencias', async (req, res) => {
    try {
        const { id } = req.params;
        const resultado = await pool.query(
            `
            WITH base AS (
                SELECT id, fecha, autor, grupo
                FROM actividades_limpieza
                WHERE id = $1
            ),
            limite_base AS (
                SELECT MIN(a2.fecha) AS fecha_limite
                FROM actividades_limpieza a2
                JOIN base b ON 1 = 1
                WHERE a2.autor = b.autor
                  AND a2.grupo = b.grupo
                  AND a2.fecha > b.fecha
                  AND (
                                            a2.actividad IS NOT NULL
                                            AND BTRIM(a2.actividad) <> ''
                                            AND a2.actividad <> '[Solo imagen]'
                  )
            ),
            limite_tiempo AS (
                SELECT b.fecha + INTERVAL '${LIMPIEZA_GROUP_WINDOW_MINUTES} minutes' AS fecha_limite
                FROM base b
            ),
            candidatas AS (
                SELECT a3.id
                FROM actividades_limpieza a3
                JOIN base b ON 1 = 1
                LEFT JOIN limite_base lb ON 1 = 1
                LEFT JOIN limite_tiempo lt ON 1 = 1
                WHERE a3.autor = b.autor
                  AND a3.grupo = b.grupo
                  AND a3.fecha >= b.fecha
                  AND a3.fecha < LEAST(
                      COALESCE(lb.fecha_limite, 'infinity'::timestamp),
                      lt.fecha_limite
                  )
            )
            SELECT e.*
            FROM evidencias_limpieza e
            WHERE e.actividad_id IN (SELECT id FROM candidatas)
            ORDER BY e.fecha ASC, e.id ASC
            `,
            [id]
        );

        res.json(resultado.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al consultar evidencias de limpieza' });
    }
});

app.get('/api/v1/limpieza/asistencia', async (req, res) => {
    try {
        await asegurarTablaAsistenciaLimpieza();

        const { page, pageSize, offset } = getPagination(req);
        const { from, to, autor, grupo } = req.query;

        const where = [];
        const params = [];
        let idx = 1;

        if (from) {
            where.push(`fecha >= $${idx++}`);
            params.push(from);
        }

        if (to) {
            where.push(`fecha <= $${idx++}`);
            params.push(to);
        }

        if (autor) {
            where.push(`autor ILIKE $${idx++}`);
            params.push(`%${autor}%`);
        }

        if (grupo) {
            where.push(`grupo ILIKE $${idx++}`);
            params.push(`%${grupo}%`);
        }

        const autoresExcluidos = obtenerAutoresExcluidosAsistencia();
        for (const autorExcluido of autoresExcluidos) {
            where.push(`autor NOT ILIKE $${idx++}`);
            params.push(`%${autorExcluido}%`);
        }

        const data = await runPaginatedQuery({
            baseFrom: 'FROM asistencia_limpieza_diaria',
            where,
            params,
            orderBy: 'ORDER BY fecha DESC, autor ASC',
            page,
            pageSize,
            offset
        });

        res.json(data);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al consultar asistencia de limpieza' });
    }
});

app.get('/api/v1/limpieza/asistencia-semanal', async (req, res) => {
    try {
        await asegurarTablaAsistenciaLimpieza();

        const { page, pageSize, offset } = getPagination(req);
        const { from, to, autor, grupo } = req.query;

        const where = [];
        const params = [];
        let idx = 1;

        if (from) {
            where.push(`fecha >= $${idx++}`);
            params.push(from);
        }

        if (to) {
            where.push(`fecha <= $${idx++}`);
            params.push(to);
        }

        if (autor) {
            where.push(`autor ILIKE $${idx++}`);
            params.push(`%${autor}%`);
        }

        if (grupo) {
            where.push(`grupo ILIKE $${idx++}`);
            params.push(`%${grupo}%`);
        }

        const autoresExcluidos = obtenerAutoresExcluidosAsistencia();
        for (const autorExcluido of autoresExcluidos) {
            where.push(`autor NOT ILIKE $${idx++}`);
            params.push(`%${autorExcluido}%`);
        }

        const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

        const countSql = `
            WITH agrupado AS (
                SELECT
                    DATE_TRUNC('week', fecha)::date AS semana_inicio,
                    autor,
                    grupo
                FROM asistencia_limpieza_diaria
                ${whereSql}
                GROUP BY DATE_TRUNC('week', fecha)::date, autor, grupo
            )
            SELECT COUNT(*)::int AS total
            FROM agrupado
        `;

        const countRes = await pool.query(countSql, params);
        const total = countRes.rows[0]?.total || 0;

        const listSql = `
            WITH agrupado AS (
                SELECT
                    DATE_TRUNC('week', fecha)::date AS semana_inicio,
                    (DATE_TRUNC('week', fecha)::date + INTERVAL '6 days')::date AS semana_fin,
                    autor,
                    grupo,
                    SUM(total_reportes)::int AS total_reportes,
                    SUM(total_evidencias)::int AS total_evidencias,
                    COUNT(*) FILTER (WHERE total_reportes > 0)::int AS dias_con_asistencia,
                    MIN(primer_reporte) AS primer_reporte_semana,
                    MAX(ultimo_reporte) AS ultimo_reporte_semana
                FROM asistencia_limpieza_diaria
                ${whereSql}
                GROUP BY DATE_TRUNC('week', fecha)::date, autor, grupo
            )
            SELECT *
            FROM agrupado
            ORDER BY semana_inicio DESC, autor ASC
            LIMIT $${params.length + 1}
            OFFSET $${params.length + 2}
        `;

        const listRes = await pool.query(listSql, [...params, pageSize, offset]);

        res.json({
            periodo: 'semanal',
            page,
            pageSize,
            total,
            totalPages: Math.max(1, Math.ceil(total / pageSize)),
            items: listRes.rows
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al consultar asistencia semanal de limpieza' });
    }
});

app.get('/api/v1/limpieza/asistencia-mensual', async (req, res) => {
    try {
        await asegurarTablaAsistenciaLimpieza();

        const { page, pageSize, offset } = getPagination(req);
        const { from, to, autor, grupo } = req.query;

        const where = [];
        const params = [];
        let idx = 1;

        if (from) {
            where.push(`fecha >= $${idx++}`);
            params.push(from);
        }

        if (to) {
            where.push(`fecha <= $${idx++}`);
            params.push(to);
        }

        if (autor) {
            where.push(`autor ILIKE $${idx++}`);
            params.push(`%${autor}%`);
        }

        if (grupo) {
            where.push(`grupo ILIKE $${idx++}`);
            params.push(`%${grupo}%`);
        }

        const autoresExcluidos = obtenerAutoresExcluidosAsistencia();
        for (const autorExcluido of autoresExcluidos) {
            where.push(`autor NOT ILIKE $${idx++}`);
            params.push(`%${autorExcluido}%`);
        }

        const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

        const countSql = `
            WITH agrupado AS (
                SELECT
                    DATE_TRUNC('month', fecha)::date AS mes_inicio,
                    autor,
                    grupo
                FROM asistencia_limpieza_diaria
                ${whereSql}
                GROUP BY DATE_TRUNC('month', fecha)::date, autor, grupo
            )
            SELECT COUNT(*)::int AS total
            FROM agrupado
        `;

        const countRes = await pool.query(countSql, params);
        const total = countRes.rows[0]?.total || 0;

        const listSql = `
            WITH agrupado AS (
                SELECT
                    DATE_TRUNC('month', fecha)::date AS mes_inicio,
                    (DATE_TRUNC('month', fecha)::date + INTERVAL '1 month - 1 day')::date AS mes_fin,
                    autor,
                    grupo,
                    SUM(total_reportes)::int AS total_reportes,
                    SUM(total_evidencias)::int AS total_evidencias,
                    COUNT(*) FILTER (WHERE total_reportes > 0)::int AS dias_con_asistencia,
                    MIN(primer_reporte) AS primer_reporte_mes,
                    MAX(ultimo_reporte) AS ultimo_reporte_mes
                FROM asistencia_limpieza_diaria
                ${whereSql}
                GROUP BY DATE_TRUNC('month', fecha)::date, autor, grupo
            )
            SELECT *
            FROM agrupado
            ORDER BY mes_inicio DESC, autor ASC
            LIMIT $${params.length + 1}
            OFFSET $${params.length + 2}
        `;

        const listRes = await pool.query(listSql, [...params, pageSize, offset]);

        res.json({
            periodo: 'mensual',
            page,
            pageSize,
            total,
            totalPages: Math.max(1, Math.ceil(total / pageSize)),
            items: listRes.rows
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al consultar asistencia mensual de limpieza' });
    }
});

app.get('/api/v1/limpieza/asistencia-marcador', async (req, res) => {
    try {
        await asegurarTablaAsistenciaLimpieza();
        await asegurarTablaAjustesAsistencia();

        const { page, pageSize, offset } = getPagination(req);
        const { autor, grupo, weekStart } = req.query;

        const weekStartDate = resolveWeekStartDate(weekStart, req.query.from);
        const weekEndDate = new Date(weekStartDate);
        weekEndDate.setUTCDate(weekStartDate.getUTCDate() + 6);

        const where = ['fecha >= $1', 'fecha <= $2'];
        const params = [toDateOnlyIso(weekStartDate), toDateOnlyIso(weekEndDate)];
        let idx = 3;

        if (autor) {
            where.push(`autor ILIKE $${idx++}`);
            params.push(`%${autor}%`);
        }

        if (grupo) {
            where.push(`grupo ILIKE $${idx++}`);
            params.push(`%${grupo}%`);
        }

        const autoresExcluidos = obtenerAutoresExcluidosAsistencia();
        for (const autorExcluido of autoresExcluidos) {
            where.push(`autor NOT ILIKE $${idx++}`);
            params.push(`%${autorExcluido}%`);
        }

        const rowsRes = await pool.query(
            `
            SELECT
                fecha::date AS fecha,
                autor,
                grupo,
                SUM(total_reportes)::int AS total_reportes,
                SUM(total_evidencias)::int AS total_evidencias,
                MIN(primer_reporte) AS primer_reporte
            FROM asistencia_limpieza_diaria
            WHERE ${where.join(' AND ')}
            GROUP BY fecha::date, autor, grupo
            ORDER BY fecha::date ASC, autor ASC
            `,
            params
        );

        const dias = buildWeekDays(weekStartDate);
        const weekOffset = getWeekOffset(weekStartDate);
        const mapaAsistencia = new Map();
        const ajustesRes = await pool.query(
            `
            SELECT fecha::date AS fecha, persona_key, tipo, turno
            FROM asistencia_limpieza_ajustes
            WHERE fecha >= $1
              AND fecha <= $2
            `,
            [toDateOnlyIso(weekStartDate), toDateOnlyIso(weekEndDate)]
        );
        const mapaAjustes = new Map();

        for (const ajuste of ajustesRes.rows) {
            const fechaIso = toDateOnlyIso(new Date(ajuste.fecha));
            mapaAjustes.set(`${ajuste.persona_key}|${fechaIso}`, {
                tipo: (ajuste.tipo || '').toUpperCase(),
                turno: ajuste.turno || null
            });
        }

        for (const row of rowsRes.rows) {
            const persona = resolverPersonaMarcador(row.autor);
            if (!persona) {
                continue;
            }

            const fechaIso = toDateOnlyIso(new Date(row.fecha));
            const key = `${persona.key}|${fechaIso}`;
            const previo = mapaAsistencia.get(key) || {
                total_reportes: 0,
                total_evidencias: 0,
                primer_reporte: null,
                autores: new Set()
            };

            previo.total_reportes += Number(row.total_reportes || 0);
            previo.total_evidencias += Number(row.total_evidencias || 0);
            if (row.primer_reporte) {
                const previoPrimer = previo.primer_reporte ? new Date(previo.primer_reporte) : null;
                const candidato = new Date(row.primer_reporte);
                if (!previoPrimer || candidato < previoPrimer) {
                    previo.primer_reporte = row.primer_reporte;
                }
            }
            previo.autores.add(row.autor);

            mapaAsistencia.set(key, previo);
        }

        const autorFiltroN = normalizarTexto(autor || '');
        const personalFiltrado = MARCADOR_PERSONAL.filter((persona) => {
            if (!autorFiltroN) {
                return true;
            }

            const nombreN = normalizarTexto(persona.nombre);
            if (nombreN.includes(autorFiltroN)) {
                return true;
            }

            return persona.aliases.some((alias) => normalizarTexto(alias).includes(autorFiltroN));
        });

        const itemsAll = personalFiltrado.map((persona) => {
            const marcador = dias.map((dia) => {
                const asistencia = mapaAsistencia.get(`${persona.key}|${dia.fecha}`) || {
                    total_reportes: 0,
                    total_evidencias: 0,
                    primer_reporte: null,
                    autores: new Set()
                };

                const ajuste = mapaAjustes.get(`${persona.key}|${dia.fecha}`) || null;

                let descanso = esDescansoProgramado(persona.key, dia.idx, weekOffset);

                if (ajuste?.tipo === 'DESCANSO') {
                    descanso = true;
                }

                if (ajuste?.tipo === 'LABORA') {
                    descanso = false;
                }

                const estado = resolverEstadoAsistenciaDiaria({
                    descanso,
                    turno: persona.turno,
                    fechaIso: dia.fecha,
                    primerReporte: asistencia.primer_reporte,
                    totalReportes: asistencia.total_reportes,
                    totalEvidencias: asistencia.total_evidencias,
                    requiereEvidencia: true
                });

                return {
                    fecha: dia.fecha,
                    estado,
                    descanso,
                    total_reportes: asistencia.total_reportes,
                    total_evidencias: asistencia.total_evidencias,
                    primer_reporte: asistencia.primer_reporte,
                    autores: Array.from(asistencia.autores)
                };
            });

            const totales = marcador.reduce((acc, dia) => {
                acc[dia.estado] += 1;
                return acc;
            }, { A: 0, D: 0, R: 0, F: 0 });

            return {
                persona: persona.nombre,
                persona_key: persona.key,
                turno: persona.turno,
                marcador,
                totales
            };
        });

        const total = itemsAll.length;
        const items = itemsAll.slice(offset, offset + pageSize);

        res.json({
            page,
            pageSize,
            total,
            totalPages: Math.max(1, Math.ceil(total / pageSize)),
            weekStart: toDateOnlyIso(weekStartDate),
            weekEnd: toDateOnlyIso(weekEndDate),
            days: dias.map((dia) => dia.fecha),
            items
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al consultar marcador de asistencia' });
    }
});

app.get('/api/v1/limpieza/asistencia-ajustes', async (req, res) => {
    try {
        await asegurarTablaAjustesAsistencia();

        const { from, to, personaKey } = req.query;
        const where = [];
        const params = [];
        let idx = 1;

        if (from) {
            where.push(`fecha >= $${idx++}`);
            params.push(from);
        }

        if (to) {
            where.push(`fecha <= $${idx++}`);
            params.push(to);
        }

        if (personaKey) {
            where.push(`persona_key = $${idx++}`);
            params.push(personaKey);
        }

        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

        const rowsRes = await pool.query(
            `
            SELECT id, fecha, persona_key, tipo, turno, motivo, creado_por, created_at, updated_at
            FROM asistencia_limpieza_ajustes
            ${whereSql}
            ORDER BY fecha DESC, persona_key ASC
            `,
            params
        );

        res.json(rowsRes.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al consultar ajustes de asistencia' });
    }
});

app.post('/api/v1/limpieza/asistencia-ajustes', async (req, res) => {
    try {
        await asegurarTablaAjustesAsistencia();

        const {
            fecha,
            personaKey,
            tipo,
            turno,
            motivo,
            creadoPor
        } = req.body || {};

        if (!fecha || !personaKey || !tipo) {
            return res.status(400).json({ error: 'fecha, personaKey y tipo son obligatorios' });
        }

        const tipoUpper = String(tipo).toUpperCase().trim();
        if (tipoUpper !== 'DESCANSO' && tipoUpper !== 'LABORA') {
            return res.status(400).json({ error: 'tipo debe ser DESCANSO o LABORA' });
        }

        const result = await pool.query(
            `
            INSERT INTO asistencia_limpieza_ajustes
            (fecha, persona_key, tipo, turno, motivo, creado_por, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, NOW())
            ON CONFLICT (fecha, persona_key)
            DO UPDATE
            SET
                tipo = EXCLUDED.tipo,
                turno = EXCLUDED.turno,
                motivo = EXCLUDED.motivo,
                creado_por = EXCLUDED.creado_por,
                updated_at = NOW()
            RETURNING id, fecha, persona_key, tipo, turno, motivo, creado_por, updated_at
            `,
            [
                fecha,
                String(personaKey).trim(),
                tipoUpper,
                turno || null,
                motivo || null,
                creadoPor || 'dashboard'
            ]
        );

        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al guardar ajuste de asistencia' });
    }
});

app.delete('/api/v1/limpieza/asistencia-ajustes/:id', async (req, res) => {
    try {
        await asegurarTablaAjustesAsistencia();

        const result = await pool.query(
            `
            DELETE FROM asistencia_limpieza_ajustes
            WHERE id = $1
            RETURNING id
            `,
            [req.params.id]
        );

        if (!result.rows.length) {
            return res.status(404).json({ error: 'Ajuste no encontrado' });
        }

        res.json({ ok: true, id: result.rows[0].id });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al eliminar ajuste de asistencia' });
    }
});

app.get('/api/v1/ingenieria/asistencia-hoy', async (req, res) => {
    try {
        await asegurarTablaAsistenciaLimpieza();

        const fechaHoyMxRes = await pool.query(`SELECT (NOW() AT TIME ZONE 'America/Mexico_City')::date AS fecha_hoy`);
        const fechaHoy = fechaHoyMxRes.rows[0]?.fecha_hoy;

        const rows = await queryIngenieriaByDateRange({
            fechaInicio: fechaHoy,
            fechaFin: fechaHoy
        });

        const items = buildIngenieriaRows({ rows });

        res.json({
            fecha: fechaHoy,
            grupo: GRUPO_ASISTENCIA_INGENIERIA,
            periodo: 'diaria',
            total: items.length,
            items
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al consultar asistencia de ingenieria' });
    }
});

app.get('/api/v1/asistencia/estado-hoy', async (req, res) => {
    try {
        await sincronizarEstadosAsistencia(pool);

        const limpieza = await obtenerEstadosAsistenciaDia(pool, 'LIMPIEZA');
        const mantenimiento = await obtenerEstadosAsistenciaDia(pool, 'MTTO');

        res.json({
            fecha: (await pool.query(`SELECT (NOW() AT TIME ZONE 'America/Mexico_City')::date AS fecha_hoy`)).rows[0]?.fecha_hoy,
            limpieza,
            mantenimiento
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al consultar estado actual de asistencia' });
    }
});

app.get('/api/v1/ingenieria/asistencia-semanal', async (req, res) => {
    try {
        await asegurarTablaAsistenciaLimpieza();

        const base = req.query.weekStart || req.query.from || new Date().toISOString();
        const weekStart = resolveWeekStartDate(base, req.query.from);
        const weekEnd = new Date(weekStart);
        weekEnd.setUTCDate(weekStart.getUTCDate() + 6);

        const fechaInicio = toDateOnlyIso(weekStart);
        const fechaFin = toDateOnlyIso(weekEnd);
        const rows = await queryIngenieriaByDateRange({ fechaInicio, fechaFin });
        const items = buildIngenieriaRows({ rows });

        res.json({
            periodo: 'semanal',
            weekStart: fechaInicio,
            weekEnd: fechaFin,
            grupo: GRUPO_ASISTENCIA_INGENIERIA,
            total: items.length,
            items
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al consultar asistencia semanal de ingenieria' });
    }
});

app.get('/api/v1/ingenieria/asistencia-mensual', async (req, res) => {
    try {
        await asegurarTablaAsistenciaLimpieza();

        const monthRaw = (req.query.month || '').toString().trim();
        let year;
        let month;

        if (/^\d{4}-\d{2}$/.test(monthRaw)) {
            year = Number.parseInt(monthRaw.slice(0, 4), 10);
            month = Number.parseInt(monthRaw.slice(5, 7), 10);
        } else {
            const nowMx = await pool.query(`SELECT NOW() AT TIME ZONE 'America/Mexico_City' AS ahora`);
            const dt = new Date(nowMx.rows[0].ahora);
            year = dt.getFullYear();
            month = dt.getMonth() + 1;
        }

        const monthStart = new Date(Date.UTC(year, month - 1, 1));
        const monthEnd = new Date(Date.UTC(year, month, 0));

        const fechaInicio = toDateOnlyIso(monthStart);
        const fechaFin = toDateOnlyIso(monthEnd);
        const rows = await queryIngenieriaByDateRange({ fechaInicio, fechaFin });
        const items = buildIngenieriaRows({ rows });

        res.json({
            periodo: 'mensual',
            month: `${year}-${String(month).padStart(2, '0')}`,
            monthStart: fechaInicio,
            monthEnd: fechaFin,
            grupo: GRUPO_ASISTENCIA_INGENIERIA,
            total: items.length,
            items
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al consultar asistencia mensual de ingenieria' });
    }
});

app.get('/api/v1/ingenieria/asistencia-marcador', async (req, res) => {
    try {
        await asegurarTablaAsistenciaLimpieza();

        const { page, pageSize, offset } = getPagination(req);
        const { autor, grupo, weekStart } = req.query;

        const weekStartDate = resolveWeekStartDate(weekStart, req.query.from);
        const weekEndDate = new Date(weekStartDate);
        weekEndDate.setUTCDate(weekStartDate.getUTCDate() + 6);

        const fechaInicio = toDateOnlyIso(weekStartDate);
        const fechaFin = toDateOnlyIso(weekEndDate);
        const rows = await queryIngenieriaByDateRange({ fechaInicio, fechaFin });

        const autorFiltro = (autor || '').toString().trim();
        const grupoFiltro = (grupo || '').toString().trim();
        const rowsFiltradas = rows.filter((row) => {
            if (grupoFiltro && !normalizarTexto(row.grupo || '').includes(normalizarTexto(grupoFiltro))) {
                return false;
            }

            if (!autorFiltro) {
                return true;
            }

            const autorRow = normalizarTexto(row.autor || '');
            const autorFiltroN = normalizarTexto(autorFiltro);
            return autorRow.includes(autorFiltroN) || autorFiltroN.includes(autorRow);
        });

        const personal = buildIngenieriaMarcadorRows({
            rows: rowsFiltradas,
            weekStartDate,
            autorFiltro
        });

        const total = personal.items.length;
        const items = personal.items.slice(offset, offset + pageSize);

        res.json({
            periodo: 'marcador',
            page,
            pageSize,
            total,
            totalPages: Math.max(1, Math.ceil(total / pageSize)),
            weekStart: fechaInicio,
            weekEnd: fechaFin,
            days: personal.days,
            items
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al consultar marcador de asistencia de ingenieria' });
    }
});

app.get('/api/v1/supervisor/asistencia-alertas', async (req, res) => {
    try {
        const [limpiezaRes, ingenieriaRes] = await Promise.allSettled([
            obtenerAlertasAsistenciaLimpieza(pool),
            obtenerAlertasAsistenciaIngenieria(pool)
        ]);

        const limpieza = limpiezaRes.status === 'fulfilled'
            ? limpiezaRes.value
            : { generatedAt: null, toleranciaMin: null, items: [] };
        const ingenieria = ingenieriaRes.status === 'fulfilled'
            ? ingenieriaRes.value
            : { generatedAt: null, toleranciaMin: null, items: [] };

        const items = [
            ...(limpieza.items || []),
            ...(ingenieria.items || [])
        ];

        const generatedAt = limpieza.generatedAt || ingenieria.generatedAt || null;
        const toleranciaMin = limpieza.toleranciaMin || ingenieria.toleranciaMin || null;
        const warnings = [];

        if (limpiezaRes.status === 'rejected') {
            console.error('⚠️ Error alertas limpieza:', limpiezaRes.reason);
            warnings.push('No se pudieron calcular alertas de limpieza.');
        }

        if (ingenieriaRes.status === 'rejected') {
            console.error('⚠️ Error alertas ingenieria:', ingenieriaRes.reason);
            warnings.push('No se pudieron calcular alertas de ingenieria.');
        }

        res.json({
            generatedAt,
            toleranciaMin,
            total: items.length,
            items,
            warnings
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al consultar alertas de asistencia' });
    }
});

// =========================
// LEGACY ENDPOINTS (compat)
// =========================

app.get('/actividades', async (req, res) => {
    try {
        const resultado = await pool.query(
            `
            SELECT *
            FROM bitacora
            WHERE grupo = 'BITACORA-MTTO-SHP1'
            ORDER BY fecha DESC
            LIMIT 100
            `
        );

        res.json(resultado.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al consultar actividades' });
    }
});

app.get('/actividad/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const resultado = await pool.query(
            `
            SELECT *
                        FROM bitacora
            WHERE id = $1
              AND grupo = 'BITACORA-MTTO-SHP1'
            `,
            [id]
        );

        res.json(resultado.rows[0] || null);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error' });
    }
});

app.get('/actividad/:id/evidencias', async (req, res) => {
    try {
        const { id } = req.params;
        const resultado = await pool.query(
            `
            SELECT *
            FROM evidencias_mtto
            WHERE actividad_id = $1
            ORDER BY fecha
            `,
            [id]
        );

        res.json(resultado.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error' });
    }
});

const PORT = process.env.API_PORT || 5000;
const HOST = process.env.API_HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`🚀 API escuchando en ${HOST}:${PORT}`);
});
