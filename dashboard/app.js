const state = {
    tab: 'bitacora',
    scope: 'pendientes',
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
    subtabs: document.querySelectorAll('.subtab'),
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

function formatFecha(value) {
    if (!value) return '-';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
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

    if (state.tab === 'bitacora' && extra) params.set('tecnico', extra);
    if (state.tab === 'limpieza' && extra) params.set('autor', extra);
    if (state.tab === 'supervisor' && extra) {
        if (state.scope === 'pendientes') params.set('estado', extra);
        if (state.scope === 'materiales') params.set('estado', extra);
        if (state.scope === 'proyectos') params.set('estado', extra);
    }

    return params;
}

function getEndpoint() {
    if (state.tab === 'bitacora') return '/api/v1/bitacora/actividades';
    if (state.tab === 'limpieza') return '/api/v1/limpieza/actividades';
    if (state.scope === 'materiales') return '/api/v1/supervisor/materiales';
    if (state.scope === 'proyectos') return '/api/v1/supervisor/proyectos';
    return '/api/v1/supervisor/pendientes';
}

function renderCard(item) {
    if (state.tab === 'bitacora') {
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

    if (state.tab === 'limpieza') {
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

    if (state.scope === 'pendientes') {
        return `
            <div class="card">
                <h3>Pendiente #${item.id}</h3>
                <div class="meta">
                    <div><b>Prioridad:</b> ${item.prioridad || '-'}</div>
                    <div><b>Estado:</b> ${item.estado || '-'}</div>
                    <div><b>Area:</b> ${item.area || '-'}</div>
                    <div><b>Fecha:</b> ${formatFecha(item.fecha)}</div>
                </div>
                <div class="block-text">${item.descripcion || '-'}</div>
                <button data-evid-sup-pend="${item.id}">Ver evidencias</button>
                <div class="evidencias" id="evid-sup-pend-${item.id}"></div>
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

        const endpoint = getEndpoint();
        const params = buildParams();

        const resp = await fetch(`${endpoint}?${params.toString()}`);
        if (!resp.ok) {
            throw new Error(`HTTP ${resp.status}`);
        }

        const data = await resp.json();
        state.totalPages = data.totalPages || 1;
        state.page = Math.min(state.page, state.totalPages);

        els.listado.innerHTML = (data.items || []).map(renderCard).join('');
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
            const urls = evidencias.map(x => toPublicImageUrl(x.ruta));

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
            const urls = evidencias.map(x => toPublicImageUrl(x.ruta));

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

function syncUiByTab() {
    const isSupervisor = state.tab === 'supervisor';

    els.subtabsWrap.hidden = !isSupervisor;
}

function initEvents() {
    els.tabs.forEach((tab) => {
        tab.onclick = () => {
            els.tabs.forEach((x) => x.classList.remove('active'));
            tab.classList.add('active');
            state.tab = tab.dataset.tab;
            state.page = 1;
            syncUiByTab();
            cargarListado();
        };
    });

    els.subtabs.forEach((sub) => {
        sub.onclick = () => {
            els.subtabs.forEach((x) => x.classList.remove('active'));
            sub.classList.add('active');
            state.scope = sub.dataset.scope;
            state.page = 1;
            cargarListado();
        };
    });

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
