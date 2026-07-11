const { guardarEvidencia } = require('../lib/bitacora-storage');
const {
    guardarActividadLimpieza,
    guardarEvidenciaLimpieza,
    obtenerUltimaActividadLimpiezaPorAutor,
    obtenerUltimaActividadLimpiezaSinReportePorAutor
} = require('../services/limpieza');
const { resolverPersonaMarcador } = require('../services/limpieza-personal');
const {
    resolverRolYPersonaLimpieza,
    registrarPersonaLimpiezaSiNoExiste
} = require('../services/limpieza-roles');
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
    const personaRolActual = resolverRolYPersonaLimpieza(nombreAutor)
        || registrarPersonaLimpiezaSiNoExiste(nombreAutor)
        || { nombre: (nombreAutor || 'Sin nombre'), rol: 'SIN_CLASIFICAR' };
    const autorCanonico = personaPermitida?.nombre || personaRolActual.nombre;

    console.log('\n🧹 LIMPIEZA');
    console.log('Descripción:', textoOriginal);
    console.log('Rol catalogado:', personaRolActual.rol || 'SIN_CLASIFICAR');
    if (!personaPermitida) {
        console.log('ℹ️ LIMPIEZA autor sin catalogar, se registra como:', autorCanonico);
    }

    const fechaArchivo  = fecha.format('YYYY-MM-DD');
    let rutaEvidencia   = '';
    let actividadId     = null;
    let evidenciaRelacionada = false;
    const descripcion   = (textoOriginal || '').trim();
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

}


module.exports = { manejarLimpieza };
