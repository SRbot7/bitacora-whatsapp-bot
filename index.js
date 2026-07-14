require('dotenv').config();

const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const pool = require('./db');

const { obtenerTextoMensaje } = require('./lib/bitacora-parser');
const { manejarSupervisor }   = require('./handlers/supervisor');
const { manejarBitacora }     = require('./handlers/bitacora');
const { manejarLimpieza }     = require('./handlers/limpieza');
const { manejarAsistencia } = require('./handlers/asistencia');
const { manejarPreventivos }   = require('./handlers/preventivos');
const {
    obtenerResumenOperativo,
    construirMensajeResumenOperativo
} = require('./services/reportes');

const BITACORA_GROUP_NAME = process.env.BITACORA_GROUP_NAME || 'BITACORA-MTTO-SHP1';
const SUPERVISOR_GROUP_NAME = process.env.SUPERVISOR_GROUP_NAME || 'Centro Operativo SHP1';
const LIMPIEZA_GROUP_NAME = process.env.LIMPIEZA_GROUP_NAME || 'MELI SVC PACHUCA - BATIA LIMPIEZA';
const LIMPIEZA_ASISTENCIA_GROUP_NAME = process.env.LIMPIEZA_ASISTENCIA_GROUP_NAME || 'Asistencia limpieza SHP1 Pachuca';
const MANTENIMIENTO_ASISTENCIA_GROUP_NAME = process.env.MANTENIMIENTO_ASISTENCIA_GROUP_NAME || 'Asistencia SHP1 Pachuca';
const MANTENIMIENTO_BLOQUEADO_GROUP_NAME = process.env.MANTENIMIENTO_BLOQUEADO_GROUP_NAME || 'Mantenimiento SHP1';

function normalizarNombreGrupo(nombre = '') {
    return nombre
        .toString()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function obtenerFechaMensajeMx(message) {
    const tsRaw = Number(message?.timestamp || message?._data?.t || 0);
    if (Number.isFinite(tsRaw) && tsRaw > 0) {
        return moment.unix(tsRaw).tz('America/Mexico_City');
    }

    return moment().tz('America/Mexico_City');
}



// =========================
// GRUPOS ACEPTADOS
// =========================

// Mapa principal de escucha: cada grupo entra por un flujo especifico.
const GRUPOS = {
    [normalizarNombreGrupo(BITACORA_GROUP_NAME)]:                 'BITACORA',
    [normalizarNombreGrupo(SUPERVISOR_GROUP_NAME)]:               'SUPERVISOR',
    [normalizarNombreGrupo(LIMPIEZA_GROUP_NAME)]:                 'LIMPIEZA',
    [normalizarNombreGrupo(LIMPIEZA_ASISTENCIA_GROUP_NAME)]:      'ASISTENCIA_LIMPIEZA',
    [normalizarNombreGrupo(MANTENIMIENTO_ASISTENCIA_GROUP_NAME)]: 'ASISTENCIA_MTTO'
};

const GRUPOS_BLOQUEADOS = new Set([
    normalizarNombreGrupo(MANTENIMIENTO_BLOQUEADO_GROUP_NAME)
]);

const HORARIOS_REPORTE = ['06:30', '15:30', '22:30'];
const COMANDOS_REPORTE = ['REPORTE', 'RESUMEN', 'REPORTE OPERATIVO', 'RESUMEN OPERATIVO'];
const AUTO_REPORTES_ACTIVOS = (process.env.AUTO_REPORTES_ACTIVOS || 'false').toLowerCase() === 'true';
const GRUPO_ALERTAS_SUPERVISOR = SUPERVISOR_GROUP_NAME;
const MODO_SOLO_LECTURA_GRUPOS = true;
// Solo estos grupos pueden recibir mensajes salientes del bot.
const GRUPOS_SALIDA_HABILITADA = new Set([
    normalizarNombreGrupo(BITACORA_GROUP_NAME),
    normalizarNombreGrupo(SUPERVISOR_GROUP_NAME),
    normalizarNombreGrupo(LIMPIEZA_ASISTENCIA_GROUP_NAME)
]);
const COMANDOS_CONTROL_BOT = new Set([
    'BOT STOP', 'BOT PAUSA',
    'BOT START', 'BOT REANUDAR',
    'BOT RESET',
    'BOT STATUS', 'BOT ESTADO',
    'BOT URL', 'BOT REENVIAR URL', 'BOT URL ESTADO'
]);
const VENTANA_PREVENTIVO_CO_MS = Math.max(
    60 * 1000,
    Number.parseInt(process.env.PREVENTIVO_CO_VENTANA_MS || `${3 * 60 * 1000}`, 10) || (3 * 60 * 1000)
);
const WA_LAUNCH_TIMEOUT_MS = Math.max(
    30_000,
    Number.parseInt(process.env.WA_LAUNCH_TIMEOUT_MS || '120000', 10) || 120_000
);
const WA_PROTOCOL_TIMEOUT_MS = Math.max(
    30_000,
    Number.parseInt(process.env.WA_PROTOCOL_TIMEOUT_MS || '180000', 10) || 180_000
);
const WA_INIT_RETRY_DELAY_MS = Math.max(
    5_000,
    Number.parseInt(process.env.WA_INIT_RETRY_DELAY_MS || '20000', 10) || 20_000
);
const QUICK_TUNNEL_URL_FILE = process.env.QUICK_TUNNEL_URL_FILE || path.join(__dirname, 'runtime', 'quick-tunnel-url.txt');
const DASHBOARD_SHARE_TOKEN_FILE = process.env.DASHBOARD_SHARE_TOKEN_FILE || path.join(__dirname, 'runtime', 'dashboard-share-token.txt');
const DASHBOARD_SHARE_TOKEN_ROTATE_MINUTES = Math.max(
    5,
    Number.parseInt(process.env.DASHBOARD_SHARE_TOKEN_ROTATE_MINUTES || '720', 10) || 720
);
const QUICK_TUNNEL_SYNC_SECONDS = Math.max(
    15,
    Number.parseInt(process.env.QUICK_TUNNEL_SYNC_SECONDS || '45', 10) || 45
);

let schedulerReportesId = null;
let schedulerQuickTunnelId = null;
const reporteEnviadoHoy = {};
const pendientesPreventivoCO = {};
let chatSupervisorCache = null;
let ultimoErrorChatSupervisorMs = 0;
let botPausado = false;
let botPausadoAt = null;
let botPausadoPor = '';
let quickTunnelUrlPublicada = '';
let quickTunnelUltimaPublicacionMx = '';

function esErrorTransitorioPuppeteer(err) {
    const detalle = `${err?.message || ''}\n${err?.stack || ''}`;
    return /Runtime\.callFunctionOn|Promise was collected|Execution context was destroyed|Protocol error|Target closed/i.test(detalle);
}

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
        comando === 'SHP1' ||
        comando.startsWith('OP SHP1') ||
        comandoCompacto.startsWith('OPSHP1')
    );
}

function obtenerClaveAutorMensaje({ message, nombreAutor = '' }) {
    const autor = (message?.author || message?.from || nombreAutor || 'sin-autor')
        .toString()
        .trim()
        .toLowerCase();

    return autor || 'sin-autor';
}

function obtenerClavePendientePreventivoCO({ chat, message, nombreAutor = '' }) {
    const chatKey = (chat?.id?._serialized || chat?.name || 'sin-chat').toString().trim();
    const autorKey = obtenerClaveAutorMensaje({ message, nombreAutor });
    return `${chatKey}::${autorKey}`;
}

function limpiarPendientesPreventivoCO() {
    const ahora = Date.now();
    Object.keys(pendientesPreventivoCO).forEach((clave) => {
        const item = pendientesPreventivoCO[clave];
        if (!item || (ahora - item.createdAtMs) > VENTANA_PREVENTIVO_CO_MS) {
            delete pendientesPreventivoCO[clave];
        }
    });
}

function registrarPendientePreventivoCO({ clave, messageSafe, chatSafe, fecha }) {
    pendientesPreventivoCO[clave] = {
        messageSafe,
        chatSafe,
        fecha,
        createdAtMs: Date.now()
    };
}

function tomarPendientePreventivoCO(clave) {
    limpiarPendientesPreventivoCO();

    const item = pendientesPreventivoCO[clave];
    if (!item) {
        return null;
    }

    delete pendientesPreventivoCO[clave];
    return item;
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
        'BOT STOP', 'BOT PAUSA', 'BOT START', 'BOT REANUDAR', 'BOT RESET', 'BOT STATUS', 'BOT ESTADO', 'BOT URL', 'BOT REENVIAR URL',
        'AYUDA', 'AYUDA GUIADA', 'GUIA AYUDA', 'AYUDA RAPIDA',
        'LISTAR', 'ABIERTOS', 'CERRADOS',
        'PREVENTIVOS', 'ALERTAS', 'ALERTAS ASISTENCIA',
        'HISTORIAL CO', 'HISTORIAL CO HOY',
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

    if (/^HISTORIAL\s+CO\s+AUTOR\s*:/i.test(texto)) {
        return true;
    }

    if (/^ROLES\s+LIMPIEZA(?:\s+PENDIENTES)?$/i.test(texto)) {
        return true;
    }

    if (/^ROL\s+LIMPIEZA\s*:\s*.+\|\s*(LIMPIEZA|SITE[_\s-]?LEADER|TEAM[_\s-]?LEADER|SIN[_\s-]?CLASIFICAR)\s*$/i.test(texto)) {
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

function leerQuickTunnelUrl() {
    try {
        if (!fs.existsSync(QUICK_TUNNEL_URL_FILE)) {
            return '';
        }

        const raw = fs.readFileSync(QUICK_TUNNEL_URL_FILE, 'utf8').trim();
        if (!raw) {
            return '';
        }

        const match = raw.match(/https:\/\/[-a-zA-Z0-9]+\.trycloudflare\.com/);
        return match ? match[0] : '';
    } catch (error) {
        console.error('⚠️ Error leyendo URL de Quick Tunnel:', error?.message || error);
        return '';
    }
}

function construirUrlDashboardCompartible(urlBase = '') {
    if (!urlBase) {
        return '';
    }

    let tokenCompartible = '';
    try {
        if (fs.existsSync(DASHBOARD_SHARE_TOKEN_FILE)) {
            tokenCompartible = fs.readFileSync(DASHBOARD_SHARE_TOKEN_FILE, 'utf8').trim();
        }
    } catch (error) {
        console.error('⚠️ Error leyendo dashboard share token:', error?.message || error);
    }

    if (!tokenCompartible) {
        tokenCompartible = (process.env.DASHBOARD_PRIVATE_KEY || '').trim();
    }

    if (!tokenCompartible) {
        return urlBase;
    }

    const separador = urlBase.includes('?') ? '&' : '?';
    return `${urlBase}${separador}k=${encodeURIComponent(tokenCompartible)}`;
}

function formatearMinutosRestantes(minutos = 0) {
    if (minutos <= 0) {
        return '0 min';
    }

    const horas = Math.floor(minutos / 60);
    const mins = minutos % 60;
    if (horas <= 0) {
        return `${mins} min`;
    }

    return `${horas}h ${mins}m`;
}

function obtenerEstadoQuickTunnel() {
    const urlBase = leerQuickTunnelUrl();
    const urlCompartible = construirUrlDashboardCompartible(urlBase);

    let tokenActualizadoMx = '-';
    let tokenRestanteMin = null;

    try {
        if (fs.existsSync(DASHBOARD_SHARE_TOKEN_FILE)) {
            const stat = fs.statSync(DASHBOARD_SHARE_TOKEN_FILE);
            const actualizado = moment(stat.mtimeMs).tz('America/Mexico_City');
            tokenActualizadoMx = actualizado.format('YYYY-MM-DD HH:mm:ss');

            const transcurridoMin = Math.max(0, Math.floor((Date.now() - stat.mtimeMs) / 60000));
            tokenRestanteMin = Math.max(0, DASHBOARD_SHARE_TOKEN_ROTATE_MINUTES - transcurridoMin);
        }
    } catch (error) {
        console.error('⚠️ Error calculando estado de rotacion de token:', error?.message || error);
    }

    return {
        urlBase,
        urlCompartible,
        ultimaPublicacion: quickTunnelUltimaPublicacionMx || '-',
        tokenActualizadoMx,
        tokenRestanteMin
    };
}

async function revisarQuickTunnelUrl({ clientRef, forzar = false }) {
    if (botPausado && !forzar) {
        return false;
    }

    const urlBase = leerQuickTunnelUrl();
    if (!urlBase) {
        return false;
    }

    const urlCompartible = construirUrlDashboardCompartible(urlBase);
    if (!forzar && urlCompartible === quickTunnelUrlPublicada) {
        return false;
    }

    const chatSupervisor = await obtenerChatSupervisor(clientRef);
    if (!chatSupervisor) {
        console.log('⚠️ No se encontro Centro Operativo para publicar URL de Quick Tunnel.');
        return false;
    }

    const sello = moment().tz('America/Mexico_City').format('YYYY-MM-DD HH:mm:ss');
    const mensaje = [
        '🌐 DASHBOARD PUBLICO (Quick Tunnel)',
        `URL: ${urlCompartible}`,
        `Actualizado: ${sello}`,
        'Nota: URL temporal; puede cambiar si reinicia el proceso del tunel.'
    ].join('\n');

    await chatSupervisor.sendMessage(mensaje);
    quickTunnelUrlPublicada = urlCompartible;
    quickTunnelUltimaPublicacionMx = sello;
    console.log('🌐 URL Quick Tunnel publicada en Centro Operativo:', urlCompartible);
    return true;
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
        limpiarMapeo(reporteEnviadoHoy);
        botPausado = false;

        iniciarSchedulerReportes(clientRef);
        iniciarSchedulerQuickTunnel(clientRef);

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
                `Quick Tunnel: ${construirUrlDashboardCompartible(leerQuickTunnelUrl()) || 'No disponible'}`,
                '',
                'Comandos:',
                '• BOT STOP / BOT PAUSA',
                '• BOT START / BOT REANUDAR',
                '• BOT RESET',
                '• BOT URL',
                '• BOT URL ESTADO'
            ].join('\n')
        );
        return true;
    }

    if (comando === 'BOT URL' || comando === 'BOT REENVIAR URL') {
        const publicada = await revisarQuickTunnelUrl({ clientRef, forzar: true });
        await chat.sendMessage(
            publicada
                ? [
                    '🌐 URL DE DASHBOARD REENVIADA',
                    `Solicitó: ${nombreAutor || 'Sin nombre'}`,
                    `Fecha: ${nowMx}`
                ].join('\n')
                : [
                    '⚠️ No hay URL activa de Quick Tunnel.',
                    'Revisa proceso: pm2 status | grep bitacora-quick-tunnel'
                ].join('\n')
        );
        return true;
    }

    if (comando === 'BOT URL ESTADO') {
        const estado = obtenerEstadoQuickTunnel();
        await chat.sendMessage(
            [
                '🌐 ESTADO QUICK TUNNEL',
                `URL base: ${estado.urlBase || 'No disponible'}`,
                `URL compartible: ${estado.urlCompartible || 'No disponible'}`,
                `Ultima publicacion CO: ${estado.ultimaPublicacion}`,
                `Token actualizado: ${estado.tokenActualizadoMx}`,
                `Rotacion token (min): ${DASHBOARD_SHARE_TOKEN_ROTATE_MINUTES}`,
                `Tiempo restante token: ${estado.tokenRestanteMin === null ? '-' : formatearMinutosRestantes(estado.tokenRestanteMin)}`
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

async function obtenerChatSupervisor(clientRef) {
    if (
        chatSupervisorCache &&
        chatSupervisorCache.isGroup &&
        normalizarNombreGrupo(chatSupervisorCache.name) === normalizarNombreGrupo(GRUPO_ALERTAS_SUPERVISOR)
    ) {
        return chatSupervisorCache;
    }

    try {
        const chats = await clientRef.getChats();
        const chatSupervisor = chats.find((chat) => {
            return chat.isGroup && normalizarNombreGrupo(chat.name) === normalizarNombreGrupo(GRUPO_ALERTAS_SUPERVISOR);
        }) || null;

        if (chatSupervisor) {
            chatSupervisorCache = chatSupervisor;
        }

        return chatSupervisor;
    } catch (error) {
        if (esErrorTransitorioPuppeteer(error)) {
            const ahora = Date.now();
            if ((ahora - ultimoErrorChatSupervisorMs) > 60_000) {
                console.warn('⚠️ obtenerChatSupervisor con error transitorio (se omite ciclo):', error?.message || error);
                ultimoErrorChatSupervisorMs = ahora;
            }
            return null;
        }

        throw error;
    }
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

    if (AUTO_REPORTES_ACTIVOS) {
        console.log('ℹ️ AUTO_REPORTES_ACTIVOS=true, pero los reportes automáticos están deshabilitados en este modo limpio.');
    }
}

function iniciarSchedulerQuickTunnel(clientRef) {
    if (schedulerQuickTunnelId) {
        clearInterval(schedulerQuickTunnelId);
        schedulerQuickTunnelId = null;
    }

    const ejecutar = async () => {
        try {
            await revisarQuickTunnelUrl({ clientRef });
        } catch (error) {
            console.error('⚠️ Error revisando URL de Quick Tunnel:', error?.message || error);
        }
    };

    ejecutar();
    schedulerQuickTunnelId = setInterval(ejecutar, QUICK_TUNNEL_SYNC_SECONDS * 1000);
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
        timeout: WA_LAUNCH_TIMEOUT_MS,
        protocolTimeout: WA_PROTOCOL_TIMEOUT_MS,
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
    iniciarSchedulerQuickTunnel(client);
    await revisarQuickTunnelUrl({ clientRef: client, forzar: true });
});


// =========================
// DESCONECTADO
// =========================

client.on('disconnected', (reason) => {
    console.log('\n⚠️ Cliente desconectado:', reason);
});

let initEnCurso = false;

function esErrorTimeoutNavegacion(err) {
    const detalle = `${err?.message || ''}\n${err?.stack || ''}`;
    return /ProtocolError|Page\.navigate timed out/i.test(detalle);
}

async function inicializarClienteConReintento() {
    if (initEnCurso) {
        return;
    }

    initEnCurso = true;
    try {
        await client.initialize();
    } catch (err) {
        const esTimeoutNavegacion = esErrorTimeoutNavegacion(err);
        console.error('\n❌ Fallo al inicializar cliente WhatsApp:', err?.message || err);
        if (esTimeoutNavegacion) {
            console.error(`⏳ Se detecto timeout de navegacion. Reintentando en ${WA_INIT_RETRY_DELAY_MS} ms...`);
        } else {
            console.error(`⏳ Reintentando inicializacion en ${WA_INIT_RETRY_DELAY_MS} ms...`);
        }

        setTimeout(() => {
            inicializarClienteConReintento().catch((retryErr) => {
                console.error('❌ Reintento de inicializacion fallo:', retryErr?.message || retryErr);
            });
        }, WA_INIT_RETRY_DELAY_MS);
    } finally {
        initEnCurso = false;
    }
}


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
            const permitirFromMeAsistencia =
                tipoFuente === 'ASISTENCIA_LIMPIEZA' || tipoFuente === 'ASISTENCIA_MTTO';

            if (!permitirFromMeSupervisor && !permitirFromMeBitacora && !permitirFromMeAsistencia) {
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

        const fecha = obtenerFechaMensajeMx(message);
        const nombreAutor = message._data.notifyName || message.author || 'Sin nombre';
        const clavePendientePreventivoCO = obtenerClavePendientePreventivoCO({
            chat,
            message,
            nombreAutor
        });

        limpiarPendientesPreventivoCO();

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
                    delete pendientesPreventivoCO[clavePendientePreventivoCO];
                    console.log('✅ Preventivo detectado desde Centro Operativo y guardado (sin respuesta).');
                    return;
                }
            }

            if (!messageSafe.hasMedia && esSolicitudPreventivoEnSupervisor(textoOriginal)) {
                const pendienteMedia = tomarPendientePreventivoCO(clavePendientePreventivoCO);
                if (pendienteMedia?.messageSafe?.hasMedia) {
                    const intentoPreventivoDiferido = await manejarPreventivos({
                        message: pendienteMedia.messageSafe,
                        chat: pendienteMedia.chatSafe,
                        textoOriginal,
                        nombreAutor,
                        fecha: pendienteMedia.fecha,
                        permitirFallbackEtiqueta: false
                    });

                    if (intentoPreventivoDiferido?.registrado) {
                        console.log('✅ Preventivo detectado con imagen previa + comando posterior en CO.');
                        return;
                    }
                }
            }

            if (messageSafe.hasMedia && message.type === 'image') {
                registrarPendientePreventivoCO({
                    clave: clavePendientePreventivoCO,
                    messageSafe,
                    chatSafe,
                    fecha
                });
                console.log('🧠 Imagen CO guardada temporalmente para OCR preventivo (3 min).');
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

        if (tipoFuente === 'ASISTENCIA_LIMPIEZA') {
            // Limpieza: flujo con confirmacion final (solo si registro + ubicacion se completan).
            await manejarAsistencia({
                message: messageSafe,
                chat: chatSafe,
                textoOriginal,
                nombreAutor,
                fecha,
                area: 'LIMPIEZA'
            });
            return;
        }

        if (tipoFuente === 'ASISTENCIA_MTTO') {
            // MTTO: mismo registro en asistencia_eventos, sin respuesta automatica al grupo.
            await manejarAsistencia({
                message: messageSafe,
                chat: chatSafe,
                textoOriginal,
                nombreAutor,
                fecha,
                area: 'MTTO'
            });
            return;
        }

        console.log('⏭️ Tipo de fuente sin handler activo:', tipoFuente);
    } catch (error) {
        console.error('\n❌ ERROR GENERAL:\n', error);
    }

});

client.on('message_edit', async (message) => {
    try {
        const textoOriginal = obtenerTextoMensaje(message);

        if (!textoOriginal.trim() && message.type !== 'location') return;

        if (!message.id || !message.id._serialized) {
            console.log('⚠️ Mensaje editado sin ID');
            return;
        }

        const chat = await message.getChat();
        if (!chat.isGroup) {
            return;
        }

        const chatNameNormalizado = normalizarNombreGrupo(chat.name);
        const tipoFuente = GRUPOS[chatNameNormalizado];

        if (tipoFuente !== 'ASISTENCIA_LIMPIEZA' && tipoFuente !== 'ASISTENCIA_MTTO') {
            return;
        }

        if (botPausado) {
            return;
        }

        const messageSafe = crearMensajeSoloLectura(message, chat);
        const chatSafe = crearChatSoloLectura(chat);
        const fecha = obtenerFechaMensajeMx(message);
        const nombreAutor = message._data.notifyName || message.author || 'Sin nombre';

        console.log('✏️ MENSAJE EDITADO (ASISTENCIA):', {
            grupo: chat.name,
            tipoFuente,
            autor: nombreAutor,
            mensajeId: message.id._serialized,
            texto: textoOriginal.replace(/\s+/g, ' ').slice(0, 160)
        });

        await manejarAsistencia({
            message: messageSafe,
            chat: chatSafe,
            textoOriginal,
            nombreAutor,
            fecha,
            area: tipoFuente === 'ASISTENCIA_LIMPIEZA' ? 'LIMPIEZA' : 'MTTO'
        });
    } catch (error) {
        console.error('\n❌ ERROR MESSAGE_EDIT:\n', error);
    }
});


// =========================
// INICIAR
// =========================

inicializarClienteConReintento().catch((err) => {
    console.error('❌ Error no controlado al iniciar cliente WhatsApp:', err?.message || err);
});
