const pool = require('../db');
const path = require('path');


// =========================
// EVIDENCIA - PENDIENTE
// =========================

async function guardarEvidenciaPendiente({ pendienteId, rutaEvidencia }) {
    await pool.query(
        `
        INSERT INTO evidencias_pendientes (pendiente_id, ruta, nombre_archivo)
        VALUES ($1, $2, $3)
        `,
        [pendienteId, rutaEvidencia, path.basename(rutaEvidencia)]
    );
}


// =========================
// EVIDENCIA - MATERIAL
// =========================

async function guardarEvidenciaMaterial({ materialId, rutaEvidencia }) {
    await pool.query(
        `
        INSERT INTO evidencias_materiales (material_id, ruta, nombre_archivo)
        VALUES ($1, $2, $3)
        `,
        [materialId, rutaEvidencia, path.basename(rutaEvidencia)]
    );
}


// =========================
// EVIDENCIA - PROYECTO
// =========================

async function guardarEvidenciaProyecto({ proyectoId, rutaEvidencia }) {
    await pool.query(
        `
        INSERT INTO evidencias_proyectos (proyecto_id, ruta, nombre_archivo)
        VALUES ($1, $2, $3)
        `,
        [proyectoId, rutaEvidencia, path.basename(rutaEvidencia)]
    );
}


module.exports = {
    guardarEvidenciaPendiente,
    guardarEvidenciaMaterial,
    guardarEvidenciaProyecto
};
