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
const ALERTA_ASISTENCIA_FALTA_MIN = Math.max(
    ALERTA_ASISTENCIA_TOLERANCIA_MIN + 1,
    Number.parseInt(process.env.ALERTA_ASISTENCIA_FALTA_MIN || '120', 10) || 120
);
const ALERTA_ASISTENCIA_ANTICIPO_MIN = Math.max(
    0,
    Number.parseInt(process.env.ALERTA_ASISTENCIA_ANTICIPO_MIN || '30', 10) || 30
);

const GRUPO_LIMPIEZA_ALERTAS = process.env.LIMPIEZA_GROUP_NAME || 'Asistencia limpieza SHP1 Pachuca';
const GRUPO_INGENIERIA_ALERTAS = process.env.MANTENIMIENTO_ASISTENCIA_GROUP_NAME || 'Asistencia SHP1 Pachuca';

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
        aliases: ['saul romero romero', 'saul romero', 'saul', 'ctamez2016b', '~ ctamez2016b'],
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
        turno: '3er turno 23:00-06:00',
        turnoInicio: '23:00',
        turnoFin: '06:00'
    }
];
const INGENIERIA_DESCANSO_DOMINGO_KEYS = new Set(['saul', 'eliezer', 'flavio']);

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
                        SELECT tipo, turno, motivo
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

function aplicarAjusteTurnoIngenieria(persona = {}, ajuste = null) {
    const turnoAjuste = String(ajuste?.turno || '').trim();
    if (ajuste?.tipo !== 'CAMBIO_TURNO' || !turnoAjuste) {
        return persona;
    }

    const horario = extraerHorarioTurno(turnoAjuste);
    if (!horario) {
        return persona;
    }

    return {
        ...persona,
        turno: `Ajuste ${turnoAjuste}`,
        turnoInicio: horario.turnoInicio,
        turnoFin: horario.turnoFin
    };
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
                            AND COALESCE(evento_at, ((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Mexico_City')) >= $2::timestamp
                            AND COALESCE(evento_at, ((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Mexico_City')) <= $3::timestamp
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

    return false;
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

        const minutosDesdeInicio = Math.max(0, ahoraMx.diff(ventana.inicio, 'minutes'));
        const severidad = minutosDesdeInicio > ALERTA_ASISTENCIA_FALTA_MIN ? 'FALTA' : 'RETARDO';

        const reportoActividad = await existeActividadTurno(pool, {
            persona,
            inicio: ventana.inicio.clone().subtract(ALERTA_ASISTENCIA_ANTICIPO_MIN, 'minutes'),
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
            faltaMin: ALERTA_ASISTENCIA_FALTA_MIN,
            severidad,
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
        const personaEfectiva = aplicarAjusteTurnoIngenieria(persona, ajuste);
        const ventana = obtenerVentanaTurno(personaEfectiva, ahoraMx);

        const personaKey = (persona.key || '').toLowerCase();
        const descansoDominical = INGENIERIA_DESCANSO_DOMINGO_KEYS.has(personaKey) && (
            personaKey === 'flavio'
                ? ventana.inicio.isoWeekday() === 7
                : ahoraMx.isoWeekday() === 7
        );
        if (descansoDominical && ajuste?.tipo !== 'LABORA') {
            continue;
        }

        if (ajuste?.tipo === 'PERMISO') {
            continue;
        }

        if (ahoraMx.isBefore(ventana.inicio) || ahoraMx.isAfter(ventana.fin)) {
            continue;
        }

        const inicioConTolerancia = ventana.inicio.clone().add(ALERTA_ASISTENCIA_TOLERANCIA_MIN, 'minutes');
        if (ahoraMx.isBefore(inicioConTolerancia)) {
            continue;
        }

        const minutosDesdeInicio = Math.max(0, ahoraMx.diff(ventana.inicio, 'minutes'));
        const severidad = minutosDesdeInicio > ALERTA_ASISTENCIA_FALTA_MIN ? 'FALTA' : 'RETARDO';

        const reportoActividad = await existeActividadTurnoIngenieria(pool, {
            persona: personaEfectiva,
            inicio: ventana.inicio.clone().subtract(ALERTA_ASISTENCIA_ANTICIPO_MIN, 'minutes'),
            fin: ahoraMx
        });

        if (reportoActividad) {
            continue;
        }

        alertas.push({
            key: persona.key,
            etiqueta: personaEfectiva.etiqueta,
            persona: personaEfectiva.nombre,
            turno: personaEfectiva.turno,
            turnoInicio: personaEfectiva.turnoInicio,
            turnoFin: personaEfectiva.turnoFin,
            grupo: personaEfectiva.grupo,
            toleranciaMin: ALERTA_ASISTENCIA_TOLERANCIA_MIN,
            faltaMin: ALERTA_ASISTENCIA_FALTA_MIN,
            severidad,
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