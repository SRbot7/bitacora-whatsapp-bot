require('dotenv').config();

const moment = require('moment-timezone');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const { obtenerTextoMensaje } = require('./lib/bitacora-parser');
const { manejarSupervisor }   = require('./handlers/supervisor');
const { manejarBitacora }     = require('./handlers/bitacora');
const { manejarLimpieza }     = require('./handlers/limpieza');



// =========================
// GRUPOS ACEPTADOS
// =========================

const GRUPOS = {
    'BITACORA-MTTO-SHP1':                'BITACORA',
    'Mantenimiento SHP1':                'INCIDENTE',
    'MELI SVC PACHUCA - BATIA LIMPIEZA': 'LIMPIEZA',
    'Órdenes preventivas semanales':     'PREVENTIVO',
    'Centro Operativo SHP1':             'SUPERVISOR'
};


// =========================
// CLIENTE WHATSAPP
// =========================

const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'bitacora-mtto' }),
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
    qrcode.generate(qr, { small: true });
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
    console.log(`Cargando ${percent}% - ${message}`);
});


// =========================
// READY
// =========================

client.on('ready', async () => {
    console.log('\n🚀 BOT LISTO\n');
    const version = await client.getWWebVersion();
    console.log('Version WhatsApp:', version);
});


// =========================
// DESCONECTADO
// =========================

client.on('disconnected', (reason) => {
    console.log('\n⚠️ Cliente desconectado:', reason);
});


// =========================
// MENSAJES
// =========================

client.on('message_create', async (message) => {

    try {

        // =========================
        // VALIDACIONES BASICAS
        // =========================

        if (!message.body && !message.hasMedia) return;

        if (!message.id || !message.id._serialized) {
            console.log('⚠️ Mensaje sin ID');
            return;
        }

        // =========================
        // CHAT Y GRUPO
        // =========================

        const chat = await message.getChat();

        if (!chat.isGroup) return;

        const tipoFuente = GRUPOS[chat.name];

        if (!tipoFuente) return;

        // =========================
        // SOLO BITACORA, SUPERVISOR Y LIMPIEZA
        // =========================

        if (tipoFuente !== 'BITACORA' && tipoFuente !== 'SUPERVISOR' && tipoFuente !== 'LIMPIEZA') return;

        // =========================
        // EXTRAER TEXTO
        // =========================

        const textoOriginal = obtenerTextoMensaje(message);

        if (!textoOriginal.trim() && !message.hasMedia) return;

        // =========================
        // DATOS BASICOS
        // =========================

        const fecha       = moment().tz('America/Mexico_City');
        const nombreAutor = message._data.notifyName || message.author || 'Sin nombre';

        console.log('\n====================');
        console.log('📥 NUEVO MENSAJE');
        console.log('GRUPO:', chat.name);
        console.log('TIPO:', tipoFuente);
        console.log('AUTOR:', nombreAutor);
        console.log({ tipoMensaje: message.type, mensajeId: message.id._serialized, fromMe: message.fromMe });

        // =========================
        // ROUTER
        // =========================

        if (tipoFuente === 'SUPERVISOR') {
            await manejarSupervisor({ message, chat, textoOriginal, nombreAutor, fecha });
        }
        else if (tipoFuente === 'BITACORA') {
            await manejarBitacora({ message, chat, textoOriginal, nombreAutor, fecha });
        }
        else if (tipoFuente === 'LIMPIEZA') {
            await manejarLimpieza({ message, chat, textoOriginal, nombreAutor, fecha });
        }

    } catch (error) {
        console.error('\n❌ ERROR GENERAL:\n', error);
    }

});


// =========================
// INICIAR
// =========================

client.initialize();
