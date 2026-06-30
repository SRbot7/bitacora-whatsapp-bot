const state = {
    tab: 'principal',
    scope: 'pendientes',
    limpiezaView: 'actividades',
    asistenciaScope: 'diaria',
    supervisorAsistenciaScope: 'diaria',
    page: 1,
    pageSize: 20,
    totalPages: 1,
    modalImages: [],
    modalIndex: 0
};

const els = {
    listado: document.getElementById('listado'),
    status: document.getElementById('status'),
    tabs: document.querySelectorAll('.tab'),
    subtabsWrap: document.getElementById('subtabs-supervisor'),
    subtabs: document.querySelectorAll('#subtabs-supervisor .subtab'),
    subtabsSupervisorAsistenciaWrap: document.getElementById('subtabs-supervisor-asistencia'),
    subtabsSupervisorAsistencia: document.querySelectorAll('[data-supervisor-asistencia-scope]'),
    subtabsLimpiezaWrap: document.getElementById('subtabs-limpieza'),
    subtabsLimpieza: document.querySelectorAll('[data-limpieza-view]'),
    subtabsAsistenciaWrap: document.getElementById('subtabs-asistencia'),
    subtabsAsistencia: document.querySelectorAll('.asistencia-subtab'),
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
    kpiBitacora: document.getElementById('kpi-bitacora'),
    kpiLimpieza: document.getElementById('kpi-limpieza'),
    kpiPendientes: document.getElementById('kpi-pendientes'),
    kpiMateriales: document.getElementById('kpi-materiales'),
    kpiProyectos: document.getElementById('kpi-proyectos')
};

function toIsoOrEmpty(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
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

    if (ruta.startsWith('/evidencias/') || ruta.startsWith('/evidencias_limpieza/')) {
        return ruta;
    }

    const clean = ruta.replace(/\\/g, '/');

    const idxLimp = clean.indexOf('/evidencias_limpieza/');
    if (idxLimp >= 0) {
        return clean.slice(idxLimp);
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
        if (state.scope === 'pendientes') params.set('estado', extra);
        if (state.scope === 'preventivos') params.set('estado', extra);
        if (state.scope === 'completados') params.set('prioridad', extra);
        if (state.scope === 'materiales') params.set('estado', extra);
        if (state.scope === 'proyectos') params.set('estado', extra);
    }

    return params;
}

function getEndpoint() {
    if (state.tab === 'principal') return '';
    if (state.tab === 'supervisor' && state.scope === 'bitacora') return '/api/v1/bitacora/actividades';
    if (state.tab === 'supervisor' && state.scope === 'alertas') return '/api/v1/supervisor/asistencia-alertas';
    if (state.tab === 'supervisor' && state.scope === 'asistencia') {
        if (state.supervisorAsistenciaScope === 'mensual') {
            return '/api/v1/ingenieria/asistencia-mensual';
        }

        if (state.supervisorAsistenciaScope === 'semanal') {
            return '/api/v1/ingenieria/asistencia-semanal';
        }

        return '/api/v1/ingenieria/asistencia-hoy';
    }

    if (state.tab === 'limpieza') {
        if (state.limpiezaView === 'actividades') {
            return '/api/v1/limpieza/actividades';
        }

        if (state.asistenciaScope === 'marcador') {
            return '/api/v1/limpieza/asistencia-marcador';
        }

        return state.asistenciaScope === 'semanal'
            ? '/api/v1/limpieza/asistencia-semanal'
            : '/api/v1/limpieza/asistencia';
    }
    if (state.tab === 'supervisor' && state.scope === 'preventivos') return '/api/v1/supervisor/preventivos';
    if (state.tab === 'supervisor' && state.scope === 'completados') return '/api/v1/supervisor/completados';
    if (state.scope === 'materiales') return '/api/v1/supervisor/materiales';
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

function construirIndicadorTurnoLimpieza(asistencia = {}) {
    const hoy = obtenerFechaHoyMxIso();
    const minutoActual = obtenerMinutosActualesMx();
    const items = asistencia.items || [];

    const resumen = {
        enTurno: [],
        fueraTurno: [],
        descanso: [],
        sinCobertura: true
    };

    items.forEach((persona) => {
        const marcador = persona.marcador || [];
        const registroHoy = marcador.find((d) => d.fecha === hoy) || marcador[0];
        if (!registroHoy) return;

        const enVentanaTurno = turnoIncluyeHora(persona.turno, minutoActual);

        if (enVentanaTurno) {
            resumen.sinCobertura = false;
        }

        if (registroHoy.descanso || registroHoy.estado === 'R') {
            resumen.descanso.push(persona.persona || '-');
            return;
        }

        if (!enVentanaTurno) {
            return;
        }

        if (registroHoy.estado === 'A') {
            resumen.enTurno.push(persona.persona || '-');
            return;
        }

        resumen.fueraTurno.push(persona.persona || '-');
    });

    return resumen;
}

function construirIndicadorTurnoMantenimiento(asistenciaMtto = {}) {
    const items = asistenciaMtto.items || [];

    const resumen = {
        enTurno: [],
        fueraTurno: [],
        descanso: []
    };

    items.forEach((persona) => {
        if ((persona.estado || 'F') === 'A') {
            resumen.enTurno.push(persona.persona || '-');
            return;
        }

        resumen.fueraTurno.push(persona.persona || '-');
    });

    return resumen;
}

function renderPrincipalListado({ summary, pendientes, asistenciaLimpieza, asistenciaMtto, preventivos, alertasAsistencia }) {
    const pendientesAbiertos = (pendientes.items || []).filter((x) => {
        return (x.estado || '').toLowerCase() === 'pendiente';
    }).slice(0, 5);

    const asistenciaCritica = (asistenciaLimpieza.items || []).map((p) => {
        const faltas = Number(p?.totales?.F || 0);
        return {
            persona: p.persona,
            turno: p.turno,
            faltas
        };
    }).sort((a, b) => b.faltas - a.faltas).slice(0, 5);

    const topPendiente = pendientesAbiertos[0] || null;
    const topAsistencia = asistenciaCritica[0] || null;
    const preventivosAbiertos = preventivos?.items || [];
    const alertasActivas = alertasAsistencia?.items || [];
    const indicadorLimpieza = construirIndicadorTurnoLimpieza(asistenciaLimpieza);
    const indicadorMtto = construirIndicadorTurnoMantenimiento(asistenciaMtto);

    const maxFaltas = asistenciaCritica.length
        ? Math.max(...asistenciaCritica.map((x) => Number(x.faltas || 0)))
        : 0;

    const semaforo = Number(summary.pendientesAbiertos || 0) > 5 || maxFaltas >= 3
        ? { code: 'ROJO', className: 'estado-f', msg: 'Atencion inmediata en pendientes y asistencia.' }
        : Number(summary.pendientesAbiertos || 0) > 2 || maxFaltas >= 2
            ? { code: 'AMARILLO', className: 'estado-r', msg: 'Riesgo operativo moderado, vigilar indicadores.' }
            : { code: 'VERDE', className: 'estado-a', msg: 'Operacion estable con seguimiento normal.' };

    const totalPreventivos = summary.pendientesPreventivos ?? 0;

    return `
        <div class="home-grid">
            <button class="home-card home-card-green" data-home-tab="supervisor" data-home-scope="bitacora">
                <span class="home-icon">◉</span>
                <span class="home-title">Operación</span>
                <strong>${summary.bitacora ?? '-'} / ${summary.limpieza ?? '-'}</strong>
                <small>Bitácora y limpieza</small>
            </button>
            <button class="home-card home-card-yellow" data-home-tab="supervisor" data-home-scope="pendientes">
                <span class="home-icon">▣</span>
                <span class="home-title">Ingenieria de planta</span>
                <strong>${summary.pendientesAbiertos ?? '-'} pendientes</strong>
                <small>Actividades y preventivos</small>
            </button>
            <button class="home-card home-card-orange" data-home-tab="supervisor" data-home-scope="preventivos">
                <span class="home-icon">🛠</span>
                <span class="home-title">Preventivos</span>
                <strong>${totalPreventivos}</strong>
                <small>Abiertos en Ingenieria</small>
            </button>
            <button class="home-card home-card-blue" data-home-tab="supervisor" data-home-scope="alertas">
                <span class="home-icon">✦</span>
                <span class="home-title">Alertas</span>
                <strong>${alertasActivas.length} activas</strong>
                <small>Asistencia en seguimiento</small>
            </button>
            <button class="home-card home-card-ink" data-home-tab="limpieza" data-home-limpieza-view="actividades">
                <span class="home-icon">▤</span>
                <span class="home-title">Limpieza</span>
                <strong>${summary.limpieza ?? '-'}</strong>
                <small>Actividades y evidencia</small>
            </button>
        </div>

        <div class="card home-summary-card">
            <h3>Semaforo General</h3>
            <div class="semaforo-wrap">
                <div class="semaforo-badge ${semaforo.className}">${semaforo.code}</div>
                <div class="semaforo-text">${semaforo.msg}</div>
            </div>
            <div class="home-metrics">
                <span>Bitácora ${summary.bitacora ?? '-'}</span>
                <span>Actividades ${Math.max(0, Number(summary.pendientesAbiertos || 0) - Number(summary.pendientesPreventivos || 0))}</span>
                <span>Preventivos ${summary.pendientesPreventivos ?? '-'}</span>
                <span>Asistencia ${asistenciaCritica.length}</span>
                <span>Materiales ${summary.materiales ?? '-'}</span>
                <span>Proyectos ${summary.proyectos ?? '-'}</span>
            </div>
        </div>

        <button class="card home-mini-card home-turno-card home-panel-button" type="button" data-home-tab="supervisor" data-home-scope="asistencia" data-home-supervisor-asistencia-scope="diaria">
            <h3>Turno | Mantenimiento</h3>
            <div class="home-turno-grid">
                <div class="home-turno-item ok">En turno: <b>${indicadorMtto.enTurno.length}</b></div>
                <div class="home-turno-item warn">Fuera de turno: <b>${indicadorMtto.fueraTurno.length}</b></div>
                <div class="home-turno-item rest">Descanso: <b>${indicadorMtto.descanso.length}</b></div>
            </div>
            <div class="home-mini-line">
                ${indicadorMtto.enTurno.length ? `Asistencia SHP1 Pachuca: ${indicadorMtto.enTurno.slice(0, 3).join(', ')}` : 'Sin activos con reporte hoy en Asistencia SHP1 Pachuca.'}
            </div>
        </button>

        <button class="card home-mini-card home-turno-card home-panel-button" type="button" data-home-tab="limpieza" data-home-limpieza-view="asistencia" data-home-asistencia-scope="marcador">
            <h3>Turno | Limpieza</h3>
            <div class="home-turno-grid">
                <div class="home-turno-item ok">En turno: <b>${indicadorLimpieza.enTurno.length}</b></div>
                <div class="home-turno-item warn">Sin registro en turno: <b>${indicadorLimpieza.fueraTurno.length}</b></div>
                <div class="home-turno-item rest">Descanso: <b>${indicadorLimpieza.descanso.length}</b></div>
            </div>
            <div class="home-mini-line">
                ${indicadorLimpieza.sinCobertura
                    ? 'MELI SVC PACHUCA - BATIA LIMPIEZA: sin cobertura programada en esta hora.'
                    : indicadorLimpieza.enTurno.length
                        ? `MELI SVC PACHUCA - BATIA LIMPIEZA: ${indicadorLimpieza.enTurno.slice(0, 3).join(', ')}`
                        : 'MELI SVC PACHUCA - BATIA LIMPIEZA: sin activos con reporte en el turno actual.'}
            </div>
        </button>

        <button class="card home-mini-card home-alert-card home-panel-button" type="button" data-home-tab="supervisor" data-home-scope="alertas">
            <h3>Alertas activas | Asistencia</h3>
            <div class="home-list-mini">
                ${alertasActivas.length
                    ? alertasActivas.slice(0, 4).map((item) => `
                        <div class="home-list-item alert-item">
                            <b>${item.persona}</b>
                            <span>${item.turno} · ${item.minutosAtraso} min de atraso</span>
                            <small>${item.grupo}</small>
                        </div>
                    `).join('')
                    : '<div class="home-list-empty">Sin alertas activas de asistencia.</div>'}
            </div>
        </button>

        <button class="card home-help-card home-panel-button" type="button" data-home-tab="supervisor" data-home-scope="preventivos">
            <h3>Preventivos abiertos</h3>
            <div class="home-mini-line">${totalPreventivos} pendientes de tipo preventivo</div>
            <div class="home-mini-line">Se cierran solo desde WhatsApp con <b>CERRAR PREVENTIVO &lt;ID&gt;</b></div>
        </button>

        <button class="card home-mini-card home-panel-button" type="button" data-home-tab="supervisor" data-home-scope="preventivos">
            <h3>Lista de preventivos</h3>
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
        </button>

        <button class="card home-mini-card home-panel-button" type="button" data-home-tab="supervisor" data-home-scope="pendientes">
            <h3>Pendiente clave</h3>
            <div class="home-mini-line">${topPendiente ? `#${topPendiente.id} · ${topPendiente.area || '-'} · ${topPendiente.prioridad || '-'}` : 'Sin pendientes abiertos relevantes.'}</div>
        </button>

        <button class="card home-mini-card home-panel-button" type="button" data-home-tab="limpieza" data-home-limpieza-view="asistencia" data-home-asistencia-scope="semanal">
            <h3>Asistencia crítica</h3>
            <div class="home-mini-line">${topAsistencia ? `${topAsistencia.persona || '-'} · ${topAsistencia.turno || '-'} · ${topAsistencia.faltas} faltas` : 'Sin datos semanales de asistencia.'}</div>
        </button>

        <button class="card home-mini-card home-panel-button" type="button" data-home-tab="supervisor" data-home-scope="materiales">
            <h3>Ingenieria rapido</h3>
            <div class="home-mini-line">Materiales ${summary.materiales ?? '-'} · Proyectos ${summary.proyectos ?? '-'}</div>
        </button>

        <div class="card home-help-card">
            <h3>Ayuda Centro de Operaciones</h3>
            <div class="home-help-grid">
                <div class="home-help-item"><b>Preventivos</b><span>Usa Ingenieria de planta > Preventivos para los abiertos y Ingenieria de planta > Completados para historico.</span></div>
                <div class="home-help-item"><b>Asistencia</b><span>La vista principal muestra en-turno, fuera y descanso con base en Asistencia SHP1 Pachuca.</span></div>
            </div>
        </div>
    `;
}

function renderIngenieriaAsistenciaCard(ingenieria) {
    const items = ingenieria?.items || [];
    const listado = items.length
        ? items.map((x) => `
            <li>
                <span class="asistencia-chip ${x.estado === 'A' ? 'estado-a' : 'estado-f'}">${x.estado}</span>
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

    const resumen = items.reduce((acc, x) => {
        acc.total += 1;
        if (x.estado === 'A') acc.asistio += 1;
        else acc.falto += 1;
        return acc;
    }, { total: 0, asistio: 0, falto: 0 });

    const rows = items.map((x) => {
        const estadoClass = x.estado === 'A' ? 'estado-a' : 'estado-f';
        const estadoLabel = x.estado === 'A' ? 'Asistencia registrada' : 'Sin asistencia';

        return `
            <div class="asistencia-row">
                <div class="asistencia-col persona">${x.persona || '-'}</div>
                <div class="asistencia-col estado">
                    <span class="asistencia-chip ${estadoClass}" title="${estadoLabel}">${x.estado}</span>
                </div>
                <div class="asistencia-col numero">${x.total_reportes ?? 0}</div>
                <div class="asistencia-col numero">${x.total_evidencias ?? 0}</div>
                <div class="asistencia-col hora">${x.turno || '-'}</div>
                <div class="asistencia-col hora">${x.puesto || '-'}</div>
            </div>
        `;
    }).join('');

    const totalA = items.filter((x) => x.estado === 'A').length;
    const totalF = items.filter((x) => x.estado === 'F').length;

    return `
        <div class="asistencia-legend">
            <span class="asistencia-chip estado-a">A</span> Asistencia registrada
            <span class="asistencia-chip estado-f">F</span> Sin asistencia
        </div>
        <div class="status">${periodLabel} | Con asistencia: ${totalA} | Sin asistencia: ${totalF}</div>
        <section class="asistencia-day">
            <h3>Ingenieria de Planta | Asistencia ${periodLabel}</h3>
            <div class="asistencia-row asistencia-head">
                <div class="asistencia-col persona">Persona</div>
                <div class="asistencia-col estado">Estado</div>
                <div class="asistencia-col numero">Reportes</div>
                <div class="asistencia-col numero">Evidencias</div>
                <div class="asistencia-col hora">Turno</div>
                <div class="asistencia-col hora">Puesto</div>
            </div>
            ${rows}
        </section>
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
            <div class="section-subtitle">Personal en turno sin evidencia despues de ${data.toleranciaMin || 60} minutos de tolerancia.</div>
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
    const [summaryResp, pendientesResp, asistenciaLimpiezaResp, asistenciaMttoResp, preventivosResp, alertasResp] = await Promise.all([
        fetch('/api/v1/summary'),
        fetch('/api/v1/supervisor/pendientes?page=1&pageSize=25'),
        fetch('/api/v1/limpieza/asistencia-marcador?page=1&pageSize=50'),
        fetch('/api/v1/ingenieria/asistencia-hoy?page=1&pageSize=50'),
        fetch('/api/v1/supervisor/preventivos?page=1&pageSize=10'),
        fetch('/api/v1/supervisor/asistencia-alertas?page=1&pageSize=50')
    ]);

    if (!summaryResp.ok || !pendientesResp.ok || !asistenciaLimpiezaResp.ok || !asistenciaMttoResp.ok || !preventivosResp.ok || !alertasResp.ok) {
        throw new Error('No se pudo cargar la vista principal');
    }

    const [summary, pendientes, asistenciaLimpieza, asistenciaMtto, preventivos, alertasAsistencia] = await Promise.all([
        summaryResp.json(),
        pendientesResp.json(),
        asistenciaLimpiezaResp.json(),
        asistenciaMttoResp.json(),
        preventivosResp.json(),
        alertasResp.json()
    ]);

    els.listado.innerHTML = renderPrincipalListado({ summary, pendientes, asistenciaLimpieza, asistenciaMtto, preventivos, alertasAsistencia });
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

function renderAsistenciaListado(items) {
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

    for (const [fechaLabel, rows] of grupos.entries()) {
        const filas = rows.map((item) => {
            const estado = obtenerEstadoAsistencia(item);
            return `
                <div class="asistencia-row">
                    <div class="asistencia-col persona">${item.autor || '-'}</div>
                    <div class="asistencia-col estado">
                        <span class="asistencia-chip ${estado.className}" title="${estado.label}">${estado.code}</span>
                    </div>
                    <div class="asistencia-col numero">${item.total_reportes ?? 0}</div>
                    <div class="asistencia-col numero">${item.total_evidencias ?? 0}</div>
                    <div class="asistencia-col hora">${formatFecha(item.primer_reporte)}</div>
                    <div class="asistencia-col hora">${formatFecha(item.ultimo_reporte)}</div>
                </div>
            `;
        }).join('');

        bloques.push(`
            <section class="asistencia-day">
                <h3>${fechaLabel}</h3>
                <div class="asistencia-row asistencia-head">
                    <div class="asistencia-col persona">Elemento</div>
                    <div class="asistencia-col estado">Estado</div>
                    <div class="asistencia-col numero">Reportes</div>
                    <div class="asistencia-col numero">Evidencias</div>
                    <div class="asistencia-col hora">Primer registro</div>
                    <div class="asistencia-col hora">Ultimo registro</div>
                </div>
                ${filas}
            </section>
        `);
    }

    return `
        <div class="asistencia-legend">
            <span class="asistencia-chip estado-a">A</span> Asistencia OK
            <span class="asistencia-chip estado-r">R</span> Sin evidencia
            <span class="asistencia-chip estado-f">F</span> Sin registro
        </div>
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

function classByEstado(estado) {
    if (estado === 'A') return 'estado-a';
    if (estado === 'R') return 'estado-r';
    return 'estado-f';
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
            const tooltip = dia.descanso
                ? 'Descanso programado'
                : dia.estado === 'A'
                    ? `Asistencia OK (${dia.total_reportes || 0} reportes)`
                    : 'Falta sin descanso';

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
                <td class="tot-col">${item.totales?.R ?? 0}</td>
                <td class="tot-col">${item.totales?.F ?? 0}</td>
            </tr>
        `;
    }).join('');

    return `
        <div class="asistencia-legend">
            <span class="asistencia-chip estado-a">A</span> Asistio
            <span class="asistencia-chip estado-r">R</span> Descanso programado
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

    if (state.scope === 'materiales') {
        return `
            <div class="card">
                <h3>Material #${item.id}</h3>
                <div class="meta">
                    <div><b>Solicitante:</b> ${item.solicitante || '-'}</div>
                    <div><b>Prioridad:</b> ${item.prioridad || '-'}</div>
                    <div><b>Estado:</b> ${item.estado || '-'}</div>
                    <div><b>Fecha:</b> ${formatFecha(item.fecha)}</div>
                </div>
                <div class="block-text"><b>Material</b>\n${item.material || '-'}</div>
                <div class="block-text"><b>Justificacion</b>\n${item.justificacion || '-'}</div>
                <button data-evid-sup-mat="${item.id}">Ver evidencias</button>
                <div class="evidencias" id="evid-sup-mat-${item.id}"></div>
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
        const resp = await fetch('/api/v1/summary');
        const data = await resp.json();

        els.kpiBitacora.textContent = data.bitacora ?? '-';
        els.kpiLimpieza.textContent = data.limpieza ?? '-';
        els.kpiPendientes.textContent = data.pendientesAbiertos ?? '-';
        els.kpiMateriales.textContent = data.materiales ?? '-';
        els.kpiProyectos.textContent = data.proyectos ?? '-';
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

        const resp = await fetch(`${endpoint}?${params.toString()}`);
        if (!resp.ok) {
            throw new Error(`HTTP ${resp.status}`);
        }

        const data = await resp.json();
        state.totalPages = data.totalPages || 1;
        state.page = Math.min(state.page, state.totalPages);

        if (state.tab === 'limpieza' && state.limpiezaView === 'asistencia') {
            if (state.asistenciaScope === 'semanal') {
                els.listado.innerHTML = renderAsistenciaSemanalListado(data.items || []);
            } else if (state.asistenciaScope === 'marcador') {
                els.listado.innerHTML = renderAsistenciaMarcadorListado(data);
            } else {
                els.listado.innerHTML = renderAsistenciaListado(data.items || []);
            }
        } else if (state.tab === 'supervisor' && state.scope === 'alertas') {
            els.listado.innerHTML = renderAlertasAsistenciaListado(data);
        } else if (state.tab === 'supervisor' && state.scope === 'asistencia') {
            els.listado.innerHTML = renderSupervisorAsistenciaListado(data);
        } else if (state.tab === 'supervisor' && state.scope === 'bitacora') {
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
    const supMatBtns = document.querySelectorAll('[data-evid-sup-mat]');
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

            const r = await fetch(`/api/v1/bitacora/actividades/${id}/evidencias`);
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

            const r = await fetch(`/api/v1/limpieza/actividades/${id}/evidencias`);
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

            const r = await fetch(`/api/v1/supervisor/pendientes/${id}/evidencias`);
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

    for (const btn of supMatBtns) {
        btn.onclick = async () => {
            const id = btn.getAttribute('data-evid-sup-mat');
            const wrap = document.getElementById(`evid-sup-mat-${id}`);

            if (wrap.innerHTML.trim()) {
                wrap.innerHTML = '';
                btn.textContent = 'Ver evidencias';
                return;
            }

            const r = await fetch(`/api/v1/supervisor/materiales/${id}/evidencias`);
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

            const r = await fetch(`/api/v1/supervisor/proyectos/${id}/evidencias`);
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

    if (els.subtabsAsistencia) {
        els.subtabsAsistencia.forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.asistenciaScope === state.asistenciaScope);
        });
    }

    if (els.subtabsSupervisorAsistencia) {
        els.subtabsSupervisorAsistencia.forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.supervisorAsistenciaScope === state.supervisorAsistenciaScope);
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

    if (config.asistenciaScope) {
        state.asistenciaScope = config.asistenciaScope;
    }

    if (config.supervisorAsistenciaScope) {
        state.supervisorAsistenciaScope = config.supervisorAsistenciaScope;
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
    const isAsistencia = isLimpieza && state.limpiezaView === 'asistencia';
    const isSupervisorAsistencia = isSupervisor && state.scope === 'asistencia';
    const isSupervisorPreventivos = isSupervisor && state.scope === 'preventivos';

    els.subtabsWrap.hidden = !isSupervisor;
    if (els.subtabsLimpiezaWrap) {
        els.subtabsLimpiezaWrap.hidden = !isLimpieza;
    }
    if (els.subtabsAsistenciaWrap) {
        els.subtabsAsistenciaWrap.hidden = !isAsistencia;
    }
    if (els.subtabsSupervisorAsistenciaWrap) {
        els.subtabsSupervisorAsistenciaWrap.hidden = !isSupervisorAsistencia;
    }

    if (els.filtersWrap) {
        els.filtersWrap.hidden = isPrincipal;
    }

    if (els.paginationWrap) {
        els.paginationWrap.hidden = isPrincipal;
    }

    if (isPrincipal) {
        els.filterExtra.placeholder = 'No aplica en Principal';
    } else if (isSupervisor && state.scope === 'bitacora') {
        els.filterExtra.placeholder = 'Tecnico';
    } else if (state.tab === 'limpieza') {
        els.filterExtra.placeholder = 'Autor';
    } else if (isSupervisorAsistencia) {
        els.filterExtra.placeholder = 'No aplica en Asistencia';
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
            limpiezaView: card.dataset.homeLimpiezaView,
            asistenciaScope: card.dataset.homeAsistenciaScope,
            supervisorAsistenciaScope: card.dataset.homeSupervisorAsistenciaScope
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

    els.subtabsAsistencia.forEach((sub) => {
        sub.onclick = () => {
            state.asistenciaScope = sub.dataset.asistenciaScope;
            state.page = 1;
            marcarSubtabsActivos();
            cargarListado();
        };
    });

    if (els.subtabsSupervisorAsistencia) {
        els.subtabsSupervisorAsistencia.forEach((sub) => {
            sub.onclick = () => {
                state.supervisorAsistenciaScope = sub.dataset.supervisorAsistenciaScope;
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
