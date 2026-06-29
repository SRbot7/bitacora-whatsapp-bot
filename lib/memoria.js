// =========================
// MEMORIA TEMPORAL
// =========================
// Guarda los últimos IDs registrados por usuario+grupo
// para relacionar evidencias enviadas después del registro.
//
// Los objetos se comparten por referencia entre todos los módulos
// que hagan require('./lib/memoria').

const ultimasActividades = {};
const ultimasLimpiezas   = {};
const ultimosPendientes  = {};
const ultimosMateriales  = {};
const ultimosProyectos   = {};

function claveMemoria(chatName, autor) {
    return `${chatName}_${autor || ''}`;
}

module.exports = {
    ultimasActividades,
    ultimasLimpiezas,
    ultimosPendientes,
    ultimosMateriales,
    ultimosProyectos,
    claveMemoria
};
