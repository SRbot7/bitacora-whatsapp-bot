const fs = require('fs');
const path = require('path');
const mime = require('mime-types');

const ROOT_DIR = path.join(__dirname, '..');

function asegurarDirectorio(directorio) {
    if (!fs.existsSync(directorio)) {
        fs.mkdirSync(directorio, {
            recursive: true
        });
    }
}

function guardarTextoBitacora({
    fecha,
    chatName,
    nombreAutor,
    turno,
    area,
    actividad,
    pendientes,
    tecnico,
    textoOriginal
}) {
    const fechaArchivo = fecha.format('YYYY-MM-DD');
    const carpetaBitacoras = path.join(ROOT_DIR, 'bitacoras');

    asegurarDirectorio(carpetaBitacoras);

    const archivoBitacora = path.join(
        carpetaBitacoras,
        `${fechaArchivo}.txt`
    );

    const textoTXT = `
====================================
FECHA: ${fecha.format('YYYY-MM-DD HH:mm:ss')}
GRUPO: ${chatName}
AUTOR: ${nombreAutor}

TURNO:
${turno}

AREA:
${area}

ACTIVIDADES:
${actividad}

PENDIENTES:
${pendientes}

TECNICO:
${tecnico}

MENSAJE ORIGINAL:
${textoOriginal}

====================================
`;

    fs.appendFileSync(archivoBitacora, textoTXT);

    return archivoBitacora;
}

async function guardarEvidencia(message, fechaArchivo, carpetaBase = 'evidencias_bitacora') {
    if (!message.hasMedia) {
        return '';
    }

    const media = await message.downloadMedia();

    if (!media) {
        return '';
    }

    const carpetaEvidencias = path.join(
        ROOT_DIR,
        carpetaBase,
        fechaArchivo
    );

    asegurarDirectorio(carpetaEvidencias);

    const extension = mime.extension(media.mimetype) || 'bin';
    const nombreArchivo = `${Date.now()}.${extension}`;
    const rutaEvidencia = path.join(carpetaEvidencias, nombreArchivo);

    fs.writeFileSync(
        rutaEvidencia,
        media.data,
        'base64'
    );

    return rutaEvidencia;
}

async function guardarActividad(pool, data) {
    if (data.grupo !== 'BITACORA-MTTO-SHP1') {
        console.log('⛔ Insert bloqueado en bitacora (grupo no BITACORA):', data.grupo);
        return null;
    }

    const resultado = await pool.query(
        `
        INSERT INTO bitacora
        (
            fecha,
            tecnico,
            area,
            actividad,
            pendientes,
            turno,
            mensaje_id,
            grupo,
            autor_numero,
            tipo_mensaje
        )

        VALUES
        (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
        )
        ON CONFLICT (mensaje_id)
        DO NOTHING

        RETURNING id
        `,
        [
            data.fecha.format('YYYY-MM-DD HH:mm:ss'),
            data.tecnico,
            data.area,
            data.actividad,
            data.pendientes,
            data.turno,
            data.mensajeId,
            data.grupo,
            data.autorNumero,
            data.tipoMensaje
        ]
    );

    if (resultado.rows.length > 0) {
        return resultado.rows[0].id;
    }

    return null;
}

async function relacionarEvidencia(
    pool,
    {
        actividadId,
        rutaEvidencia,
        tipoArchivo,
        mensajeId
    }
) {
    await pool.query(
        `
        INSERT INTO evidencias_mtto
        (
            actividad_id,
            ruta,
            tipo_archivo,
            nombre_archivo,
            mensaje_id
        )

        VALUES
        (
            $1,$2,$3,$4,$5
        )
        `,
        [
            actividadId,
            rutaEvidencia,
            tipoArchivo,
            path.basename(rutaEvidencia),
            mensajeId
        ]
    );
}

module.exports = {
    guardarTextoBitacora,
    guardarEvidencia,
    guardarActividad,
    relacionarEvidencia
};
