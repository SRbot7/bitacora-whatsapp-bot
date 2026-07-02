const pool = require('../db');
const {
    resolverPersonaMarcador,
    extraerHorarioTurno,
    normalizarTexto: normalizarTextoMarcador
} = require('./limpieza-personal');

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
            persona_key TEXT,
            turno TEXT,
            horario TEXT,
            fuente_registro TEXT,
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

    await pool.query('ALTER TABLE asistencia_limpieza_diaria ADD COLUMN IF NOT EXISTS persona_key TEXT');
    await pool.query('ALTER TABLE asistencia_limpieza_diaria ADD COLUMN IF NOT EXISTS turno TEXT');
    await pool.query('ALTER TABLE asistencia_limpieza_diaria ADD COLUMN IF NOT EXISTS horario TEXT');
    await pool.query('ALTER TABLE asistencia_limpieza_diaria ADD COLUMN IF NOT EXISTS fuente_registro TEXT');

    tablaCreada = true;
}

function construirClavePersonaFallback(autor = '') {
    const normalizado = normalizarTextoMarcador(autor)
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, '_')
        .replace(/^_+|_+$/g, '');

    return normalizado || 'sin_nombre';
}

function enriquecerPersonaAsistenciaLimpieza(autor = '') {
    const persona = resolverPersonaMarcador(autor);
    if (!persona) {
        return {
            esReconocida: false,
            autorCanonico: autor || 'Sin nombre',
            personaKey: construirClavePersonaFallback(autor),
            turno: null,
            horario: null
        };
    }

    const horarioTurno = extraerHorarioTurno(persona.turno || '');
    return {
        esReconocida: true,
        autorCanonico: persona.nombre,
        personaKey: persona.key,
        turno: persona.turno || null,
        horario: horarioTurno ? `${horarioTurno.turnoInicio}-${horarioTurno.turnoFin}` : null
    };
}

function hhmmAMinutos(hhmm = '') {
    const [hh, mm] = String(hhmm || '').split(':').map((v) => Number.parseInt(v, 10));
    if (Number.isNaN(hh) || Number.isNaN(mm)) {
        return null;
    }

    return (hh * 60) + mm;
}

function obtenerFechaOperativaTurno({ turno, fecha }) {
    const horario = extraerHorarioTurno(turno || '');
    if (!horario || !fecha) {
        return fecha ? fecha.format('YYYY-MM-DD') : null;
    }

    const inicio = hhmmAMinutos(horario.turnoInicio);
    const fin = hhmmAMinutos(horario.turnoFin);
    const minutoActual = hhmmAMinutos(fecha.format('HH:mm'));

    if (inicio === null || fin === null || minutoActual === null) {
        return fecha.format('YYYY-MM-DD');
    }

    const cruzaMedianoche = inicio > fin;
    if (!cruzaMedianoche) {
        return fecha.format('YYYY-MM-DD');
    }

    if (minutoActual < fin) {
        return fecha.clone().subtract(1, 'day').format('YYYY-MM-DD');
    }

    return fecha.format('YYYY-MM-DD');
}

function estaEnHorarioTurno({ turno, fecha }) {
    const horario = extraerHorarioTurno(turno || '');
    if (!horario || !fecha) {
        return false;
    }

    const minutoActual = hhmmAMinutos(fecha.format('HH:mm'));
    const inicio = hhmmAMinutos(horario.turnoInicio);
    const fin = hhmmAMinutos(horario.turnoFin);

    if (minutoActual === null || inicio === null || fin === null) {
        return false;
    }

    if (inicio < fin) {
        return minutoActual >= inicio && minutoActual < fin;
    }

    if (inicio > fin) {
        return minutoActual >= inicio || minutoActual < fin;
    }

    return false;
}

async function resolverAutorPersistente({ fechaDia, grupo, autorCanonico, personaKey }) {
    const filasDia = await pool.query(
        `
        SELECT id, autor
        FROM asistencia_limpieza_diaria
        WHERE fecha = $1
          AND grupo = $2
        ORDER BY id ASC
        `,
        [fechaDia, grupo || 'Sin grupo']
    );

    const filasMismaPersona = filasDia.rows.filter((row) => {
        const enriquecida = enriquecerPersonaAsistenciaLimpieza(row.autor);
        return enriquecida.personaKey === personaKey;
    });

    const filaCanonica = filasMismaPersona.find((row) => row.autor === autorCanonico);
    const filaMismaPersona = filaCanonica || filasMismaPersona[0];

    if (!filaMismaPersona) {
        return autorCanonico;
    }

    if (filaMismaPersona.autor === autorCanonico) {
        return autorCanonico;
    }

    try {
        await pool.query(
            `
            UPDATE asistencia_limpieza_diaria
            SET autor = $1, updated_at = NOW()
            WHERE id = $2
            `,
            [autorCanonico, filaMismaPersona.id]
        );

        return autorCanonico;
    } catch (error) {
        if (error && error.code === '23505') {
            return filaMismaPersona.autor;
        }

        throw error;
    }
}

async function registrarAsistenciaLimpieza({
    fecha,
    autor,
    grupo,
    fuenteRegistro = 'AUTOMATICO',
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

    const persona = enriquecerPersonaAsistenciaLimpieza(autor || 'Sin nombre');

    // Asistencia SOLO por primera evidencia enviada dentro del horario del turno.
    // Si no hay evidencia valida en turno, se considera falta y no se registra asistencia.
    if (!persona.esReconocida) {
        return null;
    }

    if (evidenciasIncremento <= 0) {
        return null;
    }

    if (!estaEnHorarioTurno({ turno: persona.turno, fecha })) {
        return null;
    }

    const ts = fecha.format('YYYY-MM-DD HH:mm:ss');
    const fechaDia = obtenerFechaOperativaTurno({ turno: persona.turno, fecha });
    const autorPersistente = await resolverAutorPersistente({
        fechaDia,
        grupo,
        autorCanonico: persona.autorCanonico,
        personaKey: persona.personaKey
    });

    const reporteBandera = 1;
    const evidenciaBandera = 1;

    const resultado = await pool.query(
        `
        INSERT INTO asistencia_limpieza_diaria
        (
            fecha,
            autor,
            persona_key,
            turno,
            horario,
            fuente_registro,
            grupo,
            primer_reporte,
            ultimo_reporte,
            total_reportes,
            total_evidencias
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10)
        ON CONFLICT (fecha, autor, grupo)
        DO UPDATE
        SET
            primer_reporte = LEAST(asistencia_limpieza_diaria.primer_reporte, EXCLUDED.primer_reporte),
            ultimo_reporte = GREATEST(asistencia_limpieza_diaria.ultimo_reporte, EXCLUDED.ultimo_reporte),
            total_reportes = GREATEST(asistencia_limpieza_diaria.total_reportes, EXCLUDED.total_reportes),
            total_evidencias = GREATEST(asistencia_limpieza_diaria.total_evidencias, EXCLUDED.total_evidencias),
            persona_key = COALESCE(asistencia_limpieza_diaria.persona_key, EXCLUDED.persona_key),
            turno = COALESCE(asistencia_limpieza_diaria.turno, EXCLUDED.turno),
            horario = COALESCE(asistencia_limpieza_diaria.horario, EXCLUDED.horario),
            fuente_registro =
                CASE
                    WHEN asistencia_limpieza_diaria.fuente_registro = 'MANUAL' THEN asistencia_limpieza_diaria.fuente_registro
                    ELSE EXCLUDED.fuente_registro
                END,
            updated_at = NOW()
        RETURNING id
        `,
        [
            fechaDia,
            autorPersistente || 'Sin nombre',
            persona.personaKey,
            persona.turno,
            persona.horario,
            (fuenteRegistro || 'AUTOMATICO').toUpperCase(),
            grupo || 'Sin grupo',
            ts,
            reporteBandera,
            evidenciaBandera
        ]
    );

    return resultado.rows[0]?.id || null;
}

module.exports = {
    asegurarTablaAsistenciaLimpieza,
    registrarAsistenciaLimpieza,
    obtenerAutoresExcluidosAsistencia,
    obtenerAutoresPermitidosPorGrupo,
    autorPermitidoPorGrupo,
    estaEnHorarioTurno,
    obtenerFechaOperativaTurno
};
