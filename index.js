const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const mime = require('mime-types');
const path = require('path');

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

    const chat = await message.getChat();

    if (chat.isGroup && chat.name === 'BITACORA - MTTO - SHP1') {

        const fecha = new Date().toISOString();

        const texto = `
====================================
FECHA: ${fecha}
GRUPO: ${chat.name}
AUTOR: ${message.author}

MENSAJE:
${message.body}
====================================

`;

        fs.appendFileSync('bitacora.txt', texto);

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
});

client.initialize();
