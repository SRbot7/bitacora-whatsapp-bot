const moment = require('moment-timezone');
const pool = require('../db');
const {
    obtenerFechaOperativaTurno,
    consolidarAsistenciaLimpiezaDiariaDesdeEventos
} = require('./asistencia-limpieza');
const {
    MARCADOR_PERSONAL,
    normalizarTexto,
    getWeekOffset,
    esDescansoProgramado,
    extraerHorarioTurno,
    resolverPersonaMarcador
} = require('./limpieza-personal');

const GRUPO_LIMPIEZA = process.env.LIMPIEZA_GROUP_NAME || 'MELI SVC PACHUCA - BATIA LIMPIEZA';
const GRUPO_LIMPIEZA_ASISTENCIA = process.env.LIMPIEZA_ASISTENCIA_GROUP_NAME || 'Asistencia limpieza SHP1 Pachuca';
const GRUPO_MANTENIMIENTO = process.env.MANTENIMIENTO_ASISTENCIA_GROUP_NAME || 'Asistencia SHP1 Pachuca';
const GRUPOS_LIMPIEZA_CON_REGISTRO = Array.from(new Set([
    GRUPO_LIMPIEZA,
    GRUPO_LIMPIEZA_ASISTENCIA
]));
const ASISTENCIA_RETARDO_MINUTOS = Math.max(
    1,
    Number.parseInt(process.env.ASISTENCIA_RETARDO_MINUTOS || '60', 10) || 60
);
const ASISTENCIA_FALTA_MINUTOS = Math.max(
    ASISTENCIA_RETARDO_MINUTOS + 1,
    Number.parseInt(process.env.ASISTENCIA_FALTA_MINUTOS || '120', 10) || 120
);

const EQUIPO_MANTENIMIENTO = [
    {
        key: 'saul',
        nombre: 'Saul Romero Romero',
        turno: '1er turno 07:00-15:00',
        aliases: ['saul romero romero', 'saul romero', 'saul', 'ctamez2016b', '~ ctamez2016b']
    },
    {
        key: 'eliezer',
        nombre: 'Eliezer Romero Romero',
        turno: '2do turno 14:00-22:00',
        aliases: ['eliezer romero romero', 'eliezer romero', 'eliezer']
    },
    {
        key: 'flavio',
        nombre: 'Flavio Cruz Santiago',
        turno: '3er turno 23:00-06:00',
        aliases: ['flavio cruz santiago', 'flavio cruz', 'flavio']
    }
];
const MANTENIMIENTO_DESCANSO_DOMINGO_KEYS = new Set(['saul', 'eliezer', 'flavio']);

let tablaCreada = false;

function normalizarAutor(texto = '') {
    return normalizarTexto(texto)
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function construirFechaHora(base, hhmm) {
    const [hora, minuto] = hhmm.split(':').map((valor) => Number.parseInt(valor, 10) || 0);
    return base.clone().startOf('day').hour(hora).minute(minuto).second(0).millisecond(0);
}

function obtenerVentanaTurno(persona, ahoraMx) {
    const turno = extraerHorarioTurno(persona.turno || '') || { turnoInicio: '00:00', turnoFin: '23:59' };
    const inicioHoy = construirFechaHora(ahoraMx, turno.turnoInicio);
    const finHoy = construirFechaHora(ahoraMx, turno.turnoFin);
    const cruzaMedianoche = finHoy.isSameOrBefore(inicioHoy);

    if (!cruzaMedianoche) {
        return { inicio: inicioHoy, fin: finHoy };
    }

    if (ahoraMx.isSameOrAfter(inicioHoy)) {
        return { inicio: inicioHoy, fin: finHoy.clone().add(1, 'day') };
    }

    return { inicio: inicioHoy.clone().subtract(1, 'day'), fin: finHoy };
}

function coincideAutorConPersona(autor = '', persona = null) {
    if (!persona) {
        return false;
    }

    const autorN = normalizarAutor(autor);
    if (!autorN) {
        return false;
    }

    return (persona.aliases || []).some((alias) => {
        const aliasN = normalizarAutor(alias);
        return aliasN && (autorN.includes(aliasN) || aliasN.includes(autorN));
    });
}

function resolverPersonaMantenimiento(autor = '') {
    const autorN = normalizarAutor(autor);
    if (!autorN) {
        return null;
    }

    for (const persona of EQUIPO_MANTENIMIENTO) {
        const matched = persona.aliases.some((alias) => {
            const aliasN = normalizarAutor(alias);
            return autorN.includes(aliasN) || aliasN.includes(autorN);
        });

        if (matched) {
            return persona;
        }
    }

    return null;
}

async function asegurarTablaEstadoAsistencia() {
    if (tablaCreada) {
        return;
    }

    await pool.query(`
        CREATE TABLE IF NOT EXISTS estado_asistencia_diaria (
            fecha DATE NOT NULL,
            area TEXT NOT NULL,
            grupo TEXT NOT NULL,
            persona_key TEXT NOT NULL,
            persona TEXT NOT NULL,
            turno TEXT NOT NULL,
            horario TEXT NOT NULL,
            estado_turno TEXT NOT NULL,
            detalle_turno TEXT NOT NULL DEFAULT '',
            tiene_registro BOOLEAN NOT NULL DEFAULT FALSE,
            actualizado_at TIMESTAMP NOT NULL DEFAULT NOW(),
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            PRIMARY KEY (fecha, area, persona_key)
        )
    `);

    tablaCreada = true;
}

async function obtenerAjusteLimpieza(poolRef, { fecha, personaKey }) {
    try {
        const res = await poolRef.query(
            `
                        SELECT tipo, turno, motivo
            FROM asistencia_limpieza_ajustes
            WHERE fecha = $1
              AND persona_key = $2
            LIMIT 1
            `,
            [fecha, personaKey]
        );

        return res.rows[0] || null;
    } catch (error) {
        if (error && error.code === '42P01') {
            return null;
        }

        throw error;
    }
}

function resolverTurnoMttoConAjuste(persona = {}, ajuste = null) {
    const turnoBase = persona?.turno || 'Sin turno';
    const turnoAjuste = String(ajuste?.turno || '').trim();
    if (ajuste?.tipo !== 'CAMBIO_TURNO' || !turnoAjuste) {
        return turnoBase;
    }

    const horario = extraerHorarioTurno(turnoAjuste);
    if (!horario) {
        return turnoBase;
    }

    return `Ajuste ${turnoAjuste}`;
}

function resolverEstadoLimpieza(persona, ahoraMx, tieneRegistro, ajuste) {
    const dayIdx = (ahoraMx.isoWeekday() + 6) % 7;
    const weekOffset = getWeekOffset(ahoraMx.toDate());
    let descanso = esDescansoProgramado(persona.key, dayIdx, weekOffset);
    const permiso = ajuste?.tipo === 'PERMISO';

    if (ajuste?.tipo === 'DESCANSO') {
        descanso = true;
    } else if (ajuste?.tipo === 'LABORA') {
        descanso = false;
    }

    const ventana = obtenerVentanaTurno(persona, ahoraMx);
    const dentroVentana = ahoraMx.isSameOrAfter(ventana.inicio) && ahoraMx.isSameOrBefore(ventana.fin);
    const despuesDeSalida = ahoraMx.isAfter(ventana.fin);
    const minutosDesdeInicio = Math.max(0, ahoraMx.diff(ventana.inicio, 'minutes'));

    if (descanso) {
        return {
            estadoTurno: 'DESCANSO',
            detalleTurno: 'Descanso programado',
            tieneRegistro: false,
            ventana
        };
    }

    if (permiso) {
        return {
            estadoTurno: 'PERMISO',
            detalleTurno: 'Permiso autorizado',
            tieneRegistro: false,
            ventana
        };
    }

    if (despuesDeSalida) {
        return {
            estadoTurno: tieneRegistro ? 'SALIDA' : 'FALTA',
            detalleTurno: tieneRegistro ? 'Hora de salida cumplida' : 'Sin evidencia en turno (falta)',
            tieneRegistro,
            ventana
        };
    }

    if (dentroVentana) {
        if (!tieneRegistro && minutosDesdeInicio > ASISTENCIA_FALTA_MINUTOS) {
            return {
                estadoTurno: 'FALTA',
                detalleTurno: 'Mas de 120 min sin evidencia',
                tieneRegistro: false,
                ventana
            };
        }

        if (!tieneRegistro && minutosDesdeInicio > ASISTENCIA_RETARDO_MINUTOS) {
            return {
                estadoTurno: 'RETARDO',
                detalleTurno: 'Mas de 60 min sin evidencia',
                tieneRegistro: false,
                ventana
            };
        }

        return {
            estadoTurno: tieneRegistro ? 'EN_TURNO' : 'SIN_REGISTRO',
            detalleTurno: tieneRegistro ? 'Con registro en ventana' : 'Sin registro en ventana',
            tieneRegistro,
            ventana
        };
    }

    return {
        estadoTurno: tieneRegistro ? 'FUERA_DE_TURNO' : 'FUERA_DE_TURNO',
        detalleTurno: 'Fuera de turno',
        tieneRegistro,
        ventana
    };
}

function resolverEstadoMantenimiento(persona, ahoraMx, tieneRegistro, ajuste) {
    const ventana = obtenerVentanaTurno(persona, ahoraMx);
    const personaKey = (persona?.key || '').toLowerCase();
    const aplicaReglaDomingo = MANTENIMIENTO_DESCANSO_DOMINGO_KEYS.has(personaKey);
    const descansoDominical = aplicaReglaDomingo && (
        personaKey === 'flavio'
            ? ventana.inicio.isoWeekday() === 7
            : ahoraMx.isoWeekday() === 7
    );
    const dentroVentana = ahoraMx.isSameOrAfter(ventana.inicio) && ahoraMx.isSameOrBefore(ventana.fin);
    const despuesDeSalida = ahoraMx.isAfter(ventana.fin);
    const permiso = ajuste?.tipo === 'PERMISO';

    if (descansoDominical && ajuste?.tipo !== 'LABORA') {
        return {
            estadoTurno: 'DESCANSO',
            detalleTurno: 'Descanso programado (domingo)',
            tieneRegistro: false,
            ventana
        };
    }

    if (permiso) {
        return {
            estadoTurno: 'PERMISO',
            detalleTurno: 'Permiso autorizado',
            tieneRegistro: false,
            ventana
        };
    }

    if (despuesDeSalida) {
        return {
            estadoTurno: tieneRegistro ? 'SALIDA' : 'FUERA_DE_TURNO',
            detalleTurno: tieneRegistro ? 'Hora de salida cumplida' : 'Fuera de turno',
            tieneRegistro,
            ventana
        };
    }

    if (dentroVentana) {
        return {
            estadoTurno: tieneRegistro ? 'EN_TURNO' : 'SIN_REGISTRO',
            detalleTurno: tieneRegistro ? 'Con registro en ventana' : 'Sin registro en ventana',
            tieneRegistro,
            ventana
        };
    }

    return {
        estadoTurno: 'FUERA_DE_TURNO',
        detalleTurno: 'Fuera de turno',
        tieneRegistro,
        ventana
    };
}

async function sincronizarEstadosAsistencia(poolRef = pool, ahoraInput = null) {
    await asegurarTablaEstadoAsistencia();

    // Mantener tabla diaria alineada con eventos para evitar huecos entre flujo de captura y dashboard.
    await consolidarAsistenciaLimpiezaDiariaDesdeEventos();

    const ahoraMx = ahoraInput
        ? moment(ahoraInput).tz('America/Mexico_City')
        : moment().tz('America/Mexico_City');
    const fechaHoy = ahoraMx.format('YYYY-MM-DD');

    for (const persona of MARCADOR_PERSONAL) {
        const horarioTurno = extraerHorarioTurno(persona.turno || '');
        const ventana = obtenerVentanaTurno(persona, ahoraMx);
        const fechaOperativa = obtenerFechaOperativaTurno({ turno: persona.turno, fecha: ahoraMx });
        const limpiezaRowsRes = await poolRef.query(
            `
            SELECT autor, total_reportes, total_evidencias, fecha
            FROM asistencia_limpieza_diaria
            WHERE fecha = $1
              AND grupo = ANY($2::text[])
            ORDER BY fecha ASC
            `,
            [
                fechaOperativa,
                GRUPOS_LIMPIEZA_CON_REGISTRO
            ]
        );

        const registro = {
            tieneRegistro: limpiezaRowsRes.rows.some((row) => {
                if (!coincideAutorConPersona(row.autor || '', persona)) {
                    return false;
                }

                return Number(row.total_reportes || 0) > 0 || Number(row.total_evidencias || 0) > 0;
            })
        };
        const ajuste = await obtenerAjusteLimpieza(poolRef, {
            fecha: fechaHoy,
            personaKey: persona.key
        });

        const estado = resolverEstadoLimpieza(persona, ahoraMx, registro.tieneRegistro, ajuste);
        const horario = horarioTurno ? `${horarioTurno.turnoInicio}-${horarioTurno.turnoFin}` : 'Sin horario';

        await poolRef.query(
            `
            INSERT INTO estado_asistencia_diaria
            (fecha, area, grupo, persona_key, persona, turno, horario, estado_turno, detalle_turno, tiene_registro, actualizado_at)
            VALUES ($1, 'LIMPIEZA', $2, $3, $4, $5, $6, $7, $8, $9, NOW())
            ON CONFLICT (fecha, area, persona_key)
            DO UPDATE SET
                grupo = EXCLUDED.grupo,
                persona = EXCLUDED.persona,
                turno = EXCLUDED.turno,
                horario = EXCLUDED.horario,
                estado_turno = EXCLUDED.estado_turno,
                detalle_turno = EXCLUDED.detalle_turno,
                tiene_registro = EXCLUDED.tiene_registro,
                actualizado_at = NOW()
            `,
            [
                fechaHoy,
                GRUPO_LIMPIEZA,
                persona.key,
                persona.nombre,
                persona.turno,
                horario,
                estado.estadoTurno,
                estado.detalleTurno,
                estado.tieneRegistro
            ]
        );
    }

    for (const persona of EQUIPO_MANTENIMIENTO) {
        const ajuste = await obtenerAjusteLimpieza(poolRef, {
            fecha: fechaHoy,
            personaKey: persona.key
        });
        const turnoEfectivo = resolverTurnoMttoConAjuste(persona, ajuste);
        const personaEfectiva = {
            ...persona,
            turno: turnoEfectivo
        };
        const horarioTurno = extraerHorarioTurno(personaEfectiva.turno || '');
        const ventana = obtenerVentanaTurno(personaEfectiva, ahoraMx);
        const mantenimientoRowsRes = await poolRef.query(
            `
            SELECT autor, tipo_evento, ubicacion, turno, mensaje_id, fecha
            FROM asistencia_mantenimiento_eventos
            WHERE fecha >= $1::date
              AND fecha <= $2::date
              AND trim(grupo) = trim($3)
            ORDER BY fecha ASC
            `,
            [
                ventana.inicio.format('YYYY-MM-DD'),
                ventana.fin.format('YYYY-MM-DD'),
                GRUPO_MANTENIMIENTO
            ]
        );

        const estado = resolverEstadoMantenimiento(
            personaEfectiva,
            ahoraMx,
            mantenimientoRowsRes.rows.some((row) => coincideAutorConPersona(row.autor || '', persona)),
            ajuste
        );
        const horario = horarioTurno ? `${horarioTurno.turnoInicio}-${horarioTurno.turnoFin}` : 'Sin horario';

        await poolRef.query(
            `
            INSERT INTO estado_asistencia_diaria
            (fecha, area, grupo, persona_key, persona, turno, horario, estado_turno, detalle_turno, tiene_registro, actualizado_at)
            VALUES ($1, 'MTTO', $2, $3, $4, $5, $6, $7, $8, $9, NOW())
            ON CONFLICT (fecha, area, persona_key)
            DO UPDATE SET
                grupo = EXCLUDED.grupo,
                persona = EXCLUDED.persona,
                turno = EXCLUDED.turno,
                horario = EXCLUDED.horario,
                estado_turno = EXCLUDED.estado_turno,
                detalle_turno = EXCLUDED.detalle_turno,
                tiene_registro = EXCLUDED.tiene_registro,
                actualizado_at = NOW()
            `,
            [
                fechaHoy,
                GRUPO_MANTENIMIENTO,
                persona.key,
                persona.nombre,
                personaEfectiva.turno,
                horario,
                estado.estadoTurno,
                estado.detalleTurno,
                estado.tieneRegistro
            ]
        );
    }

    return { fecha: fechaHoy, generadoAt: ahoraMx.format('YYYY-MM-DD HH:mm:ss') };
}

async function obtenerEstadosAsistenciaDia(poolRef = pool, area = '') {
    await asegurarTablaEstadoAsistencia();

    const fechaHoy = moment().tz('America/Mexico_City').format('YYYY-MM-DD');
    const areaUpper = normalizarTexto(area).toUpperCase();

    const res = await poolRef.query(
        `
        SELECT persona_key, persona, turno, horario, estado_turno, detalle_turno, tiene_registro, grupo, actualizado_at
        FROM estado_asistencia_diaria
        WHERE fecha = $1
          AND ($2 = '' OR area = $2)
        ORDER BY persona ASC
        `,
        [fechaHoy, areaUpper]
    );

    return res.rows.map((row) => ({
        personaKey: row.persona_key,
        persona: row.persona,
        turno: row.turno,
        horario: row.horario,
        estadoTurno: row.estado_turno,
        detalleTurno: row.detalle_turno,
        tieneRegistro: row.tiene_registro,
        grupo: row.grupo,
        actualizadoAt: row.actualizado_at
    }));
}

module.exports = {
    asegurarTablaEstadoAsistencia,
    sincronizarEstadosAsistencia,
    obtenerEstadosAsistenciaDia
};