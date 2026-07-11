const pool = require('../db');

let tablaCreada = false;

async function asegurarTablaAsistenciaEventos() {
    if (tablaCreada) {
        return;
    }

    await pool.query(`
        CREATE TABLE IF NOT EXISTS asistencia_eventos (
            id SERIAL PRIMARY KEY,
            fecha_operativa DATE NOT NULL,
            evento_at TIMESTAMP NOT NULL,
            -- Opcion A: una sola tabla para ambos grupos; area separa LIMPIEZA/MTTO.
            area TEXT NOT NULL,
            tipo_evento TEXT NOT NULL,
            autor TEXT NOT NULL,
            grupo_nombre TEXT NOT NULL,
            chat_id TEXT,
            mensaje_id TEXT,
            tipo_mensaje TEXT,
            ubicacion TEXT,
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query('CREATE INDEX IF NOT EXISTS idx_asistencia_eventos_fecha_area ON asistencia_eventos (fecha_operativa, area)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_asistencia_eventos_evento_at ON asistencia_eventos (evento_at DESC)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_asistencia_eventos_mensaje_id ON asistencia_eventos (mensaje_id)');

    tablaCreada = true;
}

function normalizarArea(area = '') {
    const valor = String(area || '').toUpperCase().trim();
    if (valor === 'MTTO' || valor === 'LIMPIEZA') {
        return valor;
    }
    return '';
}

async function registrarEventoAsistencia({
    fecha,
    area,
    tipoEvento,
    autor,
    grupoNombre,
    chatId = '',
    mensajeId = '',
    tipoMensaje = '',
    ubicacion = ''
}) {
    await asegurarTablaAsistenciaEventos();

    const areaValida = normalizarArea(area);
    const tipo = String(tipoEvento || '').toUpperCase().trim();
    // Solo persistimos eventos reales de asistencia; estados derivados viven fuera de esta tabla.
    if (!areaValida || !['ENTRADA', 'SALIDA'].includes(tipo)) {
        return null;
    }

    const eventoAt = fecha.format('YYYY-MM-DD HH:mm:ss');
    const fechaOperativa = fecha.format('YYYY-MM-DD');

    const res = await pool.query(
        `
        INSERT INTO asistencia_eventos
        (
            fecha_operativa,
            evento_at,
            area,
            tipo_evento,
            autor,
            grupo_nombre,
            chat_id,
            mensaje_id,
            tipo_mensaje,
            ubicacion
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id
        `,
        [
            fechaOperativa,
            eventoAt,
            areaValida,
            tipo,
            autor || 'Sin nombre',
            grupoNombre || 'Sin grupo',
            chatId || null,
            mensajeId || null,
            tipoMensaje || null,
            ubicacion || null
        ]
    );

    return res.rows[0]?.id || null;
}

async function actualizarUbicacionEvento({ idEvento, ubicacion }) {
    await asegurarTablaAsistenciaEventos();
    if (!idEvento || !ubicacion) {
        return false;
    }

    // Se actualiza por id del evento pendiente para mantener trazabilidad mensaje -> evento.
    const res = await pool.query(
        `
        UPDATE asistencia_eventos
        SET ubicacion = $1
        WHERE id = $2
        `,
        [ubicacion, idEvento]
    );

    return res.rowCount > 0;
}

module.exports = {
    asegurarTablaAsistenciaEventos,
    registrarEventoAsistencia,
    actualizarUbicacionEvento
};
