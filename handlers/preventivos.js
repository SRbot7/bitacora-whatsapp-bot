const moment = require('moment-timezone');
const { guardarEvidencia } = require('../lib/bitacora-storage');
const { extraerTextoOCRDesdeArchivo } = require('../lib/ocr');
const { registrarPreventivoSemanal } = require('../services/preventivos');
const { registrarPendiente } = require('../services/pendientes');
const { logPersistencia } = require('../lib/persistence-log');

function normalizarTexto(texto = '') {
    return texto
        .toString()
        .replace(/\r/g, '')
        .trim();
}

function extraerEtiquetaSitio(texto = '') {
    const normalizado = texto
        .toString()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase();

    if (/\bSHP1\b/.test(normalizado)) {
        return 'SHP1';
    }

    return '';
}

function limpiarLinea(valor = '') {
    return valor
        .toString()
        .replace(/\s+/g, ' ')
        .trim();
}

function extraerValorDesdeTexto(texto = '', etiqueta = '') {
    const lineas = texto
        .toString()
        .replace(/\r/g, '')
        .split('\n')
        .map((linea) => limpiarLinea(linea))
        .filter(Boolean);

    const etiquetaNormalizada = limpiarLinea(etiqueta).toLowerCase();

    for (let indice = 0; indice < lineas.length; indice += 1) {
        const linea = lineas[indice];
        const lineaNormalizada = linea.toLowerCase();

        if (!lineaNormalizada.startsWith(etiquetaNormalizada)) {
            continue;
        }

        const posDosPuntos = linea.indexOf(':');
        if (posDosPuntos >= 0) {
            const valorMismaLinea = limpiarLinea(linea.slice(posDosPuntos + 1));
            if (valorMismaLinea) {
                return valorMismaLinea;
            }
        }

        const siguienteLinea = lineas[indice + 1] || '';
        return limpiarLinea(siguienteLinea);
    }

    return '';
}

function construirDescripcionPendiente({ textoOCR, textoCaption }) {
    const textoFuente = textoCaption || textoOCR || '';
    const textoBreve = extraerValorDesdeTexto(textoFuente, 'Texto breve');
    const aviso = extraerValorDesdeTexto(textoFuente, 'Aviso');
    const orden = extraerValorDesdeTexto(textoFuente, 'Orden');
    const equipo = extraerValorDesdeTexto(textoFuente, 'Equipo');
    const indAbc = extraerValorDesdeTexto(textoFuente, 'Ind. ABC');

    const partes = [textoBreve, equipo, orden, aviso, indAbc].filter(Boolean);

    return {
        descripcion: partes.length ? partes.join(' | ') : limpiarLinea(textoFuente).slice(0, 280),
        observaciones: [
            aviso ? `Aviso: ${aviso}` : '',
            orden ? `Orden: ${orden}` : '',
            equipo ? `Equipo: ${equipo}` : '',
            indAbc ? `Ind. ABC: ${indAbc}` : '',
            textoBreve ? `Texto breve: ${textoBreve}` : '',
            textoOCR ? `OCR:\n${textoOCR}` : ''
        ].filter(Boolean).join('\n\n')
    };
}

function unirTextos(...fragmentos) {
    return fragmentos
        .map((texto) => normalizarTexto(texto))
        .filter(Boolean)
        .join('\n');
}

function normalizarComparacion(valor = '') {
    return valor
        .toString()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase();
}

function limpiarEncabezadosOCR(linea = '') {
    return limpiarLinea(
        linea
            .replace(/^[-*•\s]+/, '')
            .replace(/^\d+[.)-]?\s+/, '')
    );
}

function construirDescripcionItem(lineaOriginal = '') {
    const linea = limpiarEncabezadosOCR(lineaOriginal);
    const normalizada = normalizarComparacion(linea);

    const categoria =
        normalizada.includes('CORTINA') ? 'CORTINAS' :
        normalizada.includes('RAMPA') ? 'RAMPAS' :
        normalizada.includes('BANO') || normalizada.includes('BAÑO') ? 'BANOS' :
        normalizada.includes('CARRITO') ? 'CARRITOS' :
        'OTRO';

    const matchDetalle = linea.match(/(?:MANTTO|MTTO)\s+(.+)$/i);
    const detalle = matchDetalle?.[1]?.trim() || linea;

    return {
        categoria,
        descripcion: `[${categoria}] ${detalle}`.slice(0, 280),
        lineaOCR: linea
    };
}

function extraerItemsPreventivosIndividuales(textoFuente = '') {
    const lineas = textoFuente
        .toString()
        .replace(/\r/g, '')
        .split('\n')
        .map((linea) => limpiarEncabezadosOCR(linea))
        .filter(Boolean);

    const vistos = new Set();
    const items = [];

    for (const linea of lineas) {
        const normalizada = normalizarComparacion(linea);

        const pareceItem =
            normalizada.includes('SHP1') &&
            (
                normalizada.includes('MANTTO') ||
                normalizada.includes('MTTO') ||
                normalizada.includes('CORTINA') ||
                normalizada.includes('RAMPA') ||
                normalizada.includes('BANO') ||
                normalizada.includes('CARRITO')
            );

        if (!pareceItem) {
            continue;
        }

        if (normalizada.includes('TIEMPO CE') || normalizada.includes('TEXTO BREVE')) {
            continue;
        }

        const clave = normalizada.replace(/\s+/g, ' ').trim();
        if (vistos.has(clave)) {
            continue;
        }

        vistos.add(clave);
        items.push(construirDescripcionItem(linea));

        if (items.length >= 50) {
            break;
        }
    }

    return items;
}

function inicioDeSemana(fecha) {
    return fecha.clone().startOf('isoWeek').format('YYYY-MM-DD');
}

function finDeSemana(fecha) {
    return fecha.clone().endOf('isoWeek').format('YYYY-MM-DD');
}

async function manejarPreventivos({
    message,
    chat,
    textoOriginal,
    nombreAutor,
    fecha,
    permitirFallbackEtiqueta = false
}) {
    const texto = normalizarTexto(textoOriginal);
    const fechaArchivo = fecha.format('YYYY-MM-DD');

    const rutaEvidencia = message.hasMedia
        ? await guardarEvidencia(message, fechaArchivo, 'evidencias_preventivos')
        : '';

    let textoOCR = '';
    if (rutaEvidencia) {
        try {
            textoOCR = await extraerTextoOCRDesdeArchivo(rutaEvidencia);
        } catch (error) {
            console.error('❌ OCR preventivos falló:', error);
        }
    }

    const textoCombinado = unirTextos(texto, textoOCR);
    let etiqueta = extraerEtiquetaSitio(textoCombinado);

    if (!etiqueta && permitirFallbackEtiqueta && chat?.name === 'Centro Operativo SHP1') {
        etiqueta = 'SHP1';
        console.log('ℹ️ Preventivo con etiqueta SHP1 por fallback de grupo Centro Operativo.');
    }

    if (!etiqueta) {
        console.log('⏭️ Preventivo ignorado: no trae etiqueta SHP1 en caption ni OCR.', {
            grupo: chat.name,
            autor: nombreAutor,
            mensajeId: message.id?._serialized
        });
        return { registrado: false, motivo: 'SIN_ETIQUETA' };
    }

    const resumen = texto || textoOCR || '[IMAGEN SIN TEXTO] Orden preventiva semanal enviada sin caption.';
    const pendienteData = construirDescripcionPendiente({
        textoOCR,
        textoCaption: texto
    });
    const itemsIndividuales = extraerItemsPreventivosIndividuales(textoCombinado);

    const idPreventivo = await registrarPreventivoSemanal({
        fecha,
        autor: nombreAutor,
        grupo: chat.name,
        etiqueta,
        textoOCR,
        semanaInicio: inicioDeSemana(fecha),
        semanaFin: finDeSemana(fecha),
        resumen,
        rutaEvidencia: rutaEvidencia || null,
        mensajeId: message.id._serialized
    });

    logPersistencia({
        tabla: 'preventivos_semanales',
        id: idPreventivo,
        autor: nombreAutor,
        grupo: chat.name,
        mensajeId: message.id._serialized
    });

    const idsPendientes = [];

    if (itemsIndividuales.length > 0) {
        for (const item of itemsIndividuales) {
            const idPendienteItem = await registrarPendiente({
                descripcion: item.descripcion,
                area: etiqueta,
                tipoMtto: 'PREVENTIVO',
                prioridad: 'ALTA',
                turno: 'SEMANAL',
                tecnicos: nombreAutor,
                fechaSql: fecha.format('YYYY-MM-DD'),
                creadoPor: nombreAutor,
                categoria: 'PREVENTIVO',
                observaciones: `Preventivo semanal #${idPreventivo}\nLínea OCR: ${item.lineaOCR}`
            });

            idsPendientes.push(idPendienteItem);
            logPersistencia({
                tabla: 'pendientes_supervisor',
                id: idPendienteItem,
                autor: nombreAutor,
                grupo: chat.name,
                mensajeId: message.id._serialized
            });
        }
    } else {
        const idPendiente = await registrarPendiente({
            descripcion: pendienteData.descripcion,
            area: etiqueta,
            tipoMtto: 'PREVENTIVO',
            prioridad: 'ALTA',
            turno: 'SEMANAL',
            tecnicos: nombreAutor,
            fechaSql: fecha.format('YYYY-MM-DD'),
            creadoPor: nombreAutor,
            categoria: 'PREVENTIVO',
            observaciones: pendienteData.observaciones
        });

        idsPendientes.push(idPendiente);
        logPersistencia({
            tabla: 'pendientes_supervisor',
            id: idPendiente,
            autor: nombreAutor,
            grupo: chat.name,
            mensajeId: message.id._serialized
        });
    }

    const idsPreview = idsPendientes.slice(0, 10).join(', ');
    const sufijoIds = idsPendientes.length > 10 ? ', ...' : '';

    await message.reply(
        `✅ Preventivo semanal registrado\n\nID preventivo: ${idPreventivo}\nPendientes generados: ${idsPendientes.length}\nIDs: ${idsPreview}${sufijoIds}\nSemana: ${inicioDeSemana(fecha)} a ${finDeSemana(fecha)}`
    );

    return {
        registrado: true,
        idPreventivo,
        idsPendientes,
        etiqueta
    };
}

module.exports = { manejarPreventivos };