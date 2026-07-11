const pool = require('../db');

let tablaCreada = false;

const HORARIO_POR_AUTOR_MTTO = {
    'saul romero romero': '07:00-15:00',
    'eliezer romero romero': '14:00-22:00',
    'flavio cruz santiago': '23:00-06:00'
};

function normalizarTexto(valor = '') {
    return valor
        .toString()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function hhmmAMinutos(hhmm = '') {
    const [hh, mm] = String(hhmm || '').split(':').map((v) => Number.parseInt(v, 10));
    if (Number.isNaN(hh) || Number.isNaN(mm)) {
        return null;
    }

    return (hh * 60) + mm;
}

function extraerHorarioTurnoMtto(turno = '') {
    const valor = String(turno || '').trim();
    const match = valor.match(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
    if (match) {
        return { inicio: match[1], fin: match[2] };
    }

    const soloDigito = valor.match(/^([123])$/);
    if (soloDigito) {
        if (soloDigito[1] === '1') return { inicio: '07:00', fin: '15:00' };
        if (soloDigito[1] === '2') return { inicio: '14:00', fin: '22:00' };
        if (soloDigito[1] === '3') return { inicio: '23:00', fin: '06:00' };
    }

    return null;
}

function resolverHorarioOperativoMtto({ autor = '', turno = '' }) {
    const horarioTurno = extraerHorarioTurnoMtto(turno);
    if (horarioTurno) {
        return horarioTurno;
    }

    const autorN = normalizarTexto(autor);
    const horarioAutor = HORARIO_POR_AUTOR_MTTO[autorN] || '';
    const matchAutor = horarioAutor.match(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
    if (matchAutor) {
        return { inicio: matchAutor[1], fin: matchAutor[2] };
    }

    return null;
}

function obtenerFechaOperativaMantenimiento({ fecha, autor, turno }) {
    if (!fecha) {
        return null;
    }

    const horario = resolverHorarioOperativoMtto({ autor, turno });
    if (!horario) {
        return fecha.format('YYYY-MM-DD');
    }

    const inicio = hhmmAMinutos(horario.inicio);
    const fin = hhmmAMinutos(horario.fin);
    const actual = hhmmAMinutos(fecha.format('HH:mm'));

    if (inicio === null || fin === null || actual === null) {
        return fecha.format('YYYY-MM-DD');
    }

    const cruzaMedianoche = inicio > fin;
    if (!cruzaMedianoche) {
        return fecha.format('YYYY-MM-DD');
    }

    // Para turnos nocturnos, 00:00-fin pertenece al dia operativo anterior.
    if (actual < fin) {
        return fecha.clone().subtract(1, 'day').format('YYYY-MM-DD');
    }

    return fecha.format('YYYY-MM-DD');
}

async function asegurarTablaAsistenciaMantenimiento() {
    if (tablaCreada) {
        return;
    }

    await pool.query(`
        CREATE TABLE IF NOT EXISTS asistencia_mantenimiento_eventos (
            id SERIAL PRIMARY KEY,
            fecha DATE NOT NULL,
            autor TEXT NOT NULL,
            grupo TEXT NOT NULL,
            tipo_evento TEXT NOT NULL,
            ubicacion TEXT NOT NULL DEFAULT 'Sin ubicacion',
            turno TEXT NOT NULL DEFAULT 'Sin turno',
            mensaje_original TEXT NOT NULL DEFAULT '',
            mensaje_id TEXT NOT NULL UNIQUE,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        ALTER TABLE asistencia_mantenimiento_eventos
        ADD COLUMN IF NOT EXISTS evento_at TIMESTAMP
    `);

    await pool.query(`
        UPDATE asistencia_mantenimiento_eventos
        SET evento_at = ((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Mexico_City')
        WHERE evento_at IS NULL
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_asistencia_mtto_fecha_grupo_autor
        ON asistencia_mantenimiento_eventos (fecha, grupo, autor)
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_asistencia_mtto_grupo_evento_autor
        ON asistencia_mantenimiento_eventos (grupo, evento_at, autor)
    `);

    tablaCreada = true;
}

async function registrarAsistenciaMantenimiento({
    fecha,
    autor,
    grupo,
    tipoEvento,
    ubicacion,
    turno,
    mensajeOriginal,
    mensajeId
}) {
    await asegurarTablaAsistenciaMantenimiento();
    const fechaOperativa = obtenerFechaOperativaMantenimiento({
        fecha,
        autor,
        turno
    });

    const resultado = await pool.query(
        `
        INSERT INTO asistencia_mantenimiento_eventos
        (
            fecha,
            autor,
            grupo,
            tipo_evento,
            ubicacion,
            turno,
            mensaje_original,
            mensaje_id,
            evento_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (mensaje_id)
        DO UPDATE
        SET
            fecha = EXCLUDED.fecha,
            autor = EXCLUDED.autor,
            grupo = EXCLUDED.grupo,
            tipo_evento = EXCLUDED.tipo_evento,
            ubicacion = EXCLUDED.ubicacion,
            turno = EXCLUDED.turno,
            mensaje_original = EXCLUDED.mensaje_original,
            evento_at = EXCLUDED.evento_at,
            updated_at = NOW()
        RETURNING id
        `,
        [
            fechaOperativa || fecha.format('YYYY-MM-DD'),
            autor || 'Sin nombre',
            (grupo || 'Sin grupo').trim(),
            (tipoEvento || 'ENTRADA').toUpperCase(),
            ubicacion || 'Sin ubicacion',
            turno || 'Sin turno',
            mensajeOriginal || '',
            mensajeId,
            fecha.format('YYYY-MM-DD HH:mm:ss')
        ]
    );

    return resultado.rows[0]?.id || null;
}

async function actualizarUbicacionUltimoEventoMantenimiento({
    fecha,
    autor,
    grupo,
    tipoEvento,
    ubicacion,
    mensajeOriginal
}) {
    await asegurarTablaAsistenciaMantenimiento();

    const resultado = await pool.query(
        `
        UPDATE asistencia_mantenimiento_eventos
        SET
            ubicacion = $1,
            mensaje_original = $2,
            updated_at = NOW()
        WHERE id = (
            SELECT id
            FROM asistencia_mantenimiento_eventos
            WHERE autor = $3
              AND trim(grupo) = trim($4)
              AND tipo_evento = $5
              AND evento_at >= ($6::timestamp - INTERVAL '15 minutes')
              AND evento_at <= $6::timestamp
            ORDER BY evento_at DESC
            LIMIT 1
        )
        RETURNING id
        `,
        [
            ubicacion || 'Sin ubicacion',
            mensajeOriginal || '',
            autor || 'Sin nombre',
            (grupo || 'Sin grupo').trim(),
            (tipoEvento || 'ENTRADA').toUpperCase(),
            fecha.format('YYYY-MM-DD HH:mm:ss')
        ]
    );

    return resultado.rows[0]?.id || null;
}

module.exports = {
    asegurarTablaAsistenciaMantenimiento,
    registrarAsistenciaMantenimiento,
    actualizarUbicacionUltimoEventoMantenimiento
};