const pool = require('../db');

let tablaCreada = false;

const AUTORES_PERMITIDOS_POR_GRUPO = {
    'asistencia shp1 pachuca': [
        'saul romero romero',
        'eliezer romero romero',
        'flavio cruz santiago'
    ]
};

function normalizarTexto(valor = '') {
    return valor
        .toString()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
}

function obtenerAutoresExcluidosAsistencia() {
    const raw = process.env.LIMPIEZA_ASISTENCIA_EXCLUIR_AUTORES || 'Saul Romero';

    return raw
        .split(',')
        .map((x) => normalizarTexto(x))
        .filter(Boolean);
}

function autorExcluidoAsistencia(autor = '') {
    const autorN = normalizarTexto(autor);
    if (!autorN) {
        return false;
    }

    return obtenerAutoresExcluidosAsistencia().some((bloqueado) => {
        return autorN.includes(bloqueado);
    });
}

function obtenerAutoresPermitidosPorGrupo(grupo = '') {
    const grupoN = normalizarTexto(grupo);
    return AUTORES_PERMITIDOS_POR_GRUPO[grupoN] || null;
}

function autorPermitidoPorGrupo(autor = '', grupo = '') {
    const permitidos = obtenerAutoresPermitidosPorGrupo(grupo);
    if (!permitidos) {
        return true;
    }

    const autorN = normalizarTexto(autor);
    if (!autorN) {
        return false;
    }

    return permitidos.some((permitido) => {
        const permitidoN = normalizarTexto(permitido);
        return autorN.includes(permitidoN) || permitidoN.includes(autorN);
    });
}

async function asegurarTablaAsistenciaLimpieza() {
    if (tablaCreada) {
        return;
    }

    await pool.query(`
        CREATE TABLE IF NOT EXISTS asistencia_limpieza_diaria (
            id SERIAL PRIMARY KEY,
            fecha DATE NOT NULL,
            autor TEXT NOT NULL,
            grupo TEXT NOT NULL,
            primer_reporte TIMESTAMP NOT NULL,
            ultimo_reporte TIMESTAMP NOT NULL,
            total_reportes INTEGER NOT NULL DEFAULT 0,
            total_evidencias INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
            UNIQUE (fecha, autor, grupo)
        )
    `);

    tablaCreada = true;
}

async function registrarAsistenciaLimpieza({
    fecha,
    autor,
    grupo,
    reportesIncremento = 0,
    evidenciasIncremento = 0
}) {
    await asegurarTablaAsistenciaLimpieza();

    if (!autorPermitidoPorGrupo(autor, grupo)) {
        return;
    }

    const grupoConLista = Boolean(obtenerAutoresPermitidosPorGrupo(grupo));
    if (!grupoConLista && autorExcluidoAsistencia(autor)) {
        return;
    }

    const ts = fecha.format('YYYY-MM-DD HH:mm:ss');
    const fechaDia = fecha.format('YYYY-MM-DD');

    const resultado = await pool.query(
        `
        INSERT INTO asistencia_limpieza_diaria
        (
            fecha,
            autor,
            grupo,
            primer_reporte,
            ultimo_reporte,
            total_reportes,
            total_evidencias
        )
        VALUES ($1, $2, $3, $4, $4, $5, $6)
        ON CONFLICT (fecha, autor, grupo)
        DO UPDATE
        SET
            primer_reporte = LEAST(asistencia_limpieza_diaria.primer_reporte, EXCLUDED.primer_reporte),
            ultimo_reporte = GREATEST(asistencia_limpieza_diaria.ultimo_reporte, EXCLUDED.ultimo_reporte),
            total_reportes = asistencia_limpieza_diaria.total_reportes + EXCLUDED.total_reportes,
            total_evidencias = asistencia_limpieza_diaria.total_evidencias + EXCLUDED.total_evidencias,
            updated_at = NOW()
        RETURNING id
        `,
        [
            fechaDia,
            autor || 'Sin nombre',
            grupo || 'Sin grupo',
            ts,
            reportesIncremento,
            evidenciasIncremento
        ]
    );

    return resultado.rows[0]?.id || null;
}

module.exports = {
    asegurarTablaAsistenciaLimpieza,
    registrarAsistenciaLimpieza,
    obtenerAutoresExcluidosAsistencia,
    obtenerAutoresPermitidosPorGrupo,
    autorPermitidoPorGrupo
};
