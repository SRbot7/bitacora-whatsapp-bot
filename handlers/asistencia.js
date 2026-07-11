const {
    registrarEventoAsistencia,
    actualizarUbicacionEvento
} = require('../services/asistencia-eventos');
const { resolverPersonaMarcador } = require('../services/limpieza-personal');
const { logPersistencia } = require('../lib/persistence-log');

const VENTANA_UBICACION_MS = Math.max(
    60 * 1000,
    Number.parseInt(process.env.ASISTENCIA_VENTANA_UBICACION_MS || `${15 * 60 * 1000}`, 10) || (15 * 60 * 1000)
);

const pendientesUbicacion = {};

function normalizarTexto(texto = '') {
    return texto
        .toString()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function detectarIntencion(texto = '') {
    const comando = normalizarTexto(texto);
    if (!comando) {
        return '';
    }

    if (/\b(me retiro|retiro de sitio|salida|egreso|fin de turno|me voy)\b/.test(comando)) {
        return 'SALIDA';
    }

    if (/\b(me reporto en sitio|reporto en sitio|entrada|ingreso|inicio de turno|llegada)\b/.test(comando)) {
        return 'ENTRADA';
    }

    return '';
}

function obtenerClavePendiente({ chat, message, nombreAutor = '' }) {
    const chatKey = (chat?.id?._serialized || chat?.name || 'sin-chat').toString().trim();
    const autorKey = (message?.author || message?.from || nombreAutor || 'sin-autor').toString().trim().toLowerCase();
    return `${chatKey}::${autorKey}`;
}

function limpiarPendientes() {
    const ahora = Date.now();
    Object.keys(pendientesUbicacion).forEach((clave) => {
        const item = pendientesUbicacion[clave];
        if (!item || (ahora - item.createdAtMs) > VENTANA_UBICACION_MS) {
            delete pendientesUbicacion[clave];
        }
    });
}

function obtenerDetalleUbicacion(message) {
    const lat = message?.location?.latitude;
    const lng = message?.location?.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return '';
    }

    return `GPS:${lat},${lng}`;
}

async function manejarAsistencia({ message, chat, textoOriginal, nombreAutor, fecha, area }) {
    const hayContenido = Boolean((textoOriginal || '').trim()) || message.type === 'location';
    if (!hayContenido) {
        return;
    }

    // En asistencia de limpieza, solo se procesan personas dadas de alta en la plantilla.
    const personaLimpieza = area === 'LIMPIEZA'
        ? resolverPersonaMarcador(nombreAutor || message?.author || '')
        : null;
    if (area === 'LIMPIEZA' && !personaLimpieza) {
        console.log('⏭️ ASISTENCIA LIMPIEZA ignorada: autor fuera de plantilla =>', nombreAutor || message?.author || 'Sin nombre');
        return;
    }

    const clavePendiente = obtenerClavePendiente({ chat, message, nombreAutor });
    const chatId = chat?.id?._serialized || '';
    const mensajeId = message?.id?._serialized || '';
    const tipoMensaje = message?.type || '';
    const autor = personaLimpieza?.nombre || nombreAutor || message?.author || 'Sin nombre';

    limpiarPendientes();

    const intencion = detectarIntencion(textoOriginal);
    if (intencion) {
        // Paso 1 del flujo: guardar evento (entrada/salida) y esperar ubicacion para completar contexto.
        const idEvento = await registrarEventoAsistencia({
            fecha,
            area,
            tipoEvento: intencion,
            autor,
            grupoNombre: chat?.name || '',
            chatId,
            mensajeId,
            tipoMensaje,
            ubicacion: ''
        });

        if (idEvento) {
            logPersistencia({
                tabla: 'asistencia_eventos',
                id: idEvento,
                autor,
                grupo: chat?.name || '',
                mensajeId
            });

            pendientesUbicacion[clavePendiente] = {
                idEvento,
                tipoEvento: intencion,
                autor,
                createdAtMs: Date.now()
            };
        }

        return;
    }

    if (message.type !== 'location') {
        return;
    }

    const pendiente = pendientesUbicacion[clavePendiente];
    if (!pendiente?.idEvento) {
        return;
    }

    const ubicacion = obtenerDetalleUbicacion(message);
    if (!ubicacion) {
        return;
    }

    const actualizada = await actualizarUbicacionEvento({
        idEvento: pendiente.idEvento,
        ubicacion
    });

    // Solo limpieza confirma en chat; MTTO queda silencioso por decision operativa.
    if (actualizada && area === 'LIMPIEZA') {
        const accion = pendiente.tipoEvento === 'SALIDA' ? 'salida' : 'entrada';
        await message.reply(`✅ ${accion.toUpperCase()} registrada para ${pendiente.autor || autor}.`);
    }

    delete pendientesUbicacion[clavePendiente];
}

module.exports = { manejarAsistencia };
