const pool = require('../db');

let tablaCreada = false;

async function asegurarTablaAsistenciaMantenimiento() {
    if (tablaCreada) {
        return;
    }

    await pool.query(`
        CREATE TABLE IF NOT EXISTS asistencia_mantenimiento_eventos (
            id SERIAL PRIMARY KEY,
            fecha DATE NOT NULL,
            autor TEXT NOT NULL,
            grupo TEXT NOT NULL,
            tipo_evento TEXT NOT NULL,
            ubicacion TEXT NOT NULL DEFAULT 'Sin ubicacion',
            turno TEXT NOT NULL DEFAULT 'Sin turno',
            mensaje_original TEXT NOT NULL DEFAULT '',
            mensaje_id TEXT NOT NULL UNIQUE,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
    `);

    tablaCreada = true;
}

async function registrarAsistenciaMantenimiento({
    fecha,
    autor,
    grupo,
    tipoEvento,
    ubicacion,
    turno,
    mensajeOriginal,
    mensajeId
}) {
    await asegurarTablaAsistenciaMantenimiento();

    const resultado = await pool.query(
        `
        INSERT INTO asistencia_mantenimiento_eventos
        (
            fecha,
            autor,
            grupo,
            tipo_evento,
            ubicacion,
            turno,
            mensaje_original,
            mensaje_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (mensaje_id)
        DO UPDATE
        SET
            fecha = EXCLUDED.fecha,
            autor = EXCLUDED.autor,
            grupo = EXCLUDED.grupo,
            tipo_evento = EXCLUDED.tipo_evento,
            ubicacion = EXCLUDED.ubicacion,
            turno = EXCLUDED.turno,
            mensaje_original = EXCLUDED.mensaje_original,
            updated_at = NOW()
        RETURNING id
        `,
        [
            fecha.format('YYYY-MM-DD'),
            autor || 'Sin nombre',
            (grupo || 'Sin grupo').trim(),
            (tipoEvento || 'ENTRADA').toUpperCase(),
            ubicacion || 'Sin ubicacion',
            turno || 'Sin turno',
            mensajeOriginal || '',
            mensajeId
        ]
    );

    return resultado.rows[0]?.id || null;
}

module.exports = {
    asegurarTablaAsistenciaMantenimiento,
    registrarAsistenciaMantenimiento
};