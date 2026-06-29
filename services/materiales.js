const pool = require('../db');


// =========================
// REGISTRAR MATERIAL
// =========================

async function registrarMaterial({
    solicitante,
    grupo,
    material,
    cantidad,
    unidad,
    prioridad,
    area,
    justificacion,
    creadoPor
}) {
    const resultado = await pool.query(
        `
        INSERT INTO materiales_solicitados
        (
            solicitante, grupo, material, cantidad,
            unidad, prioridad, area, justificacion, creado_por
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id
        `,
        [
            solicitante,
            grupo,
            material,
            cantidad || null,
            unidad,
            prioridad,
            area,
            justificacion,
            creadoPor
        ]
    );

    return resultado.rows[0].id;
}


module.exports = { registrarMaterial };
