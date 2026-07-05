const moment = require('moment-timezone');

let tablaCreada = false;

async function asegurarTablaHistorialCO(pool) {
    if (tablaCreada) {
        return;
    }

    await pool.query(`
        CREATE TABLE IF NOT EXISTS historial_centro_operativo (
            id BIGSERIAL PRIMARY KEY,
            fecha TIMESTAMP NOT NULL DEFAULT NOW(),
            chat_grupo TEXT,
            autor TEXT,
            comando TEXT NOT NULL,
            payload JSONB,
            estado TEXT NOT NULL DEFAULT 'OK',
            resultado TEXT,
            referencia_tabla TEXT,
            referencia_id BIGINT,
            error TEXT
        )
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_historial_co_fecha
        ON historial_centro_operativo (fecha DESC)
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_historial_co_autor
        ON historial_centro_operativo (autor)
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_historial_co_comando
        ON historial_centro_operativo (comando)
    `);

    tablaCreada = true;
}

async function registrarEventoCO(pool, evento = {}) {
    await asegurarTablaHistorialCO(pool);

    const {
        chatGrupo = '',
        autor = '',
        comando = 'SIN_COMANDO',
        payload = null,
        estado = 'OK',
        resultado = '',
        referenciaTabla = '',
        referenciaId = null,
        error = ''
    } = evento;

    const res = await pool.query(
        `
        INSERT INTO historial_centro_operativo
        (chat_grupo, autor, comando, payload, estado, resultado, referencia_tabla, referencia_id, error)
        VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9)
        RETURNING id
        `,
        [
            chatGrupo || null,
            autor || null,
            comando,
            payload ? JSON.stringify(payload) : null,
            estado,
            resultado || null,
            referenciaTabla || null,
            referenciaId,
            error || null
        ]
    );

    return res.rows[0]?.id || null;
}

async function listarHistorialCO(pool, filtros = {}) {
    await asegurarTablaHistorialCO(pool);

    const {
        desde = '',
        hasta = '',
        autor = '',
        comando = '',
        limit = 30
    } = filtros;

    const where = [];
    const params = [];
    let idx = 1;

    if (desde) {
        where.push(`fecha >= $${idx++}`);
        params.push(desde);
    }

    if (hasta) {
        where.push(`fecha <= $${idx++}`);
        params.push(hasta);
    }

    if (autor) {
        where.push(`autor ILIKE $${idx++}`);
        params.push(`%${autor}%`);
    }

    if (comando) {
        where.push(`comando ILIKE $${idx++}`);
        params.push(`%${comando}%`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const res = await pool.query(
        `
        SELECT id, fecha, chat_grupo, autor, comando, estado, resultado, referencia_tabla, referencia_id, error
        FROM historial_centro_operativo
        ${whereSql}
        ORDER BY fecha DESC
        LIMIT $${idx}
        `,
        [...params, Math.max(1, Math.min(Number(limit) || 30, 100))]
    );

    return res.rows;
}

function rangoHoyMx() {
    const inicio = moment().tz('America/Mexico_City').startOf('day');
    const fin = moment().tz('America/Mexico_City').endOf('day');

    return {
        desde: inicio.format('YYYY-MM-DD HH:mm:ss'),
        hasta: fin.format('YYYY-MM-DD HH:mm:ss')
    };
}

module.exports = {
    asegurarTablaHistorialCO,
    registrarEventoCO,
    listarHistorialCO,
    rangoHoyMx
};
