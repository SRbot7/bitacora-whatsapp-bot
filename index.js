const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');

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

    console.log('GRUPO DETECTADO:', chat.name);
    // SOLO grupos
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
    }
});

client.initialize();

