const pool = require('../db');


// =========================
// REGISTRAR PROYECTO
// =========================

async function registrarProyecto({
    nombre,
    descripcion,
    area,
    prioridad,
    responsable,
    tecnicos,
    turno,
    fechaSql,
    costo,
    creadoPor
}) {
    const resultado = await pool.query(
        `
        INSERT INTO proyectos_mtto
        (
            nombre, descripcion, area, prioridad,
            responsable, tecnicos, turno,
            fecha_programada, costo_estimado, creado_por
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id
        `,
        [
            nombre,
            descripcion,
            area,
            prioridad,
            responsable,
            tecnicos,
            turno,
            fechaSql,
            costo || null,
            creadoPor
        ]
    );

    return resultado.rows[0].id;
}


// =========================
// LISTAR PROYECTOS ABIERTOS
// =========================

async function listarProyectosAbiertos(limit = 20) {
    const resultado = await pool.query(
        `
        SELECT
            id,
            nombre,
            descripcion,
            area,
            prioridad,
            responsable,
            turno,
            fecha_programada,
            estado,
            porcentaje_avance,
            costo_estimado,
            creado_en
        FROM proyectos_mtto
        WHERE COALESCE(LOWER(estado), 'abierto') NOT IN ('cerrado', 'completado', 'cancelado', 'finalizado')
        ORDER BY COALESCE(fecha_programada, creado_en) DESC NULLS LAST, id DESC
        LIMIT $1
        `,
        [limit]
    );

    return resultado.rows;
}


// =========================
// CERRAR PROYECTO
// =========================

async function cerrarProyecto(id) {
    const resultado = await pool.query(
        `
        UPDATE proyectos_mtto
        SET estado = 'Cerrado'
        WHERE id = $1
          AND COALESCE(LOWER(estado), 'abierto') NOT IN ('cerrado', 'completado', 'cancelado', 'finalizado')
        RETURNING id
        `,
        [id]
    );

    return resultado.rows.length > 0;
}


module.exports = {
    registrarProyecto,
    listarProyectosAbiertos,
    cerrarProyecto
};
