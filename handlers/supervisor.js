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
    claveMemoria
} = require('../lib/memoria');


// =========================
// COMANDOS VALIDOS
// =========================

const COMANDOS = [
    'AYUDA', 'AYUDA PENDIENTES', 'AYUDA MATERIALES',
    'AYUDA PROYECTOS', 'AYUDA EVIDENCIAS',
    'LISTAR', 'ABIERTOS', 'CERRADOS',
    'RIESGOS', 'MATERIALES', 'PROYECTOS'
];


// =========================
// HANDLER SUPERVISOR
// =========================

async function manejarSupervisor({ message, chat, textoOriginal, nombreAutor, fecha }) {

    const descripcion = (textoOriginal || '').trim();
    const desc        = descripcion.toUpperCase().trim();

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
    const clave         = claveMemoria(chat.name, message.author);
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
AYUDA MATERIALES — Comandos de materiales.
AYUDA PROYECTOS — Comandos de proyectos.
AYUDA EVIDENCIAS — Información sobre fotografías.

━━━━━━━━━━━━━━━
CONSULTAS
━━━━━━━━━━━━━━━
LISTAR | ABIERTOS | CERRADOS
MATERIALES | PROYECTOS | RIESGOS`);
        return;
    }

    if (desc === 'AYUDA PENDIENTES') {
        await message.reply(`🚧 REGISTRO DE PENDIENTES

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
CERRAR <ID> — Ejemplo: CERRAR 42`);
        return;
    }

    if (desc === 'AYUDA MATERIALES') {
        await message.reply(`📦 REQUISICIÓN DE MATERIAL

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
Sustituir herramienta dañada.`);
        return;
    }

    if (desc === 'AYUDA PROYECTOS') {
        await message.reply(`🏗️ REGISTRO DE PROYECTOS

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
15000`);
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

