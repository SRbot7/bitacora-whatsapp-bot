function extraerCampo(regex, texto, valorDefault = '') {
    const match = texto.match(regex);

    if (
        match &&
        match[1]
    ) {
        return match[1].trim();
    }

    return valorDefault;
}

function normalizarTexto(texto) {
    return texto
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function obtenerTextoMensaje(message) {
    // El bot acepta texto normal o una imagen con caption.
    if (message.body) {
        return message.body;
    }

    if (
        message.hasMedia &&
        message._data &&
        message._data.caption
    ) {
        return message._data.caption;
    }

    return '';
}

function extraerLineaValor(textoLimpio, etiqueta, valorDefault = '') {
    const etiquetaNormalizada = normalizarTexto(etiqueta).trim();
    const lineas = textoLimpio.split('\n');

    for (const linea of lineas) {
        const lineaLimpia = linea.trimStart();
        const lineaNormalizada = normalizarTexto(lineaLimpia);

        if (lineaNormalizada.startsWith(etiquetaNormalizada)) {
            const indiceDosPuntos = lineaLimpia.indexOf(':');
            const valor = indiceDosPuntos >= 0
                ? lineaLimpia.slice(indiceDosPuntos + 1).trim()
                : lineaLimpia.slice(etiqueta.length).trim();

            return valor || valorDefault;
        }
    }

    return valorDefault;
}

function extraerSeccionPorPatron(texto = '', patronInicio, patronFin, valorDefault = '') {
    const flags = 'i';
    const regex = patronFin
        ? new RegExp(`${patronInicio}([\\s\\S]*?)(?=${patronFin})`, flags)
        : new RegExp(`${patronInicio}([\\s\\S]*)$`, flags);

    const match = texto.match(regex);
    if (!match || !match[1]) {
        return valorDefault;
    }

    const valor = match[1]
        .replace(/^\s*:\s*/, '')
        .replace(/^\s+/, '')
        .trim();

    return valor || valorDefault;
}

function extraerBloqueEntreEtiquetas(
    textoLimpio,
    etiquetaInicio,
    etiquetasFin,
    valorDefault = ''
) {
    const etiquetasFinNormalizadas = etiquetasFin.map((etiqueta) => {
        return normalizarTexto(etiqueta).trim();
    });

    const lineas = textoLimpio.split('\n');
    const inicioIndex = lineas.findIndex((linea) => {
        return normalizarTexto(linea).trimStart().startsWith(
            normalizarTexto(etiquetaInicio).trim()
        );
    });

    if (inicioIndex === -1) {
        return valorDefault;
    }

    const contenido = [];

    for (let indice = inicioIndex + 1; indice < lineas.length; indice += 1) {
        const lineaActual = lineas[indice];
        const lineaNormalizada = normalizarTexto(lineaActual).trimStart();

        if (
            etiquetasFinNormalizadas.some((etiquetaFin) => {
                return lineaNormalizada.startsWith(etiquetaFin);
            })
        ) {
            break;
        }

        contenido.push(lineaActual);
    }

    const valor = contenido.join('\n').trim();
    return valor || valorDefault;
}

function esEtiquetaInsumos(linea = '') {
    const n = normalizarTexto(linea || '').replace(/\s+/g, ' ').trim();
    return /^(insumos|materiales|herramientas)\s*:?$/.test(n);
}

function esEncabezadoBitacora(linea = '') {
    const n = normalizarTexto(linea || '').replace(/\s+/g, ' ').trim();
    return /^(bitacora\s*turno|area|actividades?|actividad|pendientes|tecnico|tecnico responsable|insumos|materiales|herramientas)\s*:?$/.test(n);
}

function extraerLineasInsumos(texto = '') {
    const lineas = (texto || '').replace(/\r/g, '').split('\n');
    const inicioIndex = lineas.findIndex((linea) => esEtiquetaInsumos(linea));

    if (inicioIndex === -1) {
        return [];
    }

    const resultado = [];
    for (let i = inicioIndex + 1; i < lineas.length; i += 1) {
        const linea = lineas[i] || '';
        const trim = linea.trim();

        if (!trim) {
            continue;
        }

        if (esEncabezadoBitacora(trim)) {
            break;
        }

        const limpia = trim
            .replace(/^[\-•*]+\s*/, '')
            .replace(/^\d{1,2}\s*[-.)]\s*/, '')
            .trim();

        if (!limpia || limpia === '.') {
            continue;
        }

        resultado.push(limpia);
    }

    return resultado;
}

function extraerDatosBitacora(textoOriginal, nombreAutor) {
    const textoLimpio = textoOriginal
        .replace(/\r/g, '')
        .trim();

    // Cada campo se extrae por etiqueta para que el flujo sea fácil de leer.
    const turno = extraerCampo(
        /bit[aá]cora\s*turno\s*:?\s*(\d+)/i,
        textoLimpio,
        'Sin turno'
    );

    let area = extraerSeccionPorPatron(
        textoLimpio,
        '(?:^|\\n|\\s)(?:area|área)\\s*:?\\s*',
        '(?:\\n|\\s)(?:actividades?|pendientes|tecnico|técnico)\\s*:?\\s*',
        'Sin area'
    );

    let actividad = extraerSeccionPorPatron(
        textoLimpio,
        '(?:^|\\n|\\s)(?:actividades?|actividad)\\s*:?\\s*',
        '(?:\\n|\\s)(?:pendientes|tecnico|técnico)\\s*:?\\s*',
        ''
    );

    const pendientes = extraerSeccionPorPatron(
        textoLimpio,
        '(?:^|\\n|\\s)(?:pendientes)\\s*:?\\s*',
        '(?:\\n|\\s)(?:tecnico|técnico)\\s*:?\\s*',
        'Sin pendientes'
    );

    const tecnico = extraerSeccionPorPatron(
        textoLimpio,
        '(?:^|\\n|\\s)(?:tecnico|técnico)\\s*:?\\s*',
        null,
        nombreAutor
    );

    const insumos = extraerLineasInsumos(textoLimpio);

    // Si el usuario no puso etiqueta ACTIVIDAD/ACTIVIDADES y mando el contenido
    // inmediatamente despues de AREA, se parte AREA vs ACTIVIDAD por el primer
    // item numerado (ej. "1.-", "2)").
    if (area && area !== 'Sin area' && !actividad) {
        const indiceActividad = area.search(/(?:^|\s)\d{1,2}\s*[-.)]/m);

        if (indiceActividad > 0) {
            const areaOriginal = area;
            const areaCorta = areaOriginal
                .slice(0, indiceActividad)
                .trim()
                .replace(/[,:;.\-\s]+$/, '')
                .trim();
            const actividadInferida = areaOriginal.slice(indiceActividad).trim();

            area = areaCorta || areaOriginal;
            actividad = actividadInferida;
        }
    }

    return {
        textoLimpio,
        turno,
        area,
        tecnico,
        pendientes,
        actividad,
        insumos
    };
}

module.exports = {
    extraerCampo,
    obtenerTextoMensaje,
    extraerDatosBitacora,
    extraerLineasInsumos
};
