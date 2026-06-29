const pool = require('../db');
const { extraerDatosBitacora } = require('../lib/bitacora-parser');
const {
    guardarTextoBitacora,
    guardarEvidencia,
    guardarActividad,
    relacionarEvidencia
} = require('../lib/bitacora-storage');
const { ultimasActividades, claveMemoria } = require('../lib/memoria');


// =========================
// HANDLER BITACORA
// =========================

async function manejarBitacora({ message, chat, textoOriginal, nombreAutor, fecha }) {

    // Blindaje: este handler solo debe persistir datos del grupo BITACORA.
    if (chat.name !== 'BITACORA-MTTO-SHP1') {
        console.log('⛔ Bloqueado en BITACORA: grupo no permitido para actividades_mtto ->', chat.name);
        return;
    }

    // =========================
    // PARSEAR TEXTO
    // =========================

    const { turno, area, tecnico, pendientes, actividad } =
        extraerDatosBitacora(textoOriginal, nombreAutor);

    console.log('\nDATOS EXTRAIDOS:');
    console.log('Turno:', turno);
    console.log('Area:', area);
    console.log('Tecnico:', tecnico);
    console.log('Actividad:', actividad);
    console.log('Pendientes:', pendientes);

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
            const clave = claveMemoria(chat.name, message.author);
            ultimasActividades[clave] = actividadId;
            console.log('🧠 Última actividad:', clave, '=>', actividadId);
            console.log('\n✅ ACTIVIDAD GUARDADA | ID:', actividadId);
        }
    }

    // =========================
    // RECUPERAR ID PARA EVIDENCIA SUELTA
    // =========================
    // Si el mensaje solo trae imagen (sin texto), se recupera
    // la última actividad del usuario para relacionarla.

    if (!actividadId && rutaEvidencia) {
        const clave = claveMemoria(chat.name, message.author);
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
}


module.exports = { manejarBitacora };
