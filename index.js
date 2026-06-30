require('dotenv').config();

const moment = require('moment-timezone');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const pool = require('./db');

const { obtenerTextoMensaje } = require('./lib/bitacora-parser');
const { manejarSupervisor }   = require('./handlers/supervisor');
const { manejarBitacora }     = require('./handlers/bitacora');
const { manejarLimpieza }     = require('./handlers/limpieza');
const { manejarMantenimiento } = require('./handlers/mantenimiento');
const { manejarPreventivos }   = require('./handlers/preventivos');
const {
    obtenerAlertasAsistenciaLimpieza,
    obtenerAlertasAsistenciaIngenieria
} = require('./services/alertas-asistencia');
const {
    obtenerResumenOperativo,
    construirMensajeResumenOperativo
} = require('./services/reportes');



// =========================
// GRUPOS ACEPTADOS
// =========================

const GRUPOS = {
    'BITACORA-MTTO-SHP1':                'BITACORA',
    'Mantenimiento SHP1':                'MANTENIMIENTO_FALLAS',
    'MELI SVC PACHUCA - BATIA LIMPIEZA': 'LIMPIEZA',
    'Asistencia SHP1 Pachuca':           'MANTENIMIENTO_ASISTENCIA',
    'Órdenes preventivas semanales':     'PREVENTIVO',
    'Centro Operativo SHP1':             'SUPERVISOR'
};

const HORARIOS_REPORTE = ['06:30', '15:30', '22:30'];
const COMANDOS_REPORTE = ['REPORTE', 'RESUMEN', 'REPORTE OPERATIVO', 'RESUMEN OPERATIVO'];
const AUTO_REPORTES_ACTIVOS = (process.env.AUTO_REPORTES_ACTIVOS || 'false').toLowerCase() === 'true';
const ALERTAS_ASISTENCIA_ACTIVAS = (process.env.ALERTAS_ASISTENCIA_ACTIVAS || 'true').toLowerCase() === 'true';
const GRUPO_ALERTAS_SUPERVISOR = 'Centro Operativo SHP1';

let schedulerReportesId = null;
const reporteEnviadoHoy = {};
const alertaAsistenciaEnviada = {};

function normalizarComando(texto = '') {
    return texto
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

async function revisarAlertasAsistencia({ clientRef }) {
    if (!ALERTAS_ASISTENCIA_ACTIVAS) {
        return;
    }

    const chatSupervisor = await obtenerChatSupervisor(clientRef);

    if (!chatSupervisor) {
        return;
    }

    if (!chatSupervisor.isGroup || chatSupervisor.name !== GRUPO_ALERTAS_SUPERVISOR) {
        console.log('⏸️ Alertas no enviadas: destino fuera del grupo permitido.');
        return;
    }

    const [alertasLimpiezaRes, alertasIngenieriaRes] = await Promise.allSettled([
        obtenerAlertasAsistenciaLimpieza(pool),
        obtenerAlertasAsistenciaIngenieria(pool)
    ]);

    if (alertasLimpiezaRes.status === 'rejected') {
        console.error('⚠️ Error obteniendo alertas de limpieza:', alertasLimpiezaRes.reason);
    }

    if (alertasIngenieriaRes.status === 'rejected') {
        console.error('⚠️ Error obteniendo alertas de ingenieria:', alertasIngenieriaRes.reason);
    }

    const alertasLimpieza = alertasLimpiezaRes.status === 'fulfilled'
        ? alertasLimpiezaRes.value
        : { items: [] };
    const alertasIngenieria = alertasIngenieriaRes.status === 'fulfilled'
        ? alertasIngenieriaRes.value
        : { items: [] };

    const alertas = [
        ...(alertasLimpieza.items || []),
        ...(alertasIngenieria.items || [])
    ];

    for (const alerta of alertas) {
        const claveAlerta = `${alerta.etiqueta || 'OPERATIVA'}_${alerta.key}_${alerta.enAlertaDesde}`;
        if (alertaAsistenciaEnviada[claveAlerta]) {
            continue;
        }

        const mensaje = [
            `🚨 ALERTA ASISTENCIA ${alerta.etiqueta || 'OPERATIVA'}`,
            `Personal: ${alerta.persona}`,
            `Turno: ${alerta.turnoInicio} - ${alerta.turnoFin}`,
            `Grupo esperado: ${alerta.grupo}`,
            `Estatus: Sin evidencia de actividad despues de ${alerta.toleranciaMin} minutos. Se considera falta operativa.`
        ].join('\n');

        await chatSupervisor.sendMessage(mensaje);
        alertaAsistenciaEnviada[claveAlerta] = true;
        console.log('🚨 Alerta de asistencia enviada:', claveAlerta);
    }
}

async function obtenerChatSupervisor(clientRef) {
    const chats = await clientRef.getChats();
    return chats.find((chat) => chat.isGroup && chat.name === GRUPO_ALERTAS_SUPERVISOR);
}

async function enviarResumenOperativo({ clientRef, tipo }) {
    const fechaMx = moment().tz('America/Mexico_City');
    const inicioDia = fechaMx.clone().startOf('day').format('YYYY-MM-DD HH:mm:ss');
    const finDia = fechaMx.clone().endOf('day').format('YYYY-MM-DD HH:mm:ss');

    const resumen = await obtenerResumenOperativo({ inicioDia, finDia });
    const mensaje = construirMensajeResumenOperativo({
        momento: fechaMx,
        resumen,
        tipo
    });

    const chatSupervisor = await obtenerChatSupervisor(clientRef);

    if (!chatSupervisor) {
        console.log('⚠️ No se encontro el grupo Centro Operativo SHP1 para enviar reporte.');
        return false;
    }

    await chatSupervisor.sendMessage(mensaje);
    return true;
}

function iniciarSchedulerReportes(clientRef) {
    if (schedulerReportesId) {
        clearInterval(schedulerReportesId);
        schedulerReportesId = null;
    }

    if (!AUTO_REPORTES_ACTIVOS) {
        console.log('⏸️ Reportes automaticos desactivados (AUTO_REPORTES_ACTIVOS=false).');
    }

    schedulerReportesId = setInterval(async () => {
        try {
            await revisarAlertasAsistencia({ clientRef });

            if (!AUTO_REPORTES_ACTIVOS) {
                return;
            }

            const ahoraMx = moment().tz('America/Mexico_City');
            const horaMin = ahoraMx.format('HH:mm');

            if (!HORARIOS_REPORTE.includes(horaMin)) {
                return;
            }

            const clave = `${ahoraMx.format('YYYY-MM-DD')}_${horaMin}`;
            if (reporteEnviadoHoy[clave]) {
                return;
            }

            const enviado = await enviarResumenOperativo({
                clientRef,
                tipo: 'AUTO'
            });

            if (enviado) {
                reporteEnviadoHoy[clave] = true;
                console.log('📤 Reporte operativo automatico enviado:', clave);
            }
        } catch (error) {
            console.error('❌ Error enviando reporte automatico:', error);
        }
    }, 30 * 1000);
}


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
    iniciarSchedulerReportes(client);
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

        const textoOriginal = obtenerTextoMensaje(message);

        // =========================
        // VALIDACIONES BASICAS
        // =========================

        if (!textoOriginal.trim() && !message.hasMedia && message.type !== 'location') return;

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

        if (
            tipoFuente !== 'BITACORA' &&
            tipoFuente !== 'SUPERVISOR' &&
            tipoFuente !== 'LIMPIEZA' &&
            tipoFuente !== 'MANTENIMIENTO_FALLAS' &&
            tipoFuente !== 'MANTENIMIENTO_ASISTENCIA' &&
            tipoFuente !== 'PREVENTIVO'
        ) return;

        // =========================
        // EXTRAER TEXTO
        // =========================

        const comando = normalizarComando(textoOriginal);

        if (!textoOriginal.trim() && !message.hasMedia && message.type !== 'location') return;

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
        if (textoOriginal.trim()) {
            console.log('TEXTO:', textoOriginal.replace(/\s+/g, ' ').slice(0, 280));
        }

        if (
            tipoFuente === 'SUPERVISOR' &&
            !message.hasMedia &&
            COMANDOS_REPORTE.includes(comando)
        ) {
            const enviado = await enviarResumenOperativo({
                clientRef: client,
                tipo: 'MANUAL'
            });

            if (!enviado) {
                await message.reply('⚠️ No se pudo enviar el reporte al grupo de operaciones.');
            }

            return;
        }

        // =========================
        // ROUTER
        // =========================

        if (tipoFuente === 'SUPERVISOR') {
            if (message.hasMedia) {
                const intentoPreventivo = await manejarPreventivos({
                    message,
                    chat,
                    textoOriginal,
                    nombreAutor,
                    fecha,
                    permitirFallbackEtiqueta: true
                });

                if (intentoPreventivo?.registrado) {
                    console.log('✅ Preventivo detectado desde Centro Operativo y guardado.');
                    return;
                }
            }

            await manejarSupervisor({ message, chat, textoOriginal, nombreAutor, fecha });
        }
        else if (tipoFuente === 'BITACORA') {
            await manejarBitacora({ message, chat, textoOriginal, nombreAutor, fecha });
        }
        else if (tipoFuente === 'LIMPIEZA') {
            await manejarLimpieza({ message, chat, textoOriginal, nombreAutor, fecha });
        }
        else if (tipoFuente === 'MANTENIMIENTO_FALLAS' || tipoFuente === 'MANTENIMIENTO_ASISTENCIA') {
            await manejarMantenimiento({
                message,
                chat,
                textoOriginal,
                nombreAutor,
                fecha,
                tipoFuente
            });
        }
        else if (tipoFuente === 'PREVENTIVO') {
            await manejarPreventivos({ message, chat, textoOriginal, nombreAutor, fecha });
        }

    } catch (error) {
        console.error('\n❌ ERROR GENERAL:\n', error);
    }

});


// =========================
// INICIAR
// =========================

client.initialize();
