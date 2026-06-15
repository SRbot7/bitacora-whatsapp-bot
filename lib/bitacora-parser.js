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

    const area = extraerLineaValor(
        textoLimpio,
        'area',
        'Sin area'
    );

    const tecnico = extraerLineaValor(
        textoLimpio,
        'tecnico',
        nombreAutor
    );

    const pendientes = extraerBloqueEntreEtiquetas(
        textoLimpio,
        'pendientes',
        ['tecnico'],
        'Sin pendientes'
    );

    let actividad = '';
    const lineas = textoLimpio.split('\n');
    const inicioArea = lineas.findIndex((linea) => {
        return normalizarTexto(linea).trimStart().startsWith('area');
    });

    if (inicioArea >= 0) {
        const actividadLineas = [];
        const primeraLinea = lineas[inicioArea];
        const indiceDosPuntos = primeraLinea.indexOf(':');

        if (indiceDosPuntos >= 0) {
            const textoEnLaMismaLinea = primeraLinea.slice(indiceDosPuntos + 1).trim();
            if (textoEnLaMismaLinea) {
                actividadLineas.push(textoEnLaMismaLinea);
            }
        }

        for (let indice = inicioArea + 1; indice < lineas.length; indice += 1) {
            const lineaActual = lineas[indice];
            const lineaNormalizada = normalizarTexto(lineaActual).trimStart();

            if (
                lineaNormalizada.startsWith('pendientes') ||
                lineaNormalizada.startsWith('tecnico')
            ) {
                break;
            }

            actividadLineas.push(lineaActual);
        }

        actividad = actividadLineas
            .join('\n')
            .replace(/^\s+/gm, '')
            .trim();
    }

    return {
        textoLimpio,
        turno,
        area,
        tecnico,
        pendientes,
        actividad
    };
}

module.exports = {
    extraerCampo,
    obtenerTextoMensaje,
    extraerDatosBitacora
};
