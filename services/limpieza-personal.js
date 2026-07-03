const MARCADOR_BASE_WEEK_ISO = '2026-06-29';

const MARCADOR_PERSONAL = [
    {
        key: 'hugo',
        nombre: 'Hugo Sanchez Calixto',
        turno: '1er turno 06:00-14:00',
        aliases: ['hugo sanchez calixto', 'hugo']
    },
    {
        key: 'yuri',
        nombre: 'Rosa Yuridia Lopez Dominguez',
        turno: '1er turno 06:00-14:00',
        aliases: ['rosa yuridia lopez dominguez', 'yuri', 'rosa yuridia']
    },
    {
        key: 'lucy',
        nombre: 'Lucila Castillo Labastida',
        turno: '1er turno 06:00-14:00',
        aliases: ['lucila castillo labastida', 'lucila', 'lucy']
    },
    {
        key: 'gloria',
        nombre: 'Gloria Velazquez Tolentino',
        turno: '2do turno 12:00-20:00',
        aliases: ['gloria velazquez tolentino', 'gloria', 'tamara']
    },
    {
        key: 'margarita',
        nombre: 'Margarita Reyes Santiago',
        turno: '2do turno 12:00-20:00',
        aliases: ['margarita reyes santiago', 'margarita reyes', 'margarita']
    },
    {
        key: 'jose_luis',
        nombre: 'Jose Luis Velazquez Herrera',
        turno: '3er turno 22:00-06:00',
        aliases: ['jose luis velazquez herrera', 'jose luis', 'jose', 'zeus', 'zeus45745']
    }
];

const DESCANSOS_FIJOS_PERSONAL = {
    jose_luis: [5]
};

const DESCANSOS_ROTACION_PRIMER_TURNO = {
    4: ['yuri', 'lucy', 'hugo'],
    5: ['hugo', 'yuri', 'lucy'],
    6: ['lucy', 'hugo', 'yuri']
};

const DESCANSOS_ROTACION_SEGUNDO_TURNO = {
    5: ['margarita', 'gloria'],
    6: ['gloria', 'margarita']
};

function mod(valor, base) {
    return ((valor % base) + base) % base;
}

function normalizarTexto(valor = '') {
    return valor
        .toString()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
}

function getWeekOffset(dateInput) {
    const base = new Date(`${MARCADOR_BASE_WEEK_ISO}T00:00:00.000Z`);
    const current = new Date(dateInput);
    const normalized = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate()));
    const diffMs = normalized.getTime() - base.getTime();
    return Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
}

function esDescansoProgramado(personaKey, dayIdx, weekOffset) {
    if (dayIdx === 3) {
        return false;
    }

    const descansosFijos = DESCANSOS_FIJOS_PERSONAL[personaKey];
    if (Array.isArray(descansosFijos) && descansosFijos.length > 0) {
        return descansosFijos.includes(dayIdx);
    }

    if (personaKey === 'lucy' || personaKey === 'yuri' || personaKey === 'hugo') {
        const rotacion = DESCANSOS_ROTACION_PRIMER_TURNO[dayIdx];
        if (Array.isArray(rotacion) && rotacion.length > 0) {
            const asignado = rotacion[mod(weekOffset, rotacion.length)];
            return asignado === personaKey;
        }

        return false;
    }

    if (personaKey === 'gloria' || personaKey === 'margarita') {
        const rotacion = DESCANSOS_ROTACION_SEGUNDO_TURNO[dayIdx];
        if (Array.isArray(rotacion) && rotacion.length > 0) {
            const asignado = rotacion[mod(weekOffset, rotacion.length)];
            return asignado === personaKey;
        }

        return false;
    }

    return false;
}

function extraerHorarioTurno(turno = '') {
    const match = turno.match(/(\d{2}:\d{2})-(\d{2}:\d{2})/);
    if (!match) {
        return null;
    }

    return {
        turnoInicio: match[1],
        turnoFin: match[2]
    };
}

function resolverPersonaMarcador(autor = '') {
    const autorN = normalizarTexto(autor);
    if (!autorN) {
        return null;
    }

    for (const persona of MARCADOR_PERSONAL) {
        const matched = persona.aliases.some((alias) => {
            const aliasN = normalizarTexto(alias);
            return autorN.includes(aliasN) || aliasN.includes(autorN);
        });

        if (matched) {
            return persona;
        }
    }

    return null;
}

module.exports = {
    MARCADOR_BASE_WEEK_ISO,
    MARCADOR_PERSONAL,
    DESCANSOS_FIJOS_PERSONAL,
    normalizarTexto,
    getWeekOffset,
    esDescansoProgramado,
    extraerHorarioTurno,
    resolverPersonaMarcador
};