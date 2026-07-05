const moment = require('moment-timezone');
const pool = require('../db');

const {
    registrarPendiente,
    cerrarPendiente,
    cerrarPendientePorCategoria,
    contarAbiertos,
    contarCerrados,
    listarPendientes,
    listarPreventivosPendientes,
    listarCompletadosSupervisor,
    listarPreventivosCompletados,
    listarRiesgos
} = require('../services/pendientes');

const {
    registrarProyecto,
    listarProyectosAbiertos,
    cerrarProyecto
} = require('../services/proyectos');
const {
    obtenerResumenOperativo,
    construirMensajeResumenOperativo
} = require('../services/reportes');
const {
    guardarEvidenciaPendiente,
    guardarEvidenciaProyecto
} = require('../services/evidencias');

const { guardarEvidencia } = require('../lib/bitacora-storage');
const {
    ultimosPendientes,
    ultimosProyectos,
    flujosSupervisor,
    claveMemoria
} = require('../lib/memoria');
const { logPersistencia } = require('../lib/persistence-log');
const {
    obtenerAlertasAsistenciaLimpieza,
    obtenerAlertasAsistenciaIngenieria,
    obtenerEstadoTurnoLimpieza
} = require('../services/alertas-asistencia');
const {
    registrarAsistenciaLimpieza,
    autorPermitidoPorGrupo
} = require('../services/asistencia-limpieza');
const {
    registrarAsistenciaMantenimiento
} = require('../services/asistencia-mantenimiento');
const {
    MARCADOR_PERSONAL
} = require('../services/limpieza-personal');
const {
    validarLimitesPermisoMes,
    validarCoberturaTurno,
    registrarPermisoConAprobacion,
    confirmarTipoPermiso,
    aprobarPermiso,
    reportePermisosDelMes,
    reportePermisosPersona,
    listarPermisosPendientes,
    listarDeudasPendientes
} = require('../services/permisos-workflow');
const {
    registrarEventoCO,
    listarHistorialCO,
    rangoHoyMx
} = require('../services/historial-co');
const {
    menuPrincipal,
    menuAyuda,
    menuGuia,
    menuInformes,
    menuPendientes,
    menuPreventivos,
    menuAsistencia,
    menuAlertas,
    menuConfigurar,
    detalleAyudaPendientes,
    detalleAyudaProyectos,
    detalleAyudaEvidencias,
    detalleAyudaPermisos,
    detalleAyudaAsistencia,
    guiaPermisoMenuEquipos,
    guiaPermisoMenuNombres,
    guiaPermisoPaso3Dia,
    guiaPermisoPaso4Razon,
    guiaPermisoPaso5Tipo
} = require('../lib/menus-minimalistas');


// =========================
// COMANDOS VALIDOS
// =========================

const COMANDOS = [
    'AYUDA', 'AYUDA PENDIENTES',
    'AYUDA PROYECTOS', 'AYUDA EVIDENCIAS',
    'AYUDA PREVENTIVOS', 'AYUDA ALERTAS', 'AYUDA HISTORICO',
    'AYUDA CENTRO', 'AYUDA CENTRO OPERATIVO', 'AYUDA PERMISOS',
    'AYUDA GUIADA', 'GUIA AYUDA', 'AYUDA RAPIDA',
    'PERMISOS', 'PERMISOS CENTRO',
    'REPORTE', 'RESUMEN', 'REPORTE OPERATIVO', 'RESUMEN OPERATIVO',
    'LISTAR', 'ABIERTOS', 'CERRADOS', 'COMPLETADOS', 'HISTORICO', 'LISTAR CERRADOS',
    'PREVENTIVOS', 'LISTAR PREVENTIVOS', 'PREVENTIVOS CERRADOS', 'LISTAR PREVENTIVOS CERRADOS', 'HISTORICO PREVENTIVOS',
    'ALERTAS', 'ALERTAS ASISTENCIA',
    'ASISTENCIA', 'ASISTENCIA HOY', 'EN TURNO', 'EN SITIO',
    'RESUMEN ASISTENCIA', 'MARCADOR', 'MARCADOR ASISTENCIA',
    'RIESGOS', 'PROYECTOS', 'LISTAR PROYECTOS'
];

const GRUPO_ASISTENCIA_INGENIERIA = 'Asistencia SHP1 Pachuca';
const GRUPO_LIMPIEZA_OPERATIVA = 'MELI SVC PACHUCA - BATIA LIMPIEZA';
const EQUIPO_INGENIERIA = [
    {
        key: 'saul',
        nombre: 'Saul Romero Romero',
        puesto: 'Electromecanico',
        turno: '1er turno',
        horario: '07:00-15:00',
        aliases: ['saul romero romero', 'saul romero', 'saul', 'ctamez2016b', '~ ctamez2016b']
    },
    {
        key: 'eliezer',
        nombre: 'Eliezer Romero Romero',
        puesto: 'Multitecnico',
        turno: '2do turno',
        horario: '14:00-22:00',
        aliases: ['eliezer romero romero', 'eliezer romero', 'eliezer']
    },
    {
        key: 'flavio',
        nombre: 'Flavio Cruz Santiago',
        puesto: 'Multitecnico',
        turno: '3er turno',
        horario: '23:00-06:00',
        aliases: ['flavio cruz santiago', 'flavio cruz', 'flavio']
    }
];
const INGENIERIA_DESCANSO_DOMINGO_KEYS = new Set(['saul', 'eliezer', 'flavio']);

const COMANDOS_GUIA_PENDIENTE = [
    'GUIA PENDIENTE',
    'NUEVO PENDIENTE',
    'INICIAR PENDIENTE'
];

const COMANDOS_GUIA_PROYECTO = [
    'GUIA PROYECTO',
    'NUEVO PROYECTO',
    'INICIAR PROYECTO'
];

const COMANDOS_CANCELAR = ['CANCELAR', 'SALIR', 'CANCELAR GUIA'];
const COMANDOS_GUIA_AYUDA = ['AYUDA GUIADA', 'GUIA AYUDA', 'AYUDA RAPIDA'];

function normalizarComando(texto = '') {
    return texto
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function limpiarTextoPlano(texto = '') {
    return texto
        .toString()
        .replace(/\s+/g, ' ')
        .trim();
}

function extraerLineaOCRDesdeObservaciones(observaciones = '') {
    const match = (observaciones || '').match(/L[ií]nea OCR:\s*([^\n]+)/i);
    return match?.[1] ? limpiarTextoPlano(match[1]) : '';
}

function formatearLineaOCRPreventivo(linea = '') {
    if (!linea) {
        return '';
    }

    const base = linea
        .toString()
        .replace(/[—–−]/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/\bMITO\b/gi, 'MANTTO')
        .trim();

    if (!base) {
        return '';
    }

    const numeros = base.match(/\b\d{6,}\b/g) || [];
    if (numeros.length > 0) {
        const resto = limpiarTextoPlano(
            base
                .replace(/\bSHP1\b/gi, ' ')
                .replace(/\bZMPS\b/gi, ' ')
                .replace(/\b\d{6,}\b/g, ' ')
                .replace(/[|]/g, ' ')
                .replace(/\s+/g, ' ')
        );

        return `${numeros.join(' - ')}${resto ? ` - ${resto}` : ''}`;
    }

    if (base.includes('|')) {
        const partes = base
            .split('|')
            .map((p) => p.trim())
            .filter(Boolean);

        return partes.join(' | ');
    }

    if (base.includes('-')) {
        const partes = base
            .split('-')
            .map((p) => p.trim())
            .filter(Boolean);

        if (partes.length > 1) {
            return partes.join(' | ');
        }
    }

    return base;
}

function formatearLineaPreventivo(p) {
    const icono =
        p.prioridad === 'ALTA' ? '🔴' :
        p.prioridad === 'MEDIA' ? '🟡' : '🟢';

    const area = p.area || 'SHP1';
    const descripcion = normalizarDescripcionPreventivo(p.descripcion || '[Sin descripción]');
    const lineaOCRRaw = extraerLineaOCRDesdeObservaciones(p.observaciones);
    const lineaOCR = formatearLineaOCRPreventivo(lineaOCRRaw);
    return `[${p.id}] ${icono} ${p.prioridad} | ${area} | ${descripcion}${lineaOCR ? `\n${lineaOCR}` : ''}`;
}

function formatearLineaProyecto(p) {
    const icono =
        p.prioridad === 'ALTA' ? '🔴' :
        p.prioridad === 'MEDIA' ? '🟡' : '🟢';

    const area = p.area || 'SHP1';
    const estado = p.estado || 'Abierto';
    const nombre = limpiarTextoPlano(p.nombre || 'Proyecto sin nombre');
    const descripcion = limpiarTextoPlano(p.descripcion || 'Sin descripción').slice(0, 100);

    return `[${p.id}] ${icono} ${p.prioridad || 'MEDIA'} | ${estado} | ${area}\n${nombre}\n${descripcion}`;
}

function normalizarDescripcionPreventivo(descripcion = '') {
    const limpia = limpiarTextoPlano(descripcion || '[Sin descripción]');

    // Evita repeticiones visuales como "[CORTINAS] CORTINAS".
    const match = limpia.match(/^\[([^\]]+)\]\s+(.+)$/);
    if (!match) {
        return limpia;
    }

    const etiqueta = (match[1] || '').trim();
    const resto = (match[2] || '').trim();
    const restoSinEtiqueta = resto.replace(new RegExp(`^${etiqueta}\b\s*`, 'i'), '').trim();

    if (etiqueta && resto.toUpperCase() === etiqueta.toUpperCase()) {
        return `[${etiqueta}]`;
    }

    if (etiqueta && restoSinEtiqueta && restoSinEtiqueta.length < resto.length) {
        return `[${etiqueta}] ${restoSinEtiqueta}`;
    }

    return limpia;
}

function categoriaPreventivoDesdeDescripcion(descripcion = '') {
    const d = (descripcion || '').toUpperCase();
    if (d.includes('[CORTINAS]') || d.includes('CORTINA')) return 'CORTINAS';
    if (d.includes('[RAMPAS]') || d.includes('RAMPA')) return 'RAMPAS';
    if (d.includes('[BANOS]') || d.includes('BAÑ') || d.includes('BANO')) return 'BANOS';
    if (d.includes('[CARRITOS]') || d.includes('CARRITO')) return 'CARRITOS';
    return 'OTROS';
}

function ordenarPreventivosPorCategoria(rows = []) {
    const ordenCategoria = {
        CORTINAS: 1,
        RAMPAS: 2,
        BANOS: 3,
        CARRITOS: 4,
        OTROS: 5
    };

    return [...rows].sort((a, b) => {
        const ca = categoriaPreventivoDesdeDescripcion(a.descripcion);
        const cb = categoriaPreventivoDesdeDescripcion(b.descripcion);

        if (ca !== cb) {
            return (ordenCategoria[ca] || 99) - (ordenCategoria[cb] || 99);
        }

        return Number(a.id) - Number(b.id);
    });
}

function iniciarFlujoPendiente(clave) {
    flujosSupervisor[clave] = {
        tipo: 'PENDIENTE',
        paso: 0,
        data: {
            descripcion: '',
            area: '',
            tipoMtto: 'CORRECTIVO',
            prioridad: 'MEDIA',
            turno: '',
            tecnicos: '',
            fecha: ''
        }
    };
}

function iniciarFlujoProyecto(clave, nombreAutor) {
    flujosSupervisor[clave] = {
        tipo: 'PROYECTO',
        paso: 0,
        data: {
            nombre: '',
            descripcion: '',
            area: '',
            prioridad: 'MEDIA',
            responsable: nombreAutor || '',
            tecnicos: '',
            turno: '',
            fechaSql: null,
            costo: null
        }
    };
}

function iniciarFlujoAyudaGuiada(clave) {
    flujosSupervisor[clave] = {
        tipo: 'MENU_PRINCIPAL',
        paso: 0,
        data: {}
    };
}

function iniciarFlujoMenuAyuda(clave) {
    flujosSupervisor[clave] = {
        tipo: 'MENU_AYUDA',
        paso: 0,
        data: {}
    };
}

function iniciarFlujoMenuGuia(clave) {
    flujosSupervisor[clave] = {
        tipo: 'MENU_GUIA',
        paso: 0,
        data: {}
    };
}

function iniciarFlujoMenuInformes(clave) {
    flujosSupervisor[clave] = {
        tipo: 'MENU_INFORMES',
        paso: 0,
        data: {}
    };
}

function mensajeMenuAyudaGuiada() {
    return menuPrincipal();
}

function resolverAyudaGuiada(respuesta = '') {
    const r = normalizarComando(respuesta);

    if (!r || r === 'MENU' || r === 'MENÚ' || r === 'INICIO') {
        return mensajeMenuAyudaGuiada();
    }

    if (r === '1' || r === 'PENDIENTE' || r === 'PENDIENTES') {
        return [
            '🚧 Pendientes',
            'Usa GUIA PENDIENTE para captura paso a paso.',
            'Al finalizar, envía fotos y se ligan al último pendiente.',
            'Cierre rápido: CERRAR <ID>'
        ].join('\n');
    }

    if (r === '2' || r === 'PROYECTO' || r === 'PROYECTOS') {
        return [
            '🏗️ Proyectos',
            'Usa GUIA PROYECTO para captura guiada.',
            'Al finalizar, envía fotos y se ligan al último proyecto.'
        ].join('\n');
    }

    if (r === '3' || r === 'EVIDENCIA' || r === 'EVIDENCIAS' || r === 'FOTO' || r === 'FOTOS') {
        return [
            '📸 Evidencias',
            'Envía una o varias imágenes después de registrar.',
            'El sistema las liga al último registro tuyo (pendiente/proyecto).'
        ].join('\n');
    }

    if (r === '4' || r === 'CONSULTA' || r === 'CONSULTAS') {
        return [
            '📋 Consultas útiles',
            'LISTAR, ABIERTOS, CERRADOS, COMPLETADOS',
            'PROYECTOS, RIESGOS',
            'PREVENTIVOS, PREVENTIVOS CERRADOS'
        ].join('\n');
    }

    return 'No entendí la opción. Responde 1, 2, 3 o 4.';
}

function siguientePreguntaPendiente(paso) {
    const preguntas = [
        '1/7 Describe el pendiente:',
        '2/7 Area:',
        '3/7 Tipo (CORRECTIVO/PREVENTIVO/MEJORA):',
        '4/7 Prioridad (ALTA/MEDIA/BAJA):',
        '5/7 Turno:',
        '6/7 Tecnicos (ejemplo: Juan|Pedro):',
        '7/7 Fecha programada DD/MM/AAAA (o escribe OMITIR). Al finalizar puedes enviar fotos de evidencia:'
    ];

    return preguntas[paso] || '';
}

function siguientePreguntaProyecto(paso) {
    const preguntas = [
        '1/9 Nombre del proyecto:',
        '2/9 Descripcion del proyecto:',
        '3/9 Area:',
        '4/9 Prioridad (ALTA/MEDIA/BAJA):',
        '5/9 Responsable (o escribe OMITIR para usar tu nombre):',
        '6/9 Tecnicos (ejemplo: Juan|Pedro):',
        '7/9 Turno:',
        '8/9 Fecha programada DD/MM/AAAA (o escribe OMITIR):',
        '9/9 Costo estimado (numero, o escribe OMITIR). Al finalizar puedes enviar fotos de evidencia:'
    ];

    return preguntas[paso] || '';
}

function convertirFechaDDMMYYYYaSQL(valor) {
    if (!valor || /^OMITIR$/i.test(valor)) {
        return null;
    }

    const match = valor.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) {
        return undefined;
    }

    const [, d, m, y] = match;
    return `${y}-${m}-${d}`;
}

function resolverIngenieriaPersona(autor = '') {
    const autorN = normalizarComando(autor).toLowerCase();
    if (!autorN) {
        return null;
    }

    for (const persona of EQUIPO_INGENIERIA) {
        const matched = persona.aliases.some((alias) => {
            const aliasN = normalizarComando(alias).toLowerCase();
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
    const esDomingo = moment(fechaHoy).tz('America/Mexico_City').isoWeekday() === 7;
    const mapa = new Map();

    const acumular = (row) => {
        const persona = resolverIngenieriaPersona(row.autor);
        if (!persona) {
            return;
        }

        if (!autorPermitidoPorGrupo(row.autor, GRUPO_ASISTENCIA_INGENIERIA)) {
            return;
        }

        const previo = mapa.get(persona.key) || {
            totalReportes: 0,
            totalEvidencias: 0,
            primerReporte: null,
            ultimoReporte: null,
            autores: []
        };

        previo.totalReportes += Number(row.total_reportes || 0);
        previo.totalEvidencias += Number(row.total_evidencias || 0);
        if (!previo.primerReporte || (row.primer_reporte && new Date(row.primer_reporte) < new Date(previo.primerReporte))) {
            previo.primerReporte = row.primer_reporte || previo.primerReporte;
        }
        if (!previo.ultimoReporte || (row.ultimo_reporte && new Date(row.ultimo_reporte) > new Date(previo.ultimoReporte))) {
            previo.ultimoReporte = row.ultimo_reporte || previo.ultimoReporte;
        }
        if (!previo.autores.includes(row.autor)) {
            previo.autores.push(row.autor);
        }

        mapa.set(persona.key, previo);
    };

    try {
        const eventosRes = await pool.query(
            `
            SELECT
                autor,
                COUNT(*)::int AS total_reportes,
                0::int AS total_evidencias,
                MIN(COALESCE(evento_at, ((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Mexico_City'))) AS primer_reporte,
                MAX(COALESCE(evento_at, ((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Mexico_City'))) AS ultimo_reporte
            FROM asistencia_mantenimiento_eventos
            WHERE fecha = $1
              AND grupo ILIKE $2
            GROUP BY autor
            ORDER BY autor ASC
            `,
            [fechaHoy, `%${GRUPO_ASISTENCIA_INGENIERIA}%`]
        );

        for (const row of eventosRes.rows) {
            acumular(row);
        }
    } catch (error) {
        if (!error || error.code !== '42P01') {
            throw error;
        }
    }

    // Validar ajustes en asistencia_limpieza_ajustes (sobreride para LABORA/PERMISO)
    try {
        const ajustesRes = await pool.query(
            `SELECT persona_key, tipo FROM asistencia_limpieza_ajustes WHERE fecha = $1`,
            [fechaHoy]
        );
        for (const ajuste of ajustesRes.rows) {
            const personaKey = ajuste.persona_key?.toLowerCase();
            const persona = EQUIPO_INGENIERIA.find(p => p.key?.toLowerCase() === personaKey);
            if (persona && ajuste.tipo === 'LABORA') {
                // Si hay registro LABORA, marca como asistencia
                if (!mapa.has(persona.key)) {
                    mapa.set(persona.key, {
                        totalReportes: 1,
                        totalEvidencias: 0,
                        primerReporte: new Date().toISOString(),
                        ultimoReporte: new Date().toISOString(),
                        autores: []
                    });
                }
            }
        }
    } catch (error) {
        // Tabla no existe aún, continuar sin validar
    }

    return EQUIPO_INGENIERIA.map((persona) => {
        const agg = mapa.get(persona.key) || {
            totalReportes: 0,
            totalEvidencias: 0,
            primerReporte: null,
            ultimoReporte: null,
            autores: []
        };

        const descansoDominical = esDomingo && INGENIERIA_DESCANSO_DOMINGO_KEYS.has((persona.key || '').toLowerCase());
        const estado = descansoDominical
            ? 'D'
            : (agg.totalReportes > 0 || agg.totalEvidencias > 0 ? 'A' : 'F');

        return {
            persona: persona.nombre,
            puesto: persona.puesto,
            turno: persona.turno,
            estado,
            totalReportes: agg.totalReportes,
            totalEvidencias: agg.totalEvidencias,
            primerReporte: agg.primerReporte,
            ultimoReporte: agg.ultimoReporte,
            autores: agg.autores
        };
    });
}

function procesarPasoPendiente({ flujo, respuesta }) {
    const valor = (respuesta || '').trim();

    if (flujo.paso === 0) {
        if (!valor) {
            return { ok: false, msg: 'La descripcion no puede ir vacia.' };
        }
        flujo.data.descripcion = valor;
    }

    if (flujo.paso === 1) {
        if (!valor) {
            return { ok: false, msg: 'El area no puede ir vacia.' };
        }
        flujo.data.area = valor;
    }

    if (flujo.paso === 2) {
        if (!valor) {
            return { ok: false, msg: 'El tipo no puede ir vacio.' };
        }
        flujo.data.tipoMtto = valor.toUpperCase();
    }

    if (flujo.paso === 3) {
        const prioridad = valor.toUpperCase();
        if (!['ALTA', 'MEDIA', 'BAJA'].includes(prioridad)) {
            return { ok: false, msg: 'Prioridad invalida. Usa ALTA, MEDIA o BAJA.' };
        }
        flujo.data.prioridad = prioridad;
    }

    if (flujo.paso === 4) {
        flujo.data.turno = valor;
    }

    if (flujo.paso === 5) {
        flujo.data.tecnicos = valor;
    }

    if (flujo.paso === 6) {
        const fechaSql = convertirFechaDDMMYYYYaSQL(valor);
        if (fechaSql === undefined) {
            return { ok: false, msg: 'Fecha invalida. Usa DD/MM/AAAA o escribe OMITIR.' };
        }

        flujo.data.fechaSql = fechaSql;
        return { ok: true, finalizado: true, data: flujo.data };
    }

    flujo.paso += 1;
    return { ok: true, finalizado: false };
}

function procesarPasoProyecto({ flujo, respuesta, nombreAutor }) {
    const valor = (respuesta || '').trim();

    if (flujo.paso === 0) {
        if (!valor) {
            return { ok: false, msg: 'El nombre del proyecto no puede ir vacio.' };
        }
        flujo.data.nombre = valor;
    }

    if (flujo.paso === 1) {
        if (!valor) {
            return { ok: false, msg: 'La descripcion no puede ir vacia.' };
        }
        flujo.data.descripcion = valor;
    }

    if (flujo.paso === 2) {
        if (!valor) {
            return { ok: false, msg: 'El area no puede ir vacia.' };
        }
        flujo.data.area = valor;
    }

    if (flujo.paso === 3) {
        const prioridad = valor.toUpperCase();
        if (!['ALTA', 'MEDIA', 'BAJA'].includes(prioridad)) {
            return { ok: false, msg: 'Prioridad invalida. Usa ALTA, MEDIA o BAJA.' };
        }
        flujo.data.prioridad = prioridad;
    }

    if (flujo.paso === 4) {
        flujo.data.responsable = /^OMITIR$/i.test(valor) || !valor
            ? (nombreAutor || 'Sin nombre')
            : valor;
    }

    if (flujo.paso === 5) {
        flujo.data.tecnicos = valor;
    }

    if (flujo.paso === 6) {
        flujo.data.turno = valor;
    }

    if (flujo.paso === 7) {
        const fechaSql = convertirFechaDDMMYYYYaSQL(valor);
        if (fechaSql === undefined) {
            return { ok: false, msg: 'Fecha invalida. Usa DD/MM/AAAA o escribe OMITIR.' };
        }
        flujo.data.fechaSql = fechaSql;
    }

    if (flujo.paso === 8) {
        if (!valor || /^OMITIR$/i.test(valor)) {
            flujo.data.costo = null;
        } else if (!/^\d+(\.\d+)?$/.test(valor)) {
            return { ok: false, msg: 'Costo invalido. Escribe numero o OMITIR.' };
        } else {
            flujo.data.costo = Number(valor);
        }

        return { ok: true, finalizado: true, data: flujo.data };
    }

    flujo.paso += 1;
    return { ok: true, finalizado: false };
}

function construirMensajeIdManual(prefijo = 'manual') {
    const base = moment().tz('America/Mexico_City').format('YYYYMMDDHHmmssSSS');
    const random = Math.random().toString(36).slice(2, 10);
    return `${prefijo}_${base}_${random}`;
}

function iniciarFlujoAsistenciaGuiada(clave, nombreAutor) {
    flujosSupervisor[clave] = {
        tipo: 'ASISTENCIA_GUIADA',
        paso: 0,
        data: {
            area: '',
            persona: '',
            solicitante: nombreAutor || 'Sin nombre'
        }
    };
}

function opcionesPersonalAsistencia(area = '') {
    if (area === 'LIMPIEZA') {
        return MARCADOR_PERSONAL.map((p) => p.nombre);
    }

    return EQUIPO_INGENIERIA.map((p) => p.nombre);
}

function resolverFichaPersonalAsistencia(area = '', nombre = '') {
    const nombreN = normalizarComando(nombre);
    if (!nombreN) {
        return null;
    }

    if (area === 'LIMPIEZA') {
        const persona = MARCADOR_PERSONAL.find((p) => normalizarComando(p.nombre) === nombreN);
        if (!persona) {
            return null;
        }

        const turnoTxt = persona.turno || 'Sin turno';
        const horario = turnoTxt.match(/(\d{2}:\d{2}-\d{2}:\d{2})/)?.[1] || 'Sin horario';
        return {
            nombre: persona.nombre,
            turno: turnoTxt,
            horario,
            turnoRegistro: turnoTxt
        };
    }

    const persona = EQUIPO_INGENIERIA.find((p) => normalizarComando(p.nombre) === nombreN);
    if (!persona) {
        return null;
    }

    const turno = persona.turno || 'Sin turno';
    const horario = persona.horario || 'Sin horario';
    return {
        nombre: persona.nombre,
        turno,
        horario,
        turnoRegistro: `${turno} ${horario}`.trim()
    };
}

function mensajeMenuAsistenciaArea() {
    return [
        '👥 ASISTENCIA GUIADA',
        '',
        '¿Qué área deseas registrar?',
        '1) LIMPIEZA',
        '2) MTTO',
        '',
        'Responde con 1 o 2 (o escribe LIMPIEZA / MTTO).',
        'Escribe CANCELAR para salir.'
    ].join('\n');
}

function mensajeMenuAsistenciaPersonas(area = '') {
    const opciones = opcionesPersonalAsistencia(area);
    const titulo = area === 'LIMPIEZA' ? '🧹 PERSONAL LIMPIEZA' : '🛠️ PERSONAL MANTENIMIENTO';
    const lineas = [titulo, ''];

    opciones.forEach((nombre, idx) => {
        const ficha = resolverFichaPersonalAsistencia(area, nombre);
        if (ficha) {
            lineas.push(`${idx + 1}) ${nombre} (${ficha.turno}, ${ficha.horario})`);
            return;
        }

        lineas.push(`${idx + 1}) ${nombre}`);
    });

    lineas.push('');
    lineas.push('Responde con el número o escribe el nombre exacto.');
    lineas.push('Escribe CANCELAR para salir.');

    return lineas.join('\n');
}

function resolverAreaAsistencia(valor = '') {
    const n = normalizarComando(valor);
    if (n === '1' || n === 'LIMPIEZA') return 'LIMPIEZA';
    if (n === '2' || n === 'MTTO' || n === 'MANTENIMIENTO') return 'MTTO';
    return '';
}

function resolverPersonaAsistencia(area = '', valor = '') {
    const opciones = opcionesPersonalAsistencia(area);
    const n = normalizarComando(valor);
    const num = Number.parseInt(n, 10);

    if (Number.isInteger(num) && num >= 1 && num <= opciones.length) {
        return opciones[num - 1];
    }

    const encontrada = opciones.find((nombre) => normalizarComando(nombre) === n);
    return encontrada || '';
}

function opcionesPersonalPermiso(area = '') {
    if (area === 'LIMPIEZA') {
        return MARCADOR_PERSONAL.map((p) => ({ nombre: p.nombre, key: p.key, turno: p.turno || '' }));
    }

    return EQUIPO_INGENIERIA.map((p) => ({
        nombre: p.nombre,
        key: p.key,
        turno: `${p.turno || ''} ${p.horario || ''}`.trim()
    }));
}

function resolverPersonaPermisoPorArea(area = '', valor = '') {
    const opciones = opcionesPersonalPermiso(area);
    const n = normalizarComando(valor);
    const idx = Number.parseInt(n, 10);

    if (Number.isInteger(idx) && idx >= 1 && idx <= opciones.length) {
        return opciones[idx - 1] || null;
    }

    return opciones.find((p) => normalizarComando(p.nombre) === n) || null;
}

function parsearAsistenciaMantenimientoManual(cuerpo = '', nombreAutor = '') {
    const partes = (cuerpo || '')
        .split('|')
        .map((p) => p.trim())
        .filter(Boolean);

    let autor = '';
    let tipoEvento = 'ENTRADA';
    let turno = 'Sin turno';
    let ubicacion = 'Centro Operativo SHP1';

    for (const parte of partes) {
        const upper = normalizarComando(parte);

        if (upper === 'ENTRADA' || upper === 'SALIDA') {
            tipoEvento = upper;
            continue;
        }

        const turnoMatch = parte.match(/^TURNO\s*:?\s*(.+)$/i);
        if (turnoMatch?.[1]) {
            turno = turnoMatch[1].trim();
            continue;
        }

        const ubicMatch = parte.match(/^(?:UBICACION|UBICACIÓN|LUGAR|LOCALIZACION|LOCALIZACIÓN)\s*:?\s*(.+)$/i);
        if (ubicMatch?.[1]) {
            ubicacion = ubicMatch[1].trim();
            continue;
        }

        if (!autor) {
            autor = parte;
        }
    }

    if (turno === 'Sin turno') {
        const personaInferida = resolverIngenieriaPersona(autor || nombreAutor);
        if (personaInferida?.turno) {
            turno = `${personaInferida.turno}${personaInferida.horario ? ` ${personaInferida.horario}` : ''}`.trim();
        }
    }

    return {
        autor: autor || nombreAutor || 'Sin nombre',
        tipoEvento,
        turno,
        ubicacion
    };
}

function resolverPersonaPermiso(valor = '') {
    const n = normalizarComando(valor).toLowerCase();
    if (!n) {
        return null;
    }

    for (const p of MARCADOR_PERSONAL) {
        const nombreN = normalizarComando(p.nombre).toLowerCase();
        if (n.includes(nombreN) || nombreN.includes(n)) {
            return { key: p.key, nombre: p.nombre, area: 'LIMPIEZA', turno: p.turno || '' };
        }

        if ((p.aliases || []).some((a) => {
            const aliasN = normalizarComando(a).toLowerCase();
            return aliasN && (n.includes(aliasN) || aliasN.includes(n));
        })) {
            return { key: p.key, nombre: p.nombre, area: 'LIMPIEZA', turno: p.turno || '' };
        }
    }

    for (const p of EQUIPO_INGENIERIA) {
        const nombreN = normalizarComando(p.nombre).toLowerCase();
        if (n.includes(nombreN) || nombreN.includes(n)) {
            return { key: p.key, nombre: p.nombre, area: 'MTTO', turno: `${p.turno || ''} ${p.horario || ''}`.trim() };
        }

        if ((p.aliases || []).some((a) => {
            const aliasN = normalizarComando(a).toLowerCase();
            return aliasN && (n.includes(aliasN) || aliasN.includes(n));
        })) {
            return { key: p.key, nombre: p.nombre, area: 'MTTO', turno: `${p.turno || ''} ${p.horario || ''}`.trim() };
        }
    }

    return null;
}

function normalizarTipoPermisoInput(valor = '') {
    const v = normalizarComando(valor || 'CAMBIO DESCANSO');
    if (!v) return 'CAMBIO_DESCANSO';
    if (v === '1' || v.includes('DESCUENTO')) return 'DESCUENTO_SUELDO';
    if (v === '2' || (v.includes('CAMBIO') && v.includes('DESCANSO'))) return 'CAMBIO_DESCANSO';
    if (v === '3' || (v.includes('TURNO') && v.includes('DOBLE'))) return 'TURNO_DOBLE';
    if (v === '4' || v.includes('INTERCAMBIO')) return 'INTERCAMBIO_TURNO';
    if (v === '5' || v.includes('PENDIENTE')) return 'PENDIENTE_DEFINIR';
    return v.replace(/\s+/g, '_');
}

function parseFechaPermiso(valor = '', fechaBase = moment().tz('America/Mexico_City')) {
    const t = String(valor || '').trim();
    const tn = normalizarComando(t).toLowerCase();
    if (!t) {
        return fechaBase.clone();
    }

    if (tn === 'hoy') {
        return fechaBase.clone();
    }

    if (tn === 'manana' || tn === 'mañana') {
        return fechaBase.clone().add(1, 'day');
    }

    const fechaTexto = t.match(/(\d{2}\/\d{2}\/\d{4}|\d{2}\/\d{2}\/\d{2}|\d{2}\/\d{2}|\d{4}-\d{2}-\d{2})/);
    const fechaValor = fechaTexto?.[1] || t;

    if (/^\d{2}\/\d{2}\/\d{4}$/.test(fechaValor)) {
        const d = moment.tz(fechaValor, 'DD/MM/YYYY', true, 'America/Mexico_City');
        return d.isValid() ? d : null;
    }

    if (/^\d{2}\/\d{2}\/\d{2}$/.test(fechaValor)) {
        const d = moment.tz(fechaValor, 'DD/MM/YY', true, 'America/Mexico_City');
        return d.isValid() ? d : null;
    }

    if (/^\d{2}\/\d{2}$/.test(fechaValor)) {
        const [dd, mm] = fechaValor.split('/').map((x) => Number.parseInt(x, 10));
        const year = fechaBase.year();
        const d = moment.tz(`${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`, 'YYYY-MM-DD', 'America/Mexico_City');
        return d.isValid() ? d : null;
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(fechaValor)) {
        const d = moment.tz(fechaValor, 'YYYY-MM-DD', true, 'America/Mexico_City');
        return d.isValid() ? d : null;
    }

    return null;
}

function requiereFechaCompensacion(tipoPermiso = '') {
    return ['CAMBIO_DESCANSO', 'TURNO_DOBLE'].includes(String(tipoPermiso || '').toUpperCase());
}


// =========================
// HANDLER SUPERVISOR
// =========================

// =============================================
// PROCESADOR DE MENÚS ANIDADOS
// =============================================

async function procesarMenuAnidado({ flujo, respuesta, mensaje, clave }) {
    const valor = (respuesta || '').trim().toLowerCase();

    // Opción para volver atrás
    if (valor === '0' || valor === 'atras' || valor === 'atrás') {
        delete flujosSupervisor[clave];
        return { siguiente: 'MENU_PRINCIPAL', msg: menuPrincipal() };
    }

    // Salir
    if (valor === 'cancelar' || valor === 'salir' || valor === 'exit') {
        delete flujosSupervisor[clave];
        return { siguiente: null, msg: '🛑 Menú cerrado.' };
    }

    // MENU_PRINCIPAL
    if (flujo.tipo === 'MENU_PRINCIPAL') {
        if (valor === '1') {
            flujosSupervisor[clave] = { tipo: 'MENU_AYUDA', paso: 0, data: {} };
            return { siguiente: 'MENU_AYUDA', msg: menuAyuda() };
        }
        if (valor === '2') {
            flujosSupervisor[clave] = { tipo: 'MENU_GUIA', paso: 0, data: {} };
            return { siguiente: 'MENU_GUIA', msg: menuGuia() };
        }
        if (valor === '3') {
            flujosSupervisor[clave] = { tipo: 'MENU_INFORMES', paso: 0, data: {} };
            return { siguiente: 'MENU_INFORMES', msg: menuInformes() };
        }
        if (valor === '4') {
            flujosSupervisor[clave] = { tipo: 'MENU_ALERTAS', paso: 0, data: {} };
            return { siguiente: 'MENU_ALERTAS', msg: menuAlertas() };
        }
        if (valor === '5') {
            flujosSupervisor[clave] = { tipo: 'MENU_CONFIGURAR', paso: 0, data: {} };
            return { siguiente: 'MENU_CONFIGURAR', msg: menuConfigurar() };
        }
        return { siguiente: null, msg: '⚠️ Opción no válida. Responde 1-5 o escribe CANCELAR.' };
    }

    // MENU_AYUDA
    if (flujo.tipo === 'MENU_AYUDA') {
        if (valor === '1') return { siguiente: null, msg: detalleAyudaPendientes() };
        if (valor === '2') return { siguiente: null, msg: detalleAyudaProyectos() };
        if (valor === '3') return { siguiente: null, msg: detalleAyudaEvidencias() };
        if (valor === '4') return { siguiente: null, msg: detalleAyudaPermisos() };
        if (valor === '5') return { siguiente: null, msg: detalleAyudaAsistencia() };
        return { siguiente: null, msg: '⚠️ Opción no válida. Responde 1-5 o 0 para atrás.' };
    }

    // MENU_GUIA
    if (flujo.tipo === 'MENU_GUIA') {
        if (valor === '1') {
            flujosSupervisor[clave] = { tipo: 'PENDIENTE', paso: 0, data: { descripcion: '' } };
            return { siguiente: 'GUIA_PENDIENTE', msg: 'Iniciando PENDIENTE...\nEscribe la descripción:' };
        }
        if (valor === '2') {
            flujosSupervisor[clave] = { tipo: 'PROYECTO', paso: 0, data: { nombre: '' } };
            return { siguiente: 'GUIA_PROYECTO', msg: 'Iniciando PROYECTO...\nEscribe el nombre:' };
        }
        if (valor === '3') {
            flujosSupervisor[clave] = { tipo: 'PERMISO_GUIADO', paso: 0, data: {} };
            return { siguiente: 'GUIA_PERMISO', msg: guiaPermisoMenuEquipos() };
        }
        return { siguiente: null, msg: '⚠️ Opción no válida. Responde 1-3 o 0 para atrás.' };
    }

    // MENU_INFORMES
    if (flujo.tipo === 'MENU_INFORMES') {
        if (valor === '1') {
            flujosSupervisor[clave] = { tipo: 'MENU_PENDIENTES', paso: 0, data: {} };
            return { siguiente: 'MENU_PENDIENTES', msg: menuPendientes() };
        }
        if (valor === '2') {
            flujosSupervisor[clave] = { tipo: 'MENU_PREVENTIVOS', paso: 0, data: {} };
            return { siguiente: 'MENU_PREVENTIVOS', msg: menuPreventivos() };
        }
        if (valor === '3') {
            flujosSupervisor[clave] = { tipo: 'MENU_ASISTENCIA', paso: 0, data: {} };
            return { siguiente: 'MENU_ASISTENCIA', msg: menuAsistencia() };
        }
        if (valor === '4') {
            return { comando: 'PERMISOS RESUMEN' };
        }
        if (valor === '5') {
            return { comando: 'REPORTE' };
        }
        return { siguiente: null, msg: '⚠️ Opción no válida. Responde 1-5 o 0 para atrás.' };
    }

    // MENU_PENDIENTES
    if (flujo.tipo === 'MENU_PENDIENTES') {
        if (valor === '1') {
            return { comando: 'LISTAR' };
        }
        if (valor === '2') {
            return { comando: 'ABIERTOS' };
        }
        if (valor === '3') {
            return { comando: 'CERRADOS' };
        }
        if (valor === '4') {
            return { comando: 'COMPLETADOS' };
        }
        if (valor === '5') {
            return { siguiente: null, msg: '🔍 ¿Qué ID buscas?\n\nEscribe: LISTAR <ID>\n\nEj: LISTAR 42' };
        }
        return { siguiente: null, msg: '⚠️ Opción no válida. Responde 1-5 o 0 para atrás.' };
    }

    // MENU_PREVENTIVOS
    if (flujo.tipo === 'MENU_PREVENTIVOS') {
        if (valor === '1') {
            return { comando: 'PREVENTIVOS' };
        }
        if (valor === '2') {
            return { comando: 'PREVENTIVOS' };
        }
        if (valor === '3') {
            return { comando: 'PREVENTIVOS CERRADOS' };
        }
        if (valor === '4') {
            return { siguiente: null, msg: '🔒 ¿Qué ID de preventivo?\n\nEscribe: CERRAR PREVENTIVO <ID>\n\nEj: CERRAR PREVENTIVO 7' };
        }
        return { siguiente: null, msg: '⚠️ Opción no válida. Responde 1-4 o 0 para atrás.' };
    }

    // MENU_ASISTENCIA
    if (flujo.tipo === 'MENU_ASISTENCIA') {
        if (valor === '1') {
            return { comando: 'MARCADOR' };
        }
        if (valor === '2') {
            return { comando: 'EN TURNO' };
        }
        if (valor === '3') {
            return { comando: 'ASISTENCIA HOY' };
        }
        if (valor === '4') {
            return { comando: 'ESTADO TURNO LIMPIEZA' };
        }
        if (valor === '5') {
            return { comando: 'ALERTAS ASISTENCIA' };
        }
        return { siguiente: null, msg: '⚠️ Opción no válida. Responde 1-5 o 0 para atrás.' };
    }

    // MENU_ALERTAS
    if (flujo.tipo === 'MENU_ALERTAS') {
        if (valor === '1') {
            return { comando: 'ALERTAS ASISTENCIA' };
        }
        if (valor === '2') {
            return { comando: 'ALERTAS PENDIENTES' };
        }
        if (valor === '3') {
            return { comando: 'ALERTAS DEUDAS' };
        }
        return { siguiente: null, msg: '⚠️ Opción no válida. Responde 1-3 o 0 para atrás.' };
    }

    // MENU_CONFIGURAR
    if (flujo.tipo === 'MENU_CONFIGURAR') {
        if (valor === '1') {
            return { siguiente: null, msg: '✅ Flujo recomendado:\n\n1) CONFIRMAR PERMISO <ID> | DESCUENTO/CAMBIO DESCANSO/TURNO DOBLE/INTERCAMBIO\n   (si aplica, te pedirá día de compensación)\n2) APROBAR PERMISO <ID>\n\nTambién puedes aprobar directo con tipo+fecha:\nAPROBAR PERMISO <ID> | CAMBIO DESCANSO | 12/07/2026' };
        }
        if (valor === '2') {
            return { siguiente: null, msg: '🗑️ Para cancelar un ajuste:\n\nCANCELAR AJUSTE <ID>\n\nEj: CANCELAR AJUSTE 8' };
        }
        if (valor === '3') {
            return { comando: 'PERMISOS LIMITES' };
        }
        return { siguiente: null, msg: '⚠️ Opción no válida. Responde 1-3 o 0 para atrás.' };
    }

    return { siguiente: null, msg: '⚠️ Error al procesar menú.' };
}

async function manejarSupervisor({ message, chat, textoOriginal, nombreAutor, fecha }) {

    const descripcion = (textoOriginal || '').trim();
    const desc        = normalizarComando(descripcion);
    const clave       = claveMemoria(chat.name, message.author);
    const flujoActivo = flujosSupervisor[clave];

    async function auditarCO({ comando, payload = null, estado = 'OK', resultado = '', referenciaTabla = '', referenciaId = null, error = '' }) {
        try {
            await registrarEventoCO(pool, {
                chatGrupo: chat?.name || '',
                autor: nombreAutor || 'Sin nombre',
                comando,
                payload,
                estado,
                resultado,
                referenciaTabla,
                referenciaId,
                error
            });
        } catch (auditError) {
            console.error('⚠️ Error auditando CO:', auditError?.message || auditError);
        }
    }

    // =========================
    // COMANDOS DE ALTA PRIORIDAD (antes de flujos)
    // =========================
    
    console.log('🔍 DEBUG manejarSupervisor - descripcion:', descripcion.slice(0, 80));
    console.log('🔍 DEBUG - desc normalizado:', desc);
    
    // MARCAR PRESENTE <NOMBRE>
    const marcarPresenteMatch = descripcion.match(/^marcar\s+presente\s*:\s*(.+)$/i);
    console.log('🔍 DEBUG marcarPresenteMatch:', marcarPresenteMatch ? 'SÍ' : 'NO');
    if (marcarPresenteMatch) {
        console.log('✅ DETECTADO: MARCAR PRESENTE');
        const persona = marcarPresenteMatch[1].trim();
        
        let personaResolvida = MARCADOR_PERSONAL.find(p => 
            p.nombre.toLowerCase().includes(persona.toLowerCase()) ||
            persona.toLowerCase().includes(p.nombre.toLowerCase()) ||
            p.aliases?.some(a => a.toLowerCase().includes(persona.toLowerCase()))
        );
        
        if (!personaResolvida) {
            personaResolvida = resolverIngenieriaPersona(persona);
        }

        if (!personaResolvida) {
            await message.reply(`⚠️ Persona no encontrada: "${persona}". Escribe nombre completo o alias.`);
            return;
        }

        try {
            await pool.query(
                `INSERT INTO asistencia_limpieza_ajustes (fecha, persona_key, tipo)
                 VALUES ($1, $2, 'LABORA')
                 ON CONFLICT (fecha, persona_key) DO UPDATE SET tipo = 'LABORA'`,
                [fecha.format('YYYY-MM-DD'), personaResolvida.key]
            );

            await message.reply(
                `✅ ${personaResolvida.nombre} marcado como PRESENTE\n` +
                `📅 Fecha: ${fecha.format('DD/MM/YYYY')}\n` +
                `Se cancelan alertas de asistencia para este día.`
            );
        } catch (error) {
            console.error('❌ Error marcando presente:', error);
            await message.reply(`❌ Error: ${error.message}`);
        }
        return;
    }

    // REGISTRAR FALTA <NOMBRE> | <MOTIVO>
    // REGISTRAR FALTA: Nombre | Motivo [| YYYY-MM-DD o DD/MM/YYYY]
    const registrarFaltaMatch = descripcion.match(/^REGISTRAR\s+FALTA\s*:\s*(.+?)\s*\|\s*(.+?)(?:\s*\|\s*(.+))?$/i);
    if (registrarFaltaMatch) {
        console.log('✅ DETECTADO: REGISTRAR FALTA');
        const persona = registrarFaltaMatch[1].trim();
        const motivo = registrarFaltaMatch[2].trim();
        let fechaRegistro = fecha; // Por defecto, hoy
        
        // Si hay fecha opcional
        if (registrarFaltaMatch[3]) {
            const fechaStr = registrarFaltaMatch[3].trim();
            let fechaParsed;
            
            // Intentar parsear en formato DD/MM/YYYY
            if (fechaStr.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
                fechaParsed = moment(fechaStr, 'DD/MM/YYYY');
            }
            // O en formato YYYY-MM-DD
            else if (fechaStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
                fechaParsed = moment(fechaStr, 'YYYY-MM-DD');
            }
            
            if (fechaParsed && fechaParsed.isValid()) {
                fechaRegistro = fechaParsed.tz('America/Mexico_City');
            } else {
                await message.reply(`⚠️ Fecha inválida: "${fechaStr}". Usa DD/MM/YYYY o YYYY-MM-DD`);
                return;
            }
        }
        
        let personaResolvida = MARCADOR_PERSONAL.find(p => 
            p.nombre.toLowerCase().includes(persona.toLowerCase()) ||
            persona.toLowerCase().includes(p.nombre.toLowerCase()) ||
            p.aliases?.some(a => a.toLowerCase().includes(persona.toLowerCase()))
        );
        
        if (!personaResolvida) {
            personaResolvida = resolverIngenieriaPersona(persona);
        }

        if (!personaResolvida) {
            await message.reply(`⚠️ Persona no encontrada: "${persona}". Escribe nombre completo o alias.`);
            return;
        }

        try {
            // Registra como PERMISO (no DESCANSO)
            await pool.query(
                `INSERT INTO asistencia_limpieza_ajustes (fecha, persona_key, tipo, motivo, creado_por)
                 VALUES ($1, $2, 'PERMISO', $3, $4)
                 ON CONFLICT (fecha, persona_key) DO UPDATE SET tipo = 'PERMISO', motivo = $3`,
                [fechaRegistro.format('YYYY-MM-DD'), personaResolvida.key, motivo, nombreAutor]
            );

            const mañana = fechaRegistro.clone().add(1, 'day').format('DD/MM/YYYY');
            await message.reply(
                `✅ PERMISO registrado para ${personaResolvida.nombre}\n` +
                `📅 Fecha: ${fechaRegistro.format('DD/MM/YYYY')}\n` +
                `💬 Motivo: ${motivo}\n\n` +
                `⏰ PRÓXIMO PASO:\n` +
                `Mañana (${mañana}) registra compensación:\n\n` +
                `MARCAR PRESENTE: ${personaResolvida.nombre}`
            );
        } catch (error) {
            console.error('❌ Error registrando permiso:', error);
            await message.reply(`❌ Error: ${error.message}`);
        }
        return;
    }

    // PERMISO: Persona | Motivo | Tipo(opcional) | Fecha(opcional)
    const permisoMatch = descripcion.match(/^PERMISO\s*:\s*(.+?)\s*\|\s*(.+?)(?:\s*\|\s*(.+?))?(?:\s*\|\s*(.+))?$/i);
    if (permisoMatch) {
        const personaRaw = permisoMatch[1]?.trim();
        const motivo = permisoMatch[2]?.trim();
        const tipoPermiso = normalizarTipoPermisoInput(permisoMatch[3] || 'CAMBIO DESCANSO');
        const fechaPermiso = parseFechaPermiso(permisoMatch[4], fecha);

        if (!personaRaw || !motivo) {
            await auditarCO({
                comando: 'PERMISO',
                payload: { descripcion },
                estado: 'ERROR',
                error: 'Formato inválido'
            });
            await message.reply('⚠️ Formato inválido. Usa: PERMISO: Nombre | Motivo | Tipo | Fecha');
            return;
        }

        if (!fechaPermiso) {
            await auditarCO({
                comando: 'PERMISO',
                payload: { personaRaw, motivo, tipoPermiso, fechaRaw: permisoMatch[4] || '' },
                estado: 'ERROR',
                error: 'Fecha inválida'
            });
            await message.reply('⚠️ Fecha inválida. Usa DD/MM, DD/MM/YYYY o YYYY-MM-DD.');
            return;
        }

        const persona = resolverPersonaPermiso(personaRaw);
        if (!persona) {
            await auditarCO({
                comando: 'PERMISO',
                payload: { personaRaw, motivo, tipoPermiso, fecha: fechaPermiso.format('YYYY-MM-DD') },
                estado: 'ERROR',
                error: 'Persona no encontrada'
            });
            await message.reply(`⚠️ Persona no encontrada: "${personaRaw}".`);
            return;
        }

        const limites = await validarLimitesPermisoMes(pool, persona.key, tipoPermiso, fechaPermiso);
        if (!limites.ok) {
            await auditarCO({
                comando: 'PERMISO',
                payload: { personaKey: persona.key, tipoPermiso, fecha: fechaPermiso.format('YYYY-MM-DD') },
                estado: 'ERROR',
                error: limites.alerta || 'Límite mensual alcanzado'
            });
            await message.reply(limites.alerta || '⚠️ Límite mensual alcanzado para este tipo de permiso.');
            return;
        }

        const cobertura = await validarCoberturaTurno(pool, persona.key, fechaPermiso, MARCADOR_PERSONAL, EQUIPO_INGENIERIA);
        if (!cobertura.ok && cobertura.critico) {
            await auditarCO({
                comando: 'PERMISO',
                payload: { personaKey: persona.key, tipoPermiso, fecha: fechaPermiso.format('YYYY-MM-DD') },
                estado: 'ERROR',
                error: cobertura.msg || 'Sin cobertura crítica'
            });
            await message.reply(cobertura.msg || '⚠️ No hay cobertura para aprobar este permiso.');
            return;
        }

        const guardado = await registrarPermisoConAprobacion(pool, {
            fecha: fechaPermiso,
            personaKey: persona.key,
            area: persona.area,
            tipoPermiso,
            motivo,
            creadoPor: nombreAutor
        });

        if (!guardado.ok) {
            await auditarCO({
                comando: 'PERMISO',
                payload: { personaKey: persona.key, tipoPermiso, fecha: fechaPermiso.format('YYYY-MM-DD') },
                estado: 'ERROR',
                error: guardado.error || 'No se pudo registrar permiso'
            });
            await message.reply(`❌ No se pudo registrar permiso: ${guardado.error || 'Error desconocido'}`);
            return;
        }

        await auditarCO({
            comando: 'PERMISO',
            payload: {
                personaKey: persona.key,
                tipoPermiso,
                fecha: fechaPermiso.format('YYYY-MM-DD'),
                motivo
            },
            estado: 'OK',
            resultado: 'Permiso registrado en estado pendiente',
            referenciaTabla: 'asistencia_limpieza_ajustes',
            referenciaId: guardado.id
        });

        const coberturaMsg = (cobertura.alternos || []).length
            ? `\nCobertura sugerida: ${(cobertura.alternos || []).join(', ')}`
            : '';

        await message.reply(
            `📋 Permiso registrado (pendiente de aprobación)\n` +
            `ID: ${guardado.id}\n` +
            `Persona: ${persona.nombre}\n` +
            `Fecha: ${fechaPermiso.format('DD/MM/YYYY')}\n` +
            `Tipo: ${tipoPermiso.replace(/_/g, ' ')}\n` +
            `Motivo: ${motivo}${coberturaMsg}\n\n` +
            `Para aprobar: APROBAR PERMISO ${guardado.id}`
        );
        return;
    }

    const confirmarTipoPermisoMatch = descripcion.match(/^CONFIRMAR\s+PERMISO\s+(\d+)\s*\|\s*([^|]+?)(?:\s*\|\s*(.+))?$/i);
    if (confirmarTipoPermisoMatch) {
        const id = Number.parseInt(confirmarTipoPermisoMatch[1], 10);
        const tipoPermiso = normalizarTipoPermisoInput(confirmarTipoPermisoMatch[2] || '');
        const fechaCompRaw = (confirmarTipoPermisoMatch[3] || '').trim();

        if (requiereFechaCompensacion(tipoPermiso) && !fechaCompRaw) {
            flujosSupervisor[clave] = {
                tipo: 'CONFIRMAR_PERMISO_DETALLE',
                paso: 0,
                data: { id, tipoPermiso }
            };

            await message.reply(
                `📅 Falta el día de compensación para ${(tipoPermiso || '').replace(/_/g, ' ')}\n` +
                `Responde con la fecha (DD/MM o DD/MM/YYYY).\n` +
                `Ejemplo: 12/07/2026\n` +
                `Escribe CANCELAR para salir.`
            );
            return;
        }

        const fechaComp = fechaCompRaw ? parseFechaPermiso(fechaCompRaw, fecha) : null;
        if (fechaCompRaw && !fechaComp) {
            await auditarCO({
                comando: 'CONFIRMAR PERMISO',
                payload: { id, tipoPermiso, fechaCompRaw },
                estado: 'ERROR',
                error: 'Fecha inválida'
            });
            await message.reply('⚠️ Fecha inválida. Usa DD/MM, DD/MM/YYYY o YYYY-MM-DD.');
            return;
        }

        const confirmacion = await confirmarTipoPermiso(pool, id, tipoPermiso, nombreAutor, {
            fechaPago: fechaComp ? fechaComp.format('YYYY-MM-DD') : ''
        });
        if (!confirmacion.ok) {
            await auditarCO({
                comando: 'CONFIRMAR PERMISO',
                payload: { id, tipoPermiso, fechaPago: fechaComp ? fechaComp.format('YYYY-MM-DD') : '' },
                estado: 'ERROR',
                error: confirmacion.error || 'No se pudo confirmar tipo'
            });
            await message.reply(`⚠️ No se pudo confirmar tipo en permiso ${id}: ${confirmacion.error || 'sin detalle'}`);
            return;
        }

        await auditarCO({
            comando: 'CONFIRMAR PERMISO',
            payload: {
                id,
                tipoPermiso,
                fechaPago: confirmacion.permiso?.fecha_pago || null
            },
            estado: 'OK',
            resultado: 'Tipo de permiso confirmado',
            referenciaTabla: 'asistencia_limpieza_ajustes',
            referenciaId: confirmacion.permiso?.id || id
        });

        await message.reply(
            `🧾 Tipo confirmado\n` +
            `ID: ${confirmacion.permiso?.id}\n` +
            `Tipo: ${(confirmacion.permiso?.tipo_permiso || '').replace(/_/g, ' ')}\n` +
            `Descansa: ${moment(confirmacion.permiso?.fecha).format('DD/MM/YYYY')}\n` +
            `${confirmacion.permiso?.fecha_pago ? `Compensa/Paga: ${moment(confirmacion.permiso.fecha_pago).format('DD/MM/YYYY')}\n` : ''}` +
            `Estado: ${confirmacion.permiso?.estado || 'PENDIENTE_APROBACION'}\n\n` +
            `Siguiente paso: APROBAR PERMISO ${confirmacion.permiso?.id}`
        );
        return;
    }

    const aprobarPermisoMatch = descripcion.match(/^APROBAR\s+PERMISO\s+(\d+)(?:\s*\|\s*([^|]+?))?(?:\s*\|\s*(.+))?$/i);
    if (aprobarPermisoMatch) {
        const id = Number.parseInt(aprobarPermisoMatch[1], 10);
        const tipoOverrideRaw = (aprobarPermisoMatch[2] || '').trim();
        const fechaCompRaw = (aprobarPermisoMatch[3] || '').trim();
        const tipoPermiso = tipoOverrideRaw ? normalizarTipoPermisoInput(tipoOverrideRaw) : '';
        const fechaComp = fechaCompRaw ? parseFechaPermiso(fechaCompRaw, fecha) : null;
        if (fechaCompRaw && !fechaComp) {
            await auditarCO({
                comando: 'APROBAR PERMISO',
                payload: { id, tipoPermiso, fechaCompRaw },
                estado: 'ERROR',
                error: 'Fecha inválida'
            });
            await message.reply('⚠️ Fecha inválida. Usa DD/MM, DD/MM/YYYY o YYYY-MM-DD.');
            return;
        }

        const aprobacion = await aprobarPermiso(pool, id, nombreAutor, {
            tipoPermiso,
            fechaPago: fechaComp ? fechaComp.format('YYYY-MM-DD') : ''
        });
        if (!aprobacion.ok) {
            await auditarCO({
                comando: 'APROBAR PERMISO',
                payload: { id, tipoPermiso, fechaPago: fechaComp ? fechaComp.format('YYYY-MM-DD') : '' },
                estado: 'ERROR',
                error: aprobacion.error || 'No se pudo aprobar'
            });
            await message.reply(`⚠️ No se pudo aprobar permiso ${id}: ${aprobacion.error || 'No encontrado'}`);
            return;
        }

        await auditarCO({
            comando: 'APROBAR PERMISO',
            payload: {
                id,
                tipoPermiso: aprobacion.permiso?.tipo_permiso || tipoPermiso || null,
                fechaPago: aprobacion.permiso?.fecha_pago || null
            },
            estado: 'OK',
            resultado: 'Permiso aprobado',
            referenciaTabla: 'asistencia_limpieza_ajustes',
            referenciaId: aprobacion.permiso?.id || id
        });

        await message.reply(
            `✅ Permiso aprobado\n` +
            `ID: ${aprobacion.permiso?.id}\n` +
            `Persona key: ${aprobacion.permiso?.persona_key || '-'}\n` +
            `Descansa: ${moment(aprobacion.permiso?.fecha).format('DD/MM/YYYY')}\n` +
            `${aprobacion.permiso?.fecha_pago ? `Compensa/Paga: ${moment(aprobacion.permiso.fecha_pago).format('DD/MM/YYYY')}\n` : ''}` +
            `Tipo: ${(aprobacion.permiso?.tipo_permiso || '').replace(/_/g, ' ')}`
        );
        return;
    }

    const cancelarAjusteMatch = descripcion.match(/^CANCELAR\s+AJUSTE\s+(\d+)$/i);
    if (cancelarAjusteMatch) {
        const id = Number.parseInt(cancelarAjusteMatch[1], 10);
        const del = await pool.query('DELETE FROM asistencia_limpieza_ajustes WHERE id = $1 RETURNING id', [id]);
        if (!del.rows.length) {
            await auditarCO({
                comando: 'CANCELAR AJUSTE',
                payload: { id },
                estado: 'ERROR',
                error: 'Ajuste no encontrado'
            });
            await message.reply(`⚠️ Ajuste ${id} no encontrado.`);
            return;
        }

        await auditarCO({
            comando: 'CANCELAR AJUSTE',
            payload: { id },
            estado: 'OK',
            resultado: 'Ajuste cancelado',
            referenciaTabla: 'asistencia_limpieza_ajustes',
            referenciaId: id
        });

        await message.reply(`🗑️ Ajuste ${id} cancelado.`);
        return;
    }

    const historialCoHoyMatch = desc.match(/^HISTORIAL\s+CO(?:\s+HOY)?$/i);
    if (historialCoHoyMatch) {
        const { desde, hasta } = rangoHoyMx();
        const rows = await listarHistorialCO(pool, { desde, hasta, limit: 20 });

        if (!rows.length) {
            await message.reply('📘 HISTORIAL CO HOY\nSin movimientos registrados.');
            return;
        }

        const salida = ['📘 HISTORIAL CO HOY (últimos 20)'];
        rows.forEach((r) => {
            salida.push(`• [${moment(r.fecha).format('HH:mm')}] ${r.autor || '-'} | ${r.comando} | ${r.estado}`);
        });

        await message.reply(salida.join('\n'));
        return;
    }

    const historialCoAutorMatch = descripcion.match(/^HISTORIAL\s+CO\s+AUTOR\s*:\s*(.+)$/i);
    if (historialCoAutorMatch) {
        const autorFiltro = historialCoAutorMatch[1].trim();
        const rows = await listarHistorialCO(pool, { autor: autorFiltro, limit: 20 });

        if (!rows.length) {
            await message.reply(`📘 HISTORIAL CO (${autorFiltro})\nSin movimientos registrados.`);
            return;
        }

        const salida = [`📘 HISTORIAL CO (${autorFiltro})`];
        rows.forEach((r) => {
            salida.push(`• [${moment(r.fecha).format('DD/MM HH:mm')}] ${r.comando} | ${r.estado}`);
        });

        await message.reply(salida.join('\n'));
        return;
    }

    if (desc === 'PERMISOS RESUMEN' || desc === 'PERMISOS LIMITES') {
        const mesIso = fecha.clone().format('YYYY-MM');
        const rep = await reportePermisosDelMes(pool, mesIso);
        if (!rep.ok) {
            await message.reply(`❌ Error al consultar permisos: ${rep.error || 'sin detalle'}`);
            return;
        }

        const lineas = [
            `📋 PERMISOS ${mesIso}`,
            `Total: ${rep.resumen.total} | Aprobados: ${rep.resumen.aprobados} | Pendientes: ${rep.resumen.pendientes}`,
            `Cambio descanso: ${rep.resumen.porTipo.cambioDescanso} / 2 por persona al mes`,
            `Turno doble: ${rep.resumen.porTipo.turnoDoble} | Intercambio: ${rep.resumen.porTipo.intercambio} | Descuento: ${rep.resumen.porTipo.descuento}`
        ];

        const preview = rep.permisos.slice(0, 8).map((p) => {
            return `• ${moment(p.fecha).format('DD/MM')} | ${p.persona_key} | ${p.tipo_permiso} | ${p.estado}`;
        });

        await message.reply([...lineas, '', ...preview].join('\n'));
        return;
    }

    if (desc === 'ALERTAS DEUDAS') {
        const deudas = await listarDeudasPendientes(pool);
        if (!deudas.ok) {
            await message.reply(`❌ Error al consultar deudas: ${deudas.error || 'sin detalle'}`);
            return;
        }

        const pendientes = deudas.deudasPendientes || [];
        const vencidas = deudas.deudasVencidas || [];
        if (!pendientes.length && !vencidas.length) {
            await message.reply('✅ No hay deudas de turno doble pendientes.');
            return;
        }

        const salida = ['💳 ALERTAS DEUDAS'];
        if (pendientes.length) {
            salida.push('', 'Pendientes:');
            pendientes.slice(0, 10).forEach((d) => {
                salida.push(`• ${d.persona_key} | paga ${moment(d.fecha_pago).format('DD/MM')} | faltan ${d.dias_para_vencer} días`);
            });
        }

        if (vencidas.length) {
            salida.push('', 'Vencidas:');
            vencidas.slice(0, 10).forEach((d) => {
                salida.push(`• ${d.persona_key} | venció ${moment(d.fecha_pago).format('DD/MM')} | ${Math.abs(d.dias_para_vencer)} días`);
            });
        }

        await message.reply(salida.join('\n'));
        return;
    }

    // =========================
    // RESTO DE PROCESAMIENTO
    // =========================

    if (COMANDOS_CANCELAR.includes(desc)) {
        if (flujoActivo) {
            delete flujosSupervisor[clave];
            if (flujoActivo.tipo === 'AYUDA_GUIADA') {
                await message.reply('🛑 Ayuda guiada cerrada.');
            } else {
                await message.reply('🛑 Captura guiada cancelada.');
            }
        }
        return;
    }

    if (!message.hasMedia && ['REPORTE', 'RESUMEN', 'REPORTE OPERATIVO', 'RESUMEN OPERATIVO'].includes(desc)) {
        const fechaMx = moment().tz('America/Mexico_City');
        const inicioDia = fechaMx.clone().startOf('day').format('YYYY-MM-DD HH:mm:ss');
        const finDia = fechaMx.clone().endOf('day').format('YYYY-MM-DD HH:mm:ss');

        const resumen = await obtenerResumenOperativo({ inicioDia, finDia });
        const mensajeResumen = construirMensajeResumenOperativo({
            momento: fechaMx,
            resumen,
            tipo: 'MANUAL'
        });

        await message.reply(mensajeResumen);
        return;
    }

    if (!message.hasMedia && COMANDOS_GUIA_AYUDA.includes(desc)) {
        iniciarFlujoAyudaGuiada(clave);
        await message.reply(menuPrincipal());
        return;
    }

    if (!message.hasMedia && (desc === 'ASISTENCIA' || desc === 'EN SITIO')) {
        iniciarFlujoAsistenciaGuiada(clave, nombreAutor);
        await message.reply(mensajeMenuAsistenciaArea());
        return;
    }

    if (flujoActivo && !message.hasMedia && [
        'MENU_PRINCIPAL', 'MENU_AYUDA', 'MENU_GUIA', 
        'MENU_INFORMES', 'MENU_ALERTAS', 'MENU_CONFIGURAR',
        'MENU_PENDIENTES', 'MENU_PREVENTIVOS', 'MENU_ASISTENCIA'
    ].includes(flujoActivo.tipo)) {
        const resultado = await procesarMenuAnidado({
            flujo: flujoActivo,
            respuesta: descripcion,
            mensaje: message,
            clave
        });

        // Si el resultado contiene un comando a ejecutar, hazlo directamente
        if (resultado.comando) {
            delete flujosSupervisor[clave];
            // Re-ejecutar el handler con el comando como descripción
            return await manejarSupervisor({
                message,
                chat,
                textoOriginal: resultado.comando,
                nombreAutor,
                fecha
            });
        }

        if (!resultado.siguiente) {
            delete flujosSupervisor[clave];
            await message.reply(resultado.msg);
            return;
        }

        if (resultado.siguiente === 'MENU_PRINCIPAL') {
            flujosSupervisor[clave] = { tipo: 'MENU_PRINCIPAL', paso: 0, data: {} };
            await message.reply(resultado.msg);
            return;
        }

        await message.reply(resultado.msg);
        return;
    }

    if (flujoActivo && !message.hasMedia && flujoActivo.tipo === 'AYUDA_GUIADA') {
        const respuesta = resolverAyudaGuiada(descripcion);
        await message.reply(
            `${respuesta}\n\n¿Otra duda? Responde 1-5.\nEscribe SALIR para cerrar.`
        );
        return;
    }

    if (flujoActivo && !message.hasMedia && flujoActivo.tipo === 'ASISTENCIA_GUIADA') {
        if (flujoActivo.paso === 0) {
            const area = resolverAreaAsistencia(descripcion);

            if (!area) {
                await message.reply('⚠️ Opción inválida. Responde 1 (LIMPIEZA) o 2 (MTTO).');
                return;
            }

            flujoActivo.data.area = area;
            flujoActivo.paso = 1;
            await message.reply(mensajeMenuAsistenciaPersonas(area));
            return;
        }

        if (flujoActivo.paso === 1) {
            const area = flujoActivo.data.area;
            const persona = resolverPersonaAsistencia(area, descripcion);
            const ficha = resolverFichaPersonalAsistencia(area, persona);

            if (!persona) {
                await message.reply('⚠️ Persona inválida. Responde con número o nombre exacto de la lista.');
                return;
            }

            if (area === 'LIMPIEZA') {
                const idAsistencia = await registrarAsistenciaLimpieza({
                    fecha,
                    autor: persona,
                    grupo: GRUPO_LIMPIEZA_OPERATIVA,
                    fuenteRegistro: 'MANUAL',
                    reportesIncremento: 1,
                    evidenciasIncremento: 0
                });

                delete flujosSupervisor[clave];

                if (!idAsistencia) {
                    await message.reply(`⚠️ No se pudo registrar asistencia de limpieza para ${persona}.`);
                    return;
                }

                logPersistencia({
                    tabla: 'asistencia_limpieza_diaria',
                    id: idAsistencia,
                    autor: persona,
                    grupo: chat.name,
                    mensajeId: message.id?._serialized || construirMensajeIdManual('guiada_limpieza')
                });

                await message.reply(`✅ Asistencia (LIMPIEZA) registrada para: ${persona}`);
                if (ficha) {
                    await message.reply(`🕒 Turno detectado: ${ficha.turno}\nHorario: ${ficha.horario}`);
                }
                return;
            }

            const idAsistencia = await registrarAsistenciaMantenimiento({
                fecha,
                autor: persona,
                grupo: GRUPO_ASISTENCIA_INGENIERIA,
                tipoEvento: 'ENTRADA',
                ubicacion: 'Centro Operativo SHP1',
                turno: ficha?.turnoRegistro || 'Sin turno',
                mensajeOriginal: `ALTA GUIADA DESDE CENTRO OPERATIVO | ${persona}`,
                mensajeId: message.id?._serialized || construirMensajeIdManual('guiada_mtto')
            });

            delete flujosSupervisor[clave];

            if (!idAsistencia) {
                await message.reply(`⚠️ No se pudo registrar asistencia de mantenimiento para ${persona}.`);
                return;
            }

            logPersistencia({
                tabla: 'asistencia_mantenimiento_eventos',
                id: idAsistencia,
                autor: persona,
                grupo: chat.name,
                mensajeId: message.id?._serialized || construirMensajeIdManual('guiada_mtto_log')
            });

            await message.reply(
                `✅ Asistencia (MTTO) registrada para: ${persona}` +
                `${ficha ? `\n🕒 Turno: ${ficha.turno}\nHorario: ${ficha.horario}` : ''}`
            );
            return;
        }
    }

    if (flujoActivo && !message.hasMedia && flujoActivo.tipo === 'PERMISO_GUIADO') {
        const valor = (descripcion || '').trim();

        if (flujoActivo.paso === 0) {
            const area = resolverAreaAsistencia(valor);
            if (!area) {
                await message.reply('⚠️ Opción inválida. Responde 1 (LIMPIEZA) o 2 (MTTO).');
                return;
            }

            flujoActivo.data.area = area;
            flujoActivo.paso = 1;
            await message.reply(guiaPermisoMenuNombres(area, opcionesPersonalPermiso(area)));
            return;
        }

        if (flujoActivo.paso === 1) {
            const persona = resolverPersonaPermisoPorArea(flujoActivo.data.area, valor);
            if (!persona) {
                await message.reply('⚠️ Persona inválida. Responde número o nombre exacto.');
                return;
            }

            flujoActivo.data.persona = persona;
            flujoActivo.paso = 2;
            await message.reply(guiaPermisoPaso3Dia());
            return;
        }

        if (flujoActivo.paso === 2) {
            const fechaPermiso = parseFechaPermiso(valor, fecha);
            if (!fechaPermiso) {
                await message.reply('⚠️ Fecha inválida. Usa DD/MM, DD/MM/YYYY o YYYY-MM-DD.');
                return;
            }

            flujoActivo.data.fechaPermiso = fechaPermiso;
            flujoActivo.paso = 3;
            await message.reply(guiaPermisoPaso4Razon());
            return;
        }

        if (flujoActivo.paso === 3) {
            if (!valor) {
                await message.reply('⚠️ Escribe un motivo para el permiso.');
                return;
            }

            flujoActivo.data.motivo = valor;
            flujoActivo.paso = 4;
            await message.reply(guiaPermisoPaso5Tipo());
            return;
        }

        if (flujoActivo.paso === 4) {
            const tipoPermiso = normalizarTipoPermisoInput(valor);
            const persona = flujoActivo.data.persona;
            const fechaPermiso = flujoActivo.data.fechaPermiso;
            const motivo = flujoActivo.data.motivo;

            const limites = await validarLimitesPermisoMes(pool, persona.key, tipoPermiso, fechaPermiso);
            if (!limites.ok) {
                delete flujosSupervisor[clave];
                await message.reply(limites.alerta || '⚠️ Límite mensual alcanzado para este permiso.');
                return;
            }

            const cobertura = await validarCoberturaTurno(pool, persona.key, fechaPermiso, MARCADOR_PERSONAL, EQUIPO_INGENIERIA);
            if (!cobertura.ok && cobertura.critico) {
                delete flujosSupervisor[clave];
                await message.reply(cobertura.msg || '⚠️ No hay cobertura para este permiso.');
                return;
            }

            const guardado = await registrarPermisoConAprobacion(pool, {
                fecha: fechaPermiso,
                personaKey: persona.key,
                area: flujoActivo.data.area,
                tipoPermiso,
                motivo,
                creadoPor: nombreAutor
            });

            delete flujosSupervisor[clave];

            if (!guardado.ok) {
                await message.reply(`❌ No se pudo registrar permiso: ${guardado.error || 'sin detalle'}`);
                return;
            }

            await message.reply(
                `📋 Permiso registrado\n` +
                `ID: ${guardado.id}\n` +
                `Persona: ${persona.nombre}\n` +
                `Fecha: ${fechaPermiso.format('DD/MM/YYYY')}\n` +
                `Tipo: ${tipoPermiso.replace(/_/g, ' ')}\n` +
                `Estado: PENDIENTE_APROBACION\n\n` +
                `Si quedó pendiente, confirma tipo:\n` +
                `CONFIRMAR PERMISO ${guardado.id} | DESCUENTO SUELDO\n\n` +
                `Luego aprueba:\n` +
                `APROBAR PERMISO ${guardado.id}`
            );
            return;
        }
    }

    if (flujoActivo && !message.hasMedia && flujoActivo.tipo === 'CONFIRMAR_PERMISO_DETALLE') {
        const valor = (descripcion || '').trim();
        const fechaComp = parseFechaPermiso(valor, fecha);

        if (!fechaComp) {
            await message.reply('⚠️ Fecha inválida. Usa DD/MM, DD/MM/YYYY o YYYY-MM-DD.');
            return;
        }

        const id = Number.parseInt(flujoActivo.data.id, 10);
        const tipoPermiso = flujoActivo.data.tipoPermiso || '';
        const confirmacion = await confirmarTipoPermiso(pool, id, tipoPermiso, nombreAutor, {
            fechaPago: fechaComp.format('YYYY-MM-DD')
        });

        delete flujosSupervisor[clave];

        if (!confirmacion.ok) {
            await message.reply(`⚠️ No se pudo confirmar tipo en permiso ${id}: ${confirmacion.error || 'sin detalle'}`);
            return;
        }

        await message.reply(
            `🧾 Tipo confirmado y compensación registrada\n` +
            `ID: ${confirmacion.permiso?.id}\n` +
            `Tipo: ${(confirmacion.permiso?.tipo_permiso || '').replace(/_/g, ' ')}\n` +
            `Compensa/Paga: ${moment(confirmacion.permiso?.fecha_pago).format('DD/MM/YYYY')}\n` +
            `Estado: ${confirmacion.permiso?.estado || 'PENDIENTE_APROBACION'}\n\n` +
            `Siguiente paso: APROBAR PERMISO ${confirmacion.permiso?.id}`
        );
        return;
    }

    if (!message.hasMedia && ['GUIA PERMISO', 'NUEVO PERMISO', 'INICIAR PERMISO'].includes(desc)) {
        flujosSupervisor[clave] = { tipo: 'PERMISO_GUIADO', paso: 0, data: {} };
        await message.reply(guiaPermisoMenuEquipos());
        return;
    }

    if (!message.hasMedia && COMANDOS_GUIA_PENDIENTE.includes(desc)) {
        iniciarFlujoPendiente(clave);
        await message.reply(
            '🧭 Modo guiado de Pendiente activado.\n' +
            'Responde un campo por mensaje.\n' +
            'Puedes escribir CANCELAR en cualquier momento.\n' +
            'Al terminar, envia una o varias fotos y se ligaran al pendiente.\n\n' +
            siguientePreguntaPendiente(0)
        );
        return;
    }

    if (!message.hasMedia && COMANDOS_GUIA_PROYECTO.includes(desc)) {
        iniciarFlujoProyecto(clave, nombreAutor);
        await message.reply(
            '🧭 Modo guiado de Proyecto activado.\n' +
            'Responde un campo por mensaje.\n' +
            'Puedes escribir CANCELAR en cualquier momento.\n' +
            'Al terminar, envia una o varias fotos y se ligaran al proyecto.\n\n' +
            siguientePreguntaProyecto(0)
        );
        return;
    }

    if (flujoActivo && !message.hasMedia && flujoActivo.tipo === 'PENDIENTE') {
        const resultadoPaso = procesarPasoPendiente({
            flujo: flujoActivo,
            respuesta: descripcion
        });

        if (!resultadoPaso.ok) {
            await message.reply(`⚠️ ${resultadoPaso.msg}`);
            return;
        }

        if (!resultadoPaso.finalizado) {
            await message.reply(siguientePreguntaPendiente(flujoActivo.paso));
            return;
        }

        const datos = resultadoPaso.data;
        delete flujosSupervisor[clave];

        const idPendiente = await registrarPendiente({
            descripcion: datos.descripcion,
            area: datos.area,
            tipoMtto: datos.tipoMtto,
            prioridad: datos.prioridad,
            turno: datos.turno,
            tecnicos: datos.tecnicos,
            fechaSql: datos.fechaSql || null,
            creadoPor: nombreAutor
        });

        ultimosPendientes[clave] = idPendiente;
        logPersistencia({
            tabla: 'pendientes_supervisor',
            id: idPendiente,
            autor: nombreAutor,
            grupo: chat.name,
            mensajeId: message.id._serialized
        });

        await message.reply(
            `✅ Pendiente registrado con captura guiada\n\n` +
            `ID: ${idPendiente}\n` +
            `Area: ${datos.area}\n` +
            `Prioridad: ${datos.prioridad}\n\n` +
            `📸 Puedes enviar una o varias fotos para ligar evidencia a este pendiente.`
        );

        return;
    }

    if (flujoActivo && !message.hasMedia && flujoActivo.tipo === 'PROYECTO') {
        const resultadoPaso = procesarPasoProyecto({
            flujo: flujoActivo,
            respuesta: descripcion,
            nombreAutor
        });

        if (!resultadoPaso.ok) {
            await message.reply(`⚠️ ${resultadoPaso.msg}`);
            return;
        }

        if (!resultadoPaso.finalizado) {
            await message.reply(siguientePreguntaProyecto(flujoActivo.paso));
            return;
        }

        const datos = resultadoPaso.data;
        delete flujosSupervisor[clave];

        const idProyecto = await registrarProyecto({
            nombre: datos.nombre,
            descripcion: datos.descripcion,
            area: datos.area,
            prioridad: datos.prioridad,
            responsable: datos.responsable,
            tecnicos: datos.tecnicos,
            turno: datos.turno,
            fechaSql: datos.fechaSql,
            costo: datos.costo,
            creadoPor: nombreAutor
        });

        ultimosProyectos[clave] = idProyecto;
        logPersistencia({
            tabla: 'proyectos_supervisor',
            id: idProyecto,
            autor: nombreAutor,
            grupo: chat.name,
            mensajeId: message.id._serialized
        });

        await message.reply(
            `✅ Proyecto registrado con captura guiada\n\n` +
            `ID: ${idProyecto}\n` +
            `Nombre: ${datos.nombre}\n` +
            `Prioridad: ${datos.prioridad}\n\n` +
            `📸 Puedes enviar una o varias fotos para ligar evidencia a este proyecto.`
        );

        return;
    }

    // =========================
    // TIPO DE REGISTRO
    // =========================

    let tipoRegistro = null;

    if (desc.startsWith('PENDIENTE:')) tipoRegistro = 'PENDIENTE';
    else if (desc.startsWith('PROYECTO:')) tipoRegistro = 'PROYECTO';

    console.log('TIPO REGISTRO:', tipoRegistro);

    // =========================
    // FILTRAR MENSAJES SIN COMANDO
    // =========================

    if (
        !tipoRegistro &&
        !COMANDOS.includes(desc) &&
        !desc.startsWith('CERRAR ') &&
        !message.hasMedia
    ) {
        console.log('⏭️ Mensaje ignorado');
        return;
    }

    // =========================
    // IGNORAR RESPUESTAS DEL BOT
    // =========================

    if (
        descripcion.startsWith('📋') ||
        descripcion.startsWith('✅') ||
        descripcion.startsWith('📦') ||
        descripcion.startsWith('⚠️') ||
        descripcion.startsWith('ℹ️')
    ) {
        console.log('🤖 Mensaje del bot ignorado');
        return;
    }

    // =========================
    // GUARDAR EVIDENCIA (si hay imagen)
    // =========================

    const fechaArchivo  = fecha.format('YYYY-MM-DD');
    let rutaEvidencia   = '';

    if (message.hasMedia) {
        rutaEvidencia = await guardarEvidencia(message, fechaArchivo);
        if (rutaEvidencia) {
            console.log('✅ Evidencia guardada:', rutaEvidencia);
        }
    }

    // =========================
    // AYUDA
    // =========================

    if (desc === 'AYUDA') {
        iniciarFlujoAyudaGuiada(clave);
        await message.reply(menuPrincipal());
        return;
    }

    if (
        desc === 'PERMISOS' ||
        desc === 'PERMISOS CENTRO' ||
        desc === 'AYUDA PERMISOS' ||
        desc === 'AYUDA CENTRO' ||
        desc === 'AYUDA CENTRO OPERATIVO'
    ) {
        await message.reply(`🔐 PERMISOS | CENTRO OPERATIVO SHP1

✅ HABILITADO
• Registro guiado: pendientes y proyectos.
• Registro libre: PENDIENTE:, PROYECTO:.
• Cierre: CERRAR <ID>, CERRAR PREVENTIVO <ID>, CERRAR PROYECTO <ID>.
• Consultas: LISTAR, ABIERTOS, CERRADOS, COMPLETADOS, HISTORICO.
• Limpieza/permisos: LISTAR (incluye permisos pendientes), ABIERTOS (incluye conteo), PERMISOS LIMITES.
• Resolver permisos: CONFIRMAR PERMISO <ID> | TIPO | [DD/MM/YYYY], APROBAR PERMISO <ID>.
• Preventivos: LISTAR PREVENTIVOS, PREVENTIVOS CERRADOS.
• Asistencia: ASISTENCIA, ASISTENCIA HOY, EN TURNO, MARCADOR, RESUMEN ASISTENCIA.
• Alertas: ALERTAS, ALERTAS ASISTENCIA.
• Deudas de turno doble: ALERTAS DEUDAS.
• Reporte: REPORTE, RESUMEN OPERATIVO.
• Evidencias: fotos ligadas al último registro del autor.

🚫 RESTRINGIDO
• Responder automáticamente en grupos fuera de alcance.
• Operaciones sobre grupos bloqueados por configuración.

ℹ️ Comando de referencia:
AYUDA para ver el menú general de Centro Operativo.`);
        return;
    }

    if (desc === 'AYUDA PENDIENTES') {
        await message.reply(`🚧 REGISTRO DE PENDIENTES

MODO GUIADO (recomendado):
GUIA PENDIENTE

MODO FORMATO LIBRE:
PENDIENTE:
Descripción del trabajo
AREA:
Área
TIPO:
CORRECTIVO
PRIORIDAD:
ALTA
TURNO:
2
TECNICOS:
Saul Romero|Eliezer Romero
FECHA:
30/06/2026

FOTOS:
Después de registrar, envía una o varias imágenes para ligar evidencia al pendiente.

━━━━━━━━━━━━━━━
LISTAR — Muestra pendientes, preventivos, proyectos y permisos de limpieza pendientes.
ABIERTOS — Totales de pendientes/preventivos/permisos pendientes.
CERRAR <ID> — Ejemplo: CERRAR 42
PERMISOS PENDIENTES:
CONFIRMAR PERMISO <ID> | DESCUENTO SUELDO
CONFIRMAR PERMISO <ID> | CAMBIO DESCANSO | DD/MM/YYYY
APROBAR PERMISO <ID>
CANCELAR — Cancela guía activa`);
        return;
    }

    if (desc === 'AYUDA PROYECTOS') {
        await message.reply(`🏗️ REGISTRO DE PROYECTOS

MODO GUIADO (recomendado):
GUIA PROYECTO

MODO FORMATO LIBRE:
PROYECTO:
Instalación de iluminación almacén
DESCRIPCION:
Instalación de 8 lámparas LED.
AREA:
Almacén
PRIORIDAD:
ALTA
RESPONSABLE:
Saul Romero
TECNICOS:
Saul Romero|Eliezer Romero
TURNO:
2
FECHA:
30/06/2026
COSTO:
15000

FOTOS:
Después de registrar, envía una o varias imágenes para ligar evidencia al proyecto.

CONSULTA/CIERRE:
LISTAR PROYECTOS — Muestra proyectos abiertos.
CERRAR PROYECTO <ID> — Cierra un proyecto abierto.

CANCELAR — Cancela guía activa`);
        return;
    }

    if (desc === 'AYUDA EVIDENCIAS') {
        await message.reply(`📸 EVIDENCIAS

Las fotografías enviadas después de registrar un pendiente o proyecto quedarán ligadas automáticamente al último registro creado por el mismo usuario.
Las fotografías enviadas después de registrar un pendiente o proyecto quedarán ligadas automáticamente al último registro creado por el mismo usuario.

Puedes enviar una o varias fotografías.

Aplica tanto para modo guiado como para formato libre.`);
        return;
    }

    if (desc === 'AYUDA PREVENTIVOS') {
        await message.reply(`🛠️ PREVENTIVOS PENDIENTES

LISTAR PREVENTIVOS — Muestra solo preventivos abiertos.
CERRAR PREVENTIVO <ID> — Cierra un preventivo abierto por ID.
LISTAR PREVENTIVOS CERRADOS — Muestra preventivos completados recientes.
HISTORICO PREVENTIVOS — Alias para preventivos cerrados.

Ejemplo:
CERRAR PREVENTIVO 48

Los preventivos se manejan aparte de los pendientes de actividades.`);
        return;
    }

    if (desc === 'AYUDA ALERTAS') {
        await message.reply(`🚨 ALERTAS DE ASISTENCIA

ALERTAS — Muestra alertas activas de asistencia (ingeniería y limpieza).
ALERTAS ASISTENCIA — Alias del comando anterior.

Estas alertas se generan cuando el personal en turno no manda evidencia dentro de la tolerancia configurada.`);
        return;
    }

    if (
        desc === 'ASISTENCIA HOY' ||
        desc === 'EN TURNO' ||
        desc === 'RESUMEN ASISTENCIA' ||
        desc === 'MARCADOR' ||
        desc === 'MARCADOR ASISTENCIA'
    ) {
        const [ingenieria, limpieza] = await Promise.all([
            obtenerAsistenciaIngenieriaHoy(),
            obtenerEstadoTurnoLimpieza(pool)
        ]);

        const ingenieriaAsistio = ingenieria.filter((item) => item.estado === 'A').map((item) => item.persona);
        const ingenieriaFalto = ingenieria.filter((item) => item.estado !== 'A').map((item) => item.persona);

        const respuesta = [
            '👥 ASISTENCIA Y EN TURNO',
            '',
            'INGENIERÍA DE PLANTA',
            `Con asistencia: ${ingenieriaAsistio.length ? ingenieriaAsistio.join(', ') : 'Nadie'}`,
            `Sin asistencia: ${ingenieriaFalto.length ? ingenieriaFalto.join(', ') : 'Nadie'}`,
            '',
            'LIMPIEZA | TURNO ACTUAL',
            limpieza.sinCobertura
                ? 'Sin cobertura programada en esta hora.'
                : `En turno con evidencia: ${limpieza.enTurno.length ? limpieza.enTurno.map((item) => item.persona).join(', ') : 'Nadie'}`,
            `En turno sin registro: ${limpieza.sinRegistro.length ? limpieza.sinRegistro.map((item) => item.persona).join(', ') : 'Nadie'}`,
            `Descanso: ${limpieza.descanso.length ? limpieza.descanso.map((item) => item.persona).join(', ') : 'Nadie'}`
        ].join('\n');

        await message.reply(respuesta);
        return;
    }

    const asistenciaLimpiezaManualMatch = descripcion.match(/^ASISTENCIA\s+LIMPIEZA\s*:\s*(.+)$/i);
    if (asistenciaLimpiezaManualMatch) {
        const persona = asistenciaLimpiezaManualMatch[1]?.trim();

        if (!persona) {
            await message.reply('⚠️ Formato inválido. Usa: ASISTENCIA LIMPIEZA: Nombre Apellido');
            return;
        }

        const idAsistencia = await registrarAsistenciaLimpieza({
            fecha,
            autor: persona,
            grupo: GRUPO_LIMPIEZA_OPERATIVA,
            fuenteRegistro: 'MANUAL',
            reportesIncremento: 1,
            evidenciasIncremento: 0
        });

        if (!idAsistencia) {
            await message.reply(`⚠️ No se pudo registrar asistencia manual de limpieza para ${persona}. Revisa nombre/grupo permitido.`);
            return;
        }

        logPersistencia({
            tabla: 'asistencia_limpieza_diaria',
            id: idAsistencia,
            autor: persona,
            grupo: chat.name,
            mensajeId: message.id?._serialized || construirMensajeIdManual('manual_limpieza')
        });

        await message.reply(`✅ Asistencia de limpieza registrada manualmente para: ${persona}`);
        return;
    }

    const asistenciaMttoManualMatch = descripcion.match(/^ASISTENCIA\s+(?:MTTO|MANTENIMIENTO)\s*:\s*(.+)$/i);
    if (asistenciaMttoManualMatch) {
        const datos = parsearAsistenciaMantenimientoManual(asistenciaMttoManualMatch[1], nombreAutor);

        const idAsistencia = await registrarAsistenciaMantenimiento({
            fecha,
            autor: datos.autor,
            grupo: GRUPO_ASISTENCIA_INGENIERIA,
            tipoEvento: datos.tipoEvento,
            ubicacion: datos.ubicacion,
            turno: datos.turno,
            mensajeOriginal: `ALTA MANUAL DESDE CENTRO OPERATIVO | ${descripcion}`,
            mensajeId: message.id?._serialized || construirMensajeIdManual('manual_mtto')
        });

        if (!idAsistencia) {
            await message.reply(`⚠️ No se pudo registrar asistencia manual de mantenimiento para ${datos.autor}.`);
            return;
        }

        logPersistencia({
            tabla: 'asistencia_mantenimiento_eventos',
            id: idAsistencia,
            autor: datos.autor,
            grupo: chat.name,
            mensajeId: message.id?._serialized || construirMensajeIdManual('manual_mtto_log')
        });

        await message.reply(
            `✅ Asistencia de mantenimiento registrada manualmente\n` +
            `Persona: ${datos.autor}\n` +
            `Tipo: ${datos.tipoEvento}\n` +
            `Turno: ${datos.turno}\n` +
            `Ubicación: ${datos.ubicacion}`
        );
        return;
    }

    if (desc === 'AYUDA HISTORICO') {
        await message.reply(`🗂️ HISTÓRICO Y COMPLETADOS

COMPLETADOS — Muestra los últimos registros cerrados/completados.
HISTORICO — Alias de completados.
LISTAR CERRADOS — Alias de completados.
PREVENTIVOS CERRADOS — Muestra preventivos cerrados recientes.
HISTORICO PREVENTIVOS — Alias de preventivos cerrados.`);
        return;
    }

    // =========================
    // ABIERTOS
    // =========================

    if (desc === 'ABIERTOS') {
        const total = await contarAbiertos();
        const preventivos = await listarPreventivosPendientes();
        const permisosPendientes = await listarPermisosPendientes(pool, 100);
        const totalPermisosPendientes = permisosPendientes?.ok ? (permisosPendientes.total || 0) : 0;
        await message.reply(`📋 Pendientes abiertos: ${total}\n🛠️ Preventivos abiertos: ${preventivos.length}\n🧹 Permisos limpieza pendientes: ${totalPermisosPendientes}`);
        return;
    }

    // =========================
    // CERRADOS
    // =========================

    if (desc === 'CERRADOS') {
        const total = await contarCerrados();
        await message.reply(`✅ Pendientes cerrados: ${total}`);
        return;
    }

    if (desc === 'COMPLETADOS' || desc === 'HISTORICO' || desc === 'LISTAR CERRADOS') {
        const rows = await listarCompletadosSupervisor(15);
        let respuesta = '🗂️ HISTORICO COMPLETADO\n\n';

        rows.forEach((r) => {
            const icono =
                r.prioridad === 'ALTA' ? '🔴' :
                r.prioridad === 'MEDIA' ? '🟡' : '🟢';

            respuesta +=
                `[${r.id}] ${icono} ${r.prioridad} | ${r.categoria || 'GENERAL'}\n` +
                `${r.descripcion}\n` +
                `${r.fecha_cierre ? `Cierre: ${moment(r.fecha_cierre).format('DD/MM/YYYY HH:mm')}\n` : ''}\n`;
        });

        if (rows.length === 0) respuesta = '✅ No hay registros completados';

        await message.reply(respuesta);
        return;
    }

    // =========================
    // RIESGOS
    // =========================

    if (desc === 'RIESGOS') {

        const rows = await listarRiesgos();
        let respuesta = '⚠️ RIESGOS ABIERTOS\n\n';

        rows.forEach(r => {
            respuesta += `[${r.id}] ${r.prioridad}\n${r.descripcion}\n\n`;
        });

        if (rows.length === 0) respuesta = '✅ No hay riesgos abiertos';

        await message.reply(respuesta);
        return;
    }

    if (desc === 'PROYECTOS' || desc === 'LISTAR PROYECTOS') {
        const rows = await listarProyectosAbiertos(25);
        let respuesta = '🏗️ PROYECTOS ABIERTOS\n\n';

        rows.forEach((p) => {
            respuesta += `${formatearLineaProyecto(p)}\n\n`;
        });

        if (rows.length === 0) {
            respuesta = '✅ No hay proyectos abiertos';
        }

        await message.reply(respuesta);
        return;
    }

    // =========================
    // CERRAR PREVENTIVO
    // =========================

    const cerrarPreventivoMatch = descripcion.match(/^(DONE|CERRAR)\s+PREVENTIVO\s+(\d+)$/i);

    if (cerrarPreventivoMatch) {
        const idPendiente = cerrarPreventivoMatch[2];
        const cerrado = await cerrarPendientePorCategoria(idPendiente, 'PREVENTIVO');

        if (cerrado) {
            await message.reply(`✅ Preventivo ${idPendiente} completado`);
            console.log(`✅ Preventivo ${idPendiente} completado`);
        } else {
            await message.reply(`⚠️ Preventivo ${idPendiente} no encontrado o ya cerrado`);
            console.log(`⚠️ Preventivo ${idPendiente} no encontrado o ya cerrado`);
        }

        return;
    }

    const cerrarProyectoMatch = descripcion.match(/^(DONE|CERRAR)\s+PROYECTO\s+(\d+)$/i);

    if (cerrarProyectoMatch) {
        const idProyecto = cerrarProyectoMatch[2];
        const cerrado = await cerrarProyecto(idProyecto);

        if (cerrado) {
            await message.reply(`✅ Proyecto ${idProyecto} cerrado`);
        } else {
            await message.reply(`⚠️ Proyecto ${idProyecto} no encontrado o ya cerrado`);
        }

        return;
    }

    // =========================
    // CERRAR PENDIENTE
    // =========================

    const cerrarMatch = descripcion.match(/^(DONE|CERRAR)\s+(\d+)$/i);

    if (cerrarMatch) {
        const idPendiente = cerrarMatch[2];
        const cerrado     = await cerrarPendiente(idPendiente);

        if (cerrado) {
            await message.reply(`✅ Pendiente ${idPendiente} completado`);
            console.log(`✅ Pendiente ${idPendiente} completado`);
        } else {
            console.log(`⚠️ Pendiente ${idPendiente} no encontrado`);
        }

        return;
    }

    // =========================
    // LISTAR PENDIENTES
    // =========================

    if (desc === 'LISTAR') {

        const rows = await listarPendientes();
        const pendientesGenerales = rows.filter((p) => (p.categoria || '').toUpperCase() !== 'PREVENTIVO');
        const preventivosRaw = await listarPreventivosPendientes();
        const preventivos = ordenarPreventivosPorCategoria(preventivosRaw);
        const proyectos = await listarProyectosAbiertos(15);
        const permisosPendientes = await listarPermisosPendientes(pool, 15);
        let respuesta = '📋 PENDIENTES ABIERTOS\n\n';

        pendientesGenerales.forEach(p => {
            const icono =
                p.prioridad === 'ALTA'  ? '🔴' :
                p.prioridad === 'MEDIA' ? '🟡' : '🟢';

            respuesta +=
                `[${p.id}] ${icono} ${p.prioridad} | ${p.categoria}\n` +
                `${p.descripcion}\n\n`;
        });

        if (pendientesGenerales.length === 0) respuesta = '✅ No hay pendientes generales abiertos';

        if (preventivos.length > 0) {
            respuesta += '\n🛠️ PREVENTIVOS ABIERTOS\n\n';

            preventivos.forEach(p => {
                respuesta += `${formatearLineaPreventivo(p)}\n\n`;
            });
        }

        if (proyectos.length > 0) {
            respuesta += '\n🏗️ PROYECTOS ABIERTOS\n\n';

            proyectos.forEach((p) => {
                respuesta += `${formatearLineaProyecto(p)}\n\n`;
            });
        }

        if (permisosPendientes?.ok && permisosPendientes.total > 0) {
            respuesta += '\n🧹 PERMISOS LIMPIEZA PENDIENTES\n\n';

            permisosPendientes.permisos.forEach((permiso) => {
                const tipo = (permiso.tipo_permiso || 'PENDIENTE_DEFINIR').replace(/_/g, ' ');
                const motivo = limpiarTextoPlano(permiso.motivo || 'Sin motivo');
                const persona = permiso.persona_key || '-';
                const fechaPermiso = permiso.fecha ? moment(permiso.fecha).format('DD/MM') : '-';

                respuesta +=
                    `[${permiso.id}] ${fechaPermiso} | ${persona} | ${tipo}\n` +
                    `${motivo}\n` +
                    `Accion: APROBAR PERMISO ${permiso.id}\n\n`;
            });
        }

        await message.reply(respuesta);
        console.log('📤 Lista enviada a WhatsApp');
        return;
    }

    if (desc === 'PREVENTIVOS' || desc === 'LISTAR PREVENTIVOS') {
        const rowsRaw = await listarPreventivosPendientes();
        const rows = ordenarPreventivosPorCategoria(rowsRaw);
        let respuesta = '🛠️ PREVENTIVOS ABIERTOS\n\n';

        rows.forEach(p => {
            respuesta += `${formatearLineaPreventivo(p)}\n\n`;
        });

        if (rows.length === 0) respuesta = '✅ No hay preventivos abiertos';

        await message.reply(respuesta);
        console.log('📤 Preventivos enviados a WhatsApp');
        return;
    }

    if (desc === 'PREVENTIVOS CERRADOS' || desc === 'LISTAR PREVENTIVOS CERRADOS' || desc === 'HISTORICO PREVENTIVOS') {
        const rows = await listarPreventivosCompletados(15);
        let respuesta = '🛠️ PREVENTIVOS CERRADOS\n\n';

        rows.forEach((p) => {
            respuesta += `${formatearLineaPreventivo(p)}\n`;
            if (p.fecha_cierre) {
                respuesta += `Cierre: ${moment(p.fecha_cierre).format('DD/MM/YYYY HH:mm')}\n`;
            }
            respuesta += '\n';
        });

        if (rows.length === 0) respuesta = '✅ No hay preventivos cerrados';

        await message.reply(respuesta);
        return;
    }

    if (desc === 'ALERTAS' || desc === 'ALERTAS ASISTENCIA') {
        const [dataLimpieza, dataIngenieria] = await Promise.all([
            obtenerAlertasAsistenciaLimpieza(pool),
            obtenerAlertasAsistenciaIngenieria(pool)
        ]);

        const items = [
            ...(dataIngenieria.items || []),
            ...(dataLimpieza.items || [])
        ];

        let respuesta = '🚨 ALERTAS DE ASISTENCIA\n\n';

        items.forEach((item) => {
            respuesta +=
                `${item.etiqueta || 'OPERATIVA'} | ${item.persona}\n` +
                `Turno: ${item.turno}\n` +
                `Atraso: ${item.minutosAtraso} min\n` +
                `Grupo: ${item.grupo}\n\n`;
        });

        if (items.length === 0) {
            respuesta = '✅ No hay alertas activas de asistencia';
        }

        await message.reply(respuesta);
        return;
    }

    // =========================
    // REGISTRAR PENDIENTE
    // =========================

    if (tipoRegistro === 'PENDIENTE') {

        const area            = descripcion.match(/AREA:\s*(.+)/i)?.[1]?.trim() || '';
        const tipoMtto        = descripcion.match(/TIPO:\s*(.+)/i)?.[1]?.trim() || 'CORRECTIVO';
        const prioridad       = descripcion.match(/PRIORIDAD:\s*(.+)/i)?.[1]?.trim() || 'MEDIA';
        const turno           = descripcion.match(/TURNO:\s*(.+)/i)?.[1]?.trim() || '';
        const tecnicos        = descripcion.match(/TECNICOS:\s*(.+)/i)?.[1]?.trim() || '';
        const fechaProgramada = descripcion.match(/FECHA:\s*(.+)/i)?.[1]?.trim() || null;

        const pendienteMatch        = descripcion.match(/PENDIENTE:\s*([\s\S]*?)\n\s*AREA:/i);
        const descripcionPendiente  = pendienteMatch ? pendienteMatch[1].trim() : '';

        let fechaSql = null;
        if (fechaProgramada) {
            const [d, m, y] = fechaProgramada.split('/');
            fechaSql = `${y}-${m}-${d}`;
        }

        const idPendiente = await registrarPendiente({
            descripcion: descripcionPendiente,
            area,
            tipoMtto:  tipoMtto.toUpperCase(),
            prioridad: prioridad.toUpperCase(),
            turno,
            tecnicos,
            fechaSql,
            creadoPor: nombreAutor
        });

        ultimosPendientes[clave] = idPendiente;
        console.log('🧠 Último pendiente:', clave, '=>', idPendiente);
        logPersistencia({
            tabla: 'pendientes_supervisor',
            id: idPendiente,
            autor: nombreAutor,
            grupo: chat.name,
            mensajeId: message.id._serialized
        });

        await message.reply(`✅ Pendiente registrado\n\nID: ${idPendiente}\n\n📸 Puedes enviar una o varias fotos para ligar evidencia a este pendiente.`);

        if (rutaEvidencia) {
            await guardarEvidenciaPendiente({ pendienteId: idPendiente, rutaEvidencia });
            console.log('✅ EVIDENCIA DE PENDIENTE RELACIONADA');
        }

        return;
    }

    // =========================
    // REGISTRAR PROYECTO
    // =========================

    if (tipoRegistro === 'PROYECTO') {

        const nombreProyecto = descripcion.match(
            /PROYECTO:\s*([\s\S]*?)\n\s*DESCRIPCION:/i
        )?.[1]?.trim() || '';

        const descripcionProyecto = descripcion.match(
            /DESCRIPCION:\s*([\s\S]*?)\n\s*AREA:/i
        )?.[1]?.trim() || '';

        const area            = descripcion.match(/AREA:\s*(.+)/i)?.[1]?.trim() || '';
        const prioridad       = descripcion.match(/PRIORIDAD:\s*(.+)/i)?.[1]?.trim() || 'MEDIA';
        const responsable     = descripcion.match(/RESPONSABLE:\s*(.+)/i)?.[1]?.trim() || '';
        const tecnicos        = descripcion.match(/TECNICOS:\s*(.+)/i)?.[1]?.trim() || '';
        const turno           = descripcion.match(/TURNO:\s*(.+)/i)?.[1]?.trim() || '';
        const fechaProgramada = descripcion.match(/FECHA:\s*(.+)/i)?.[1]?.trim() || null;
        const costo           = descripcion.match(/COSTO:\s*(.+)/i)?.[1]?.trim() || null;

        let fechaSql = null;
        if (fechaProgramada) {
            const [d, m, y] = fechaProgramada.split('/');
            fechaSql = `${y}-${m}-${d}`;
        }

        const idProyecto = await registrarProyecto({
            nombre:      nombreProyecto,
            descripcion: descripcionProyecto,
            area,
            prioridad:   prioridad.toUpperCase(),
            responsable,
            tecnicos,
            turno,
            fechaSql,
            costo:       costo || null,
            creadoPor:   nombreAutor
        });

        ultimosProyectos[clave] = idProyecto;
        console.log('🧠 Último proyecto:', clave, '=>', idProyecto);
        logPersistencia({
            tabla: 'proyectos_supervisor',
            id: idProyecto,
            autor: nombreAutor,
            grupo: chat.name,
            mensajeId: message.id._serialized
        });

        await message.reply(`✅ Proyecto registrado\n\nID: ${idProyecto}\n\n📸 Puedes enviar una o varias fotos para ligar evidencia a este proyecto.`);

        if (rutaEvidencia) {
            await guardarEvidenciaProyecto({ proyectoId: idProyecto, rutaEvidencia });
            console.log('✅ EVIDENCIA DE PROYECTO RELACIONADA');
        }

        return;
    }

    // =========================
    // EVIDENCIA SUELTA
    // =========================
    // Solo imagen sin texto → se relaciona con el último registro del usuario.

    if (rutaEvidencia) {

        const pendienteId = ultimosPendientes[clave];
        const proyectoId  = ultimosProyectos[clave];

        if (pendienteId) {
            await guardarEvidenciaPendiente({ pendienteId, rutaEvidencia });
            console.log('✅ EVIDENCIA DE PENDIENTE RELACIONADA (recuperada)');
        }

        if (proyectoId) {
            await guardarEvidenciaProyecto({ proyectoId, rutaEvidencia });
            console.log('✅ EVIDENCIA DE PROYECTO RELACIONADA (recuperada)');
        }
    }
}


module.exports = { manejarSupervisor };

