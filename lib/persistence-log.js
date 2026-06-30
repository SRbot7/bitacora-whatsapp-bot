function logPersistencia({ tabla, id, autor, grupo, mensajeId }) {
    console.log('✅ DB_PERSIST:', {
        tabla: tabla || 'sin_tabla',
        id: id ?? null,
        autor: autor || 'Sin nombre',
        grupo: grupo || 'Sin grupo',
        mensajeId: mensajeId || 'Sin mensajeId'
    });
}

module.exports = { logPersistencia };