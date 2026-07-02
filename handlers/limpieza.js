const { guardarEvidencia } = require('../lib/bitacora-storage');
const {
    guardarActividadLimpieza,
    guardarEvidenciaLimpieza,
    obtenerUltimaActividadLimpiezaPorAutor,
    obtenerUltimaActividadLimpiezaSinReportePorAutor
} = require('../services/limpieza');
const { resolverPersonaMarcador } = require('../services/limpieza-personal');
const { registrarAsistenciaLimpieza } = require('../services/asistencia-limpieza');
const { ultimasLimpiezas, claveMemoria } = require('../lib/memoria');
const { logPersistencia } = require('../lib/persistence-log');

const LIMPIEZA_GROUP_WINDOW_MINUTES = Math.max(
    1,
    Number.parseInt(process.env.LIMPIEZA_GROUP_WINDOW_MINUTES || '30', 10) || 30
);
const LIMPIEZA_PLACEHOLDER_WINDOW_MINUTES = Math.max(
    1,
    Number.parseInt(process.env.LIMPIEZA_PLACEHOLDER_WINDOW_MINUTES || String(LIMPIEZA_GROUP_WINDOW_MINUTES), 10) || LIMPIEZA_GROUP_WINDOW_MINUTES
);


// =========================
// HANDLER LIMPIEZA
// =========================
// Acepta texto libre + fotos sin formato específico
// Ideal para reporte simple de labores de limpieza

async function manejarLimpieza({ message, chat, textoOriginal, nombreAutor, fecha }) {

    const personaPermitida = resolverPersonaMarcador(nombreAutor);
    if (!personaPermitida) {
        console.log('⏭️ LIMPIEZA ignorada: autor fuera del personal permitido =>', nombreAutor);
        return;
    }

    const autorCanonico = personaPermitida.nombre;

    console.log('\n🧹 LIMPIEZA');
    console.log('Descripción:', textoOriginal);

    const fechaArchivo  = fecha.format('YYYY-MM-DD');
    let rutaEvidencia   = '';
    let actividadId     = null;
    let evidenciaRelacionada = false;
    const descripcion   = (textoOriginal || '').trim();
    const huboReporte   = Boolean(descripcion);
    const huboEvidencia = Boolean(message.hasMedia);
    const clave         = claveMemoria(chat.name, message.author);

    // =========================
    // GUARDAR ACTIVIDAD
    // =========================

    if (descripcion) {

        actividadId = await obtenerUltimaActividadLimpiezaPorAutor({
            autor: autorCanonico,
            grupo: chat.name,
            fecha,
            maxMinutos: LIMPIEZA_GROUP_WINDOW_MINUTES
        });

        if (!actividadId) {
            actividadId = await guardarActividadLimpieza({
                fecha,
                autor:       autorCanonico,
                area:        'General',
                descripcion,
                grupo:       chat.name,
                tipoMensaje: message.type,
                mensajeId:   message.id._serialized
            });
        } else {
            console.log('🧠 Actividad de limpieza reutilizada por ventana/autor:', clave, '=>', actividadId);
        }

        if (actividadId) {
            ultimasLimpiezas[clave] = actividadId;
            console.log('🧠 Última limpieza:', clave, '=>', actividadId);
            logPersistencia({
                tabla: 'actividades_limpieza',
                id: actividadId,
                autor: autorCanonico,
                grupo: chat.name,
                mensajeId: message.id._serialized
            });
        }
    } else if (message.hasMedia) {
        actividadId = await obtenerUltimaActividadLimpiezaPorAutor({
            autor: autorCanonico,
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
        evidenciaRelacionada = true;

        console.log('✅ EVIDENCIA RELACIONADA');
    }

    if (rutaEvidencia && !actividadId) {
        actividadId = await obtenerUltimaActividadLimpiezaSinReportePorAutor({
            autor: autorCanonico,
            grupo: chat.name,
            fecha,
            maxMinutos: LIMPIEZA_PLACEHOLDER_WINDOW_MINUTES
        });

        if (actividadId) {
            ultimasLimpiezas[clave] = actividadId;
            console.log('🧠 Placeholder de limpieza reutilizado:', clave, '=>', actividadId);
        }
    }

    if (rutaEvidencia && actividadId && !evidenciaRelacionada) {
        await guardarEvidenciaLimpieza({
            actividadId,
            rutaEvidencia
        });
        evidenciaRelacionada = true;
        console.log('✅ EVIDENCIA RELACIONADA');
    }

    if (rutaEvidencia && !actividadId) {
        actividadId = await guardarActividadLimpieza({
            fecha,
            autor:       autorCanonico,
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
                autor: autorCanonico,
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
        autor: autorCanonico,
        grupo: chat.name,
        fuenteRegistro: 'AUTOMATICO',
        reportesIncremento: huboReporte ? 1 : 0,
        evidenciasIncremento: huboEvidencia ? 1 : 0
    });

    if (idAsistencia) {
        logPersistencia({
            tabla: 'asistencia_limpieza_diaria',
            id: idAsistencia,
            autor: autorCanonico,
            grupo: chat.name,
            mensajeId: message.id._serialized
        });
    }

}


module.exports = { manejarLimpieza };
