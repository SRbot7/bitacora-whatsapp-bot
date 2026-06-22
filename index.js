require('dotenv').config();

const moment = require('moment-timezone');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const mime = require('mime-types');
const path = require('path');
const pool = require('./db');



// =========================
// MEMORIA TEMPORAL
// =========================

const ultimasActividades = {};





// =========================
// CLIENTE WHATSAPP
// =========================

const client = new Client({

    authStrategy: new LocalAuth({

        clientId: 'bitacora-mtto'

    }),

    puppeteer: {

        headless: true,

        executablePath: '/usr/bin/google-chrome',

        args: [

            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
            '--no-zygote'

        ]
    }
});


// =========================
// QR
// =========================

client.on('qr', (qr) => {

    console.log('\n====================');
    console.log('ESCANEA ESTE QR');
    console.log('====================\n');

    qrcode.generate(qr, {
        small: true
    });

});


// =========================
// AUTH
// =========================

client.on('authenticated', () => {

    console.log('\n✅ WHATSAPP AUTENTICADO\n');

});


// =========================
// AUTH FAILURE
// =========================

client.on('auth_failure', (msg) => {

    console.log('\n❌ ERROR AUTH:\n', msg);

});


// =========================
// LOADING
// =========================

client.on('loading_screen', (percent, message) => {

    console.log(
        `Cargando ${percent}% - ${message}`
    );

});


// =========================
// READY
// =========================

client.on('ready', async () => {

    console.log('\n🚀 BOT LISTO\n');

    const version =
        await client.getWWebVersion();

    console.log(
        'Version WhatsApp:',
        version
    );

});


// =========================
// DESCONECTADO
// =========================

client.on('disconnected', (reason) => {

    console.log(
        '\n⚠️ Cliente desconectado:',
        reason
    );

});


// =========================
// FUNCION EXTRAER CAMPOS
// =========================

function extraerCampo(
    regex,
    texto,
    valorDefault = ''
) {

    const match = texto.match(regex);

    if (
        match &&
        match[1]
    ) {
        return match[1].trim();
    }

    return valorDefault;
}


// =========================
// MENSAJES
// =========================

client.on('message_create', async (message) => {

    try {

        // =========================
        // IGNORAR MENSAJES VACIOS
        // =========================

        if (
            !message.body &&
            !message.hasMedia
        ) {
            return;
        }

        // =========================
        // VALIDAR MESSAGE ID
        // =========================

        if (
            !message.id ||
            !message.id._serialized
        ) {

            console.log(
                '⚠️ Mensaje sin ID'
            );

            return;
        }

        // =========================
        // CHAT
        // =========================

        const chat = await message.getChat();

        // =========================
        // SOLO GRUPOS
        // =========================

        if (!chat.isGroup) {
            return;
        }

        // =========================
        // ROUTER DE GRUPOS
        // =========================

        const grupo = chat.name;

        let tipoFuente = null;

        if (
            grupo === 'BITACORA-MTTO-SHP1'
        ) {

            tipoFuente = 'BITACORA';

        }
        else if (
            grupo === 'Mantenimiento SHP1'
        ) {

            tipoFuente = 'INCIDENTE';

        }
        else if (
            grupo === 'MELI SVC PACHUCA - BATIA LIMPIEZA'
        ) {

            tipoFuente = 'LIMPIEZA';

        }
        else if (
            grupo === 'Órdenes preventivas semanales'
        ) {

            tipoFuente = 'PREVENTIVO';

        }

        if (

            grupo !== 'BITACORA-MTTO-SHP1' &&

            grupo !== 'Mantenimiento SHP1' &&

            grupo !== 'MELI SVC PACHUCA - BATIA LIMPIEZA' &&

            grupo !== 'Órdenes preventivas semanales'

        ) {

            return;

        }

        console.log(
            'TIPO FUENTE:',
            tipoFuente
        );

        console.log(
            '\n===================='
        );

        console.log(
            '📥 NUEVO MENSAJE'
        );

        console.log(
            'GRUPO:',
            chat.name
        );

        // =========================
        // DEBUG
        // =========================

        console.log({

            grupo: chat.name,

            tipoMensaje: message.type,

            mensajeId: message.id._serialized,

            fromMe: message.fromMe

        });

        // =========================
        // DATOS BASICOS
        // =========================

        const fecha =
            moment().tz('America/Mexico_City');

        const nombreAutor =
            message._data.notifyName ||
            message.author ||
            'Sin nombre';

        // =========================
// EXTRAER TEXTO REAL
// =========================

let textoOriginal = '';

// TEXTO NORMAL
if (message.body) {

    textoOriginal = message.body;
}

// IMAGEN CON CAPTION
if (
    !textoOriginal &&
    message.hasMedia &&
    message._data &&
    message._data.caption
) {

    textoOriginal =
        message._data.caption;
}

// DEBUG
console.log('\nTEXTO DETECTADO:\n');

console.log(textoOriginal);

console.log(
    'MEDIA GROUP:',
    message._data.mediaGroupId
);

// SI SIGUE VACIO
if (
    !textoOriginal.trim() &&
    !message.hasMedia
) {

    console.log(
        '⚠️ Mensaje vacio'
    );

    return;
}

        console.log(
            '\nMENSAJE:\n'
        );

        console.log(textoOriginal);

        // =========================
        // SOLO BITACORA POR AHORA
        // =========================

        if (grupo !== 'BITACORA-MTTO-SHP1') {

            console.log(
                '⏭️ Grupo pendiente de implementar:',
                grupo
            );

            return;
        }

        // =========================
        // PARSER
        // =========================

        // =========================
        // NORMALIZAR TEXTO
        // =========================

        const textoLimpio = textoOriginal
            .replace(/\r/g, '')
            .trim();

// =========================
// TURNO
// =========================

const turnoMatch =
    textoLimpio.match(
        /bit[aá]cora\s*turno\s*:?\s*(\d+)/i
    );

const turno =
    turnoMatch
        ? turnoMatch[1]
        : 'Sin turno';

// =========================
// AREA
// =========================

const areaMatch =
    textoLimpio.match(
        /[aá]rea\s*:?\s*([^\n]+)/i
    );

const area =
    areaMatch
        ? areaMatch[1].trim()
        : 'Sin area';

// =========================
// TECNICO
// =========================

const tecnicoMatch =
    textoLimpio.match(
        /t[eé]cnico\s*:?\s*([^\n]+)/i
    );

const tecnico =
    tecnicoMatch
        ? tecnicoMatch[1].trim()
        : nombreAutor;

// =========================
// PENDIENTES
// =========================

const pendientesMatch =
    textoLimpio.match(
        /pendientes\s*:?\s*([\s\S]*)/i
    );

const pendientes =
    pendientesMatch
        ? pendientesMatch[1]
            .replace(
                /t[eé]cnico\s*:.*$/is,
                ''
            )
            .trim()
        : 'Sin pendientes';

// =========================
// ACTIVIDADES
// =========================

let actividad = '';

const actividadMatch =
    textoLimpio.match(

        /(?:[aá]rea\s*:?[^\n]*)([\s\S]*?)(?:pendientes\s*:|t[eé]cnico\s*:|$)/i
    );

if (actividadMatch) {

    actividad =
        actividadMatch[1]

        // Elimina el encabezado "Actividades:"
        .replace(
            /^\s*actividades?\s*:?\s*/i,
            ''
        )

        // Limpia espacios al inicio de cada línea
        .replace(
            /^\s+/gm,
            ''
        )

        .trim();
}

// =========================
// LOGS
// =========================

console.log('\nDATOS EXTRAIDOS:\n');

console.log('Turno:', turno);

console.log('Area:', area);

console.log('Tecnico:', tecnico);

console.log('Actividad:', actividad);

console.log('Pendientes:', pendientes);

        // =========================
        // TXT
        // =========================

        const fechaArchivo =
            fecha.format('YYYY-MM-DD');

        const carpetaBitacoras =
            'bitacoras';

        if (
            !fs.existsSync(
                carpetaBitacoras
            )
        ) {

            fs.mkdirSync(
                carpetaBitacoras,
                {
                    recursive: true
                }
            );
        }

        const archivoBitacora =
            `${carpetaBitacoras}/${fechaArchivo}.txt`;

        const textoTXT = `

====================================
FECHA: ${fecha.format('YYYY-MM-DD HH:mm:ss')}
GRUPO: ${chat.name}
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

        fs.appendFileSync(
            archivoBitacora,
            textoTXT
        );

        console.log(
            '\n📄 TXT GUARDADO'
        );

        // =========================
        // EVIDENCIAS
        // =========================

        let rutaEvidencia = '';
        let actividadId = null;

        if (message.hasMedia) {

            console.log(
                '\n📥 Descargando evidencia...'
            );

            const media =
                await message.downloadMedia();

            if (media) {

                const carpeta =
                    `evidencias/${fechaArchivo}`;

                if (
                    !fs.existsSync(
                        carpeta
                    )
                ) {

                    fs.mkdirSync(
                        carpeta,
                        {
                            recursive: true
                        }
                    );
                }

                const extension =
                    mime.extension(
                        media.mimetype
                    );

                const nombreArchivo =
                    `${Date.now()}.${extension}`;

                rutaEvidencia =
                    path.join(
                        carpeta,
                        nombreArchivo
                    );

                fs.writeFileSync(
                    rutaEvidencia,
                    media.data,
                    'base64'
                );

                console.log(
                    '✅ Evidencia guardada:',
                    rutaEvidencia
                );
            }
        }




        // =========================
        // POSTGRESQL
        // =========================

        /*const resultado = await pool.query(

            `
            INSERT INTO actividades_mtto
            (
                fecha,
                tecnico,
                area,
                actividad,
                pendientes,
                evidencia,
                turno,
                mensaje_id,
                grupo,
                autor_numero,
                tipo_mensaje
            )

            VALUES
            (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
            )

            ON CONFLICT (mensaje_id)
            DO NOTHING
            `,

            [
                fecha.format(
                    'YYYY-MM-DD HH:mm:ss'
                ),

                tecnico,

                area,

                actividad,

                pendientes,

                rutaEvidencia,

                turno,

                message.id._serialized,

                chat.name,

                message.author || '',

                message.type
            ]
        );

        console.log(
            '\n✅ GUARDADO EN POSTGRESQL'
        );

        console.log(
            'Rows insertadas:',
            resultado.rowCount
        ); */


// =========================
// CREAR ACTIVIDAD
// =========================

if (textoOriginal.trim()) {

    const resultado =
        await pool.query(

            `
            INSERT INTO actividades_mtto
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
                fecha.format(
                    'YYYY-MM-DD HH:mm:ss'
                ),

                tecnico,

                area,

                actividad,

                pendientes,

                turno,

                message.id._serialized,

                chat.name,

                message.author || '',

                message.type
            ]
        );

    if (
        resultado.rows.length > 0
    ) {

        actividadId =
            resultado.rows[0].id;

            const claveActividad =
    `${chat.name}_${message.author || ''}`;

ultimasActividades[
    claveActividad
] = actividadId;

console.log(
    '🧠 Última actividad:',
    claveActividad,
    '=>',
    actividadId
);


        console.log(
            '\n✅ ACTIVIDAD GUARDADA'
        );

        console.log(
            'Actividad ID:',
            actividadId
        );
        
    }
}






// =========================
// GUARDAR EVIDENCIA
// =========================

if (
    !actividadId &&
    rutaEvidencia
) {

    const claveActividad =
        `${chat.name}_${message.author || ''}`;

    actividadId =
        ultimasActividades[
            claveActividad
        ];

    console.log(
        '🔎 Actividad recuperada:',
        actividadId
    );
}



if (
    rutaEvidencia &&
    actividadId
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

            message.type,

            path.basename(
                rutaEvidencia
            ),

            message.id._serialized
        ]
    );

    console.log(
        '✅ EVIDENCIA RELACIONADA'
    );
}



}catch (error) {

        console.error(
            '\n❌ ERROR GENERAL:\n',
            error
        );

    }

});


// =========================
// INICIAR
// =========================

client.initialize();