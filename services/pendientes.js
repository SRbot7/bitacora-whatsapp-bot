const pool = require('../db');


// =========================
// REGISTRAR PENDIENTE
// =========================

async function registrarPendiente({
    descripcion,
    area,
    tipoMtto,
    prioridad,
    turno,
    tecnicos,
    fechaSql,
    creadoPor,
    categoria,
    observaciones
}) {
    const resultado = await pool.query(
        `
        INSERT INTO pendientes_supervisor
        (
            descripcion, area, tipo_mtto, prioridad,
            turno, tecnicos, fecha_programada, creado_por,
            categoria, observaciones
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id
        `,
        [
            descripcion,
            area,
            tipoMtto,
            prioridad,
            turno,
            tecnicos,
            fechaSql,
            creadoPor,
            categoria || 'GENERAL',
            observaciones || ''
        ]
    );

    return resultado.rows[0].id;
}


// =========================
// CERRAR PENDIENTE
// =========================

async function cerrarPendiente(id) {
    const resultado = await pool.query(
        `
        UPDATE pendientes_supervisor
        SET estado = 'Completado', fecha_cierre = NOW()
        WHERE id = $1
        RETURNING id
        `,
        [id]
    );

    return resultado.rows.length > 0;
}


async function cerrarPendientePorCategoria(id, categoria) {
    const resultado = await pool.query(
        `
        UPDATE pendientes_supervisor
        SET estado = 'Completado', fecha_cierre = NOW()
        WHERE id = $1
          AND categoria = $2
          AND estado = 'Pendiente'
        RETURNING id
        `,
        [id, categoria]
    );

    return resultado.rows.length > 0;
}


// =========================
// CONTAR ABIERTOS
// =========================

async function contarAbiertos() {
    const resultado = await pool.query(`
        SELECT COUNT(*) total
        FROM pendientes_supervisor
        WHERE estado = 'Pendiente'
    `);

    return resultado.rows[0].total;
}


// =========================
// CONTAR CERRADOS
// =========================

async function contarCerrados() {
    const resultado = await pool.query(`
        SELECT COUNT(*) total
        FROM pendientes_supervisor
        WHERE estado = 'Completado'
    `);

    return resultado.rows[0].total;
}


// =========================
// LISTAR PENDIENTES
// =========================

async function listarPendientes() {
    const resultado = await pool.query(`
        SELECT id, descripcion, prioridad, categoria
        FROM pendientes_supervisor
        WHERE estado = 'Pendiente'
        ORDER BY
            CASE prioridad
                WHEN 'ALTA'  THEN 1
                WHEN 'MEDIA' THEN 2
                WHEN 'BAJA'  THEN 3
                ELSE 4
            END,
            fecha DESC
    `);

    return resultado.rows;
}


// =========================
// LISTAR PREVENTIVOS ABIERTOS
// =========================

async function listarPreventivosPendientes() {
    const resultado = await pool.query(`
        SELECT id, descripcion, prioridad, categoria, area, observaciones, fecha
        FROM pendientes_supervisor
        WHERE estado = 'Pendiente'
          AND categoria = 'PREVENTIVO'
        ORDER BY fecha DESC, id DESC
    `);

    return resultado.rows;
}


async function listarCompletadosSupervisor(limit = 20) {
    const resultado = await pool.query(
        `
        SELECT id, descripcion, prioridad, categoria, area, observaciones, fecha, fecha_cierre
        FROM pendientes_supervisor
        WHERE estado = 'Completado'
        ORDER BY fecha_cierre DESC NULLS LAST, id DESC
        LIMIT $1
        `,
        [limit]
    );

    return resultado.rows;
}


async function listarPreventivosCompletados(limit = 20) {
    const resultado = await pool.query(
        `
        SELECT id, descripcion, prioridad, categoria, area, observaciones, fecha, fecha_cierre
        FROM pendientes_supervisor
        WHERE estado = 'Completado'
          AND categoria = 'PREVENTIVO'
        ORDER BY fecha_cierre DESC NULLS LAST, id DESC
        LIMIT $1
        `,
        [limit]
    );

    return resultado.rows;
}


// =========================
// LISTAR RIESGOS
// =========================

async function listarRiesgos() {
    const resultado = await pool.query(`
        SELECT id, descripcion, prioridad
        FROM pendientes_supervisor
        WHERE categoria = 'RIESGO' AND estado = 'Pendiente'
        ORDER BY fecha DESC
    `);

    return resultado.rows;
}


// =========================
// LISTAR MATERIALES (vista supervisor)
// =========================

async function listarMaterialesSupervisor() {
    const resultado = await pool.query(`
        SELECT id, descripcion, prioridad
        FROM pendientes_supervisor
        WHERE categoria = 'MATERIAL' AND estado = 'Pendiente'
        ORDER BY fecha DESC
    `);

    return resultado.rows;
}


module.exports = {
    registrarPendiente,
    cerrarPendiente,
    cerrarPendientePorCategoria,
    contarAbiertos,
    contarCerrados,
    listarPendientes,
    listarPreventivosPendientes,
    listarCompletadosSupervisor,
    listarPreventivosCompletados,
    listarRiesgos,
    listarMaterialesSupervisor
};
