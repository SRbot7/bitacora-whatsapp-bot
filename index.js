const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const mime = require('mime-types');
const path = require('path');
const pool = require('./db');

const client = new Client({
    authStrategy: new LocalAuth(),

    puppeteer: {
        headless: true,
        executablePath: '/snap/bin/chromium',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ]
    }
});

client.on('qr', (qr) => {
    console.log('ESCANEA ESTE QR:\n');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ BOT LISTO');
});

client.on('message_create', async message => {

    try {

        const chat = await message.getChat();

        const nombreAutor =
            message._data.notifyName ||
            message.author;

        // SOLO EL GRUPO DE BITÁCORA
        if (chat.isGroup && chat.name === 'BITACORA - MTTO - SHP1') {

            const fecha = new Date().toISOString();

            // TEXTO ORIGINAL
            const textoOriginal = message.body;

            // DETECTAR ÁREA
            let area = 'Sin área';

            const matchArea = textoOriginal.match(/área:\s*(.*)/i);

            if (matchArea) {
                area = matchArea[1].trim();
            }

            // FORMATO TXT
            const texto = `
====================================
FECHA: ${fecha}
GRUPO: ${chat.name}
AUTOR: ${nombreAutor}

MENSAJE:
${textoOriginal}
====================================

`;

            // GUARDAR TXT
            const fechaArchivo = new Date().toISOString().split('T')[0];

            const carpetaBitacoras = 'bitacoras';

            if (!fs.existsSync(carpetaBitacoras)) {
                fs.mkdirSync(carpetaBitacoras, { recursive: true });
            }

            const archivoBitacora = `${carpetaBitacoras}/${fechaArchivo}.txt`;

            fs.appendFileSync(archivoBitacora, texto);

            // GUARDAR EN POSTGRESQL
            await pool.query(
                `INSERT INTO actividades_mtto 
                (fecha, tecnico, area, actividad, pendientes, evidencia, turno)
                
                VALUES ($1, $2, $3, $4, $5, $6, $7)`,

                [
                    new Date(),
                    nombreAutor,
                    area,
                    textoOriginal,
                    '',
                    '',
                    'Turno 1'
                ]
            );

            console.log('✅ Guardado en PostgreSQL');

            console.log('Mensaje guardado');

            // DESCARGAR EVIDENCIAS
            if (message.hasMedia) {

                const media = await message.downloadMedia();

                if (media) {

                    const fechaCarpeta = new Date().toISOString().split('T')[0];

                    const carpeta = `evidencias/${fechaCarpeta}`;

                    if (!fs.existsSync(carpeta)) {
                        fs.mkdirSync(carpeta, { recursive: true });
                    }

                    const extension = mime.extension(media.mimetype);

                    const nombreArchivo = `${Date.now()}.${extension}`;

                    const rutaArchivo = path.join(carpeta, nombreArchivo);

                    fs.writeFileSync(rutaArchivo, media.data, 'base64');

                    console.log('📸 Evidencia guardada:', rutaArchivo);
                }
            }
        }

    } catch (error) {

        console.error('❌ ERROR:', error);

    }

});

client.initialize();