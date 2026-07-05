const pool = require('../db');
const { extraerDatosBitacora } = require('../lib/bitacora-parser');
const {
    guardarTextoBitacora,
    guardarEvidencia,
    guardarActividad,
    relacionarEvidencia
} = require('../lib/bitacora-storage');
const {
    ultimasActividades,
    flujosBitacora,
    claveMemoria
} = require('../lib/memoria');
const { logPersistencia } = require('../lib/persistence-log');
const {
    guardarMovimientosInsumosBitacora
} = require('../services/bitacora-insumos');

const COMANDOS_GUIA_BITACORA = [
    'GUIA BITACORA',
    'GUIA BOTACORA',
    'GUIA',
    'NUEVA BITACORA',
    'INICIAR BITACORA',
    'INICIAR BOTACORA'
];

const COMANDOS_CANCELAR = ['CANCELAR', 'SALIR', 'CANCELAR BITACORA', 'CANCELAR BOTACORA'];
const COMANDOS_AYUDA_BITACORA = ['AYUDA', 'AYUDA BITACORA', 'AYUDA BOTACORA'];

function normalizarComando(texto = '') {
    return texto
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function esFormatoBitacoraValido(texto = '') {
    const datos = extraerDatosBitacora(texto || '', '');

    return (
        datos.turno !== 'Sin turno' &&
        datos.area !== 'Sin area' &&
        Boolean((datos.actividad || '').trim()) &&
        Boolean((datos.tecnico || '').trim())
    );
}

function iniciarFlujoBitacora({ clave, nombreAutor }) {
    flujosBitacora[clave] = {
        paso: 0,
        data: {
            turno: '',
            area: '',
            actividad: '',
            pendientes: '',
            tecnico: nombreAutor || ''
        }
    };
}

function siguientePreguntaBitacora(paso) {
    const preguntas = [
        '1/5 Turno (ejemplo: 1, 2 o 3):',
        '2/5 Area:',
        '3/5 Actividad realizada:',
        '4/5 Pendientes (escribe OMITIR si no hay):',
        '5/5 Tecnico responsable (escribe OMITIR para usar tu nombre):'
    ];

    return preguntas[paso] || '';
}

function procesarPasoBitacora({ flujo, respuesta, nombreAutor }) {
    const valor = (respuesta || '').trim();

    if (flujo.paso === 0) {
        if (!/^\d+$/.test(valor)) {
            return { ok: false, msg: 'Turno invalido. Escribe solo numero (1, 2 o 3).' };
        }
        flujo.data.turno = valor;
    }

    if (flujo.paso === 1) {
        if (!valor) {
            return { ok: false, msg: 'Area no puede ir vacia.' };
        }
        flujo.data.area = valor;
    }

    if (flujo.paso === 2) {
        if (!valor) {
            return { ok: false, msg: 'Actividad no puede ir vacia.' };
        }
        flujo.data.actividad = valor;
    }

    if (flujo.paso === 3) {
        flujo.data.pendientes = /^OMITIR$/i.test(valor) || !valor
            ? 'Sin pendientes'
            : valor;
    }

    if (flujo.paso === 4) {
        flujo.data.tecnico = /^OMITIR$/i.test(valor) || !valor
            ? (nombreAutor || 'Sin nombre')
            : valor;

        return {
            ok: true,
            finalizado: true,
            data: flujo.data
        };
    }

    flujo.paso += 1;
    return { ok: true, finalizado: false };
}

function construirMensajeAgradecimientoBitacora({ tecnico, idActividad }) {
    const nombre = (tecnico || 'equipo').toString().trim();
    const nombreCorto = nombre.split(' ')[0] || 'equipo';
    const variantes = [
        `✅ Gracias ${nombreCorto}, bitacora recibida y registrada.`,
        `✅ Excelente ${nombreCorto}, ya quedo registrada tu bitacora.`,
        `✅ Listo ${nombreCorto}, se guardo correctamente tu reporte de bitacora.`,
        `✅ Gracias por el reporte ${nombreCorto}, bitacora procesada con exito.`
    ];

    const indice = Math.floor(Math.random() * variantes.length);
    const base = variantes[indice];

    if (idActividad) {
        return `${base}\nID: ${idActividad}`;
    }

    return base;
}


// =========================
// HANDLER BITACORA
// =========================

async function manejarBitacora({ message, chat, textoOriginal, nombreAutor, fecha }) {

    // Blindaje: este handler solo debe persistir datos del grupo BITACORA.
    const chatNombre = (chat.name || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

    if (chatNombre !== 'bitacora-mtto-shp1') {
        console.log('⛔ Bloqueado en BITACORA: grupo no permitido para bitacora ->', chat.name);
        return;
    }

    const descripcion = (textoOriginal || '').trim();
    const descripcionUpper = normalizarComando(descripcion);
    const clave = claveMemoria(chat.name, message.author);
    const flujoActivo = flujosBitacora[clave];

    if (!message.hasMedia && COMANDOS_AYUDA_BITACORA.includes(descripcionUpper)) {
        await message.reply(`📘 AYUDA BITACORA SHP1

Tienes 2 formas de registrar:

1) MODO GUIADO (recomendado)
Comando: GUIA BITACORA
El bot te pedira cada campo y valida datos.

2) MODO FORMATO LIBRE
Envia este formato:

BITACORA TURNO: 2
AREA:
Anden 3
ACTIVIDAD O REPORTE AQUI
PENDIENTES:
Sin pendientes
TECNICO:
Nombre del tecnico

INSUMOS:
- SALIDA | Cinchos | 20 pzas | Conveyor
- ENTRADA | Pintura amarilla | 2 lt | Reposicion

Comandos utiles:
- GUIA BITACORA: inicia captura guiada
- CANCELAR o SALIR: cancela captura guiada
- AYUDA: muestra este menu`);
        return;
    }

    if (COMANDOS_CANCELAR.includes(descripcionUpper)) {
        if (flujoActivo) {
            delete flujosBitacora[clave];
            await message.reply('🛑 Captura guiada de Bitacora cancelada.');
        }
        return;
    }

    if (!message.hasMedia && COMANDOS_GUIA_BITACORA.includes(descripcionUpper)) {
        iniciarFlujoBitacora({ clave, nombreAutor });
        await message.reply(
            '🧭 Modo guiado Bitacora activado.\n' +
            'Responde un campo por mensaje.\n' +
            'Puedes escribir CANCELAR en cualquier momento.\n\n' +
            siguientePreguntaBitacora(0)
        );
        return;
    }

    if (flujoActivo && !message.hasMedia) {
        const resultadoPaso = procesarPasoBitacora({
            flujo: flujoActivo,
            respuesta: descripcion,
            nombreAutor
        });

        if (!resultadoPaso.ok) {
            await message.reply(`⚠️ ${resultadoPaso.msg}`);
            return;
        }

        if (!resultadoPaso.finalizado) {
            await message.reply(siguientePreguntaBitacora(flujoActivo.paso));
            return;
        }

        const datos = resultadoPaso.data;
        delete flujosBitacora[clave];

        const textoSintetico = [
            `BITACORA TURNO: ${datos.turno}`,
            `AREA: ${datos.area}`,
            `${datos.actividad}`,
            'PENDIENTES:',
            `${datos.pendientes}`,
            `TECNICO: ${datos.tecnico}`,
            'INSUMOS:',
            'Sin insumos'
        ].join('\n');

        guardarTextoBitacora({
            fecha,
            chatName: chat.name,
            nombreAutor,
            turno: datos.turno,
            area: datos.area,
            actividad: datos.actividad,
            pendientes: datos.pendientes,
            tecnico: datos.tecnico,
            insumos: '',
            textoOriginal: textoSintetico
        });

        const actividadIdGuiada = await guardarActividad(pool, {
            fecha,
            tecnico: datos.tecnico,
            area: datos.area,
            actividad: datos.actividad,
            pendientes: datos.pendientes,
            turno: datos.turno,
            mensajeId: message.id._serialized,
            grupo: chat.name,
            autorNumero: message.author || '',
            tipoMensaje: message.type
        });

        if (actividadIdGuiada) {
            ultimasActividades[clave] = actividadIdGuiada;
            logPersistencia({
                tabla: 'bitacora',
                id: actividadIdGuiada,
                autor: nombreAutor,
                grupo: chat.name,
                mensajeId: message.id._serialized
            });
        }

        await message.reply(
            `✅ Bitacora registrada con captura guiada.\n\n` +
            `Turno: ${datos.turno}\n` +
            `Area: ${datos.area}\n` +
            `Tecnico: ${datos.tecnico}`
        );

        await message.reply(
            construirMensajeAgradecimientoBitacora({
                tecnico: datos.tecnico,
                idActividad: actividadIdGuiada
            })
        );

        return;
    }

    if (!message.hasMedia && descripcion && !esFormatoBitacoraValido(descripcion)) {
        await message.reply(
            '⚠️ Formato no reconocido para Bitacora.\n' +
            'Recomendado: escribe GUIA BITACORA para captura paso a paso.'
        );
        return;
    }

    // =========================
    // PARSEAR TEXTO
    // =========================

    const { turno, area, tecnico, pendientes, actividad, insumos } =
        extraerDatosBitacora(textoOriginal, nombreAutor);

    console.log('\nDATOS EXTRAIDOS:');
    console.log('Turno:', turno);
    console.log('Area:', area);
    console.log('Tecnico:', tecnico);
    console.log('Actividad:', actividad);
    console.log('Pendientes:', pendientes);
    console.log('Insumos:', insumos);

    // =========================
    // GUARDAR TXT
    // =========================

    guardarTextoBitacora({
        fecha,
        chatName:     chat.name,
        nombreAutor,
        turno,
        area,
        actividad,
        pendientes,
        tecnico,
        insumos: (insumos || []).join('\n'),
        textoOriginal
    });

    console.log('\n📄 TXT GUARDADO');

    // =========================
    // GUARDAR EVIDENCIA (imagen)
    // =========================

    const fechaArchivo = fecha.format('YYYY-MM-DD');
    const rutaEvidencia = await guardarEvidencia(message, fechaArchivo);

    if (rutaEvidencia) {
        console.log('✅ Evidencia guardada:', rutaEvidencia);
    }

    // =========================
    // CREAR ACTIVIDAD EN DB
    // =========================

    let actividadId = null;

    if (textoOriginal.trim()) {

        actividadId = await guardarActividad(pool, {
            fecha,
            tecnico,
            area,
            actividad,
            pendientes,
            turno,
            mensajeId:    message.id._serialized,
            grupo:        chat.name,
            autorNumero:  message.author || '',
            tipoMensaje:  message.type
        });

        if (actividadId) {
            ultimasActividades[clave] = actividadId;
            console.log('🧠 Última actividad:', clave, '=>', actividadId);
            logPersistencia({
                tabla: 'bitacora',
                id: actividadId,
                autor: nombreAutor,
                grupo: chat.name,
                mensajeId: message.id._serialized
            });
        }
    }

    // =========================
    // RECUPERAR ID PARA EVIDENCIA SUELTA
    // =========================
    // Si el mensaje solo trae imagen (sin texto), se recupera
    // la última actividad del usuario para relacionarla.

    if (!actividadId && rutaEvidencia) {
        actividadId = ultimasActividades[clave];
        console.log('🖎 Actividad recuperada:', actividadId);
    }

    // =========================
    // RELACIONAR EVIDENCIA CON ACTIVIDAD
    // =========================

    if (rutaEvidencia && actividadId) {

        await relacionarEvidencia(pool, {
            actividadId,
            rutaEvidencia,
            tipoArchivo: message.type,
            mensajeId:   message.id._serialized
        });

        console.log('✅ EVIDENCIA RELACIONADA');
    }

    let totalInsumosGuardados = 0;
    if (textoOriginal.trim() && Array.isArray(insumos) && insumos.length > 0) {
        const guardadoInsumos = await guardarMovimientosInsumosBitacora(pool, {
            actividadId,
            fechaSql: fecha.format('YYYY-MM-DD HH:mm:ss'),
            grupo: chat.name,
            tecnico,
            area,
            turno,
            mensajeId: message.id._serialized,
            lineas: insumos
        });

        totalInsumosGuardados = Number(guardadoInsumos?.total || 0);
        console.log('📦 Insumos guardados:', totalInsumosGuardados);
    }

    if (textoOriginal.trim() && actividadId) {
        const agradecimiento = construirMensajeAgradecimientoBitacora({
            tecnico,
            idActividad: actividadId
        });
        const extraInsumos = totalInsumosGuardados > 0
            ? `\n📦 Movimientos de insumos registrados: ${totalInsumosGuardados}`
            : '';

        await message.reply(`${agradecimiento}${extraInsumos}`);
    }
}


module.exports = { manejarBitacora };
