const pool = require('../db');
const path = require('path');


// =========================
// GUARDAR ACTIVIDAD LIMPIEZA
// =========================

async function guardarActividadLimpieza({
    fecha,
    autor,
    area,
    descripcion,
    grupo,
    tipoMensaje,
    mensajeId
}) {
    const resultado = await pool.query(
        `
        INSERT INTO actividades_limpieza
        (fecha, autor, area, actividad, grupo, tipo_mensaje, mensaje_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
        `,
        [fecha.format('YYYY-MM-DD HH:mm:ss'), autor, area, descripcion, grupo, tipoMensaje, mensajeId]
    );

    return resultado.rows.length > 0 ? resultado.rows[0].id : null;
}


// =========================
// GUARDAR EVIDENCIA LIMPIEZA
// =========================

async function guardarEvidenciaLimpieza({ actividadId, rutaEvidencia }) {
    await pool.query(
        `
        INSERT INTO evidencias_limpieza
        (actividad_id, ruta, tipo_archivo, nombre_archivo)
        VALUES ($1, $2, $3, $4)
        `,
        [actividadId, rutaEvidencia, 'photo', path.basename(rutaEvidencia)]
    );
}


// =========================
// OBTENER ULTIMA ACTIVIDAD LIMPIEZA
// =========================

async function obtenerUltimaActividadLimpiezaPorAutor({ autor, grupo, fecha, maxMinutos }) {
        const fechaRef = fecha.format('YYYY-MM-DD HH:mm:ss');

    const resultado = await pool.query(
        `
        SELECT id
        FROM actividades_limpieza
        WHERE autor = $1
          AND grupo = $2
                    AND (
                            actividad IS NOT NULL
                            AND BTRIM(actividad) <> ''
                            AND actividad <> '[Solo imagen]'
                    )
                    AND fecha <= $3
                    AND fecha >= ($3::timestamp - make_interval(mins => $4::int))
        ORDER BY fecha DESC, id DESC
        LIMIT 1
        `,
                [autor, grupo, fechaRef, maxMinutos]
    );

    return resultado.rows[0]?.id || null;
}


async function obtenerUltimaActividadLimpiezaSinReportePorAutor({ autor, grupo, fecha, maxMinutos }) {
    const fechaRef = fecha.format('YYYY-MM-DD HH:mm:ss');

    const resultado = await pool.query(
        `
        SELECT id
        FROM actividades_limpieza
        WHERE autor = $1
          AND grupo = $2
          AND actividad = '[SIN REPORTE] Imagen enviada sin texto.'
          AND fecha <= $3
          AND fecha >= ($3::timestamp - make_interval(mins => $4::int))
        ORDER BY fecha DESC, id DESC
        LIMIT 1
        `,
        [autor, grupo, fechaRef, maxMinutos]
    );

    return resultado.rows[0]?.id || null;
}


module.exports = {
    guardarActividadLimpieza,
    guardarEvidenciaLimpieza,
    obtenerUltimaActividadLimpiezaPorAutor,
    obtenerUltimaActividadLimpiezaSinReportePorAutor
};
