const moment = require('moment-timezone');
const { guardarEvidencia } = require('../lib/bitacora-storage');
const {
    registrarFallaMantenimiento
} = require('../services/mantenimiento-fallas');
const {
    registrarAsistenciaMantenimiento
} = require('../services/asistencia-mantenimiento');
const { autorPermitidoPorGrupo } = require('../services/asistencia-limpieza');
const { logPersistencia } = require('../lib/persistence-log');

const AUTORES_MTTO_POR_NUMERO = {
    '202013803569317@lid': 'Eliezer Romero Romero',
    '68028557435039@lid': 'Flavio Cruz Santiago',
    '33114248208520@lid': 'Saul Romero Romero',
    '189795108180057@lid': 'Saul Romero Romero',
    '189795108180057:33@lid': 'Saul Romero Romero'
};

function normalizarTexto(texto = '') {
    return texto
        .toString()
        .replace(/\r/g, '')
        .trim();
}

function extraerCampo(texto, regex, valorDefault = '') {
    const match = texto.match(regex);
    return match && match[1] ? match[1].trim() : valorDefault;
}

function extraerBloqueFalla(texto = '') {
    const bloque = extraerCampo(texto, /FALLA:\s*([\s\S]*)/i, '');
    if (bloque) {
        return bloque.trim();
    }

    return texto || '[Sin detalle]';
}

function detectarTipoEvento(texto = '') {
    const n = texto.toLowerCase();
    if (/(\bsalida\b|\bsaliendo\b|\bfin turno\b|\begreso\b)/i.test(n)) return 'SALIDA';
    if (/(\bentrada\b|\bingreso\b|\binicio turno\b|\bllegada\b)/i.test(n)) return 'ENTRADA';
    return 'ENTRADA';
}

function detectarTurno(texto = '') {
    const turno = extraerCampo(texto, /TURNO:\s*(.+)/i, '');
    if (turno) {
        return turno;
    }

    if (/\b3(er)?\b/.test(texto)) return '3';
    if (/\b2(do)?\b/.test(texto)) return '2';
    if (/\b1(er)?\b/.test(texto)) return '1';

    return 'Sin turno';
}

function detectarUbicacion(texto = '') {
    return extraerCampo(texto, /(?:UBICACION|LUGAR|LOCALIZACION):\s*(.+)/i, 'Sin ubicacion');
}

function resolverAutorMantenimiento(nombreAutor = '', autorNumero = '') {
    if (/ctamez/i.test(String(nombreAutor || ''))) {
        return 'Saul Romero Romero';
    }

    if (autorPermitidoPorGrupo(nombreAutor, 'Asistencia SHP1 Pachuca')) {
        return nombreAutor;
    }

    return AUTORES_MTTO_POR_NUMERO[autorNumero] || nombreAutor;
}

async function manejarMantenimiento({ message, chat, textoOriginal, nombreAutor, fecha, tipoFuente, autorNumero = '' }) {
    const texto = normalizarTexto(textoOriginal);
    const fechaArchivo = fecha.format('YYYY-MM-DD');
    const autorResuelto = resolverAutorMantenimiento(nombreAutor, autorNumero);

    if (tipoFuente === 'MANTENIMIENTO_ASISTENCIA' && !autorPermitidoPorGrupo(autorResuelto, chat.name)) {
        console.log('⚠️ ASISTENCIA MTTO: autor no en lista, registrando igual =>', autorResuelto);
        // No se bloquea — se registra todo para análisis de patrones
    }

    if (tipoFuente === 'MANTENIMIENTO_FALLAS') {
        const area = extraerCampo(texto, /AREA:\s*(.+)/i, 'General');
        const equipo = extraerCampo(texto, /EQUIPO:\s*(.+)/i, 'General');
        const prioridad = extraerCampo(texto, /PRIORIDAD:\s*(ALTA|MEDIA|BAJA)/i, 'MEDIA').toUpperCase();
        const falla = extraerBloqueFalla(texto);
        const rutaEvidencia = message.hasMedia
            ? await guardarEvidencia(message, fechaArchivo, 'evidencias_mantenimiento')
            : '';

        const idFalla = await registrarFallaMantenimiento({
            fecha,
            autor: autorResuelto,
            grupo: chat.name,
            area,
            equipo,
            falla,
            prioridad,
            rutaEvidencia: rutaEvidencia || null,
            mensajeId: message.id._serialized
        });

        logPersistencia({
            tabla: 'mantenimiento_fallas',
            id: idFalla,
            autor: autorResuelto,
            grupo: chat.name,
            mensajeId: message.id._serialized
        });
        return;
    }

    const tipoEvento = detectarTipoEvento(texto);
    const turno = detectarTurno(texto);

    // Capturar ubicación GPS si el mensaje es de tipo location
    let ubicacion = detectarUbicacion(texto);
    let mensajeParaGuardar = texto;

    if (message.type === 'location' && message.location) {
        const loc = message.location;
        const lat = loc.latitude || '';
        const lng = loc.longitude || '';
        const desc = loc.description || loc.address || '';
        ubicacion = `GPS:${lat},${lng}${desc ? ` | ${desc}` : ''}`;
        mensajeParaGuardar = `[UBICACION] ${desc || `${lat},${lng}`}`;
    }

    const idAsistencia = await registrarAsistenciaMantenimiento({
        fecha,
        autor: autorResuelto,
        grupo: chat.name,
        tipoEvento,
        ubicacion,
        turno,
        mensajeOriginal: mensajeParaGuardar || `[${message.type || 'chat'}]`,
        mensajeId: message.id._serialized
    });

    logPersistencia({
        tabla: 'asistencia_mantenimiento_eventos',
        id: idAsistencia,
        autor: autorResuelto,
        grupo: chat.name,
        mensajeId: message.id._serialized
    });
}

module.exports = { manejarMantenimiento };