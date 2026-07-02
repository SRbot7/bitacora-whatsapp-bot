const pool = require('../db');
const {
    obtenerAlertasAsistenciaLimpieza,
    obtenerAlertasAsistenciaIngenieria
} = require('./alertas-asistencia');
const {
    obtenerEstadosAsistenciaDia
} = require('./estado-asistencia');

const GRUPO_ASISTENCIA_INGENIERIA = 'Asistencia SHP1 Pachuca';
const EQUIPO_INGENIERIA = [
    {
        key: 'saul',
        nombre: 'Saul Romero Romero',
        aliases: ['saul romero romero', 'saul romero', 'saul']
    },
    {
        key: 'eliezer',
        nombre: 'Eliezer Romero Romero',
        aliases: ['eliezer romero romero', 'eliezer romero', 'eliezer']
    },
    {
        key: 'flavio',
        nombre: 'Flavio Cruz Santiago',
        aliases: ['flavio cruz santiago', 'flavio cruz', 'flavio']
    }
];

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

function resolverIngenieriaPersona(autor = '') {
    const autorN = normalizarTexto(autor);
    if (!autorN) {
        return null;
    }

    for (const persona of EQUIPO_INGENIERIA) {
        const matched = persona.aliases.some((alias) => {
            const aliasN = normalizarTexto(alias);
            return autorN.includes(aliasN) || aliasN.includes(autorN);
        });

        if (matched) {
            return persona;
        }
    }

    return null;
}

async function obtenerAsistenciaIngenieriaHoy() {
    const fechaHoyMxRes = await pool.query(`SELECT (NOW() AT TIME ZONE 'America/Mexico_City')::date AS fecha_hoy`);
    const fechaHoy = fechaHoyMxRes.rows[0]?.fecha_hoy;
    const presentes = new Set();

    try {
        const eventosRes = await pool.query(
            `
            SELECT autor
            FROM asistencia_mantenimiento_eventos
            WHERE fecha = $1
              AND grupo ILIKE $2
            `,
            [fechaHoy, `%${GRUPO_ASISTENCIA_INGENIERIA}%`]
        );

        for (const row of eventosRes.rows) {
            const persona = resolverIngenieriaPersona(row.autor);
            if (persona) {
                presentes.add(persona.key);
            }
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
            WHERE fecha = $1
              AND grupo ILIKE $2
            `,
            [fechaHoy, `%${GRUPO_ASISTENCIA_INGENIERIA}%`]
        );

        for (const row of legacyRes.rows) {
            const tieneActividad = Number(row.total_reportes || 0) > 0 || Number(row.total_evidencias || 0) > 0;
            if (!tieneActividad) {
                continue;
            }

            const persona = resolverIngenieriaPersona(row.autor);
            if (persona) {
                presentes.add(persona.key);
            }
        }
    } catch (error) {
        if (!error || error.code !== '42P01') {
            throw error;
        }
    }

    const presentesNombres = EQUIPO_INGENIERIA
        .filter((persona) => presentes.has(persona.key))
        .map((persona) => persona.nombre);
    const faltantesNombres = EQUIPO_INGENIERIA
        .filter((persona) => !presentes.has(persona.key))
        .map((persona) => persona.nombre);

    return {
        fecha: fechaHoy,
        totalEquipo: EQUIPO_INGENIERIA.length,
        presentes: presentesNombres,
        faltantes: faltantesNombres
    };
}

function construirResumenEstadoPersistido(items = [], area = '') {
    const resumen = {
        enTurno: [],
        salida: [],
        fueraTurno: [],
        descanso: [],
        sinCobertura: true
    };

    for (const item of items) {
        const persona = item?.persona || '-';
        const estado = normalizarTexto((item?.estadoTurno || '').toString());

        if (estado === 'descanso') {
            resumen.descanso.push(persona);
            continue;
        }

        resumen.sinCobertura = false;

        if (estado === 'en_turno' || estado === 'enturno') {
            resumen.enTurno.push(persona);
            continue;
        }

        if (estado === 'salida') {
            resumen.salida.push(persona);
            continue;
        }

        resumen.fueraTurno.push(persona);
    }

    if (area === 'LIMPIEZA' && resumen.enTurno.length === 0 && resumen.salida.length === 0 && resumen.descanso.length === 0) {
        resumen.sinCobertura = true;
    }

    return resumen;
}

async function obtenerResumenAsistenciaGeneral() {
    const warnings = [];

    const [ingenieriaRes, limpiezaRes, alertasLimpiezaRes, alertasIngenieriaRes] = await Promise.allSettled([
        obtenerEstadosAsistenciaDia(pool, 'MTTO'),
        obtenerEstadosAsistenciaDia(pool, 'LIMPIEZA'),
        obtenerAlertasAsistenciaLimpieza(pool),
        obtenerAlertasAsistenciaIngenieria(pool)
    ]);

    if (ingenieriaRes.status === 'rejected') {
        warnings.push('ingenieria_no_disponible');
    }
    if (limpiezaRes.status === 'rejected') {
        warnings.push('limpieza_no_disponible');
    }

    const ingenieriaPersistida = ingenieriaRes.status === 'fulfilled'
        ? construirResumenEstadoPersistido(ingenieriaRes.value, 'MTTO')
        : construirResumenEstadoPersistido([], 'MTTO');

    const ingenieria = {
        fecha: moment().tz('America/Mexico_City').format('YYYY-MM-DD'),
        totalEquipo: EQUIPO_INGENIERIA.length,
        presentes: [...ingenieriaPersistida.enTurno, ...ingenieriaPersistida.salida],
        faltantes: ingenieriaPersistida.fueraTurno,
        enTurno: ingenieriaPersistida.enTurno,
        salida: ingenieriaPersistida.salida,
        fueraTurno: ingenieriaPersistida.fueraTurno,
        descanso: ingenieriaPersistida.descanso,
        sinCobertura: ingenieriaPersistida.sinCobertura
    };

    const limpiezaPersistida = limpiezaRes.status === 'fulfilled'
        ? construirResumenEstadoPersistido(limpiezaRes.value, 'LIMPIEZA')
        : construirResumenEstadoPersistido([], 'LIMPIEZA');

    const limpieza = {
        sinCobertura: limpiezaPersistida.sinCobertura,
        enTurno: limpiezaPersistida.enTurno,
        sinRegistro: limpiezaPersistida.fueraTurno,
        salida: limpiezaPersistida.salida,
        descanso: limpiezaPersistida.descanso,
        fueraTurno: limpiezaPersistida.fueraTurno
    };

    const alertasActivas =
        (alertasLimpiezaRes.status === 'fulfilled' ? (alertasLimpiezaRes.value.items || []).length : 0) +
        (alertasIngenieriaRes.status === 'fulfilled' ? (alertasIngenieriaRes.value.items || []).length : 0);

    return {
        ingenieria,
        limpieza,
        alertasActivas,
        warnings
    };
}

function listarNombres(lista = []) {
    return Array.isArray(lista) && lista.length ? lista.join(', ') : 'Nadie';
}

async function contar(sql, params = []) {
    const resultado = await pool.query(sql, params);
    return Number(resultado.rows[0]?.total || 0);
}

async function obtenerResumenOperativo({ inicioDia, finDia }) {
    const [
        bitacoraTotal,
        bitacoraHoy,
        limpiezaTotal,
        limpiezaHoy,
        pendientesAbiertos,
        pendientesHoy,
        materialesTotal,
        materialesHoy,
        proyectosTotal,
        proyectosHoy,
        asistenciaGeneral
    ] = await Promise.all([
        contar(`
            SELECT COUNT(*)::int AS total
            FROM bitacora
            WHERE grupo = 'BITACORA-MTTO-SHP1'
        `),
        contar(`
            SELECT COUNT(*)::int AS total
            FROM bitacora
            WHERE grupo = 'BITACORA-MTTO-SHP1'
              AND fecha >= $1
              AND fecha <= $2
        `, [inicioDia, finDia]),
        contar(`
            SELECT COUNT(*)::int AS total
            FROM actividades_limpieza
            WHERE actividad IS NOT NULL
              AND BTRIM(actividad) <> ''
              AND actividad <> '[Solo imagen]'
        `),
        contar(`
            SELECT COUNT(*)::int AS total
            FROM actividades_limpieza
            WHERE actividad IS NOT NULL
              AND BTRIM(actividad) <> ''
              AND actividad <> '[Solo imagen]'
              AND fecha >= $1
              AND fecha <= $2
        `, [inicioDia, finDia]),
        contar(`
            SELECT COUNT(*)::int AS total
            FROM pendientes_supervisor
            WHERE estado = 'Pendiente'
        `),
        contar(`
            SELECT COUNT(*)::int AS total
            FROM pendientes_supervisor
            WHERE fecha >= $1
              AND fecha <= $2
        `, [inicioDia, finDia]),
        contar(`
            SELECT COUNT(*)::int AS total
            FROM materiales_solicitados
        `),
        contar(`
            SELECT COUNT(*)::int AS total
            FROM materiales_solicitados
            WHERE fecha >= $1
              AND fecha <= $2
        `, [inicioDia, finDia]),
        contar(`
            SELECT COUNT(*)::int AS total
            FROM proyectos_mtto
        `),
        contar(`
            SELECT COUNT(*)::int AS total
            FROM proyectos_mtto
            WHERE creado_en >= $1
              AND creado_en <= $2
        `, [inicioDia, finDia]),
        obtenerResumenAsistenciaGeneral()
    ]);

    return {
        bitacoraTotal,
        bitacoraHoy,
        limpiezaTotal,
        limpiezaHoy,
        pendientesAbiertos,
        pendientesHoy,
        materialesTotal,
        materialesHoy,
        proyectosTotal,
        proyectosHoy,
        asistenciaGeneral
    };
}

function construirMensajeResumenOperativo({ momento, resumen, tipo }) {
    const sello = tipo === 'AUTO' ? 'AUTOMATICO' : 'MANUAL';

    return [
        `📊 REPORTE OPERATIVO ${sello}`,
        `🗓️ ${momento.format('DD/MM/YYYY HH:mm')}`,
        '',
        'BITACORA',
        `- Hoy: ${resumen.bitacoraHoy}`,
        `- Total: ${resumen.bitacoraTotal}`,
        '',
        'LIMPIEZA',
        `- Hoy: ${resumen.limpiezaHoy}`,
        `- Total: ${resumen.limpiezaTotal}`,
        '',
        'SUPERVISOR',
        `- Pendientes abiertos: ${resumen.pendientesAbiertos}`,
        `- Pendientes creados hoy: ${resumen.pendientesHoy}`,
        `- Materiales hoy / total: ${resumen.materialesHoy} / ${resumen.materialesTotal}`,
        `- Proyectos hoy / total: ${resumen.proyectosHoy} / ${resumen.proyectosTotal}`,
        '',
        'ASISTENCIA GENERAL',
        `- Ingenieria con registro hoy: ${resumen.asistenciaGeneral?.ingenieria?.presentes?.length || 0}/${resumen.asistenciaGeneral?.ingenieria?.totalEquipo || 0} (${listarNombres(resumen.asistenciaGeneral?.ingenieria?.presentes)})`,
        `- Ingenieria sin registro hoy: ${listarNombres(resumen.asistenciaGeneral?.ingenieria?.faltantes)}`,
        resumen.asistenciaGeneral?.limpieza?.sinCobertura
            ? '- Limpieza (turno actual): Sin cobertura programada en esta hora.'
            : `- Limpieza en turno con evidencia: ${listarNombres((resumen.asistenciaGeneral?.limpieza?.enTurno || []).map((item) => item.persona))}`,
        `- Limpieza en turno sin registro: ${listarNombres((resumen.asistenciaGeneral?.limpieza?.sinRegistro || []).map((item) => item.persona))}`,
        `- Limpieza descanso: ${listarNombres((resumen.asistenciaGeneral?.limpieza?.descanso || []).map((item) => item.persona))}`,
        `- Alertas activas de asistencia: ${resumen.asistenciaGeneral?.alertasActivas || 0}`,
        (resumen.asistenciaGeneral?.warnings || []).length
            ? `- Nota: Datos parciales en ${resumen.asistenciaGeneral.warnings.join(', ')}`
            : null,
        '',
        '✅ Resumen generado por bot de operaciones.'
    ].filter(Boolean).join('\n');
}

module.exports = {
    obtenerResumenOperativo,
    construirMensajeResumenOperativo
};
