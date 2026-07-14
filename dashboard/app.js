const state = {
    tab: 'principal',
    scope: 'pendientes',
    limpiezaView: 'actividades',
    page: 1,
    pageSize: 20,
    totalPages: 1,
    modalImages: [],
    modalIndex: 0
};

const DASHBOARD_KEY_QUERY_PARAM = 'key';
const DASHBOARD_KEY_QUERY_PARAM_LEGACY = 'k';
const DASHBOARD_KEY_STORAGE = 'dashboardPrivateKey';

const els = {
    listado: document.getElementById('listado'),
    status: document.getElementById('status'),
    tabs: document.querySelectorAll('.tab'),
    subtabsWrap: document.getElementById('subtabs-supervisor'),
    subtabs: document.querySelectorAll('#subtabs-supervisor .subtab'),
    subtabsLimpiezaWrap: document.getElementById('subtabs-limpieza'),
    subtabsLimpieza: document.querySelectorAll('[data-limpieza-view]'),
    filtersWrap: document.getElementById('filters-wrap'),
    paginationWrap: document.getElementById('pagination-wrap'),
    filterSearch: document.getElementById('filter-search'),
    filterFrom: document.getElementById('filter-from'),
    filterTo: document.getElementById('filter-to'),
    filterArea: document.getElementById('filter-area'),
    filterExtra: document.getElementById('filter-extra'),
    btnAplicar: document.getElementById('btn-aplicar'),
    btnLimpiar: document.getElementById('btn-limpiar'),
    btnPrev: document.getElementById('btn-prev'),
    btnNext: document.getElementById('btn-next'),
    pageInfo: document.getElementById('page-info'),
    modal: document.getElementById('modal'),
    modalImage: document.getElementById('modal-image'),
    modalClose: document.getElementById('modal-close'),
    modalPrev: document.getElementById('modal-prev'),
    modalNext: document.getElementById('modal-next'),
    modalCounter: document.getElementById('modal-counter'),
    homeTopIndicators: document.getElementById('home-top-indicators'),
    kpiBitacora: document.getElementById('kpi-bitacora'),
    kpiLimpieza: document.getElementById('kpi-limpieza'),
    kpiPendientes: document.getElementById('kpi-pendientes'),
    kpiProyectos: document.getElementById('kpi-proyectos')
};

function getDashboardKeyFromUrl() {
    const params = new URLSearchParams(window.location.search || '');
    return (params.get(DASHBOARD_KEY_QUERY_PARAM)
        || params.get(DASHBOARD_KEY_QUERY_PARAM_LEGACY)
        || '').trim();
}

function persistDashboardKey(key = '') {
    const clean = (key || '').trim();
    if (!clean) {
        return;
    }

    window.localStorage.setItem(DASHBOARD_KEY_STORAGE, clean);
}

function getDashboardKey() {
    const fromUrl = getDashboardKeyFromUrl();
    if (fromUrl) {
        persistDashboardKey(fromUrl);
        const cleanUrl = `${window.location.origin}${window.location.pathname}${window.location.hash || ''}`;
        window.history.replaceState({}, document.title, cleanUrl);
        return fromUrl;
    }

    return (window.localStorage.getItem(DASHBOARD_KEY_STORAGE) || '').trim();
}

async function apiFetch(url, options = {}) {
    const headers = new Headers(options.headers || {});
    const key = getDashboardKey();
    if (key) {
        headers.set('x-dashboard-key', key);
    }

    const response = await fetch(url, {
        ...options,
        headers
    });

    if (response.status === 403) {
        throw new Error('Acceso denegado (403). Conéctate por Tailscale o abre el dashboard con ?key=TU_LLAVE.');
    }

    return response;
}

function toIsoOrEmpty(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function getMxTodayIso() {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Mexico_City',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());

    const year = parts.find((p) => p.type === 'year')?.value;
    const month = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;

    return `${year}-${month}-${day}`;
}

function parseIsoDateUtcNoon(value) {
    const [year, month, day] = String(value || '').split('-').map((part) => Number.parseInt(part, 10));
    if (!year || !month || !day) {
        return null;
    }

    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function formatIsoDate(date) {
    return date.toISOString().slice(0, 10);
}

function getWeekRangeMx() {
    const todayIso = getMxTodayIso();
    const today = parseIsoDateUtcNoon(todayIso);
    if (!today) {
        return { from: todayIso, to: todayIso, weekStart: todayIso, weekEnd: todayIso };
    }

    const dayIndex = (today.getUTCDay() + 6) % 7;
    const weekStart = new Date(today);
    weekStart.setUTCDate(today.getUTCDate() - dayIndex);
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekStart.getUTCDate() + 6);

    return {
        from: formatIsoDate(weekStart),
        to: formatIsoDate(weekEnd),
        weekStart: formatIsoDate(weekStart),
        weekEnd: formatIsoDate(weekEnd)
    };
}

function getMonthRangeMx() {
    const todayIso = getMxTodayIso();
    const today = parseIsoDateUtcNoon(todayIso);
    if (!today) {
        return { from: todayIso, to: todayIso, month: todayIso.slice(0, 7) };
    }

    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1, 12, 0, 0));
    const monthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0, 12, 0, 0));

    return {
        from: formatIsoDate(monthStart),
        to: formatIsoDate(monthEnd),
        month: `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}`
    };
}

function getDefaultAttendanceRange(scope) {
    if (scope === 'semanal') {
        return getWeekRangeMx();
    }

    if (scope === 'mensual') {
        return getMonthRangeMx();
    }

    const today = getMxTodayIso();
    return { from: today, to: today, weekStart: today, weekEnd: today, month: today.slice(0, 7) };
}

function parseDashboardDate(value) {
    if (!value) return null;

    // Evita corrimiento de dia cuando viene en formato YYYY-MM-DD.
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return new Date(`${value}T12:00:00`);
    }

    return new Date(value);
}

function formatFecha(value) {
    if (!value) return '-';
    const date = parseDashboardDate(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatFechaCorta(value) {
    if (!value) return '-';
    const date = parseDashboardDate(value);
    return Number.isNaN(date.getTime())
        ? value
        : date.toLocaleDateString('es-MX', {
            weekday: 'short',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
}

function formatDiaCabecera(value) {
    if (!value) return '-';
    const date = parseDashboardDate(value);
    return Number.isNaN(date.getTime())
        ? value
        : date.toLocaleDateString('es-MX', {
            weekday: 'short',
            day: '2-digit',
            month: '2-digit'
        });
}

function toPublicImageUrl(ruta) {
    if (!ruta) return '';

    if (ruta.startsWith('/evidencias_bitacora/') || ruta.startsWith('/evidencias/') || ruta.startsWith('/evidencias_limpieza/')) {
        return ruta;
    }

    const clean = ruta.replace(/\\/g, '/');

    const idxLimp = clean.indexOf('/evidencias_limpieza/');
    if (idxLimp >= 0) {
        return clean.slice(idxLimp);
    }

    const idxBitNuevo = clean.indexOf('/evidencias_bitacora/');
    if (idxBitNuevo >= 0) {
        return clean.slice(idxBitNuevo);
    }

    const idxBit = clean.indexOf('/evidencias/');
    if (idxBit >= 0) {
        return clean.slice(idxBit);
    }

    return `/${clean.replace(/^\/+/, '')}`;
}

function buildParams() {
    const params = new URLSearchParams();
    params.set('page', String(state.page));
    params.set('pageSize', String(state.pageSize));

    const search = els.filterSearch.value.trim();
    const from = toIsoOrEmpty(els.filterFrom.value);
    const to = toIsoOrEmpty(els.filterTo.value);
    const area = els.filterArea.value.trim();
    const extra = els.filterExtra.value.trim();

    if (search) params.set('search', search);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (area) params.set('area', area);

    if (state.tab === 'supervisor' && state.scope === 'bitacora' && extra) params.set('tecnico', extra);
    if (state.tab === 'limpieza' && extra) params.set('autor', extra);

    if (state.tab === 'supervisor' && extra) {
        if (state.scope === 'asistencia') params.set('autor', extra);
        if (state.scope === 'pendientes') params.set('estado', extra);
        if (state.scope === 'preventivos') params.set('estado', extra);
        if (state.scope === 'completados') params.set('prioridad', extra);
        if (state.scope === 'proyectos') params.set('estado', extra);
    }

    if (state.tab === 'supervisor' && state.scope === 'asistencia') {
        const fromDate = from ? String(from).slice(0, 10) : '';
        params.set('weekStart', fromDate || getWeekRangeMx().weekStart);
    }

    return params;
}

function getEndpoint() {
    if (state.tab === 'principal') return '';
    if (state.tab === 'supervisor' && state.scope === 'bitacora') return '/api/v1/bitacora/actividades';
    if (state.tab === 'supervisor' && state.scope === 'asistencia') return '/api/v1/asistencia/marcador-semanal';

    if (state.tab === 'limpieza') {
        return '/api/v1/limpieza/actividades';
    }
    if (state.tab === 'supervisor' && state.scope === 'preventivos') return '/api/v1/supervisor/preventivos';
    if (state.tab === 'supervisor' && state.scope === 'completados') return '/api/v1/supervisor/completados';
    if (state.scope === 'proyectos') return '/api/v1/supervisor/proyectos';
    return '/api/v1/supervisor/pendientes';
}

function obtenerFechaHoyMxIso() {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Mexico_City',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());

    const year = parts.find((p) => p.type === 'year')?.value;
    const month = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;

    return `${year}-${month}-${day}`;
}

function obtenerMinutosActualesMx() {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Mexico_City',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit'
    }).formatToParts(new Date());

    const hour = Number.parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
    const minute = Number.parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);

    return (hour * 60) + minute;
}

function turnoIncluyeHora(turno = '', minutoActual = 0) {
    const match = (turno || '').match(/(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})/);
    if (!match) {
        return false;
    }

    const inicio = (Number.parseInt(match[1], 10) * 60) + Number.parseInt(match[2], 10);
    const fin = (Number.parseInt(match[3], 10) * 60) + Number.parseInt(match[4], 10);

    if (inicio === fin) {
        return false;
    }

    // Turno normal (mismo dia)
    if (inicio < fin) {
        return minutoActual >= inicio && minutoActual < fin;
    }

    // Turno nocturno (cruza medianoche)
    return minutoActual >= inicio || minutoActual < fin;
}

function construirIndicadorEstadoPersistido(items = [], area = '') {
    const resumen = {
        enTurno: [],
        salida: [],
        fueraTurno: [],
        descanso: [],
        permiso: [],
        sinCobertura: true
    };

    items.forEach((persona) => {
        const nombre = persona.persona || '-';
        const estado = normalizarTexto((persona.estadoTurno || persona.estado || '').toString());

        if (estado === 'descanso') {
            resumen.descanso.push(nombre);
            return;
        }

        if (estado === 'permiso') {
            resumen.permiso.push(nombre);
            return;
        }

        resumen.sinCobertura = false;

        if (estado === 'en_turno' || estado === 'enturno') {
            resumen.enTurno.push(nombre);
            return;
        }

        if (estado === 'salida') {
            resumen.salida.push(nombre);
            return;
        }

        resumen.fueraTurno.push(nombre);
    });

    if (area === 'LIMPIEZA' && resumen.enTurno.length === 0 && resumen.salida.length === 0 && resumen.descanso.length === 0 && resumen.permiso.length === 0) {
        resumen.sinCobertura = true;
    }

    return resumen;
}

function normalizarTexto(valor = '') {
    return valor
        .toString()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function toSafeNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function fmtNum(value) {
    return toSafeNumber(value).toLocaleString('es-MX');
}

function sumarCampo(items = [], campo = '') {
    return (items || []).reduce((acc, item) => acc + toSafeNumber(item?.[campo]), 0);
}

function construirResumenMensualLimpieza(data) {
    const items = data?.items || [];
    return {
        personas: items.length,
        dias: sumarCampo(items, 'dias_con_asistencia'),
        reportes: sumarCampo(items, 'total_reportes'),
        evidencias: sumarCampo(items, 'total_evidencias')
    };
}

function construirResumenMensualMtto(data) {
    const items = data?.items || [];
    return {
        personas: items.length,
        dias: sumarCampo(items, 'dias_con_asistencia'),
        reportes: sumarCampo(items, 'total_reportes'),
        evidencias: sumarCampo(items, 'total_evidencias')
    };
}

function construirResumenMttoHoy(data) {
    const items = data?.items || [];
    const resumen = { A: 0, D: 0, P: 0, R: 0, F: 0 };

    items.forEach((item) => {
        const estado = (item?.estado || '').toString().toUpperCase();
        if (!Object.prototype.hasOwnProperty.call(resumen, estado)) {
            resumen.F += 1;
            return;
        }
        resumen[estado] += 1;
    });

    return {
        total: items.length,
        asistencia: resumen.A,
        descanso: resumen.D,
        permiso: resumen.P,
        retardo: resumen.R,
        falta: resumen.F
    };
}

function esProyectoAbierto(estado = '') {
    const e = normalizarTexto(estado || 'abierto');
    return !['cerrado', 'completado', 'cancelado', 'finalizado'].includes(e);
}

function renderHomeImpactIndicators({ pendientesHoy = 0, preventivosHoy = 0, limpiezaHoy = 0, proyectosActivos = 0 }) {
    return `
        <section class="home-impact-row">
            <button class="home-impact-card critical" type="button" data-home-tab="supervisor" data-home-scope="pendientes">
                <span class="home-impact-label">Urgente MTTO</span>
                <strong>${fmtNum(pendientesHoy)}</strong>
                <small>Pendientes abiertos hoy</small>
            </button>
            <button class="home-impact-card warning" type="button" data-home-tab="supervisor" data-home-scope="preventivos">
                <span class="home-impact-label">Preventivos</span>
                <strong>${fmtNum(preventivosHoy)}</strong>
                <small>Preventivos abiertos</small>
            </button>
            <button class="home-impact-card limpieza" type="button" data-home-tab="limpieza" data-home-limpieza-view="actividades">
                <span class="home-impact-label">Limpieza hoy</span>
                <strong>${fmtNum(limpiezaHoy)}</strong>
                <small>Actividades registradas</small>
            </button>
            <button class="home-impact-card projects" type="button" data-home-tab="supervisor" data-home-scope="proyectos">
                <span class="home-impact-label">Proyectos activos</span>
                <strong>${fmtNum(proyectosActivos)}</strong>
                <small>Seguimiento de implementación</small>
            </button>
        </section>
    `;
}

function renderPrincipalListado({ summary, pendientes, preventivos, proyectosActivosCount }) {
    const pendientesAbiertos = (pendientes.items || []).filter((x) => {
        return (x.estado || '').toLowerCase() === 'pendiente';
    }).slice(0, 5);

    const topPendiente = pendientesAbiertos[0] || null;
    const preventivosAbiertos = preventivos?.items || [];

    const semaforo = Number(summary.pendientesAbiertos || 0) > 5
        ? { code: 'ROJO', className: 'estado-f', msg: 'Atencion inmediata en pendientes.' }
        : Number(summary.pendientesAbiertos || 0) > 2
            ? { code: 'AMARILLO', className: 'estado-r', msg: 'Riesgo operativo moderado, vigilar pendientes.' }
            : { code: 'VERDE', className: 'estado-a', msg: 'Operacion estable con seguimiento normal.' };

    const totalPreventivos = summary.pendientesPreventivos ?? 0;
    const proyectosActivos = fmtNum(proyectosActivosCount ?? 0);

    return `
        <div class="card home-summary-card">
            <h3>Centro Operativo | Vista ejecutiva</h3>
            <div class="semaforo-wrap">
                <div class="semaforo-badge ${semaforo.className}">${semaforo.code}</div>
                <div class="semaforo-text">${semaforo.msg}</div>
            </div>
            <div class="home-metrics">
                <span>Pendientes ${summary.pendientesAbiertos ?? '-'}</span>
                <span>Preventivos ${summary.pendientesPreventivos ?? '-'}</span>
                <span>Proyectos activos ${proyectosActivos}</span>
                <span>Limpieza ${summary.limpieza ?? '-'}</span>
            </div>
        </div>

        <section class="home-dual-layout">
            <article class="card home-area home-area-mtto">
                <div class="home-area-head">
                    <div>
                        <h3>Mantenimiento (MTTO)</h3>
                        <p>Operacion de ingenieria sin mezclar con limpieza.</p>
                    </div>
                    <span class="home-live-pill">Tiempo real</span>
                </div>

                <div class="home-area-kpis">
                    <button class="home-kpi-card" type="button" data-home-tab="supervisor" data-home-scope="pendientes">
                        <small>Hoy</small>
                        <strong>${fmtNum(summary.pendientesAbiertos ?? 0)}</strong>
                        <span>Pendientes abiertos</span>
                    </button>
                    <button class="home-kpi-card" type="button" data-home-tab="supervisor" data-home-scope="preventivos">
                        <small>Hoy</small>
                        <strong>${fmtNum(totalPreventivos)}</strong>
                        <span>Preventivos</span>
                    </button>
                    <button class="home-kpi-card" type="button" data-home-tab="supervisor" data-home-scope="bitacora">
                        <small>Hoy</small>
                        <strong>${fmtNum(summary.bitacora ?? 0)}</strong>
                        <span>Registros bitacora</span>
                    </button>
                    <button class="home-kpi-card" type="button" data-home-tab="supervisor" data-home-scope="proyectos">
                        <small>Actual</small>
                        <strong>${proyectosActivos}</strong>
                        <span>Proyectos activos</span>
                    </button>
                </div>

                <div class="home-area-strip">
                    <span>Pendientes: <b>${fmtNum(summary.pendientesAbiertos ?? 0)}</b></span>
                    <span>Preventivos: <b>${fmtNum(totalPreventivos)}</b></span>
                    <span>Bitacora: <b>${fmtNum(summary.bitacora ?? 0)}</b></span>
                </div>

                <div class="home-actions-grid">
                    <button class="home-action-btn" type="button" data-home-tab="supervisor" data-home-scope="preventivos">Preventivos abiertos</button>
                    <button class="home-action-btn" type="button" data-home-tab="supervisor" data-home-scope="bitacora">Bitacora MTTO</button>
                    <button class="home-action-btn" type="button" data-home-tab="supervisor" data-home-scope="proyectos">Proyectos activos</button>
                </div>

                <div class="home-list-mini">
                    ${preventivosAbiertos.length
                        ? preventivosAbiertos.slice(0, 3).map((item) => `
                            <div class="home-list-item">
                                <b>[${item.id}] ${item.prioridad || '-'}</b>
                                <span>${(item.descripcion || '-').slice(0, 110)}</span>
                                <small>${item.area || 'SHP1'}</small>
                            </div>
                        `).join('')
                        : '<div class="home-list-empty">Sin preventivos abiertos.</div>'}
                </div>
            </article>

            <article class="card home-area home-area-limpieza">
                <div class="home-area-head">
                    <div>
                        <h3>Limpieza</h3>
                        <p>Seguimiento diario y mensual del equipo de limpieza.</p>
                    </div>
                    <span class="home-live-pill">Tiempo real</span>
                </div>

                <div class="home-area-kpis">
                    <button class="home-kpi-card" type="button" data-home-tab="limpieza" data-home-limpieza-view="actividades">
                        <small>Hoy</small>
                        <strong>${fmtNum(summary.limpieza ?? 0)}</strong>
                        <span>Actividades</span>
                    </button>
                    <button class="home-kpi-card" type="button" data-home-tab="limpieza" data-home-limpieza-view="actividades">
                        <small>Actual</small>
                        <strong>${fmtNum(summary.limpieza ?? 0)}</strong>
                        <span>Carga operativa</span>
                    </button>
                </div>

                <div class="home-area-strip">
                    <span>Actividades: <b>${fmtNum(summary.limpieza ?? 0)}</b></span>
                    <span>Pendientes abiertos: <b>${fmtNum(summary.pendientesAbiertos ?? 0)}</b></span>
                </div>

                <div class="home-actions-grid">
                    <button class="home-action-btn" type="button" data-home-tab="limpieza" data-home-limpieza-view="actividades">Bitacora limpieza</button>
                </div>

                <div class="home-list-mini">
                    <div class="home-list-empty">Vista de limpieza enfocada en actividades y evidencias.</div>
                </div>
            </article>
        </section>

        <section class="home-bottom-grid">
            <button class="card home-mini-card home-panel-button" type="button" data-home-tab="supervisor" data-home-scope="pendientes">
                <h3>Pendiente clave del turno</h3>
                <div class="home-mini-line">${topPendiente ? `#${topPendiente.id} · ${topPendiente.area || '-'} · ${topPendiente.prioridad || '-'}` : 'Sin pendientes abiertos relevantes.'}</div>
                <div class="home-mini-line">Abrir Ingenieria > Pendientes para detalle completo.</div>
            </button>
        </section>
    `;
}

function renderIngenieriaAsistenciaCard(ingenieria) {
    const items = ingenieria?.items || [];
    const listado = items.length
        ? items.map((x) => `
            <li>
                <span class="asistencia-chip ${x.estado === 'A' ? 'estado-a' : (x.estado === 'P' ? 'estado-p' : (x.estado === 'R' ? 'estado-r' : (x.estado === 'D' ? 'estado-d' : 'estado-f')))}">${x.estado}</span>
                ${x.persona || '-'} | ${x.puesto || '-'} | ${x.turno || '-'}
            </li>
        `).join('')
        : '<li>Sin datos de asistencia de ingenieria hoy.</li>';

    return `
        <div class="card">
            <h3>Ingenieria de Planta | Asistencia hoy</h3>
            <ul>${listado}</ul>
        </div>
    `;
}

function renderSupervisorAsistenciaListado(data) {
    const items = data?.items || [];
    if (!items.length) {
        return '';
    }

    const periodLabel = data.periodo === 'mensual'
        ? `Mes ${data.month || ''}`
        : data.periodo === 'semanal'
            ? `Semana ${formatFechaCorta(data.weekStart)} - ${formatFechaCorta(data.weekEnd)}`
            : `Dia ${formatFechaCorta(data.fecha)}`;

    const rows = items.map((x) => {
        const meta = metaEstadoAsistencia(x.estado);
        const estadoLabel = x.estado === 'A'
            ? 'Asistencia en tiempo'
            : x.estado === 'P'
                ? 'Permiso autorizado'
            : x.estado === 'R'
                ? 'Retardo de asistencia'
                : 'Sin asistencia';

        return `
            <article class="asistencia-person-card asistencia-person-card-wide">
                <div class="asistencia-person-top">
                    <div>
                        <div class="asistencia-person-name">${x.persona || '-'}</div>
                        <div class="asistencia-person-meta">${x.puesto || '-'} · ${x.turno || '-'}</div>
                    </div>
                    <span class="asistencia-chip ${meta.className}" title="${estadoLabel}">${x.estado}</span>
                </div>
                <div class="asistencia-person-stats">
                    <div><small>Estado</small><b>${meta.label}</b></div>
                    <div><small>Reportes</small><b>${x.total_reportes ?? 0}</b></div>
                    <div><small>Evidencias</small><b>${x.total_evidencias ?? 0}</b></div>
                    <div><small>Periodo</small><b>${periodLabel}</b></div>
                </div>
            </article>
        `;
    }).join('');

    const totalA = items.filter((x) => x.estado === 'A').length;
    const totalP = items.filter((x) => x.estado === 'P').length;
    const totalR = items.filter((x) => x.estado === 'R').length;
    const totalF = items.filter((x) => x.estado === 'F').length;

    return `
        ${renderAsistenciaHeaderVisual({
            title: 'Ingenieria de planta | Asistencia',
            subtitle: periodLabel,
            counts: { A: totalA, D: 0, P: totalP, R: totalR, F: totalF }
        })}
        <div class="asistencia-cards-grid">${rows}</div>
    `;
}

function renderSupervisorAsistenciaMarcadorListado(data) {
    const items = data?.items || [];
    const days = data?.days || [];

    if (!items.length) {
        return '';
    }

    const headDias = days.map((day) => `<th class="fecha-col">${formatDiaCabecera(day)}</th>`).join('');

    const bodyRows = items.map((item) => {
        const dias = (item.marcador || []).map((dia) => {
            const className = dia.estado === 'A' ? 'estado-a' : (dia.estado === 'D' ? 'estado-d' : (dia.estado === 'P' ? 'estado-p' : (dia.estado === 'R' ? 'estado-r' : 'estado-f')));
            const tooltip = dia.estado === 'A'
                ? `Asistencia en tiempo (${dia.total_reportes || 0} reportes)`
                : dia.estado === 'D'
                    ? 'Descanso programado'
                    : dia.estado === 'P'
                        ? 'Permiso autorizado'
                    : dia.estado === 'R'
                        ? 'Retardo de asistencia (> 1 hora)'
                        : 'Falta';

            return `
                <td>
                    <span class="asistencia-chip ${className}" title="${tooltip}">${dia.estado}</span>
                </td>
            `;
        }).join('');

        return `
            <tr>
                <td class="persona-col">${item.persona || '-'}</td>
                <td class="turno-col">${item.turno || '-'}</td>
                ${dias}
                <td class="tot-col">${item.totales?.A ?? 0}</td>
                <td class="tot-col">${item.totales?.D ?? 0}</td>
                <td class="tot-col">${item.totales?.P ?? 0}</td>
                <td class="tot-col">${item.totales?.R ?? 0}</td>
                <td class="tot-col">${item.totales?.F ?? 0}</td>
            </tr>
        `;
    }).join('');

    return `
        <div class="asistencia-legend">
            <span class="asistencia-chip estado-a">A</span> Asistencia
            <span class="asistencia-chip estado-d">D</span> Descanso
            <span class="asistencia-chip estado-p">P</span> Permiso
            <span class="asistencia-chip estado-r">R</span> Retardo
            <span class="asistencia-chip estado-f">F</span> Falta
        </div>
        <div class="status">Semana: ${formatFechaCorta(data.weekStart)} - ${formatFechaCorta(data.weekEnd)}</div>
        <div class="marcador-wrap">
            <table class="marcador-table">
                <thead>
                    <tr>
                        <th class="persona-col">Persona</th>
                        <th class="turno-col">Turno</th>
                        ${headDias}
                        <th>A</th>
                        <th>D</th>
                        <th>R</th>
                        <th>F</th>
                    </tr>
                </thead>
                <tbody>
                    ${bodyRows}
                </tbody>
            </table>
        </div>
    `;
}

function renderAlertasAsistenciaListado(data) {
    const items = data?.items || [];

    if (!items.length) {
        return `
            <div class="card card-section-title">
                <h3>Ingenieria de planta | Alertas de asistencia</h3>
                <div class="section-subtitle">No hay alertas activas en este momento.</div>
            </div>
        `;
    }

    const rows = items.map((item) => `
        <div class="alerta-row">
            <div class="alerta-col persona">${item.persona || '-'}</div>
            <div class="alerta-col turno">${item.turno || '-'}</div>
            <div class="alerta-col minutos">${item.minutosAtraso ?? 0} min</div>
            <div class="alerta-col grupo">${item.grupo || '-'}</div>
        </div>
    `).join('');

    return `
        <div class="card card-section-title">
            <h3>Ingenieria de planta | Alertas de asistencia</h3>
            <div class="section-subtitle">Personal en turno sin registro de check-in despues de ${data.toleranciaMin || 60} minutos de iniciado el turno.</div>
        </div>
        <div class="asistencia-legend">
            <span class="asistencia-chip estado-f">ALERTA</span> Requiere seguimiento operativo
        </div>
        <section class="alerta-panel">
            <div class="alerta-row alerta-head">
                <div class="alerta-col persona">Persona</div>
                <div class="alerta-col turno">Turno</div>
                <div class="alerta-col minutos">Atraso</div>
                <div class="alerta-col grupo">Grupo esperado</div>
            </div>
            ${rows}
        </section>
    `;
}

async function cargarVistaPrincipal() {
    const [summaryResp, pendientesResp, preventivosResp, proyectosResp] = await Promise.all([
        apiFetch('/api/v1/summary'),
        apiFetch('/api/v1/supervisor/pendientes?page=1&pageSize=25'),
        apiFetch('/api/v1/supervisor/preventivos?page=1&pageSize=10'),
        apiFetch('/api/v1/supervisor/proyectos?page=1&pageSize=200')
    ]);

    if (!summaryResp.ok || !pendientesResp.ok || !preventivosResp.ok || !proyectosResp.ok) {
        throw new Error('No se pudo cargar la vista principal');
    }

    const [summary, pendientes, preventivos, proyectos] = await Promise.all([
        summaryResp.json(),
        pendientesResp.json(),
        preventivosResp.json(),
        proyectosResp.json()
    ]);

    const proyectosActivosCount = (proyectos?.items || []).filter((p) => esProyectoAbierto(p?.estado)).length;

    if (els.homeTopIndicators) {
        els.homeTopIndicators.innerHTML = renderHomeImpactIndicators({
            pendientesHoy: summary.pendientesAbiertos ?? 0,
            preventivosHoy: summary.pendientesPreventivos ?? 0,
            limpiezaHoy: summary.limpieza ?? 0,
            proyectosActivos: proyectosActivosCount
        });
    }

    els.listado.innerHTML = renderPrincipalListado({ summary, pendientes, preventivos, proyectosActivosCount });
    els.status.textContent = 'Vista principal actualizada.';
    els.pageInfo.textContent = 'Principal';
}

function obtenerEstadoAsistencia(item) {
    const reportes = Number(item.total_reportes || 0);
    const evidencias = Number(item.total_evidencias || 0);

    if (reportes <= 0) return { code: 'F', label: 'Sin registro', className: 'estado-f' };
    if (evidencias <= 0) return { code: 'R', label: 'Sin evidencia', className: 'estado-r' };
    return { code: 'A', label: 'Asistencia OK', className: 'estado-a' };
}

function metaEstadoAsistencia(estado = '') {
    if (estado === 'A') return { className: 'estado-a', label: 'Asistencia' };
    if (estado === 'D') return { className: 'estado-d', label: 'Descanso' };
    if (estado === 'P') return { className: 'estado-p', label: 'Permiso' };
    if (estado === 'R') return { className: 'estado-r', label: 'Retardo' };
    return { className: 'estado-f', label: 'Falta' };
}

function renderAsistenciaHeaderVisual({ title = 'Asistencia', subtitle = '', counts = {} }) {
    const a = Number(counts.A || 0);
    const d = Number(counts.D || 0);
    const p = Number(counts.P || 0);
    const r = Number(counts.R || 0);
    const f = Number(counts.F || 0);

    return `
        <section class="asistencia-hero">
            <div class="asistencia-hero-head">
                <h3>${title}</h3>
                <div class="section-subtitle">${subtitle}</div>
            </div>
            <div class="asistencia-kpi-grid">
                <div class="asistencia-kpi asistencia-kpi-a"><span>A</span><strong>${a}</strong><small>Asistencia</small></div>
                <div class="asistencia-kpi asistencia-kpi-d"><span>D</span><strong>${d}</strong><small>Descanso</small></div>
                <div class="asistencia-kpi asistencia-kpi-p"><span>P</span><strong>${p}</strong><small>Permiso</small></div>
                <div class="asistencia-kpi asistencia-kpi-r"><span>R</span><strong>${r}</strong><small>Retardo</small></div>
                <div class="asistencia-kpi asistencia-kpi-f"><span>F</span><strong>${f}</strong><small>Falta</small></div>
            </div>
        </section>
    `;
}

function toDateOnlyIsoSafe(value) {
    if (!value) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
        return String(value);
    }

    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) {
        return '';
    }

    return dt.toISOString().slice(0, 10);
}

function startOfWeekMondayIso(value) {
    const base = parseIsoDateUtcNoon(toDateOnlyIsoSafe(value));
    if (!base) {
        return getWeekRangeMx().weekStart;
    }

    const dayIndex = (base.getUTCDay() + 6) % 7;
    base.setUTCDate(base.getUTCDate() - dayIndex);
    return formatIsoDate(base);
}

function listWeekStartsBetween(fromIso, toIso) {
    const fromBase = parseIsoDateUtcNoon(toDateOnlyIsoSafe(fromIso));
    const toBase = parseIsoDateUtcNoon(toDateOnlyIsoSafe(toIso));
    if (!fromBase || !toBase) {
        return [getWeekRangeMx().weekStart];
    }

    const weekStarts = [];
    let current = parseIsoDateUtcNoon(startOfWeekMondayIso(fromIso));
    const end = parseIsoDateUtcNoon(startOfWeekMondayIso(toIso));

    while (current && end && current.getTime() <= end.getTime()) {
        weekStarts.push(formatIsoDate(current));
        current.setUTCDate(current.getUTCDate() + 7);
    }

    return weekStarts;
}

async function fetchMarcadorLimpiezaWeek(weekStart) {
    const qs = new URLSearchParams();
    qs.set('page', '1');
    qs.set('pageSize', '100');
    qs.set('weekStart', weekStart);

    const resp = await apiFetch(`/api/v1/limpieza/asistencia-marcador?${qs.toString()}`);
    if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
    }

    return resp.json();
}

function buildDescansosByDayFromMarcador(marcadorData, fromIso = '', toIso = '') {
    const from = toDateOnlyIsoSafe(fromIso);
    const to = toDateOnlyIsoSafe(toIso);
    const map = new Map();

    for (const item of (marcadorData?.items || [])) {
        for (const dia of (item.marcador || [])) {
            if (dia.estado !== 'D') continue;

            const fecha = toDateOnlyIsoSafe(dia.fecha);
            if (!fecha) continue;
            if (from && fecha < from) continue;
            if (to && fecha > to) continue;

            if (!map.has(fecha)) {
                map.set(fecha, []);
            }

            map.get(fecha).push(item.persona || '-');
        }
    }

    return map;
}

function renderDescansosPanel({ title = 'Descansos', descansosByDay = new Map() }) {
    const fechas = Array.from(descansosByDay.keys()).sort();
    const bloques = fechas.map((fecha) => {
        const personas = (descansosByDay.get(fecha) || []).sort((a, b) => a.localeCompare(b, 'es-MX'));
        const chips = personas.length
            ? personas.map((nombre) => `<span class="descanso-chip">${nombre}</span>`).join('')
            : '<span class="descanso-empty-mini">Sin descanso</span>';

        return `
            <article class="descanso-day-card">
                <div class="descanso-day-top">
                    <strong>${formatFechaCorta(fecha)}</strong>
                    <span class="descanso-day-count">${personas.length}</span>
                </div>
                <div class="descanso-chip-cloud">${chips}</div>
            </article>
        `;
    }).join('');

    if (!bloques) {
        return `
            <section class="descanso-board">
                <div class="descanso-board-head">
                    <h3>${title}</h3>
                </div>
                <div class="descanso-empty">Sin descansos</div>
            </section>
        `;
    }

    return `
        <section class="descanso-board">
            <div class="descanso-board-head">
                <h3>${title}</h3>
            </div>
            <div class="descanso-days-grid">
                ${bloques}
            </div>
        </section>
    `;
}

async function buildDescansosPanelForLimpieza(scope, params) {
    const from = params.get('from') || '';
    const to = params.get('to') || '';

    if (scope === 'marcador') {
        return '';
    }

    if (scope === 'diaria') {
        const fechaObjetivo = toDateOnlyIsoSafe(from || to || getMxTodayIso());
        const weekStart = startOfWeekMondayIso(fechaObjetivo);
        const marcador = await fetchMarcadorLimpiezaWeek(weekStart);
        const byDay = buildDescansosByDayFromMarcador(marcador, fechaObjetivo, fechaObjetivo);
        return renderDescansosPanel({
            title: `Descansan hoy (${formatFechaCorta(fechaObjetivo)})`,
            descansosByDay: byDay
        });
    }

    if (scope === 'semanal') {
        const weekStart = params.get('weekStart') || startOfWeekMondayIso(from || getWeekRangeMx().from);
        const marcador = await fetchMarcadorLimpiezaWeek(toDateOnlyIsoSafe(weekStart));
        const byDay = buildDescansosByDayFromMarcador(marcador, from, to);
        return renderDescansosPanel({
            title: 'Descansos semanales',
            descansosByDay: byDay
        });
    }

    if (scope === 'mensual') {
        const monthRange = getMonthRangeMx();
        const start = toDateOnlyIsoSafe(from || monthRange.from);
        const end = toDateOnlyIsoSafe(to || monthRange.to);
        const weekStarts = listWeekStartsBetween(start, end);
        const acumulado = new Map();

        for (const weekStart of weekStarts) {
            const marcador = await fetchMarcadorLimpiezaWeek(weekStart);
            const byDay = buildDescansosByDayFromMarcador(marcador, start, end);

            for (const [fecha, personas] of byDay.entries()) {
                if (!acumulado.has(fecha)) {
                    acumulado.set(fecha, []);
                }

                acumulado.get(fecha).push(...personas);
            }
        }

        for (const [fecha, personas] of acumulado.entries()) {
            const unicos = Array.from(new Set(personas));
            acumulado.set(fecha, unicos);
        }

        return renderDescansosPanel({
            title: 'Descansos mensuales',
            descansosByDay: acumulado
        });
    }

    return '';
}

function renderAsistenciaListado(items, descansosHtml = '') {
    if (!items.length) {
        return '';
    }

    const grupos = new Map();

    for (const item of items) {
        const key = formatFechaCorta(item.fecha);
        if (!grupos.has(key)) {
            grupos.set(key, []);
        }
        grupos.get(key).push(item);
    }

    const bloques = [];
    const global = { A: 0, D: 0, P: 0, R: 0, F: 0 };

    for (const [fechaLabel, rows] of grupos.entries()) {
        const filas = rows.map((item) => {
            const estado = obtenerEstadoAsistencia(item);
            global[estado.code] += 1;
            return `
                <article class="asistencia-person-card">
                    <div class="asistencia-person-top">
                        <div>
                            <div class="asistencia-person-name">${item.autor || '-'}</div>
                            <div class="asistencia-person-meta">${formatFecha(item.fecha)}</div>
                        </div>
                        <span class="asistencia-chip ${estado.className}" title="${estado.label}">${estado.code}</span>
                    </div>
                    <div class="asistencia-person-stats">
                        <div><small>Reportes</small><b>${item.total_reportes ?? 0}</b></div>
                        <div><small>Evidencias</small><b>${item.total_evidencias ?? 0}</b></div>
                        <div><small>Primer registro</small><b>${formatFecha(item.primer_reporte)}</b></div>
                        <div><small>Ultimo registro</small><b>${formatFecha(item.ultimo_reporte)}</b></div>
                    </div>
                </article>
            `;
        }).join('');

        bloques.push(`
            <section class="asistencia-day">
                <h3>${fechaLabel}</h3>
                <div class="asistencia-cards-grid">
                    ${filas}
                </div>
            </section>
        `);
    }

    return `
        ${renderAsistenciaHeaderVisual({
            title: 'Limpieza | Asistencia diaria',
            subtitle: 'Vista visual por persona y fecha.',
            counts: global
        })}
        ${descansosHtml}
        ${bloques.join('')}
    `;
}

function renderAsistenciaSemanalListado(items) {
    if (!items.length) {
        return '';
    }

    const bloques = items.map((item) => {
        const dias = Number(item.dias_con_asistencia || 0);
        const estado = dias >= 6
            ? { code: 'A', label: 'Asistencia alta', className: 'estado-a' }
            : dias >= 3
                ? { code: 'R', label: 'Asistencia media', className: 'estado-r' }
                : { code: 'F', label: 'Asistencia baja', className: 'estado-f' };

        const semanaInicio = formatFechaCorta(item.semana_inicio);
        const semanaFin = formatFechaCorta(item.semana_fin);

        return `
            <section class="asistencia-day">
                <h3>${item.autor || '-'} | Semana ${semanaInicio} - ${semanaFin}</h3>
                <div class="asistencia-row asistencia-head">
                    <div class="asistencia-col persona">Elemento</div>
                    <div class="asistencia-col estado">Estado</div>
                    <div class="asistencia-col numero">Dias</div>
                    <div class="asistencia-col numero">Reportes</div>
                    <div class="asistencia-col numero">Evidencias</div>
                    <div class="asistencia-col hora">Ultimo registro</div>
                </div>
                <div class="asistencia-row">
                    <div class="asistencia-col persona">${item.autor || '-'}</div>
                    <div class="asistencia-col estado">
                        <span class="asistencia-chip ${estado.className}" title="${estado.label}">${estado.code}</span>
                    </div>
                    <div class="asistencia-col numero">${dias}</div>
                    <div class="asistencia-col numero">${item.total_reportes ?? 0}</div>
                    <div class="asistencia-col numero">${item.total_evidencias ?? 0}</div>
                    <div class="asistencia-col hora">${formatFecha(item.ultimo_reporte_semana)}</div>
                </div>
            </section>
        `;
    }).join('');

    return `
        <div class="asistencia-legend">
            <span class="asistencia-chip estado-a">A</span> 6-7 dias
            <span class="asistencia-chip estado-r">R</span> 3-5 dias
            <span class="asistencia-chip estado-f">F</span> 0-2 dias
        </div>
        ${bloques}
    `;
}

function renderAsistenciaAgrupadaListado(data, descansosHtml = '') {
    const items = data?.items || [];
    if (!items.length) {
        return '';
    }

    const isMonthly = data.periodo === 'mensual' || Boolean(data.month);
    const rangeStart = data.weekStart || data.monthStart || data.periodoInicio || data.periodo_inicio || data.from || '-';
    const rangeEnd = data.weekEnd || data.monthEnd || data.periodoFin || data.periodo_fin || data.to || '-';
    const title = isMonthly ? 'Mes' : 'Semana';
    const startLabel = formatFechaCorta(rangeStart);
    const endLabel = formatFechaCorta(rangeEnd);

    const global = { A: 0, D: 0, P: 0, R: 0, F: 0 };

    const bloques = items.map((item) => {
        const dias = Number(item.dias_con_asistencia || 0);
        const estado = dias >= 6
            ? { code: 'A', label: 'Asistencia alta', className: 'estado-a' }
            : dias >= 3
                ? { code: 'R', label: 'Asistencia media', className: 'estado-r' }
                : { code: 'F', label: 'Asistencia baja', className: 'estado-f' };
        global[estado.code] += 1;

        const periodoInicio = item.semana_inicio || item.mes_inicio || item.periodo_inicio || item.periodoInicio || rangeStart;
        const periodoFin = item.semana_fin || item.mes_fin || item.periodo_fin || item.periodoFin || rangeEnd;
        const ultimoPeriodo = item.ultimo_reporte_semana || item.ultimo_reporte_mes || item.ultimo_reporte_periodo || item.ultimo_reporte;

        return `
            <article class="asistencia-person-card asistencia-person-card-wide">
                <div class="asistencia-person-top">
                    <div>
                        <div class="asistencia-person-name">${item.autor || '-'}</div>
                        <div class="asistencia-person-meta">${title} ${formatFechaCorta(periodoInicio)} - ${formatFechaCorta(periodoFin)}</div>
                    </div>
                    <span class="asistencia-chip ${estado.className}" title="${estado.label}">${estado.code}</span>
                </div>
                <div class="asistencia-person-stats">
                    <div><small>Dias con asistencia</small><b>${dias}</b></div>
                    <div><small>Reportes</small><b>${item.total_reportes ?? 0}</b></div>
                    <div><small>Evidencias</small><b>${item.total_evidencias ?? 0}</b></div>
                    <div><small>Ultimo registro</small><b>${formatFecha(ultimoPeriodo)}</b></div>
                </div>
            </article>
        `;
    }).join('');

    return `
        ${renderAsistenciaHeaderVisual({
            title: `Limpieza | Asistencia ${isMonthly ? 'mensual' : 'semanal'}`,
            subtitle: `${title}: ${startLabel} - ${endLabel}`,
            counts: global
        })}
        ${descansosHtml}
        <div class="asistencia-cards-grid">${bloques}</div>
    `;
}

function classByEstado(estado) {
    if (estado === 'N' || estado === '-') return '';
    if (estado === 'A') return 'estado-a';
    if (estado === 'D') return 'estado-d';
    if (estado === 'P') return 'estado-p';
    if (estado === 'R') return 'estado-r';
    return 'estado-f';
}

function renderMarcadorSemanalArea({ titulo = '', dias = [], items = [] }) {
    if (!items.length) {
        return `
            <section class="card">
                <h3>${titulo}</h3>
                <div class="empty-state">Sin datos para esta semana.</div>
            </section>
        `;
    }

    const headDias = (dias || []).map((day) => `<th class="fecha-col">${formatDiaCabecera(day)}</th>`).join('');
    const bodyRows = items.map((item) => {
        const diasCols = (item.marcador || []).map((dia) => {
            const estado = dia.estado || '-';
            const className = classByEstado(estado === '-' ? 'N' : estado);
            return `<td><span class="asistencia-chip ${className}">${estado}</span></td>`;
        }).join('');

        return `
            <tr>
                <td class="persona-col">${item.persona || '-'}</td>
                <td class="turno-col">${item.turno || '-'}</td>
                ${diasCols}
                <td class="tot-col">${item.totales?.A ?? 0}</td>
                <td class="tot-col">${item.totales?.D ?? 0}</td>
                <td class="tot-col">${item.totales?.F ?? 0}</td>
            </tr>
        `;
    }).join('');

    return `
        <section class="card">
            <h3>${titulo}</h3>
            <div class="marcador-wrap">
                <table class="marcador-table">
                    <thead>
                        <tr>
                            <th class="persona-col">Persona</th>
                            <th class="turno-col">Turno</th>
                            ${headDias}
                            <th>A</th>
                            <th>D</th>
                            <th>F</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${bodyRows}
                    </tbody>
                </table>
            </div>
        </section>
    `;
}

function renderMarcadorSemanalAsistencia(data = {}) {
    const dias = data.days || [];
    const limpieza = data.limpieza?.items || [];
    const ingenieria = data.ingenieria?.items || [];
    const periodo = `Semana: ${formatFechaCorta(data.weekStart)} - ${formatFechaCorta(data.weekEnd)}`;

    return `
        <div class="card card-section-title">
            <h3>Asistencia semanal en tiempo real</h3>
            <div class="section-subtitle">${periodo}</div>
        </div>
        <div class="asistencia-legend">
            <span class="asistencia-chip estado-a">A</span> Asistencia
            <span class="asistencia-chip estado-d">D</span> Descanso
            <span class="asistencia-chip estado-f">F</span> Falta
            <span class="asistencia-chip">-</span> Dia no transcurrido
        </div>
        ${renderMarcadorSemanalArea({ titulo: 'Limpieza | Marcador semanal', dias, items: limpieza })}
        ${renderMarcadorSemanalArea({ titulo: 'Ingenieria | Marcador semanal', dias, items: ingenieria })}
    `;
}

function renderAsistenciaMarcadorListado(data) {
    const items = data.items || [];
    const days = data.days || [];

    if (!items.length) {
        return '';
    }

    const headDias = days.map((day) => {
        return `<th class="fecha-col">${formatDiaCabecera(day)}</th>`;
    }).join('');

    const bodyRows = items.map((item) => {
        const dias = (item.marcador || []).map((dia) => {
            const className = classByEstado(dia.estado);
            const tooltip = dia.estado === 'D'
                ? 'Descanso programado'
                : dia.estado === 'P'
                    ? 'Permiso autorizado'
                : dia.estado === 'A'
                    ? `Asistencia en tiempo (${dia.total_reportes || 0} reportes)`
                    : dia.estado === 'R'
                        ? 'Retardo de asistencia (> 1 hora sin evidencia)'
                        : 'Falta';

            return `
                <td>
                    <span class="asistencia-chip ${className}" title="${tooltip}">${dia.estado}</span>
                </td>
            `;
        }).join('');

        return `
            <tr>
                <td class="persona-col">${item.persona || '-'}</td>
                <td class="turno-col">${item.turno || '-'}</td>
                ${dias}
                <td class="tot-col">${item.totales?.A ?? 0}</td>
                <td class="tot-col">${item.totales?.D ?? 0}</td>
                <td class="tot-col">${item.totales?.P ?? 0}</td>
                <td class="tot-col">${item.totales?.R ?? 0}</td>
                <td class="tot-col">${item.totales?.F ?? 0}</td>
            </tr>
        `;
    }).join('');

    const descansosByDay = buildDescansosByDayFromMarcador(data, data.weekStart, data.weekEnd);
    const descansosHtml = renderDescansosPanel({
        title: 'Descansos de la semana (Marcador)',
        descansosByDay
    });

    return `
        <div class="asistencia-legend">
            <span class="asistencia-chip estado-a">A</span> Asistencia
            <span class="asistencia-chip estado-d">D</span> Descanso
            <span class="asistencia-chip estado-p">P</span> Permiso
            <span class="asistencia-chip estado-r">R</span> Retardo
            <span class="asistencia-chip estado-f">F</span> Falta
        </div>
        ${descansosHtml}
        <div class="status">Semana: ${formatFechaCorta(data.weekStart)} - ${formatFechaCorta(data.weekEnd)}</div>
        <div class="marcador-wrap">
            <table class="marcador-table">
                <thead>
                    <tr>
                        <th class="persona-col">Persona</th>
                        <th class="turno-col">Turno</th>
                        ${headDias}
                        <th>A</th>
                        <th>D</th>
                        <th>P</th>
                        <th>R</th>
                        <th>F</th>
                    </tr>
                </thead>
                <tbody>
                    ${bodyRows}
                </tbody>
            </table>
        </div>
    `;
}

function renderCard(item) {
    if (state.tab === 'supervisor' && state.scope === 'bitacora') {
        return `
            <div class="card">
                <h3>Bitacora #${item.id}</h3>
                <div class="meta">
                    <div><b>Tecnico:</b> ${item.tecnico || '-'}</div>
                    <div><b>Area:</b> ${item.area || '-'}</div>
                    <div><b>Turno:</b> ${item.turno || '-'}</div>
                    <div><b>Fecha:</b> ${formatFecha(item.fecha)}</div>
                </div>
                <div class="block-text"><b>Actividad</b>\n${item.actividad || '-'}</div>
                <div class="block-text"><b>Pendientes</b>\n${item.pendientes || '-'}</div>
                <button data-evid="${item.id}">Ver evidencias</button>
                <div class="evidencias" id="evid-${item.id}"></div>
            </div>
        `;
    }

    if (state.tab === 'limpieza' && state.limpiezaView === 'actividades') {
        const totalFotos = item.fotos_agrupadas || 0;
        const seguimiento = totalFotos > 0
            ? `Reporte con ${totalFotos} foto(s) agrupada(s).`
            : 'Reporte sin evidencia fotografica.';

        return `
            <div class="card card-limpieza">
                <h3>Bitacora Limpieza #${item.id}</h3>
                <div class="meta">
                    <div><b>Autor:</b> ${item.autor || '-'}</div>
                    <div><b>Area:</b> ${item.area || '-'}</div>
                    <div><b>Tipo:</b> ${item.tipo_mensaje || '-'}</div>
                    <div><b>Fecha:</b> ${formatFecha(item.fecha)}</div>
                </div>
                <div class="block-text"><b>Actividad</b>\n${item.actividad || '-'}</div>
                <div class="block-text"><b>Seguimiento</b>\n${seguimiento}</div>
                <button data-evid-limp="${item.id}">Ver evidencias (${totalFotos})</button>
                <div class="evidencias" id="evid-limp-${item.id}"></div>
            </div>
        `;
    }

    if (state.scope === 'pendientes' || state.scope === 'completados') {
        const responsable = item.responsable || item.creado_por || '-';
        const turnos = item.turno || item.turnos || '-';
        const tecnicos = item.tecnicos || '-';
        const titulo = state.scope === 'completados' ? 'Completado' : 'Pendiente';

        return `
            <div class="card">
                <h3>${titulo} #${item.id}</h3>
                <div class="meta">
                    <div><b>Prioridad:</b> ${item.prioridad || '-'}</div>
                    <div><b>Categoria:</b> ${item.categoria || 'GENERAL'}</div>
                    <div><b>Estado:</b> ${item.estado || '-'}</div>
                    <div><b>Area:</b> ${item.area || '-'}</div>
                    <div><b>Responsable:</b> ${responsable}</div>
                    <div><b>Turno(s):</b> ${turnos}</div>
                    <div><b>Tecnicos:</b> ${tecnicos}</div>
                    <div><b>Fecha:</b> ${formatFecha(item.fecha)}</div>
                    ${item.fecha_cierre ? `<div><b>Cierre:</b> ${formatFecha(item.fecha_cierre)}</div>` : ''}
                </div>
                <div class="block-text">${item.descripcion || '-'}</div>
                <button data-evid-sup-pend="${item.id}">Ver evidencias</button>
                <div class="evidencias" id="evid-sup-pend-${item.id}"></div>
            </div>
        `;
    }

    if (state.scope === 'preventivos') {
        return `
            <div class="card card-preventivo">
                <h3>Preventivo #${item.id}</h3>
                <div class="meta">
                    <div><b>Prioridad:</b> ${item.prioridad || '-'}</div>
                    <div><b>Categoria:</b> ${item.categoria || 'PREVENTIVO'}</div>
                    <div><b>Area:</b> ${item.area || '-'}</div>
                    <div><b>Creado por:</b> ${item.creado_por || '-'}</div>
                    <div><b>Fecha:</b> ${formatFecha(item.fecha)}</div>
                </div>
                <div class="block-text"><b>Descripcion</b>
${item.descripcion || '-'}</div>
                <div class="block-text"><b>Observaciones</b>
${item.observaciones || 'Sin observaciones'}</div>
                <div class="card-tag">Se cierra por WhatsApp con CERRAR PREVENTIVO ${item.id}</div>
            </div>
        `;
    }

    return `
        <div class="card">
            <h3>Proyecto #${item.id}</h3>
            <div class="meta">
                <div><b>Nombre:</b> ${item.nombre || '-'}</div>
                <div><b>Responsable:</b> ${item.responsable || '-'}</div>
                <div><b>Estado:</b> ${item.estado || '-'}</div>
                <div><b>Creado:</b> ${formatFecha(item.creado_en)}</div>
            </div>
            <div class="block-text">${item.descripcion || '-'}</div>
            <button data-evid-sup-proy="${item.id}">Ver evidencias</button>
            <div class="evidencias" id="evid-sup-proy-${item.id}"></div>
        </div>
    `;
}

async function cargarResumen() {
    try {
        const [resp, proyectosResp] = await Promise.all([
            apiFetch('/api/v1/summary'),
            apiFetch('/api/v1/supervisor/proyectos?page=1&pageSize=200')
        ]);
        const data = await resp.json();
        const proyectos = proyectosResp.ok ? await proyectosResp.json() : { items: [] };
        const proyectosActivosCount = (proyectos.items || []).filter((p) => esProyectoAbierto(p?.estado)).length;

        els.kpiBitacora.textContent = data.bitacora ?? '-';
        els.kpiLimpieza.textContent = data.limpieza ?? '-';
        els.kpiPendientes.textContent = data.pendientesAbiertos ?? '-';
        els.kpiProyectos.textContent = proyectosActivosCount;
    } catch (err) {
        console.error(err);
    }
}

async function cargarListado() {
    try {
        els.status.textContent = 'Cargando...';

        if (state.tab === 'principal') {
            await cargarVistaPrincipal();
            return;
        }

        const endpoint = getEndpoint();
        const params = buildParams();

        const resp = await apiFetch(`${endpoint}?${params.toString()}`);
        if (!resp.ok) {
            throw new Error(`HTTP ${resp.status}`);
        }

        const data = await resp.json();
        state.totalPages = data.totalPages || 1;
        state.page = Math.min(state.page, state.totalPages);

        if (state.tab === 'supervisor' && state.scope === 'asistencia') {
            els.listado.innerHTML = renderMarcadorSemanalAsistencia(data);
            els.pageInfo.textContent = 'Marcador semanal';
            els.status.textContent = 'Asistencia semanal actualizada.';
            return;
        }

        if (state.tab === 'supervisor' && state.scope === 'bitacora') {
            const items = data.items || [];
            els.listado.innerHTML = `
                <div class="card card-section-title">
                    <h3>Ingenieria de planta | Bitacora operativa</h3>
                    <div class="section-subtitle">Eventos de bitacora de mantenimiento por tecnico, area y turno.</div>
                </div>
                ${items.length ? items.map(renderCard).join('') : '<div class="empty-state">No hay registros de bitacora para los filtros actuales.</div>'}
            `;
        } else if (state.tab === 'supervisor' && state.scope === 'preventivos') {
            const items = data.items || [];
            els.listado.innerHTML = `
                <div class="card card-section-title">
                    <h3>Ingenieria de planta | Preventivos abiertos</h3>
                    <div class="section-subtitle">Solo preventivos pendientes, separados del resto de actividades.</div>
                </div>
                ${items.length ? items.map(renderCard).join('') : '<div class="empty-state">No hay preventivos abiertos.</div>'}
            `;
        } else if (state.tab === 'supervisor' && state.scope === 'completados') {
            const items = data.items || [];
            els.listado.innerHTML = `
                <div class="card card-section-title">
                    <h3>Ingenieria de planta | Historico completado</h3>
                    <div class="section-subtitle">Todos los pendientes y preventivos cerrados/completados.</div>
                </div>
                ${items.length ? items.map(renderCard).join('') : '<div class="empty-state">No hay registros completados.</div>'}
            `;
        } else if (state.tab === 'limpieza' && state.limpiezaView === 'actividades') {
            const items = data.items || [];
            els.listado.innerHTML = items.length ? items.map(renderCard).join('') : '<div class="empty-state">No hay actividades de limpieza para los filtros actuales.</div>';
        } else {
            els.listado.innerHTML = (data.items || []).map(renderCard).join('');
        }

        els.pageInfo.textContent = `Pagina ${state.page} de ${state.totalPages} | ${data.total} registros`;

        if ((data.items || []).length === 0) {
            els.status.textContent = 'Sin resultados para los filtros actuales.';
        } else {
            els.status.textContent = `Mostrando ${data.items.length} registros.`;
        }

        await conectarEventosEvidencias();
    } catch (err) {
        console.error(err);
        els.status.textContent = 'Error al cargar datos.';
        els.listado.innerHTML = '';
    }
}

async function conectarEventosEvidencias() {
    const bitBtns = document.querySelectorAll('[data-evid]');
    const limpBtns = document.querySelectorAll('[data-evid-limp]');
    const supPendBtns = document.querySelectorAll('[data-evid-sup-pend]');
    const supProyBtns = document.querySelectorAll('[data-evid-sup-proy]');

    for (const btn of bitBtns) {
        btn.onclick = async () => {
            const id = btn.getAttribute('data-evid');
            const wrap = document.getElementById(`evid-${id}`);

            if (wrap.innerHTML.trim()) {
                wrap.innerHTML = '';
                btn.textContent = 'Ver evidencias';
                return;
            }

            const r = await apiFetch(`/api/v1/bitacora/actividades/${id}/evidencias`);
            const evidencias = await r.json();
            const urls = evidencias.map((x) => toPublicImageUrl(x.ruta));

            wrap.innerHTML = urls.map((url, idx) => `
                <img class="thumb" src="${url}" alt="evidencia" data-modal-url="${url}" data-modal-index="${idx}">
            `).join('');

            wrap.querySelectorAll('[data-modal-url]').forEach((img) => {
                img.onclick = () => abrirModal(urls, Number.parseInt(img.dataset.modalIndex, 10));
            });

            btn.textContent = 'Ocultar evidencias';
        };
    }

    for (const btn of limpBtns) {
        btn.onclick = async () => {
            const id = btn.getAttribute('data-evid-limp');
            const wrap = document.getElementById(`evid-limp-${id}`);

            if (wrap.innerHTML.trim()) {
                wrap.innerHTML = '';
                btn.textContent = 'Ver evidencias';
                return;
            }

            const r = await apiFetch(`/api/v1/limpieza/actividades/${id}/evidencias`);
            const evidencias = await r.json();
            const urls = evidencias.map((x) => toPublicImageUrl(x.ruta));

            wrap.innerHTML = urls.map((url, idx) => `
                <img class="thumb" src="${url}" alt="evidencia" data-modal-url="${url}" data-modal-index="${idx}">
            `).join('');

            wrap.querySelectorAll('[data-modal-url]').forEach((img) => {
                img.onclick = () => abrirModal(urls, Number.parseInt(img.dataset.modalIndex, 10));
            });

            btn.textContent = 'Ocultar evidencias';
        };
    }

    for (const btn of supPendBtns) {
        btn.onclick = async () => {
            const id = btn.getAttribute('data-evid-sup-pend');
            const wrap = document.getElementById(`evid-sup-pend-${id}`);

            if (wrap.innerHTML.trim()) {
                wrap.innerHTML = '';
                btn.textContent = 'Ver evidencias';
                return;
            }

            const r = await apiFetch(`/api/v1/supervisor/pendientes/${id}/evidencias`);
            const evidencias = await r.json();
            const urls = evidencias.map((x) => toPublicImageUrl(x.ruta));

            wrap.innerHTML = urls.map((url, idx) => `
                <img class="thumb" src="${url}" alt="evidencia" data-modal-url="${url}" data-modal-index="${idx}">
            `).join('');

            wrap.querySelectorAll('[data-modal-url]').forEach((img) => {
                img.onclick = () => abrirModal(urls, Number.parseInt(img.dataset.modalIndex, 10));
            });

            btn.textContent = 'Ocultar evidencias';
        };
    }

    for (const btn of supProyBtns) {
        btn.onclick = async () => {
            const id = btn.getAttribute('data-evid-sup-proy');
            const wrap = document.getElementById(`evid-sup-proy-${id}`);

            if (wrap.innerHTML.trim()) {
                wrap.innerHTML = '';
                btn.textContent = 'Ver evidencias';
                return;
            }

            const r = await apiFetch(`/api/v1/supervisor/proyectos/${id}/evidencias`);
            const evidencias = await r.json();
            const urls = evidencias.map((x) => toPublicImageUrl(x.ruta));

            wrap.innerHTML = urls.map((url, idx) => `
                <img class="thumb" src="${url}" alt="evidencia" data-modal-url="${url}" data-modal-index="${idx}">
            `).join('');

            wrap.querySelectorAll('[data-modal-url]').forEach((img) => {
                img.onclick = () => abrirModal(urls, Number.parseInt(img.dataset.modalIndex, 10));
            });

            btn.textContent = 'Ocultar evidencias';
        };
    }
}

function abrirModal(images, index) {
    state.modalImages = images;
    state.modalIndex = index;
    renderModal();
    els.modal.style.display = 'block';
}

function cerrarModal() {
    els.modal.style.display = 'none';
}

function renderModal() {
    if (!state.modalImages.length) return;
    els.modalImage.src = state.modalImages[state.modalIndex];
    els.modalCounter.textContent = `${state.modalIndex + 1} / ${state.modalImages.length}`;
}

function modalPrev() {
    if (!state.modalImages.length) return;
    state.modalIndex = (state.modalIndex - 1 + state.modalImages.length) % state.modalImages.length;
    renderModal();
}

function modalNext() {
    if (!state.modalImages.length) return;
    state.modalIndex = (state.modalIndex + 1) % state.modalImages.length;
    renderModal();
}

function limpiarFiltros() {
    els.filterSearch.value = '';
    els.filterFrom.value = '';
    els.filterTo.value = '';
    els.filterArea.value = '';
    els.filterExtra.value = '';
}

function marcarTabsActivos(tabName) {
    els.tabs.forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
}

function marcarSubtabsActivos() {
    if (els.subtabs) {
        els.subtabs.forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.scope === state.scope);
        });
    }

    if (els.subtabsLimpieza) {
        els.subtabsLimpieza.forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.limpiezaView === state.limpiezaView);
        });
    }
}

function navegarDesdeHome(config) {
    state.tab = config.tab;
    state.page = 1;

    if (config.scope) {
        state.scope = config.scope;
    }

    if (config.limpiezaView) {
        state.limpiezaView = config.limpiezaView;
    }

    marcarTabsActivos(state.tab);
    syncUiByTab();
    marcarSubtabsActivos();
    cargarListado();
}

function syncUiByTab() {
    const isPrincipal = state.tab === 'principal';
    const isSupervisor = state.tab === 'supervisor';
    const isLimpieza = state.tab === 'limpieza';
    const isSupervisorAsistencia = isSupervisor && state.scope === 'asistencia';
    const isSupervisorPreventivos = isSupervisor && state.scope === 'preventivos';

    els.subtabsWrap.hidden = !isSupervisor;
    if (els.subtabsLimpiezaWrap) {
        els.subtabsLimpiezaWrap.hidden = !isLimpieza;
    }

    if (els.filtersWrap) {
        els.filtersWrap.hidden = isPrincipal;
    }

    if (els.paginationWrap) {
        els.paginationWrap.hidden = isPrincipal || isSupervisorAsistencia;
    }

    if (els.homeTopIndicators) {
        els.homeTopIndicators.hidden = !isPrincipal;
    }

    if (isPrincipal) {
        els.filterExtra.placeholder = 'No aplica en Principal';
    } else if (isSupervisor && state.scope === 'bitacora') {
        els.filterExtra.placeholder = 'Tecnico';
    } else if (state.tab === 'limpieza') {
        els.filterExtra.placeholder = 'Autor';
    } else if (isSupervisorAsistencia) {
        els.filterExtra.placeholder = 'Persona (opcional)';
    } else if (isSupervisorPreventivos) {
        els.filterExtra.placeholder = 'Prioridad';
    } else if (isSupervisor && state.scope === 'completados') {
        els.filterExtra.placeholder = 'Prioridad';
    } else {
        els.filterExtra.placeholder = 'Estado';
    }
}

function initEvents() {
    document.addEventListener('click', (event) => {
        const card = event.target.closest('[data-home-tab]');
        if (!card) return;

        navegarDesdeHome({
            tab: card.dataset.homeTab,
            scope: card.dataset.homeScope,
            limpiezaView: card.dataset.homeLimpiezaView
        });
    });

    els.tabs.forEach((tab) => {
        tab.onclick = () => {
            state.tab = tab.dataset.tab;
            state.page = 1;
            marcarTabsActivos(state.tab);
            syncUiByTab();
            cargarListado();
        };
    });

    els.subtabs.forEach((sub) => {
        sub.onclick = () => {
            state.scope = sub.dataset.scope;
            state.page = 1;
            marcarSubtabsActivos();
            syncUiByTab();
            cargarListado();
        };
    });

    if (els.subtabsLimpieza) {
        els.subtabsLimpieza.forEach((sub) => {
            sub.onclick = () => {
                state.limpiezaView = sub.dataset.limpiezaView;
                state.page = 1;
                marcarSubtabsActivos();
                syncUiByTab();
                cargarListado();
            };
        });
    }

    els.btnAplicar.onclick = () => {
        state.page = 1;
        cargarListado();
    };

    els.btnLimpiar.onclick = () => {
        limpiarFiltros();
        state.page = 1;
        cargarListado();
    };

    els.btnPrev.onclick = () => {
        if (state.page > 1) {
            state.page -= 1;
            cargarListado();
        }
    };

    els.btnNext.onclick = () => {
        if (state.page < state.totalPages) {
            state.page += 1;
            cargarListado();
        }
    };

    els.modalClose.onclick = cerrarModal;
    els.modalPrev.onclick = modalPrev;
    els.modalNext.onclick = modalNext;

    window.onclick = (event) => {
        if (event.target === els.modal) cerrarModal();
    };

    document.addEventListener('keydown', (event) => {
        if (els.modal.style.display !== 'block') return;
        if (event.key === 'Escape') cerrarModal();
        if (event.key === 'ArrowLeft') modalPrev();
        if (event.key === 'ArrowRight') modalNext();
    });
}

async function init() {
    initEvents();
    syncUiByTab();
    await cargarResumen();
    await cargarListado();
}

init();
