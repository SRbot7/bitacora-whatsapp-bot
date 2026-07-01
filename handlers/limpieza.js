const { guardarEvidencia } = require('../lib/bitacora-storage');
const {
    guardarActividadLimpieza,
    guardarEvidenciaLimpieza,
    obtenerUltimaActividadLimpiezaPorAutor,
    obtenerUltimaActividadLimpiezaSinReportePorAutor
} = require('../services/limpieza');
const { registrarAsistenciaLimpieza } = require('../services/asistencia-limpieza');
const { ultimasLimpiezas, claveMemoria } = require('../lib/memoria');
const { logPersistencia } = require('../lib/persistence-log');

const LIMPIEZA_GROUP_WINDOW_MINUTES = Math.max(
    5,
    Number.parseInt(process.env.LIMPIEZA_GROUP_WINDOW_MINUTES || '90', 10) || 90
);
const LIMPIEZA_PLACEHOLDER_WINDOW_MINUTES = Math.max(
    1,
    Number.parseInt(process.env.LIMPIEZA_PLACEHOLDER_WINDOW_MINUTES || '15', 10) || 15
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
    const huboReporte   = Boolean(descripcion);
    const huboEvidencia = Boolean(message.hasMedia);
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
            logPersistencia({
                tabla: 'actividades_limpieza',
                id: actividadId,
                autor: nombreAutor,
                grupo: chat.name,
                mensajeId: message.id._serialized
            });
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
        actividadId = await obtenerUltimaActividadLimpiezaSinReportePorAutor({
            autor: nombreAutor,
            grupo: chat.name,
            fecha,
            maxMinutos: LIMPIEZA_PLACEHOLDER_WINDOW_MINUTES
        });

        if (actividadId) {
            ultimasLimpiezas[clave] = actividadId;
            console.log('🧠 Placeholder de limpieza reutilizado:', clave, '=>', actividadId);
        }
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

            logPersistencia({
                tabla: 'actividades_limpieza',
                id: actividadId,
                autor: nombreAutor,
                grupo: chat.name,
                mensajeId: message.id._serialized
            });

            await guardarEvidenciaLimpieza({
                actividadId,
                rutaEvidencia
            });

            console.log('⚠️ Registro creado sin reporte y evidencia relacionada | ID:', actividadId);
        } else {
            console.log('⚠️ Evidencia sin actividad de limpieza previa (enviar primero mensaje con texto).');
        }
    }

    const idAsistencia = await registrarAsistenciaLimpieza({
        fecha,
        autor: nombreAutor,
        grupo: chat.name,
        fuenteRegistro: 'AUTOMATICO',
        reportesIncremento: huboReporte ? 1 : 0,
        evidenciasIncremento: huboEvidencia ? 1 : 0
    });

    if (idAsistencia) {
        logPersistencia({
            tabla: 'asistencia_limpieza_diaria',
            id: idAsistencia,
            autor: nombreAutor,
            grupo: chat.name,
            mensajeId: message.id._serialized
        });
    }

}


module.exports = { manejarLimpieza };
