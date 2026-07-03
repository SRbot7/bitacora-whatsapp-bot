const moment = require('moment-timezone');
const {
    MARCADOR_PERSONAL,
    normalizarTexto,
    getWeekOffset,
    esDescansoProgramado,
    extraerHorarioTurno
} = require('./limpieza-personal');

const ALERTA_ASISTENCIA_TOLERANCIA_MIN = Math.max(
    60,
    Number.parseInt(process.env.ALERTA_ASISTENCIA_TOLERANCIA_MIN || '60', 10) || 60
);

const GRUPO_LIMPIEZA_ALERTAS = 'MELI SVC PACHUCA - BATIA LIMPIEZA';
const GRUPO_INGENIERIA_ALERTAS = 'Asistencia SHP1 Pachuca';

const ALERTAS_ASISTENCIA_TURNO = MARCADOR_PERSONAL.map((persona) => {
    const horario = extraerHorarioTurno(persona.turno) || { turnoInicio: '00:00', turnoFin: '23:59' };

    return {
        key: persona.key,
        nombre: persona.nombre,
        aliases: persona.aliases,
        grupo: GRUPO_LIMPIEZA_ALERTAS,
        etiqueta: 'LIMPIEZA',
        fuente: 'LIMPIEZA_ACTIVIDAD',
        turno: persona.turno,
        turnoInicio: horario.turnoInicio,
        turnoFin: horario.turnoFin
    };
});

const ALERTAS_ASISTENCIA_INGENIERIA_TURNO = [
    {
        key: 'saul',
        nombre: 'Saul Romero Romero',
        aliases: ['saul romero romero', 'saul romero', 'saul'],
        grupo: GRUPO_INGENIERIA_ALERTAS,
        etiqueta: 'INGENIERIA',
        fuente: 'MANTENIMIENTO_ASISTENCIA',
        turno: '1er turno 06:00-14:00',
        turnoInicio: '06:00',
        turnoFin: '14:00'
    },
    {
        key: 'eliezer',
        nombre: 'Eliezer Romero Romero',
        aliases: ['eliezer romero romero', 'eliezer romero', 'eliezer'],
        grupo: GRUPO_INGENIERIA_ALERTAS,
        etiqueta: 'INGENIERIA',
        fuente: 'MANTENIMIENTO_ASISTENCIA',
        turno: '2do turno 14:00-22:00',
        turnoInicio: '14:00',
        turnoFin: '22:00'
    },
    {
        key: 'flavio',
        nombre: 'Flavio Cruz Santiago',
        aliases: ['flavio cruz santiago', 'flavio cruz', 'flavio'],
        grupo: GRUPO_INGENIERIA_ALERTAS,
        etiqueta: 'INGENIERIA',
        fuente: 'MANTENIMIENTO_ASISTENCIA',
        turno: '3er turno 22:00-06:00',
        turnoInicio: '22:00',
        turnoFin: '06:00'
    }
];

function normalizarAutor(texto = '') {
    return normalizarTexto(texto)
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function construirFechaHora(base, hhmm) {
    const [hora, minuto] = hhmm.split(':').map((v) => Number.parseInt(v, 10) || 0);
    return base.clone().startOf('day').hour(hora).minute(minuto).second(0).millisecond(0);
}

function obtenerVentanaTurno(persona, ahoraMx) {
    const inicioHoy = construirFechaHora(ahoraMx, persona.turnoInicio);
    const finHoy = construirFechaHora(ahoraMx, persona.turnoFin);
    const cruzaMedianoche = finHoy.isSameOrBefore(inicioHoy);

    if (!cruzaMedianoche) {
        return { inicio: inicioHoy, fin: finHoy };
    }

    if (ahoraMx.isSameOrAfter(inicioHoy)) {
        return { inicio: inicioHoy, fin: finHoy.clone().add(1, 'day') };
    }

    return { inicio: inicioHoy.clone().subtract(1, 'day'), fin: finHoy };
}

async function obtenerAjusteAsistencia(pool, { fecha, personaKey }) {
    try {
        const resultado = await pool.query(
            `
            SELECT tipo
            FROM asistencia_limpieza_ajustes
            WHERE fecha = $1
              AND persona_key = $2
            LIMIT 1
            `,
            [fecha, personaKey]
        );

        return resultado.rows[0] || null;
    } catch (error) {
        if (error && error.code === '42P01') {
            return null;
        }

        throw error;
    }
}

async function existeActividadTurno(pool, { persona, inicio, fin }) {
    const resultado = await pool.query(
        `
        SELECT autor, fecha
        FROM actividades_limpieza
        WHERE grupo = $1
          AND fecha >= $2
          AND fecha <= $3
        ORDER BY fecha DESC
        `,
        [
            persona.grupo,
            inicio.format('YYYY-MM-DD HH:mm:ss'),
            fin.format('YYYY-MM-DD HH:mm:ss')
        ]
    );

    const aliases = persona.aliases
        .map((alias) => normalizarAutor(alias))
        .filter(Boolean);

    return resultado.rows.some((row) => {
        const autor = normalizarAutor(row.autor || '');
        if (!autor) {
            return false;
        }

        return aliases.some((alias) => autor === alias || autor.includes(alias) || alias.includes(autor));
    });
}

async function existeActividadTurnoIngenieria(pool, { persona, inicio, fin }) {
    const aliases = persona.aliases
        .map((alias) => normalizarAutor(alias))
        .filter(Boolean);

    try {
        const eventosRes = await pool.query(
            `
            SELECT autor
            FROM asistencia_mantenimiento_eventos
            WHERE grupo = $1
              AND created_at >= $2
              AND created_at <= $3
            ORDER BY created_at DESC
            `,
            [
                persona.grupo,
                inicio.format('YYYY-MM-DD HH:mm:ss'),
                fin.format('YYYY-MM-DD HH:mm:ss')
            ]
        );

        const encontroEvento = eventosRes.rows.some((row) => {
            const autor = normalizarAutor(row.autor || '');
            if (!autor) {
                return false;
            }

            return aliases.some((alias) => autor === alias || autor.includes(alias) || alias.includes(autor));
        });

        if (encontroEvento) {
            return true;
        }
    } catch (error) {
        if (!error || error.code !== '42P01') {
            throw error;
        }
    }

    try {
        const legacyRes = await pool.query(
            `
            SELECT autor, total_reportes, total_evidencias
            FROM asistencia_limpieza_diaria
            WHERE grupo = $1
              AND fecha >= $2
              AND fecha <= $3
            `,
            [
                persona.grupo,
                inicio.format('YYYY-MM-DD'),
                fin.format('YYYY-MM-DD')
            ]
        );

        return legacyRes.rows.some((row) => {
            const autor = normalizarAutor(row.autor || '');
            const tieneActividad = Number(row.total_reportes || 0) > 0 || Number(row.total_evidencias || 0) > 0;
            if (!autor || !tieneActividad) {
                return false;
            }

            return aliases.some((alias) => autor === alias || autor.includes(alias) || alias.includes(autor));
        });
    } catch (error) {
        if (error && error.code === '42P01') {
            return false;
        }

        throw error;
    }
}

async function obtenerAlertasAsistenciaLimpieza(pool, ahoraInput = null) {
    const ahoraMx = ahoraInput
        ? moment(ahoraInput).tz('America/Mexico_City')
        : moment().tz('America/Mexico_City');

    const alertas = [];

    for (const persona of ALERTAS_ASISTENCIA_TURNO) {
        const dayIdx = (ahoraMx.isoWeekday() + 6) % 7;
        const weekOffset = getWeekOffset(ahoraMx.toDate());
        const ajuste = await obtenerAjusteAsistencia(pool, {
            fecha: ahoraMx.format('YYYY-MM-DD'),
            personaKey: persona.key
        });
        const permiso = ajuste?.tipo === 'PERMISO';

        let descanso = esDescansoProgramado(persona.key, dayIdx, weekOffset);
        if (ajuste?.tipo === 'DESCANSO') {
            descanso = true;
        }
        else if (ajuste?.tipo === 'LABORA') {
            descanso = false;
        }

        if (descanso || permiso) {
            continue;
        }

        const ventana = obtenerVentanaTurno(persona, ahoraMx);
        if (ahoraMx.isBefore(ventana.inicio) || ahoraMx.isAfter(ventana.fin)) {
            continue;
        }

        const inicioConTolerancia = ventana.inicio.clone().add(ALERTA_ASISTENCIA_TOLERANCIA_MIN, 'minutes');
        if (ahoraMx.isBefore(inicioConTolerancia)) {
            continue;
        }

        const reportoActividad = await existeActividadTurno(pool, {
            persona,
            inicio: ventana.inicio,
            fin: ahoraMx
        });

        if (reportoActividad) {
            continue;
        }

        alertas.push({
            key: persona.key,
            etiqueta: persona.etiqueta,
            persona: persona.nombre,
            turno: persona.turno,
            turnoInicio: persona.turnoInicio,
            turnoFin: persona.turnoFin,
            grupo: persona.grupo,
            toleranciaMin: ALERTA_ASISTENCIA_TOLERANCIA_MIN,
            enAlertaDesde: inicioConTolerancia.format('YYYY-MM-DD HH:mm:ss'),
            minutosAtraso: Math.max(0, ahoraMx.diff(inicioConTolerancia, 'minutes'))
        });
    }

    return {
        generatedAt: ahoraMx.format('YYYY-MM-DD HH:mm:ss'),
        toleranciaMin: ALERTA_ASISTENCIA_TOLERANCIA_MIN,
        total: alertas.length,
        items: alertas
    };
}

async function obtenerEstadoTurnoLimpieza(pool, ahoraInput = null) {
    const ahoraMx = ahoraInput
        ? moment(ahoraInput).tz('America/Mexico_City')
        : moment().tz('America/Mexico_City');

    const resumen = {
        generatedAt: ahoraMx.format('YYYY-MM-DD HH:mm:ss'),
        enTurno: [],
        sinRegistro: [],
        descanso: [],
        permiso: [],
        sinCobertura: true
    };

    for (const persona of ALERTAS_ASISTENCIA_TURNO) {
        const dayIdx = (ahoraMx.isoWeekday() + 6) % 7;
        const weekOffset = getWeekOffset(ahoraMx.toDate());
        const ajuste = await obtenerAjusteAsistencia(pool, {
            fecha: ahoraMx.format('YYYY-MM-DD'),
            personaKey: persona.key
        });
        const permiso = ajuste?.tipo === 'PERMISO';

        let descanso = esDescansoProgramado(persona.key, dayIdx, weekOffset);
        if (ajuste?.tipo === 'DESCANSO') {
            descanso = true;
        }
        else if (ajuste?.tipo === 'LABORA') {
            descanso = false;
        }

        const ventana = obtenerVentanaTurno(persona, ahoraMx);
        const enVentanaTurno = !(ahoraMx.isBefore(ventana.inicio) || ahoraMx.isAfter(ventana.fin));

        if (!enVentanaTurno) {
            continue;
        }

        resumen.sinCobertura = false;

        if (descanso) {
            resumen.descanso.push({
                key: persona.key,
                persona: persona.nombre,
                turno: persona.turno
            });
            continue;
        }

        if (permiso) {
            resumen.permiso.push({
                key: persona.key,
                persona: persona.nombre,
                turno: persona.turno
            });
            continue;
        }

        const reportoActividad = await existeActividadTurno(pool, {
            persona,
            inicio: ventana.inicio,
            fin: ahoraMx
        });

        if (reportoActividad) {
            resumen.enTurno.push({
                key: persona.key,
                persona: persona.nombre,
                turno: persona.turno
            });
            continue;
        }

        resumen.sinRegistro.push({
            key: persona.key,
            persona: persona.nombre,
            turno: persona.turno,
            turnoInicio: persona.turnoInicio,
            turnoFin: persona.turnoFin
        });
    }

    return resumen;
}

async function obtenerAlertasAsistenciaIngenieria(pool, ahoraInput = null) {
    const ahoraMx = ahoraInput
        ? moment(ahoraInput).tz('America/Mexico_City')
        : moment().tz('America/Mexico_City');

    const alertas = [];

    for (const persona of ALERTAS_ASISTENCIA_INGENIERIA_TURNO) {
        const ajuste = await obtenerAjusteAsistencia(pool, {
            fecha: ahoraMx.format('YYYY-MM-DD'),
            personaKey: persona.key
        });

        if (ajuste?.tipo === 'PERMISO') {
            continue;
        }

        const ventana = obtenerVentanaTurno(persona, ahoraMx);
        if (ahoraMx.isBefore(ventana.inicio) || ahoraMx.isAfter(ventana.fin)) {
            continue;
        }

        const inicioConTolerancia = ventana.inicio.clone().add(ALERTA_ASISTENCIA_TOLERANCIA_MIN, 'minutes');
        if (ahoraMx.isBefore(inicioConTolerancia)) {
            continue;
        }

        const reportoActividad = await existeActividadTurnoIngenieria(pool, {
            persona,
            inicio: ventana.inicio,
            fin: ahoraMx
        });

        if (reportoActividad) {
            continue;
        }

        alertas.push({
            key: persona.key,
            etiqueta: persona.etiqueta,
            persona: persona.nombre,
            turno: persona.turno,
            turnoInicio: persona.turnoInicio,
            turnoFin: persona.turnoFin,
            grupo: persona.grupo,
            toleranciaMin: ALERTA_ASISTENCIA_TOLERANCIA_MIN,
            enAlertaDesde: inicioConTolerancia.format('YYYY-MM-DD HH:mm:ss'),
            minutosAtraso: Math.max(0, ahoraMx.diff(inicioConTolerancia, 'minutes'))
        });
    }

    return {
        generatedAt: ahoraMx.format('YYYY-MM-DD HH:mm:ss'),
        toleranciaMin: ALERTA_ASISTENCIA_TOLERANCIA_MIN,
        total: alertas.length,
        items: alertas
    };
}

module.exports = {
    ALERTA_ASISTENCIA_TOLERANCIA_MIN,
    GRUPO_LIMPIEZA_ALERTAS,
    GRUPO_INGENIERIA_ALERTAS,
    ALERTAS_ASISTENCIA_TURNO,
    ALERTAS_ASISTENCIA_INGENIERIA_TURNO,
    normalizarAutor,
    construirFechaHora,
    obtenerVentanaTurno,
    obtenerAjusteAsistencia,
    existeActividadTurno,
    existeActividadTurnoIngenieria,
    obtenerAlertasAsistenciaLimpieza,
    obtenerEstadoTurnoLimpieza,
    obtenerAlertasAsistenciaIngenieria
};