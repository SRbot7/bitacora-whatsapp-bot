const moment = require('moment-timezone');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const pool = require('./db');
const {
    obtenerTextoMensaje,
    extraerDatosBitacora
} = require('./lib/bitacora-parser');
const {
    guardarTextoBitacora,
    guardarEvidencia,
    guardarActividad,
    relacionarEvidencia
} = require('./lib/bitacora-storage');

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
        // Ignoramos mensajes vacíos o eventos sin contenido útil.
        const textoOriginal = obtenerTextoMensaje(message);

        if (
            !textoOriginal.trim() &&
            !message.hasMedia
        ) {
            return;
        }

        if (
            !message.id ||
            !message.id._serialized
        ) {
            console.log('⚠️ Mensaje sin ID');
            return;
        }

        const chat = await message.getChat();

        if (!chat.isGroup) {
            return;
        }

        if (
            !chat.name
                .toUpperCase()
                .includes('BITACORA')
        ) {
            return;
        }

        console.log('\n====================');
        console.log('📥 NUEVO MENSAJE');
        console.log('GRUPO:', chat.name);

        // Datos base del mensaje antes de normalizar el contenido.
        const fecha = moment().tz('America/Mexico_City');
        const nombreAutor =
            message._data.notifyName ||
            message.author ||
            'Sin nombre';

        console.log({
            grupo: chat.name,
            tipoMensaje: message.type,
            mensajeId: message.id._serialized,
            fromMe: message.fromMe
        });

        console.log('\nTEXTO DETECTADO:\n');
        console.log(textoOriginal);
        console.log('MEDIA GROUP:', message._data.mediaGroupId);

        const {
            textoLimpio,
            turno,
            area,
            tecnico,
            pendientes,
            actividad
        } = extraerDatosBitacora(textoOriginal, nombreAutor);

        console.log('\nDATOS EXTRAIDOS:\n');
        console.log('Texto limpio:', textoLimpio);
        console.log('Turno:', turno);
        console.log('Area:', area);
        console.log('Tecnico:', tecnico);
        console.log('Actividad:', actividad);
        console.log('Pendientes:', pendientes);

        const fechaArchivo = fecha.format('YYYY-MM-DD');

        const archivoBitacora = guardarTextoBitacora({
            fecha,
            chatName: chat.name,
            nombreAutor,
            turno,
            area,
            actividad,
            pendientes,
            tecnico,
            textoOriginal
        });

        console.log('\n📄 TXT GUARDADO:', archivoBitacora);

        let rutaEvidencia = '';
        let actividadId = null;

        if (message.hasMedia) {
            console.log('\n📥 Descargando evidencia...');

            rutaEvidencia = await guardarEvidencia(
                message,
                fechaArchivo
            );

            if (rutaEvidencia) {
                console.log('✅ Evidencia guardada:', rutaEvidencia);
            }
        }

        if (textoOriginal.trim()) {
            actividadId = await guardarActividad(pool, {
                fecha,
                tecnico,
                area,
                actividad,
                pendientes,
                turno,
                mensajeId: message.id._serialized,
                grupo: chat.name,
                autorNumero: message.author || '',
                tipoMensaje: message.type
            });

            if (actividadId) {
                console.log('\n✅ ACTIVIDAD GUARDADA');
                console.log('Actividad ID:', actividadId);
            }
        }

        if (
            rutaEvidencia &&
            actividadId
        ) {
            await relacionarEvidencia(pool, {
                actividadId,
                rutaEvidencia,
                tipoArchivo: message.type,
                mensajeId: message.id._serialized
            });

            console.log('✅ EVIDENCIA RELACIONADA');
        }
    } catch (error) {
        console.error('\n❌ ERROR GENERAL:\n', error);
    }
});

// =========================
// INICIAR
// =========================

client.initialize();

module.exports = client;
