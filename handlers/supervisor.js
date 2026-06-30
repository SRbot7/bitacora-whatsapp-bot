const {
    registrarPendiente,
    cerrarPendiente,
    contarAbiertos,
    contarCerrados,
    listarPendientes,
    listarRiesgos,
    listarMaterialesSupervisor
} = require('../services/pendientes');

const { registrarMaterial }  = require('../services/materiales');
const { registrarProyecto }  = require('../services/proyectos');
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


// =========================
// COMANDOS VALIDOS
// =========================

const COMANDOS = [
    'AYUDA', 'AYUDA PENDIENTES', 'AYUDA MATERIALES',
    'AYUDA INSUMOS', 'AYUDA PROYECTOS', 'AYUDA EVIDENCIAS',
    'LISTAR', 'ABIERTOS', 'CERRADOS',
    'RIESGOS', 'MATERIALES', 'PROYECTOS'
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

function siguientePreguntaPendiente(paso) {
    const preguntas = [
        '1/7 Describe el pendiente:',
        '2/7 Area:',
        '3/7 Tipo (CORRECTIVO/PREVENTIVO/MEJORA):',
        '4/7 Prioridad (ALTA/MEDIA/BAJA):',
        '5/7 Turno:',
        '6/7 Tecnicos (ejemplo: Juan|Pedro):',
        '7/7 Fecha programada DD/MM/AAAA (o escribe OMITIR):'
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
        '6/6 Justificacion:'
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
        '9/9 Costo estimado (numero, o escribe OMITIR):'
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


// =========================
// HANDLER SUPERVISOR
// =========================

async function manejarSupervisor({ message, chat, textoOriginal, nombreAutor, fecha }) {

    const descripcion = (textoOriginal || '').trim();
    const desc        = descripcion.toUpperCase().trim();
    const clave       = claveMemoria(chat.name, message.author);
    const flujoActivo = flujosSupervisor[clave];

    if (COMANDOS_CANCELAR.includes(desc)) {
        if (flujoActivo) {
            delete flujosSupervisor[clave];
            await message.reply('🛑 Captura guiada cancelada.');
        }
        return;
    }

    if (!message.hasMedia && COMANDOS_GUIA_PENDIENTE.includes(desc)) {
        iniciarFlujoPendiente(clave);
        await message.reply(
            '🧭 Modo guiado de Pendiente activado.\n' +
            'Responde un campo por mensaje.\n' +
            'Puedes escribir CANCELAR en cualquier momento.\n\n' +
            siguientePreguntaPendiente(0)
        );
        return;
    }

    if (!message.hasMedia && COMANDOS_GUIA_MATERIAL.includes(desc)) {
        iniciarFlujoMaterial(clave);
        await message.reply(
            '🧭 Modo guiado de Material/Insumo activado.\n' +
            'Responde un campo por mensaje.\n' +
            'Puedes escribir CANCELAR en cualquier momento.\n\n' +
            siguientePreguntaMaterial(0)
        );
        return;
    }

    if (!message.hasMedia && COMANDOS_GUIA_PROYECTO.includes(desc)) {
        iniciarFlujoProyecto(clave, nombreAutor);
        await message.reply(
            '🧭 Modo guiado de Proyecto activado.\n' +
            'Responde un campo por mensaje.\n' +
            'Puedes escribir CANCELAR en cualquier momento.\n\n' +
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

        await message.reply(
            `✅ Pendiente registrado con captura guiada\n\n` +
            `ID: ${idPendiente}\n` +
            `Area: ${datos.area}\n` +
            `Prioridad: ${datos.prioridad}`
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

        await message.reply(
            `✅ Material/Insumo registrado con captura guiada\n\n` +
            `ID: ${idMaterial}\n` +
            `Material: ${datos.material}\n` +
            `Prioridad: ${datos.prioridad}`
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

        await message.reply(
            `✅ Proyecto registrado con captura guiada\n\n` +
            `ID: ${idProyecto}\n` +
            `Nombre: ${datos.nombre}\n` +
            `Prioridad: ${datos.prioridad}`
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
        await message.reply(`🤖 CENTRO OPERATIVO SHP1

📋 MENÚ DE AYUDA

AYUDA — Muestra este menú.
AYUDA PENDIENTES — Comandos de pendientes.
AYUDA MATERIALES / AYUDA INSUMOS — Comandos de materiales.
AYUDA PROYECTOS — Comandos de proyectos.
AYUDA EVIDENCIAS — Información sobre fotografías.
GUIA PENDIENTE — Registro guiado paso a paso.
GUIA MATERIAL o GUIA INSUMO — Registro guiado paso a paso.
GUIA PROYECTO — Registro guiado paso a paso.
CANCELAR o SALIR — Cancela cualquier guía activa.

━━━━━━━━━━━━━━━
CONSULTAS
━━━━━━━━━━━━━━━
LISTAR | ABIERTOS | CERRADOS
MATERIALES | PROYECTOS | RIESGOS`);
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

CANCELAR — Cancela guía activa`);
        return;
    }

    if (desc === 'AYUDA EVIDENCIAS') {
        await message.reply(`📸 EVIDENCIAS

Las fotografías enviadas después de registrar un pendiente, material o proyecto quedarán ligadas automáticamente al último registro creado por el mismo usuario.

Puedes enviar una o varias fotografías.`);
        return;
    }

    // =========================
    // ABIERTOS
    // =========================

    if (desc === 'ABIERTOS') {
        const total = await contarAbiertos();
        await message.reply(`📋 Pendientes abiertos: ${total}`);
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
        let respuesta = '📋 PENDIENTES ABIERTOS\n\n';

        rows.forEach(p => {
            const icono =
                p.prioridad === 'ALTA'  ? '🔴' :
                p.prioridad === 'MEDIA' ? '🟡' : '🟢';

            respuesta +=
                `[${p.id}] ${icono} ${p.prioridad} | ${p.categoria}\n` +
                `${p.descripcion}\n\n`;
        });

        if (rows.length === 0) respuesta = '✅ No hay pendientes abiertos';

        await message.reply(respuesta);
        console.log('📤 Lista enviada a WhatsApp');
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
        console.log(`✅ Pendiente ${idPendiente} guardado`);

        await message.reply(`✅ Pendiente registrado\n\nID: ${idPendiente}`);

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
        console.log(`✅ Material ${idMaterial} guardado`);

        await message.reply(`✅ Material registrado\n\nID: ${idMaterial}`);

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

        await message.reply(`✅ Proyecto registrado\n\nID: ${idProyecto}`);

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

