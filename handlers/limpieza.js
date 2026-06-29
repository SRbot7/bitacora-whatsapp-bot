const { guardarEvidencia } = require('../lib/bitacora-storage');
const {
    guardarActividadLimpieza,
    guardarEvidenciaLimpieza,
    obtenerUltimaActividadLimpiezaPorAutor
} = require('../services/limpieza');
const { ultimasLimpiezas, claveMemoria } = require('../lib/memoria');

const LIMPIEZA_GROUP_WINDOW_MINUTES = Math.max(
    5,
    Number.parseInt(process.env.LIMPIEZA_GROUP_WINDOW_MINUTES || '90', 10) || 90
);


// =========================
// HANDLER LIMPIEZA
// =========================
// Acepta texto libre + fotos sin formato específico
// Ideal para reporte simple de labores de limpieza

async function manejarLimpieza({ message, chat, textoOriginal, nombreAutor, fecha }) {

    console.log('\n🧹 LIMPIEZA');
    console.log('Descripción:', textoOriginal);

    const fechaArchivo  = fecha.format('YYYY-MM-DD');
    let rutaEvidencia   = '';
    let actividadId     = null;
    const descripcion   = (textoOriginal || '').trim();
    const clave         = claveMemoria(chat.name, message.author);

    // =========================
    // GUARDAR ACTIVIDAD
    // =========================

    if (descripcion) {

        actividadId = await guardarActividadLimpieza({
            fecha,
            autor:       nombreAutor,
            area:        'General',
            descripcion,
            grupo:       chat.name,
            tipoMensaje: message.type,
            mensajeId:   message.id._serialized
        });

        if (actividadId) {
            ultimasLimpiezas[clave] = actividadId;
            console.log('🧠 Última limpieza:', clave, '=>', actividadId);
            console.log(`✅ Limpieza registrada | ID: ${actividadId}`);
        }
    } else if (message.hasMedia) {
        actividadId = await obtenerUltimaActividadLimpiezaPorAutor({
            autor: nombreAutor,
            grupo: chat.name,
            fecha,
            maxMinutos: LIMPIEZA_GROUP_WINDOW_MINUTES
        });

        if (actividadId) {
            ultimasLimpiezas[clave] = actividadId;
            console.log('🧠 Última limpieza recuperada por ventana de tiempo:', clave, '=>', actividadId);
        }

        console.log('🖎 Limpieza recuperada:', actividadId);
    }

    // =========================
    // GUARDAR EVIDENCIA (FOTOS)
    // =========================

    if (message.hasMedia) {

        rutaEvidencia = await guardarEvidencia(
            message,
            fechaArchivo,
            'evidencias_limpieza'
        );

        if (rutaEvidencia) {
            console.log('✅ Evidencia guardada:', rutaEvidencia);
        }
    }

    // =========================
    // RELACIONAR EVIDENCIA CON ACTIVIDAD
    // =========================

    if (rutaEvidencia && actividadId) {

        await guardarEvidenciaLimpieza({
            actividadId,
            rutaEvidencia
        });

        console.log('✅ EVIDENCIA RELACIONADA');
    }

    if (rutaEvidencia && !actividadId) {
        actividadId = await guardarActividadLimpieza({
            fecha,
            autor:       nombreAutor,
            area:        'General',
            descripcion: '[SIN REPORTE] Imagen enviada sin texto.',
            grupo:       chat.name,
            tipoMensaje: 'image',
            mensajeId:   message.id._serialized
        });

        if (actividadId) {
            ultimasLimpiezas[clave] = actividadId;

            await guardarEvidenciaLimpieza({
                actividadId,
                rutaEvidencia
            });

            console.log('⚠️ Registro creado sin reporte y evidencia relacionada | ID:', actividadId);
        } else {
            console.log('⚠️ Evidencia sin actividad de limpieza previa (enviar primero mensaje con texto).');
        }
    }

}


module.exports = { manejarLimpieza };
