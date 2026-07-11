const fs = require('fs');
const path = require('path');
const { MARCADOR_PERSONAL, normalizarTexto } = require('./limpieza-personal');

const ROLES_VALIDOS = new Set(['LIMPIEZA', 'SITE_LEADER', 'TEAM_LEADER', 'SIN_CLASIFICAR']);
const ROLES_FILE = process.env.LIMPIEZA_ROLES_FILE || path.join(__dirname, '..', 'runtime', 'limpieza-roles.json');

let cache = null;

function asegurarDirectorioArchivo() {
    const dir = path.dirname(ROLES_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function slug(texto = '') {
    const base = normalizarTexto(texto)
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, '_')
        .replace(/^_+|_+$/g, '');

    return base || `persona_${Date.now()}`;
}

function crearSeed() {
    const personas = {};
    for (const persona of MARCADOR_PERSONAL) {
        const key = persona.key || slug(persona.nombre);
        personas[key] = {
            key,
            nombre: persona.nombre,
            rol: 'SIN_CLASIFICAR',
            aliases: Array.from(new Set([persona.nombre, ...(persona.aliases || [])])),
            origen: 'seed'
        };
    }

    return {
        version: 1,
        updatedAt: new Date().toISOString(),
        personas
    };
}

function guardar(data) {
    asegurarDirectorioArchivo();
    const payload = {
        ...data,
        updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(ROLES_FILE, JSON.stringify(payload, null, 2), 'utf8');
    cache = payload;
    return payload;
}

function cargar() {
    if (cache) {
        return cache;
    }

    if (!fs.existsSync(ROLES_FILE)) {
        return guardar(crearSeed());
    }

    try {
        const raw = fs.readFileSync(ROLES_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || !parsed.personas || typeof parsed.personas !== 'object') {
            return guardar(crearSeed());
        }
        cache = parsed;
        return parsed;
    } catch (_error) {
        return guardar(crearSeed());
    }
}

function normalizarRol(rol = '') {
    const clean = String(rol || '').trim().toUpperCase().replace(/\s+/g, '_');
    return ROLES_VALIDOS.has(clean) ? clean : '';
}

function buscarPersonaPorTexto(data, texto = '') {
    const entrada = normalizarTexto(texto);
    if (!entrada) {
        return null;
    }

    const personas = Object.values(data.personas || {});
    for (const persona of personas) {
        const nombreN = normalizarTexto(persona.nombre);
        if (entrada.includes(nombreN) || nombreN.includes(entrada)) {
            return persona;
        }

        const aliases = Array.isArray(persona.aliases) ? persona.aliases : [];
        const matchAlias = aliases.some((alias) => {
            const aliasN = normalizarTexto(alias);
            return aliasN && (entrada.includes(aliasN) || aliasN.includes(entrada));
        });

        if (matchAlias) {
            return persona;
        }
    }

    return null;
}

function resolverRolYPersonaLimpieza(autor = '') {
    const data = cargar();
    const persona = buscarPersonaPorTexto(data, autor);
    if (!persona) {
        return null;
    }

    return {
        key: persona.key,
        nombre: persona.nombre,
        rol: normalizarRol(persona.rol) || 'SIN_CLASIFICAR',
        origen: persona.origen || 'manual'
    };
}

function registrarPersonaLimpiezaSiNoExiste(autor = '') {
    const nombre = String(autor || '').trim();
    if (!nombre) {
        return null;
    }

    const data = cargar();
    const existente = buscarPersonaPorTexto(data, nombre);
    if (existente) {
        return {
            key: existente.key,
            nombre: existente.nombre,
            rol: normalizarRol(existente.rol) || 'SIN_CLASIFICAR',
            origen: existente.origen || 'manual'
        };
    }

    const keyBase = slug(nombre);
    let key = keyBase;
    let i = 1;
    while (data.personas[key]) {
        i += 1;
        key = `${keyBase}_${i}`;
    }

    data.personas[key] = {
        key,
        nombre,
        rol: 'SIN_CLASIFICAR',
        aliases: [nombre],
        origen: 'auto'
    };

    guardar(data);
    return {
        key,
        nombre,
        rol: 'SIN_CLASIFICAR',
        origen: 'auto'
    };
}

function asignarRolLimpieza({ personaTexto = '', rol = '' }) {
    const rolN = normalizarRol(rol);
    if (!rolN) {
        return { ok: false, error: 'ROL_INVALIDO' };
    }

    const data = cargar();
    let persona = buscarPersonaPorTexto(data, personaTexto);
    if (!persona) {
        const creada = registrarPersonaLimpiezaSiNoExiste(personaTexto);
        if (!creada) {
            return { ok: false, error: 'PERSONA_INVALIDA' };
        }
        const refreshed = cargar();
        persona = refreshed.personas[creada.key];
    }

    persona.rol = rolN;
    persona.origen = persona.origen || 'manual';
    persona.aliases = Array.from(new Set([persona.nombre, ...(persona.aliases || []), personaTexto].filter(Boolean)));
    guardar(data);

    return {
        ok: true,
        persona: {
            key: persona.key,
            nombre: persona.nombre,
            rol: persona.rol,
            origen: persona.origen
        }
    };
}

function listarRolesLimpieza({ soloSinClasificar = false } = {}) {
    const data = cargar();
    let items = Object.values(data.personas || {}).map((p) => {
        return {
            key: p.key,
            nombre: p.nombre,
            rol: normalizarRol(p.rol) || 'SIN_CLASIFICAR',
            origen: p.origen || 'manual'
        };
    });

    if (soloSinClasificar) {
        items = items.filter((p) => p.rol === 'SIN_CLASIFICAR');
    }

    items.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
    return items;
}

module.exports = {
    ROLES_VALIDOS,
    resolverRolYPersonaLimpieza,
    registrarPersonaLimpiezaSiNoExiste,
    asignarRolLimpieza,
    listarRolesLimpieza
};