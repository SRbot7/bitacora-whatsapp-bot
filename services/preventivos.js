const pool = require('../db');

let tablaCreada = false;

async function asegurarTablaPreventivos() {
    if (tablaCreada) {
        return;
    }

    await pool.query(`
        CREATE TABLE IF NOT EXISTS preventivos_semanales (
            id SERIAL PRIMARY KEY,
            fecha TIMESTAMP NOT NULL,
            autor TEXT NOT NULL,
            grupo TEXT NOT NULL,
            etiqueta TEXT,
            texto_ocr TEXT,
            semana_inicio DATE NOT NULL,
            semana_fin DATE NOT NULL,
            resumen TEXT NOT NULL,
            ruta_evidencia TEXT,
            mensaje_id TEXT NOT NULL UNIQUE,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        ALTER TABLE preventivos_semanales
        ADD COLUMN IF NOT EXISTS etiqueta TEXT
    `);

    await pool.query(`
        ALTER TABLE preventivos_semanales
        ADD COLUMN IF NOT EXISTS texto_ocr TEXT
    `);

    tablaCreada = true;
}

async function registrarPreventivoSemanal({
    fecha,
    autor,
    grupo,
    etiqueta,
    textoOCR,
    semanaInicio,
    semanaFin,
    resumen,
    rutaEvidencia,
    mensajeId
}) {
    await asegurarTablaPreventivos();

    const resultado = await pool.query(
        `
        INSERT INTO preventivos_semanales
        (
            fecha,
            autor,
            grupo,
            etiqueta,
            texto_ocr,
            semana_inicio,
            semana_fin,
            resumen,
            ruta_evidencia,
            mensaje_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (mensaje_id)
        DO UPDATE
        SET
            fecha = EXCLUDED.fecha,
            autor = EXCLUDED.autor,
            grupo = EXCLUDED.grupo,
            etiqueta = EXCLUDED.etiqueta,
            texto_ocr = EXCLUDED.texto_ocr,
            semana_inicio = EXCLUDED.semana_inicio,
            semana_fin = EXCLUDED.semana_fin,
            resumen = EXCLUDED.resumen,
            ruta_evidencia = COALESCE(EXCLUDED.ruta_evidencia, preventivos_semanales.ruta_evidencia),
            updated_at = NOW()
        RETURNING id
        `,
        [
            fecha.format('YYYY-MM-DD HH:mm:ss'),
            autor || 'Sin nombre',
            grupo || 'Sin grupo',
            etiqueta || '',
            textoOCR || '',
            semanaInicio,
            semanaFin,
            resumen || '[Sin resumen]',
            rutaEvidencia,
            mensajeId
        ]
    );

    return resultado.rows[0]?.id || null;
}

module.exports = {
    asegurarTablaPreventivos,
    registrarPreventivoSemanal
};