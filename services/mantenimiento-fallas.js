const pool = require('../db');

let tablaCreada = false;

async function asegurarTablaMantenimientoFallas() {
    if (tablaCreada) {
        return;
    }

    await pool.query(`
        CREATE TABLE IF NOT EXISTS mantenimiento_fallas (
            id SERIAL PRIMARY KEY,
            fecha TIMESTAMP NOT NULL,
            autor TEXT NOT NULL,
            grupo TEXT NOT NULL,
            area TEXT NOT NULL DEFAULT 'General',
            equipo TEXT NOT NULL DEFAULT 'General',
            falla TEXT NOT NULL,
            prioridad TEXT NOT NULL DEFAULT 'MEDIA',
            estado TEXT NOT NULL DEFAULT 'Abierto',
            ruta_evidencia TEXT,
            mensaje_id TEXT NOT NULL UNIQUE,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
    `);

    tablaCreada = true;
}

async function registrarFallaMantenimiento({
    fecha,
    autor,
    grupo,
    area,
    equipo,
    falla,
    prioridad = 'MEDIA',
    rutaEvidencia = null,
    mensajeId
}) {
    await asegurarTablaMantenimientoFallas();

    const resultado = await pool.query(
        `
        INSERT INTO mantenimiento_fallas
        (
            fecha,
            autor,
            grupo,
            area,
            equipo,
            falla,
            prioridad,
            ruta_evidencia,
            mensaje_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (mensaje_id)
        DO UPDATE
        SET
            fecha = EXCLUDED.fecha,
            autor = EXCLUDED.autor,
            grupo = EXCLUDED.grupo,
            area = EXCLUDED.area,
            equipo = EXCLUDED.equipo,
            falla = EXCLUDED.falla,
            prioridad = EXCLUDED.prioridad,
            ruta_evidencia = COALESCE(EXCLUDED.ruta_evidencia, mantenimiento_fallas.ruta_evidencia),
            updated_at = NOW()
        RETURNING id
        `,
        [
            fecha.format('YYYY-MM-DD HH:mm:ss'),
            autor || 'Sin nombre',
            grupo || 'Sin grupo',
            area || 'General',
            equipo || 'General',
            falla || '[Sin detalle]',
            (prioridad || 'MEDIA').toUpperCase(),
            rutaEvidencia,
            mensajeId
        ]
    );

    return resultado.rows[0]?.id || null;
}

module.exports = {
    asegurarTablaMantenimientoFallas,
    registrarFallaMantenimiento
};