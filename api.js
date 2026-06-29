require('dotenv').config();

const express = require('express');
const cors = require('cors');
const pool = require('./db');

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

app.use(cors());
app.use(express.json());
app.use(express.static('dashboard'));
app.use('/evidencias', express.static('evidencias'));
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
        const [bitacora, limpieza, pendientes, materiales, proyectos] = await Promise.all([
            pool.query(`SELECT COUNT(*)::int AS total FROM actividades_mtto WHERE grupo = 'BITACORA-MTTO-SHP1'`),
            pool.query(`
                SELECT COUNT(*)::int AS total
                FROM actividades_limpieza
                WHERE actividad IS NOT NULL
                  AND BTRIM(actividad) <> ''
                  AND actividad <> '[Solo imagen]'
            `),
            pool.query(`SELECT COUNT(*)::int AS total FROM pendientes_supervisor WHERE estado = 'Pendiente'`),
            pool.query(`SELECT COUNT(*)::int AS total FROM materiales_solicitados`),
            pool.query(`SELECT COUNT(*)::int AS total FROM proyectos_mtto`)
        ]);

        res.json({
            bitacora: bitacora.rows[0].total,
            limpieza: limpieza.rows[0].total,
            pendientesAbiertos: pendientes.rows[0].total,
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
            baseFrom: 'FROM actividades_mtto',
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
            JOIN actividades_mtto a ON a.id = e.actividad_id
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

// =========================
// LEGACY ENDPOINTS (compat)
// =========================

app.get('/actividades', async (req, res) => {
    try {
        const resultado = await pool.query(
            `
            SELECT *
            FROM actividades_mtto
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
            FROM actividades_mtto
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
