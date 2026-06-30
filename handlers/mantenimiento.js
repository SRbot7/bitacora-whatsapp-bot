const moment = require('moment-timezone');
const { guardarEvidencia } = require('../lib/bitacora-storage');
const {
    registrarFallaMantenimiento
} = require('../services/mantenimiento-fallas');
const {
    registrarAsistenciaMantenimiento
} = require('../services/asistencia-mantenimiento');
const { logPersistencia } = require('../lib/persistence-log');

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

async function manejarMantenimiento({ message, chat, textoOriginal, nombreAutor, fecha, tipoFuente }) {
    const texto = normalizarTexto(textoOriginal);
    const fechaArchivo = fecha.format('YYYY-MM-DD');

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
            autor: nombreAutor,
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
            autor: nombreAutor,
            grupo: chat.name,
            mensajeId: message.id._serialized
        });
        return;
    }

    const tipoEvento = detectarTipoEvento(texto);
    const turno = detectarTurno(texto);
    const ubicacion = detectarUbicacion(texto);

    const rutaEvidencia = message.hasMedia
        ? await guardarEvidencia(message, fechaArchivo, 'evidencias_mantenimiento')
        : '';

    const idAsistencia = await registrarAsistenciaMantenimiento({
        fecha,
        autor: nombreAutor,
        grupo: chat.name,
        tipoEvento,
        ubicacion,
        turno,
        mensajeOriginal: texto,
        mensajeId: message.id._serialized
    });

    logPersistencia({
        tabla: 'asistencia_mantenimiento_eventos',
        id: idAsistencia,
        autor: nombreAutor,
        grupo: chat.name,
        mensajeId: message.id._serialized
    });
}

module.exports = { manejarMantenimiento };