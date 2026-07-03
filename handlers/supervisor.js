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
    listarRiesgos,
    listarMaterialesSupervisor
} = require('../services/pendientes');

const { registrarMaterial }  = require('../services/materiales');
const { registrarProyecto }  = require('../services/proyectos');
const {
    obtenerResumenOperativo,
    construirMensajeResumenOperativo
} = require('../services/reportes');
const {
    guardarEvidenciaPendiente,
    guardarEvidenciaMaterial,
    guardarEvidenciaProyecto
} = require('../services/evidencias');

const { guardarEvidencia } = require('../lib/bitacora-storage');
const {
    ultimosPendientes,
    ultimosMateriales,
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
    aprobarPermiso,
    reportePermisosDelMes,
    reportePermisosPersona,
    listarDeudasPendientes
} = require('../services/permisos-workflow');
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
    detalleAyudaMateriales,
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
    'AYUDA', 'AYUDA PENDIENTES', 'AYUDA MATERIALES',
    'AYUDA INSUMOS', 'AYUDA PROYECTOS', 'AYUDA EVIDENCIAS',
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
    'RIESGOS', 'MATERIALES', 'PROYECTOS'
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
        aliases: ['saul romero romero', 'saul romero', 'saul']
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
        horario: '22:00-06:00',
        aliases: ['flavio cruz santiago', 'flavio cruz', 'flavio']
    }
];

const COMANDOS_GUIA_PENDIENTE = [
    'GUIA PENDIENTE',
    'NUEVO PENDIENTE',
    'INICIAR PENDIENTE'
];

const COMANDOS_GUIA_MATERIAL = [
    'GUIA MATERIAL',
    'GUIA INSUMO',
    'NUEVO MATERIAL',
    'NUEVO INSUMO',
    'INICIAR MATERIAL'
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

function iniciarFlujoMaterial(clave) {
    flujosSupervisor[clave] = {
        tipo: 'MATERIAL',
        paso: 0,
        data: {
            material: '',
            cantidad: null,
            unidad: '',
            prioridad: 'MEDIA',
            area: '',
            justificacion: ''
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

    if (r === '2' || r === 'MATERIAL' || r === 'MATERIALES' || r === 'INSUMO' || r === 'INSUMOS') {
        return [
            '📦 Materiales/Insumos',
            'Usa GUIA MATERIAL o GUIA INSUMO.',
            'Al finalizar, envía fotos y se ligan al último material.'
        ].join('\n');
    }

    if (r === '3' || r === 'PROYECTO' || r === 'PROYECTOS') {
        return [
            '🏗️ Proyectos',
            'Usa GUIA PROYECTO para captura guiada.',
            'Al finalizar, envía fotos y se ligan al último proyecto.'
        ].join('\n');
    }

    if (r === '4' || r === 'EVIDENCIA' || r === 'EVIDENCIAS' || r === 'FOTO' || r === 'FOTOS') {
        return [
            '📸 Evidencias',
            'Envía una o varias imágenes después de registrar.',
            'El sistema las liga al último registro tuyo (pendiente/material/proyecto).'
        ].join('\n');
    }

    if (r === '5' || r === 'CONSULTA' || r === 'CONSULTAS') {
        return [
            '📋 Consultas útiles',
            'LISTAR, ABIERTOS, CERRADOS, COMPLETADOS',
            'MATERIALES, PROYECTOS, RIESGOS',
            'PREVENTIVOS, PREVENTIVOS CERRADOS'
        ].join('\n');
    }

    return 'No entendí la opción. Responde 1, 2, 3, 4 o 5.';
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

function siguientePreguntaMaterial(paso) {
    const preguntas = [
        '1/6 Material o insumo requerido:',
        '2/6 Cantidad (numero, o escribe OMITIR):',
        '3/6 Unidad (PZA, M, KG, L, etc.):',
        '4/6 Prioridad (ALTA/MEDIA/BAJA):',
        '5/6 Area:',
        '6/6 Justificacion. Al finalizar puedes enviar fotos de evidencia:'
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
                MIN(created_at) AS primer_reporte,
                MAX(created_at) AS ultimo_reporte
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

    const legacyRes = await pool.query(
        `
        SELECT
            autor,
            total_reportes,
            total_evidencias,
            primer_reporte,
            ultimo_reporte
        FROM asistencia_limpieza_diaria
        WHERE fecha = $1
          AND grupo ILIKE $2
        ORDER BY autor ASC
        `,
        [fechaHoy, `%${GRUPO_ASISTENCIA_INGENIERIA}%`]
    );

    for (const row of legacyRes.rows) {
        acumular(row);
    }

    return EQUIPO_INGENIERIA.map((persona) => {
        const agg = mapa.get(persona.key) || {
            totalReportes: 0,
            totalEvidencias: 0,
            primerReporte: null,
            ultimoReporte: null,
            autores: []
        };

        return {
            persona: persona.nombre,
            puesto: persona.puesto,
            turno: persona.turno,
            estado: agg.totalReportes > 0 || agg.totalEvidencias > 0 ? 'A' : 'F',
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

function procesarPasoMaterial({ flujo, respuesta }) {
    const valor = (respuesta || '').trim();

    if (flujo.paso === 0) {
        if (!valor) {
            return { ok: false, msg: 'El material/insumo no puede ir vacio.' };
        }
        flujo.data.material = valor;
    }

    if (flujo.paso === 1) {
        if (!valor || /^OMITIR$/i.test(valor)) {
            flujo.data.cantidad = null;
        } else if (!/^\d+(\.\d+)?$/.test(valor)) {
            return { ok: false, msg: 'Cantidad invalida. Escribe numero o OMITIR.' };
        } else {
            flujo.data.cantidad = Number(valor);
        }
    }

    if (flujo.paso === 2) {
        flujo.data.unidad = /^OMITIR$/i.test(valor) ? '' : valor;
    }

    if (flujo.paso === 3) {
        const prioridad = valor.toUpperCase();
        if (!['ALTA', 'MEDIA', 'BAJA'].includes(prioridad)) {
            return { ok: false, msg: 'Prioridad invalida. Usa ALTA, MEDIA o BAJA.' };
        }
        flujo.data.prioridad = prioridad;
    }

    if (flujo.paso === 4) {
        if (!valor) {
            return { ok: false, msg: 'El area no puede ir vacia.' };
        }
        flujo.data.area = valor;
    }

    if (flujo.paso === 5) {
        if (!valor) {
            return { ok: false, msg: 'La justificacion no puede ir vacia.' };
        }
        flujo.data.justificacion = valor;
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
        if (valor === '2') return { siguiente: null, msg: detalleAyudaMateriales() };
        if (valor === '3') return { siguiente: null, msg: detalleAyudaProyectos() };
        if (valor === '4') return { siguiente: null, msg: detalleAyudaEvidencias() };
        if (valor === '5') return { siguiente: null, msg: detalleAyudaPermisos() };
        if (valor === '6') return { siguiente: null, msg: detalleAyudaAsistencia() };
        return { siguiente: null, msg: '⚠️ Opción no válida. Responde 1-6 o 0 para atrás.' };
    }

    // MENU_GUIA
    if (flujo.tipo === 'MENU_GUIA') {
        if (valor === '1') {
            flujosSupervisor[clave] = { tipo: 'PENDIENTE', paso: 0, data: { descripcion: '' } };
            return { siguiente: 'GUIA_PENDIENTE', msg: 'Iniciando PENDIENTE...\nEscribe la descripción:' };
        }
        if (valor === '2') {
            flujosSupervisor[clave] = { tipo: 'MATERIAL', paso: 0, data: { material: '' } };
            return { siguiente: 'GUIA_MATERIAL', msg: 'Iniciando MATERIAL...\nEscribe el material:' };
        }
        if (valor === '3') {
            flujosSupervisor[clave] = { tipo: 'PROYECTO', paso: 0, data: { nombre: '' } };
            return { siguiente: 'GUIA_PROYECTO', msg: 'Iniciando PROYECTO...\nEscribe el nombre:' };
        }
        if (valor === '4') {
            flujosSupervisor[clave] = { tipo: 'PERMISO_GUIADO', paso: 0, data: {} };
            return { siguiente: 'GUIA_PERMISO', msg: guiaPermisoMenuEquipos() };
        }
        return { siguiente: null, msg: '⚠️ Opción no válida. Responde 1-4 o 0 para atrás.' };
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
            return { comando: 'MATERIALES' };
        }
        if (valor === '4') {
            flujosSupervisor[clave] = { tipo: 'MENU_ASISTENCIA', paso: 0, data: {} };
            return { siguiente: 'MENU_ASISTENCIA', msg: menuAsistencia() };
        }
        if (valor === '5') {
            return { comando: 'PERMISOS RESUMEN' };
        }
        if (valor === '6') {
            return { comando: 'REPORTE' };
        }
        return { siguiente: null, msg: '⚠️ Opción no válida. Responde 1-6 o 0 para atrás.' };
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
            return { siguiente: null, msg: '✅ Para aprobar un permiso:\n\nAPROBAR PERMISO <ID>\n\nEj: APROBAR PERMISO 15' };
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

    if (!message.hasMedia && COMANDOS_GUIA_MATERIAL.includes(desc)) {
        iniciarFlujoMaterial(clave);
        await message.reply(
            '🧭 Modo guiado de Material/Insumo activado.\n' +
            'Responde un campo por mensaje.\n' +
            'Puedes escribir CANCELAR en cualquier momento.\n' +
            'Al terminar, envia una o varias fotos y se ligaran al material/insumo.\n\n' +
            siguientePreguntaMaterial(0)
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

    if (flujoActivo && !message.hasMedia && flujoActivo.tipo === 'MATERIAL') {
        const resultadoPaso = procesarPasoMaterial({
            flujo: flujoActivo,
            respuesta: descripcion
        });

        if (!resultadoPaso.ok) {
            await message.reply(`⚠️ ${resultadoPaso.msg}`);
            return;
        }

        if (!resultadoPaso.finalizado) {
            await message.reply(siguientePreguntaMaterial(flujoActivo.paso));
            return;
        }

        const datos = resultadoPaso.data;
        delete flujosSupervisor[clave];

        const idMaterial = await registrarMaterial({
            solicitante: nombreAutor,
            grupo: chat.name,
            material: datos.material,
            cantidad: datos.cantidad,
            unidad: datos.unidad,
            prioridad: datos.prioridad,
            area: datos.area,
            justificacion: datos.justificacion,
            creadoPor: nombreAutor
        });

        ultimosMateriales[clave] = idMaterial;
        logPersistencia({
            tabla: 'materiales_supervisor',
            id: idMaterial,
            autor: nombreAutor,
            grupo: chat.name,
            mensajeId: message.id._serialized
        });

        await message.reply(
            `✅ Material/Insumo registrado con captura guiada\n\n` +
            `ID: ${idMaterial}\n` +
            `Material: ${datos.material}\n` +
            `Prioridad: ${datos.prioridad}\n\n` +
            `📸 Puedes enviar una o varias fotos para ligar evidencia a este material/insumo.`
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
    else if (desc.startsWith('MATERIAL:')) tipoRegistro = 'MATERIAL';
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
• Registro guiado: pendientes, materiales e insumos, proyectos.
• Registro libre: PENDIENTE:, MATERIAL:, PROYECTO:.
• Cierre: CERRAR <ID> y CERRAR PREVENTIVO <ID>.
• Consultas: LISTAR, ABIERTOS, CERRADOS, COMPLETADOS, HISTORICO.
• Preventivos: LISTAR PREVENTIVOS, PREVENTIVOS CERRADOS.
• Asistencia: ASISTENCIA, ASISTENCIA HOY, EN TURNO, MARCADOR, RESUMEN ASISTENCIA.
• Alertas: ALERTAS, ALERTAS ASISTENCIA.
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
LISTAR — Muestra pendientes abiertos.
CERRAR <ID> — Ejemplo: CERRAR 42
CANCELAR — Cancela guía activa`);
        return;
    }

    if (desc === 'AYUDA MATERIALES' || desc === 'AYUDA INSUMOS') {
        await message.reply(`📦 REQUISICIÓN DE MATERIAL

MODO GUIADO (recomendado):
GUIA MATERIAL o GUIA INSUMO

MODO FORMATO LIBRE:
MATERIAL:
Taladro de impacto Milwaukee
CANTIDAD:
1
UNIDAD:
PZA
PRIORIDAD:
ALTA
AREA:
Andén 2
JUSTIFICACION:
Sustituir herramienta dañada.

FOTOS:
Después de registrar, envía una o varias imágenes para ligar evidencia al material/insumo.

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

CANCELAR — Cancela guía activa`);
        return;
    }

    if (desc === 'AYUDA EVIDENCIAS') {
        await message.reply(`📸 EVIDENCIAS

Las fotografías enviadas después de registrar un pendiente, material o proyecto quedarán ligadas automáticamente al último registro creado por el mismo usuario.

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
        await message.reply(`📋 Pendientes abiertos: ${total}\n🛠️ Preventivos abiertos: ${preventivos.length}`);
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

    // =========================
    // MATERIALES
    // =========================

    if (desc === 'MATERIALES') {

        const rows = await listarMaterialesSupervisor();
        let respuesta = '📦 MATERIALES PENDIENTES\n\n';

        rows.forEach(r => {
            respuesta += `[${r.id}] ${r.prioridad}\n${r.descripcion}\n\n`;
        });

        if (rows.length === 0) respuesta = '✅ No hay materiales pendientes';

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
    // REGISTRAR MATERIAL
    // =========================

    if (tipoRegistro === 'MATERIAL') {

        const material = descripcion
            .split('CANTIDAD:')[0]
            .replace(/MATERIAL:/i, '')
            .trim();

        const cantidad      = descripcion.match(/CANTIDAD:\s*(.+)/i)?.[1]?.trim() || null;
        const unidad        = descripcion.match(/UNIDAD:\s*(.+)/i)?.[1]?.trim() || '';
        const prioridad     = descripcion.match(/PRIORIDAD:\s*(.+)/i)?.[1]?.trim() || 'MEDIA';
        const area          = descripcion.match(/AREA:\s*(.+)/i)?.[1]?.trim() || '';
        const justificacion = descripcion.match(/JUSTIFICACION:\s*([\s\S]*)/i)?.[1]?.trim() || '';

        const idMaterial = await registrarMaterial({
            solicitante:  nombreAutor,
            grupo:        chat.name,
            material,
            cantidad:     cantidad || null,
            unidad,
            prioridad:    prioridad.toUpperCase(),
            area,
            justificacion,
            creadoPor:    nombreAutor
        });

        ultimosMateriales[clave] = idMaterial;
        console.log('🧠 Último material:', clave, '=>', idMaterial);
        logPersistencia({
            tabla: 'materiales_supervisor',
            id: idMaterial,
            autor: nombreAutor,
            grupo: chat.name,
            mensajeId: message.id._serialized
        });

        await message.reply(`✅ Material registrado\n\nID: ${idMaterial}\n\n📸 Puedes enviar una o varias fotos para ligar evidencia a este material/insumo.`);

        if (rutaEvidencia) {
            await guardarEvidenciaMaterial({ materialId: idMaterial, rutaEvidencia });
            console.log('✅ EVIDENCIA DE MATERIAL RELACIONADA');
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
        const materialId  = ultimosMateriales[clave];
        const proyectoId  = ultimosProyectos[clave];

        if (pendienteId) {
            await guardarEvidenciaPendiente({ pendienteId, rutaEvidencia });
            console.log('✅ EVIDENCIA DE PENDIENTE RELACIONADA (recuperada)');
        }

        if (materialId) {
            await guardarEvidenciaMaterial({ materialId, rutaEvidencia });
            console.log('✅ EVIDENCIA DE MATERIAL RELACIONADA (recuperada)');
        }

        if (proyectoId) {
            await guardarEvidenciaProyecto({ proyectoId, rutaEvidencia });
            console.log('✅ EVIDENCIA DE PROYECTO RELACIONADA (recuperada)');
        }
    }
}


module.exports = { manejarSupervisor };

