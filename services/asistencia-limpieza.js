const moment = require('moment-timezone');
const pool = require('../db');
const {
    MARCADOR_PERSONAL,
    resolverPersonaMarcador,
    extraerHorarioTurno,
    normalizarTexto: normalizarTextoMarcador
} = require('./limpieza-personal');

let tablaCreada = false;
let tablaEventosCreada = false;

const LIMPIEZA_ASISTENCIA_GROUP_NAME = process.env.LIMPIEZA_ASISTENCIA_GROUP_NAME || 'Asistencia limpieza SHP1 Pachuca';
const MANTENIMIENTO_ASISTENCIA_GROUP_NAME = process.env.MANTENIMIENTO_ASISTENCIA_GROUP_NAME || 'Asistencia SHP1 Pachuca';
const ASISTENCIA_ENTRADA_ANTICIPO_MIN = Math.max(
    0,
    Number.parseInt(process.env.ASISTENCIA_ENTRADA_ANTICIPO_MIN || '30', 10) || 30
);
const ASISTENCIA_ENTRADA_TOLERANCIA_MIN = Math.max(
    0,
    Number.parseInt(process.env.ASISTENCIA_ENTRADA_TOLERANCIA_MIN || '15', 10) || 15
);
const ASISTENCIA_SALIDA_TOLERANCIA_MIN = Math.max(
    1,
    Number.parseInt(process.env.ASISTENCIA_SALIDA_TOLERANCIA_MIN || '60', 10) || 60
);

const AUTORES_PERMITIDOS_POR_GRUPO = {
    [normalizarTexto(MANTENIMIENTO_ASISTENCIA_GROUP_NAME)]: [
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

async function asegurarTablaEventosAsistenciaLimpieza() {
    if (tablaEventosCreada) {
        return;
    }

    await pool.query(`
        CREATE TABLE IF NOT EXISTS asistencia_limpieza_eventos (
            id SERIAL PRIMARY KEY,
            fecha DATE NOT NULL,
            ts_evento TIMESTAMP NOT NULL,
            autor TEXT NOT NULL,
            persona_key TEXT,
            tipo_evento TEXT NOT NULL,
            grupo TEXT NOT NULL,
            ubicacion TEXT,
            mensaje_id TEXT,
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query('CREATE INDEX IF NOT EXISTS idx_asistencia_limpieza_eventos_fecha ON asistencia_limpieza_eventos (fecha)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_asistencia_limpieza_eventos_persona ON asistencia_limpieza_eventos (persona_key, ts_evento DESC)');

    tablaEventosCreada = true;
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

function construirFechaHora(base, hhmm) {
    const [hh, mm] = String(hhmm || '').split(':').map((v) => Number.parseInt(v, 10) || 0);
    return base.clone().startOf('day').hour(hh).minute(mm).second(0).millisecond(0);
}

function obtenerVentanaTurno({ turno, fecha }) {
    const horario = extraerHorarioTurno(turno || '');
    if (!horario || !fecha) {
        return null;
    }

    const inicioHoy = construirFechaHora(fecha, horario.turnoInicio);
    const finHoy = construirFechaHora(fecha, horario.turnoFin);
    const cruzaMedianoche = finHoy.isSameOrBefore(inicioHoy);

    if (!cruzaMedianoche) {
        return { inicio: inicioHoy, fin: finHoy };
    }

    if (fecha.isSameOrAfter(inicioHoy)) {
        return { inicio: inicioHoy, fin: finHoy.clone().add(1, 'day') };
    }

    return { inicio: inicioHoy.clone().subtract(1, 'day'), fin: finHoy };
}

function validarVentanaEventoAsistenciaLimpieza({ turno, fecha, tipoEvento }) {
    const tipo = String(tipoEvento || '').toUpperCase();
    const ventana = obtenerVentanaTurno({ turno, fecha });

    if (!ventana) {
        return { ok: false, razon: 'sin_horario' };
    }

    if (tipo === 'ENTRADA') {
        const inicioPermitido = ventana.inicio.clone().subtract(ASISTENCIA_ENTRADA_ANTICIPO_MIN, 'minutes');
        const finPermitido = ventana.inicio.clone().add(ASISTENCIA_ENTRADA_TOLERANCIA_MIN, 'minutes');
        const ok = fecha.isSameOrAfter(inicioPermitido) && fecha.isSameOrBefore(finPermitido);
        return {
            ok,
            razon: ok ? '' : 'fuera_ventana_entrada',
            inicioPermitido,
            finPermitido,
            ventana
        };
    }

    if (tipo === 'SALIDA') {
        const inicioPermitido = ventana.fin.clone();
        const finPermitido = ventana.fin.clone().add(ASISTENCIA_SALIDA_TOLERANCIA_MIN, 'minutes');
        const ok = fecha.isSameOrAfter(inicioPermitido) && fecha.isSameOrBefore(finPermitido);
        return {
            ok,
            razon: ok ? '' : 'fuera_ventana_salida',
            inicioPermitido,
            finPermitido,
            ventana
        };
    }

    return { ok: false, razon: 'tipo_no_soportado' };
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

    const grupoNormalizado = normalizarTexto(grupo);
    if (grupoNormalizado !== normalizarTexto(LIMPIEZA_ASISTENCIA_GROUP_NAME)) {
        return null;
    }

    if (!autorPermitidoPorGrupo(autor, grupo)) {
        return;
    }

    const grupoConLista = Boolean(obtenerAutoresPermitidosPorGrupo(grupo));
    if (!grupoConLista && autorExcluidoAsistencia(autor)) {
        return;
    }

    const persona = enriquecerPersonaAsistenciaLimpieza(autor || 'Sin nombre');

    // Asistencia por presencia en el grupo dedicado de asistencia limpieza.
    // No depende de evidencias, solo de persona reconocida y horario de turno.
    if (!persona.esReconocida) {
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

    const reporteBandera = reportesIncremento > 0 ? 1 : 0;
    const evidenciaBandera = 0;

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

async function registrarEventoAsistenciaLimpieza({
    fecha,
    autor,
    grupo,
    tipoEvento = 'ENTRADA',
    ubicacion = '',
    mensajeId = ''
}) {
    await asegurarTablaEventosAsistenciaLimpieza();

    const grupoNormalizado = normalizarTexto(grupo);
    if (grupoNormalizado !== normalizarTexto(LIMPIEZA_ASISTENCIA_GROUP_NAME)) {
        return null;
    }

    const tipo = String(tipoEvento || '').toUpperCase();
    if (!['ENTRADA', 'SALIDA', 'SALIDA_AUTO'].includes(tipo)) {
        return null;
    }

    const persona = enriquecerPersonaAsistenciaLimpieza(autor || 'Sin nombre');
    if (!persona.esReconocida) {
        return null;
    }

    const ts = fecha.format('YYYY-MM-DD HH:mm:ss');
    const fechaDia = obtenerFechaOperativaTurno({ turno: persona.turno, fecha });

    const res = await pool.query(
        `
        INSERT INTO asistencia_limpieza_eventos
        (
            fecha,
            ts_evento,
            autor,
            persona_key,
            tipo_evento,
            grupo,
            ubicacion,
            mensaje_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
        `,
        [
            fechaDia,
            ts,
            persona.autorCanonico,
            persona.personaKey,
            tipo,
            grupo || 'Sin grupo',
            ubicacion || null,
            mensajeId || null
        ]
    );

    return res.rows[0]?.id || null;
}

async function consolidarAsistenciaLimpiezaDiariaDesdeEventos({ fechaInicio = null, fechaFin = null } = {}) {
    await asegurarTablaAsistenciaLimpieza();
    await asegurarTablaEventosAsistenciaLimpieza();

    const ahoraMx = moment().tz('America/Mexico_City');
    const desde = fechaInicio
        ? moment(fechaInicio).tz('America/Mexico_City')
        : ahoraMx.clone().subtract(1, 'day').startOf('day');
    const hasta = fechaFin
        ? moment(fechaFin).tz('America/Mexico_City')
        : ahoraMx.clone().endOf('day');

    const fechaDesde = desde.format('YYYY-MM-DD');
    const fechaHasta = hasta.format('YYYY-MM-DD');

    const eventosRes = await pool.query(
        `
        WITH base AS (
            SELECT
                fecha,
                persona_key,
                autor,
                grupo,
                ts_evento,
                tipo_evento,
                ROW_NUMBER() OVER (
                    PARTITION BY fecha, persona_key, grupo
                    ORDER BY ts_evento DESC, id DESC
                ) AS rn
            FROM asistencia_limpieza_eventos
            WHERE fecha >= $1::date
              AND fecha <= $2::date
              AND grupo = $3
              AND tipo_evento IN ('ENTRADA', 'SALIDA', 'SALIDA_AUTO')
        ),
        agg AS (
            SELECT
                fecha,
                persona_key,
                grupo,
                MIN(ts_evento) AS primer_reporte,
                MAX(ts_evento) AS ultimo_reporte,
                SUM(CASE WHEN tipo_evento = 'ENTRADA' THEN 1 ELSE 0 END)::int AS total_reportes
            FROM base
            GROUP BY fecha, persona_key, grupo
        ),
        ult AS (
            SELECT fecha, persona_key, grupo, autor
            FROM base
            WHERE rn = 1
        )
        SELECT
            agg.fecha,
            agg.persona_key,
            agg.grupo,
            agg.primer_reporte,
            agg.ultimo_reporte,
            agg.total_reportes,
            ult.autor
        FROM agg
        INNER JOIN ult
            ON ult.fecha = agg.fecha
           AND ult.persona_key = agg.persona_key
           AND ult.grupo = agg.grupo
        WHERE agg.total_reportes > 0
        ORDER BY agg.fecha ASC, agg.persona_key ASC
        `,
        [fechaDesde, fechaHasta, LIMPIEZA_ASISTENCIA_GROUP_NAME]
    );

    let consolidados = 0;

    for (const row of eventosRes.rows) {
        const persona = MARCADOR_PERSONAL.find((p) => p.key === row.persona_key) || null;
        const autorCanonico = persona?.nombre || row.autor || 'Sin nombre';
        const turno = persona?.turno || null;
        const horarioTurno = extraerHorarioTurno(turno || '');
        const horario = horarioTurno ? `${horarioTurno.turnoInicio}-${horarioTurno.turnoFin}` : null;

        const autorPersistente = await resolverAutorPersistente({
            fechaDia: row.fecha,
            grupo: row.grupo,
            autorCanonico,
            personaKey: row.persona_key
        });

        await pool.query(
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
            VALUES ($1, $2, $3, $4, $5, 'AUTOMATICO', $6, $7, $8, $9, 0)
            ON CONFLICT (fecha, autor, grupo)
            DO UPDATE
            SET
                persona_key = COALESCE(asistencia_limpieza_diaria.persona_key, EXCLUDED.persona_key),
                turno = COALESCE(asistencia_limpieza_diaria.turno, EXCLUDED.turno),
                horario = COALESCE(asistencia_limpieza_diaria.horario, EXCLUDED.horario),
                primer_reporte = LEAST(asistencia_limpieza_diaria.primer_reporte, EXCLUDED.primer_reporte),
                ultimo_reporte = GREATEST(asistencia_limpieza_diaria.ultimo_reporte, EXCLUDED.ultimo_reporte),
                total_reportes = GREATEST(asistencia_limpieza_diaria.total_reportes, EXCLUDED.total_reportes),
                updated_at = NOW()
            `,
            [
                row.fecha,
                autorPersistente || autorCanonico,
                row.persona_key,
                turno,
                horario,
                row.grupo,
                row.primer_reporte,
                row.ultimo_reporte,
                Math.max(1, Number(row.total_reportes || 0))
            ]
        );

        consolidados += 1;
    }

    return consolidados;
}

async function cerrarTurnosLimpiezaVencidos(fechaInput = null) {
    await asegurarTablaEventosAsistenciaLimpieza();

    const ahoraMx = fechaInput
        ? moment(fechaInput).tz('America/Mexico_City')
        : moment().tz('America/Mexico_City');

    let cerrados = 0;

    for (const persona of MARCADOR_PERSONAL) {
        const ventana = obtenerVentanaTurno({ turno: persona.turno, fecha: ahoraMx });
        if (!ventana) {
            continue;
        }

        const limiteAuto = ventana.fin.clone().add(ASISTENCIA_SALIDA_TOLERANCIA_MIN, 'minutes');
        if (ahoraMx.isBefore(limiteAuto)) {
            continue;
        }

        const fechaDia = obtenerFechaOperativaTurno({ turno: persona.turno, fecha: ventana.inicio.clone() });
        const grupo = LIMPIEZA_ASISTENCIA_GROUP_NAME;

        const [entradaRes, salidaRes] = await Promise.all([
            pool.query(
                `
                SELECT id
                FROM asistencia_limpieza_eventos
                WHERE fecha = $1
                  AND persona_key = $2
                  AND grupo = $3
                  AND tipo_evento = 'ENTRADA'
                ORDER BY ts_evento DESC
                LIMIT 1
                `,
                [fechaDia, persona.key, grupo]
            ),
            pool.query(
                `
                SELECT id
                FROM asistencia_limpieza_eventos
                WHERE fecha = $1
                  AND persona_key = $2
                  AND grupo = $3
                  AND tipo_evento IN ('SALIDA', 'SALIDA_AUTO')
                ORDER BY ts_evento DESC
                LIMIT 1
                `,
                [fechaDia, persona.key, grupo]
            )
        ]);

        const tieneEntrada = (entradaRes.rows || []).length > 0;
        const tieneSalida = (salidaRes.rows || []).length > 0;

        if (!tieneEntrada || tieneSalida) {
            continue;
        }

        const tsAuto = limiteAuto.format('YYYY-MM-DD HH:mm:ss');
        await pool.query(
            `
            INSERT INTO asistencia_limpieza_eventos
            (
                fecha,
                ts_evento,
                autor,
                persona_key,
                tipo_evento,
                grupo,
                ubicacion,
                mensaje_id
            )
            VALUES ($1, $2, $3, $4, 'SALIDA_AUTO', $5, $6, NULL)
            `,
            [fechaDia, tsAuto, persona.nombre, persona.key, grupo, 'AUTO_CIERRE_1H']
        );

        cerrados += 1;
        console.log('🕒 Turno limpieza cerrado automaticamente:', {
            persona: persona.nombre,
            fecha: fechaDia,
            tsAuto
        });
    }

    return cerrados;
}

module.exports = {
    asegurarTablaAsistenciaLimpieza,
    registrarAsistenciaLimpieza,
    registrarEventoAsistenciaLimpieza,
    obtenerAutoresExcluidosAsistencia,
    obtenerAutoresPermitidosPorGrupo,
    autorPermitidoPorGrupo,
    estaEnHorarioTurno,
    obtenerFechaOperativaTurno,
    validarVentanaEventoAsistenciaLimpieza,
    cerrarTurnosLimpiezaVencidos,
    consolidarAsistenciaLimpiezaDiariaDesdeEventos
};
