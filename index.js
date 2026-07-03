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
const {
    sincronizarEstadosAsistencia
} = require('./services/estado-asistencia');

function normalizarNombreGrupo(nombre = '') {
    return nombre
        .toString()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}



// =========================
// GRUPOS ACEPTADOS
// =========================

const GRUPOS = {
    [normalizarNombreGrupo('BITACORA-MTTO-SHP1')]:                'BITACORA',
    [normalizarNombreGrupo('Centro Operativo SHP1')]:             'SUPERVISOR',
    [normalizarNombreGrupo('MELI SVC PACHUCA - BATIA LIMPIEZA')]: 'LIMPIEZA',
    [normalizarNombreGrupo('Asistencia SHP1 Pachuca')]:           'MANTENIMIENTO_ASISTENCIA'
};

const GRUPOS_BLOQUEADOS = new Set([
    normalizarNombreGrupo('Mantenimiento SHP1')
]);

const HORARIOS_REPORTE = ['06:30', '15:30', '22:30'];
const COMANDOS_REPORTE = ['REPORTE', 'RESUMEN', 'REPORTE OPERATIVO', 'RESUMEN OPERATIVO'];
const AUTO_REPORTES_ACTIVOS = (process.env.AUTO_REPORTES_ACTIVOS || 'false').toLowerCase() === 'true';
const ALERTAS_ASISTENCIA_ACTIVAS = (process.env.ALERTAS_ASISTENCIA_ACTIVAS || 'true').toLowerCase() === 'true';
const ESTADOS_ASISTENCIA_SYNC_MINUTES = Math.max(1, Number.parseInt(process.env.ESTADOS_ASISTENCIA_SYNC_MINUTES || '5', 10) || 5);
const GRUPO_ALERTAS_SUPERVISOR = 'Centro Operativo SHP1';
const MODO_SOLO_LECTURA_GRUPOS = true;
const GRUPOS_SALIDA_HABILITADA = new Set([
    normalizarNombreGrupo('BITACORA-MTTO-SHP1'),
    normalizarNombreGrupo('Centro Operativo SHP1')
]);
const COMANDOS_CONTROL_BOT = new Set([
    'BOT STOP', 'BOT PAUSA',
    'BOT START', 'BOT REANUDAR',
    'BOT RESET',
    'BOT STATUS', 'BOT ESTADO'
]);

let schedulerReportesId = null;
let schedulerEstadosAsistenciaId = null;
const reporteEnviadoHoy = {};
const alertaAsistenciaEnviada = {};
let botPausado = false;
let botPausadoAt = null;
let botPausadoPor = '';

function normalizarComando(texto = '') {
    return texto
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function esSolicitudPreventivoEnSupervisor(texto = '') {
    const comando = normalizarComando(texto);
    const comandoCompacto = comando.replace(/\s+/g, '');
    if (!comando) {
        return false;
    }

    return (
        comando.startsWith('PREVENTIVO:') ||
        comando.startsWith('PREVENTIVO ') ||
        comando.includes('ORDEN PREVENTIVA') ||
        comando.includes('PREVENTIVO SEMANAL') ||
        comando.startsWith('OP SHP1') ||
        comandoCompacto.startsWith('OPSHP1')
    );
}

function esEntradaOperativaSupervisorDesdePropio(texto = '') {
    const comando = normalizarComando(texto);
    if (!comando) {
        return false;
    }

    const comandosDirectos = new Set([
        'ASISTENCIA', 'EN SITIO',
        'ASISTENCIA HOY', 'EN TURNO',
        'MARCADOR', 'MARCADOR ASISTENCIA', 'RESUMEN ASISTENCIA',
        'BOT STOP', 'BOT PAUSA', 'BOT START', 'BOT REANUDAR', 'BOT RESET', 'BOT STATUS', 'BOT ESTADO',
        'AYUDA', 'AYUDA GUIADA', 'GUIA AYUDA', 'AYUDA RAPIDA',
        'LISTAR', 'ABIERTOS', 'CERRADOS',
        'PREVENTIVOS', 'ALERTAS', 'ALERTAS ASISTENCIA',
        'REPORTE', 'RESUMEN', 'REPORTE OPERATIVO', 'RESUMEN OPERATIVO',
        'CANCELAR', 'SALIR',
        '1', '2',
        'LIMPIEZA', 'MTTO', 'MANTENIMIENTO'
    ]);

    if (comandosDirectos.has(comando)) {
        return true;
    }

    // Comandos de presencia/falta
    if (/^MARCAR\s+PRESENTE\s*:/i.test(texto) || /^REGISTRAR\s+FALTA\s*:/i.test(texto)) {
        return true;
    }

    // Opciones numericas de menus guiados (ej. 1, 2, 3, ...).
    if (/^\d{1,2}$/.test(comando)) {
        return true;
    }

    // Seleccion de persona en flujo guiado: una sola linea, sin emojis ni saltos.
    return /^[A-Z0-9 .'-]{2,60}$/.test(comando);
}

function obtenerComandoControlBot(texto = '') {
    const comando = normalizarComando(texto);
    if (!comando) {
        return '';
    }

    return COMANDOS_CONTROL_BOT.has(comando) ? comando : '';
}

function limpiarMapeo(obj) {
    Object.keys(obj).forEach((key) => {
        delete obj[key];
    });
}

async function manejarComandoControlBot({ comando, chat, nombreAutor, clientRef }) {
    const nowMx = moment().tz('America/Mexico_City').format('YYYY-MM-DD HH:mm:ss');

    if (comando === 'BOT STOP' || comando === 'BOT PAUSA') {
        botPausado = true;
        botPausadoAt = nowMx;
        botPausadoPor = nombreAutor || 'Sin nombre';

        await chat.sendMessage(
            [
                '🛑 BOT EN PAUSA DE EMERGENCIA',
                `Activado por: ${botPausadoPor}`,
                `Fecha: ${botPausadoAt}`,
                '',
                'Comandos disponibles:',
                '• BOT STATUS',
                '• BOT START',
                '• BOT RESET'
            ].join('\n')
        );
        return true;
    }

    if (comando === 'BOT START' || comando === 'BOT REANUDAR') {
        botPausado = false;
        await chat.sendMessage(
            [
                '✅ BOT REANUDADO',
                `Solicitó: ${nombreAutor || 'Sin nombre'}`,
                `Fecha: ${nowMx}`
            ].join('\n')
        );
        return true;
    }

    if (comando === 'BOT RESET') {
        limpiarMapeo(alertaAsistenciaEnviada);
        limpiarMapeo(reporteEnviadoHoy);
        botPausado = false;

        iniciarSchedulerReportes(clientRef);
        iniciarSchedulerEstadosAsistencia();

        await chat.sendMessage(
            [
                '♻️ BOT RESETEADO',
                'Se limpiaron cachés de alertas/reportes y se reiniciaron schedulers.',
                `Solicitó: ${nombreAutor || 'Sin nombre'}`,
                `Fecha: ${nowMx}`
            ].join('\n')
        );
        return true;
    }

    if (comando === 'BOT STATUS' || comando === 'BOT ESTADO') {
        await chat.sendMessage(
            [
                '🤖 ESTADO DEL BOT',
                `Pausado: ${botPausado ? 'SI' : 'NO'}`,
                `Pausado por: ${botPausadoPor || '-'}`,
                `Pausado desde: ${botPausadoAt || '-'}`,
                `Alertas activas: ${ALERTAS_ASISTENCIA_ACTIVAS ? 'SI' : 'NO'}`,
                `Sync asistencia (min): ${ESTADOS_ASISTENCIA_SYNC_MINUTES}`,
                '',
                'Comandos:',
                '• BOT STOP',
                '• BOT START',
                '• BOT RESET'
            ].join('\n')
        );
        return true;
    }

    return false;
}

function esEntradaOperativaBitacoraDesdePropio(texto = '') {
    const comando = normalizarComando(texto);
    if (!comando) {
        return false;
    }

    if (
        comando.startsWith('BITACORA TURNO') ||
        comando.startsWith('BITACORA TURNO:') ||
        comando.startsWith('GUIA BITACORA') ||
        comando.startsWith('GUIA BOTACORA') ||
        comando.startsWith('INICIAR BITACORA') ||
        comando.startsWith('INICIAR BOTACORA') ||
        comando === 'GUIA' ||
        comando === 'AYUDA' ||
        comando === 'AYUDA BITACORA' ||
        comando === 'AYUDA BOTACORA' ||
        comando === 'CANCELAR' ||
        comando === 'SALIR' ||
        comando === 'CANCELAR BITACORA' ||
        comando === 'CANCELAR BOTACORA'
    ) {
        return true;
    }

    return /(AREA\s*:|PENDIENTES\s*:|TECNICO\s*:|ACTIVIDAD(?:ES)?\s*:|BITACORA\s+TURNO\b)/.test(comando);
}

function esEntradaOperativaMantenimientoDesdePropio(texto = '') {
    const comando = normalizarComando(texto);
    if (!comando) {
        return false;
    }

    return (
        /(ENTRADA|INGRESO|INICIO TURNO|LLEGADA|SALIDA|SALIENDO|FIN TURNO|EGRESO)/.test(comando) ||
        /(TURNO\s*:|UBICACION\s*:|LUGAR\s*:|LOCALIZACION\s*:)/.test(comando) ||
        /(FALLA\s*:|AREA\s*:|EQUIPO\s*:|PRIORIDAD\s*:)/.test(comando)
    );
}

async function revisarAlertasAsistencia({ clientRef }) {
    if (!ALERTAS_ASISTENCIA_ACTIVAS) {
        return;
    }

    if (botPausado) {
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

        const esIngenieria = (alerta.etiqueta || '').toUpperCase() === 'INGENIERIA';
        const estatusMsg = esIngenieria
            ? `Estatus: Sin registro de check-in despues de ${alerta.toleranciaMin} minutos de iniciado el turno. Se considera falta operativa.`
            : `Estatus: Sin evidencia de actividad despues de ${alerta.toleranciaMin} minutos. Se considera falta operativa.`;

        const mensaje = [
            `🚨 ALERTA ASISTENCIA ${alerta.etiqueta || 'OPERATIVA'}`,
            `Personal: ${alerta.persona}`,
            `Turno: ${alerta.turnoInicio} - ${alerta.turnoFin}`,
            `Grupo esperado: ${alerta.grupo}`,
            estatusMsg
        ].join('\n');

        await chatSupervisor.sendMessage(mensaje);
        alertaAsistenciaEnviada[claveAlerta] = true;
        console.log('🚨 Alerta de asistencia enviada:', claveAlerta);
    }
}

async function obtenerChatSupervisor(clientRef) {
    const chats = await clientRef.getChats();
    return chats.find((chat) => {
        return chat.isGroup && normalizarNombreGrupo(chat.name) === normalizarNombreGrupo(GRUPO_ALERTAS_SUPERVISOR);
    });
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

    if (!ALERTAS_ASISTENCIA_ACTIVAS) {
        console.log('⏸️ Alertas de asistencia desactivadas (ALERTAS_ASISTENCIA_ACTIVAS=false).');
        return;
    }

    console.log('🔔 Alertas de asistencia activas: se notificará solo en Centro Operativo SHP1.');

    const ejecutar = async () => {
        try {
            await revisarAlertasAsistencia({ clientRef });

            if (AUTO_REPORTES_ACTIVOS) {
                console.log('ℹ️ AUTO_REPORTES_ACTIVOS=true, pero los reportes automaticos siguen deshabilitados por política de solo escucha.');
            }
        } catch (error) {
            console.error('❌ Error enviando alertas automáticas:', error);
        }
    };

    ejecutar();
    schedulerReportesId = setInterval(ejecutar, 30 * 1000);
}

function iniciarSchedulerEstadosAsistencia() {
    if (schedulerEstadosAsistenciaId) {
        clearInterval(schedulerEstadosAsistenciaId);
        schedulerEstadosAsistenciaId = null;
    }

    const ejecutarSincronizacion = async () => {
        try {
            await sincronizarEstadosAsistencia(pool);
            console.log('🧭 Estados de asistencia sincronizados.');
        } catch (error) {
            console.error('⚠️ Error sincronizando estados de asistencia:', error);
        }
    };

    ejecutarSincronizacion();
    schedulerEstadosAsistenciaId = setInterval(ejecutarSincronizacion, ESTADOS_ASISTENCIA_SYNC_MINUTES * 60 * 1000);
}

function salidaGrupoPermitida(chat) {
    return !!(chat?.isGroup && GRUPOS_SALIDA_HABILITADA.has(normalizarNombreGrupo(chat.name)));
}

function crearChatSoloLectura(chat) {
    if (!MODO_SOLO_LECTURA_GRUPOS || !chat?.isGroup || salidaGrupoPermitida(chat)) {
        return chat;
    }

    return new Proxy(chat, {
        get(target, prop, receiver) {
            if (prop === 'sendMessage') {
                return async () => {
                    console.log('⛔ sendMessage bloqueado en grupo (modo solo lectura):', target.name);
                    return null;
                };
            }

            const value = Reflect.get(target, prop, receiver);
            if (typeof value === 'function') {
                return value.bind(target);
            }
            return value;
        }
    });
}

function crearMensajeSoloLectura(message, chat) {
    if (!MODO_SOLO_LECTURA_GRUPOS || !chat?.isGroup || salidaGrupoPermitida(chat)) {
        return message;
    }

    return new Proxy(message, {
        get(target, prop, receiver) {
            if (prop === 'reply') {
                return async () => {
                    console.log('⛔ reply bloqueado en grupo (modo solo lectura):', chat.name);
                    return null;
                };
            }

            const value = Reflect.get(target, prop, receiver);
            if (typeof value === 'function') {
                return value.bind(target);
            }
            return value;
        }
    });
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
    iniciarSchedulerEstadosAsistencia();
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

        if (!chat.isGroup) {
            return;
        }

        const chatNameNormalizado = normalizarNombreGrupo(chat.name);

        if (GRUPOS_BLOQUEADOS.has(chatNameNormalizado)) {
            console.log('⛔ Grupo bloqueado (fuera de operación):', chat.name);
            return;
        }

        const tipoFuente = GRUPOS[chatNameNormalizado];

        if (!tipoFuente) {
            console.log('⏸️ Grupo fuera de alcance (ignorado):', chat.name);
            return;
        }

        const comandoControlBot = tipoFuente === 'SUPERVISOR'
            ? obtenerComandoControlBot(textoOriginal)
            : '';

        if (message.fromMe) {
            const permitirFromMeSupervisor =
                tipoFuente === 'SUPERVISOR' && esEntradaOperativaSupervisorDesdePropio(textoOriginal);
            const permitirFromMeBitacora =
                tipoFuente === 'BITACORA' && (message.hasMedia || esEntradaOperativaBitacoraDesdePropio(textoOriginal));
            const permitirFromMeMantenimiento =
                tipoFuente === 'MANTENIMIENTO_ASISTENCIA'; // Saul es el mismo número del bot; registrar todo

            if (!permitirFromMeSupervisor && !permitirFromMeBitacora && !permitirFromMeMantenimiento) {
                console.log('⏸️ Mensaje fromMe ignorado:', {
                    grupo: chat.name,
                    tipoFuente,
                    preview: textoOriginal.replace(/\s+/g, ' ').slice(0, 80)
                });
                return;
            }
        }

        if (tipoFuente === 'SUPERVISOR' && comandoControlBot) {
            if (!message.fromMe) {
                console.log('⛔ Comando de control bot rechazado (solo fromMe):', comandoControlBot);
                return;
            }

            const fechaControl = moment().tz('America/Mexico_City');
            const nombreAutorControl = message._data.notifyName || message.author || 'Sin nombre';
            await manejarComandoControlBot({
                comando: comandoControlBot,
                chat,
                nombreAutor: nombreAutorControl,
                clientRef: client
            });
            return;
        }

        if (botPausado) {
            console.log('⏸️ Bot en pausa de emergencia. Mensaje ignorado:', {
                grupo: chat.name,
                tipoFuente,
                preview: textoOriginal.replace(/\s+/g, ' ').slice(0, 80)
            });
            return;
        }

        const messageSafe = crearMensajeSoloLectura(message, chat);
        const chatSafe = crearChatSoloLectura(chat);

        const fecha = moment().tz('America/Mexico_City');
        const nombreAutor = message._data.notifyName || message.author || 'Sin nombre';

        console.log('\n====================');
        console.log('📥 NUEVO MENSAJE (SOLO LECTURA)');
        console.log('GRUPO:', chat.name);
        console.log('TIPO:', tipoFuente);
        console.log('AUTOR:', nombreAutor);
        console.log({ tipoMensaje: message.type, mensajeId: message.id._serialized, fromMe: message.fromMe });
        if (textoOriginal.trim()) {
            console.log('TEXTO:', textoOriginal.replace(/\s+/g, ' ').slice(0, 280));
        }

        if (tipoFuente === 'SUPERVISOR') {
            if (messageSafe.hasMedia && esSolicitudPreventivoEnSupervisor(textoOriginal)) {
                const intentoPreventivo = await manejarPreventivos({
                    message: messageSafe,
                    chat: chatSafe,
                    textoOriginal,
                    nombreAutor,
                    fecha,
                    permitirFallbackEtiqueta: false
                });

                if (intentoPreventivo?.registrado) {
                    console.log('✅ Preventivo detectado desde Centro Operativo y guardado (sin respuesta).');
                    return;
                }
            }

            await manejarSupervisor({
                message: messageSafe,
                chat: chatSafe,
                textoOriginal,
                nombreAutor,
                fecha
            });
            return;
        }

        if (tipoFuente === 'BITACORA') {
            await manejarBitacora({
                message: messageSafe,
                chat: chatSafe,
                textoOriginal,
                nombreAutor,
                fecha
            });
            return;
        }

        if (tipoFuente === 'LIMPIEZA') {
            await manejarLimpieza({
                message: messageSafe,
                chat: chatSafe,
                textoOriginal,
                nombreAutor,
                fecha
            });
            return;
        }

        if (tipoFuente === 'MANTENIMIENTO_ASISTENCIA') {
            await manejarMantenimiento({
                message: messageSafe,
                chat: chatSafe,
                textoOriginal,
                nombreAutor,
                autorNumero: message.author || '',
                fecha,
                tipoFuente
            });
            return;
        }

        console.log('⏭️ Tipo de fuente sin handler activo:', tipoFuente);
    } catch (error) {
        console.error('\n❌ ERROR GENERAL:\n', error);
    }

});


// =========================
// INICIAR
// =========================

client.initialize();
