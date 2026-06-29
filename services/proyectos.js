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


module.exports = { registrarProyecto };
