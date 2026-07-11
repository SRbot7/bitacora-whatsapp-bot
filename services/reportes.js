const moment = require('moment-timezone');
const pool = require('../db');

const BITACORA_GROUP_NAME = process.env.BITACORA_GROUP_NAME || 'BITACORA-MTTO-SHP1';

async function contar(sql, params = []) {
    const resultado = await pool.query(sql, params);
    return Number(resultado.rows[0]?.total || 0);
}

async function contarSeguro(sql, params = []) {
    try {
        return await contar(sql, params);
    } catch (error) {
        if (error?.code === '42P01') {
            return 0;
        }
        throw error;
    }
}

async function obtenerResumenOperativo({ inicioDia, finDia }) {
    const [
        bitacoraTotal,
        bitacoraHoy,
        limpiezaTotal,
        limpiezaHoy,
        pendientesAbiertos,
        pendientesHoy,
        insumosMovimientosHoy,
        insumosSalidasHoy,
        proyectosTotal,
        proyectosHoy
    ] = await Promise.all([
        contar(`
            SELECT COUNT(*)::int AS total
            FROM bitacora
            WHERE grupo = '${BITACORA_GROUP_NAME}'
        `),
        contar(`
            SELECT COUNT(*)::int AS total
            FROM bitacora
            WHERE grupo = '${BITACORA_GROUP_NAME}'
              AND fecha >= $1
              AND fecha <= $2
        `, [inicioDia, finDia]),
        contar(`
            SELECT COUNT(*)::int AS total
            FROM actividades_limpieza
            WHERE actividad IS NOT NULL
              AND BTRIM(actividad) <> ''
              AND actividad <> '[Solo imagen]'
        `),
        contar(`
            SELECT COUNT(*)::int AS total
            FROM actividades_limpieza
            WHERE actividad IS NOT NULL
              AND BTRIM(actividad) <> ''
              AND actividad <> '[Solo imagen]'
              AND fecha >= $1
              AND fecha <= $2
        `, [inicioDia, finDia]),
        contar(`
            SELECT COUNT(*)::int AS total
            FROM pendientes_supervisor
            WHERE estado = 'Pendiente'
        `),
        contar(`
            SELECT COUNT(*)::int AS total
            FROM pendientes_supervisor
            WHERE fecha >= $1
              AND fecha <= $2
        `, [inicioDia, finDia]),
                contarSeguro(`
                        SELECT COUNT(*)::int AS total
                        FROM bitacora_insumos_movimientos
                        WHERE fecha >= $1
                            AND fecha <= $2
                `, [inicioDia, finDia]),
                contarSeguro(`
                        SELECT COUNT(*)::int AS total
                        FROM bitacora_insumos_movimientos
                        WHERE tipo_mov = 'SALIDA'
                            AND fecha >= $1
                            AND fecha <= $2
                `, [inicioDia, finDia]),
        contar(`
            SELECT COUNT(*)::int AS total
            FROM proyectos_mtto
        `),
        contar(`
            SELECT COUNT(*)::int AS total
            FROM proyectos_mtto
            WHERE creado_en >= $1
              AND creado_en <= $2
                `, [inicioDia, finDia])
    ]);

    return {
        bitacoraTotal,
        bitacoraHoy,
        limpiezaTotal,
        limpiezaHoy,
        pendientesAbiertos,
        pendientesHoy,
        insumosMovimientosHoy,
        insumosSalidasHoy,
        proyectosTotal,
        proyectosHoy
    };
}

function construirMensajeResumenOperativo({ momento, resumen, tipo }) {
    const sello = tipo === 'AUTO' ? 'AUTOMATICO' : 'MANUAL';

    return [
        `📊 REPORTE OPERATIVO ${sello}`,
        `🗓️ ${momento.format('DD/MM/YYYY HH:mm')}`,
        '',
        'BITACORA',
        `- Hoy: ${resumen.bitacoraHoy}`,
        `- Total: ${resumen.bitacoraTotal}`,
        `- Movimientos de insumos hoy: ${resumen.insumosMovimientosHoy || 0} (salidas: ${resumen.insumosSalidasHoy || 0})`,
        '',
        'LIMPIEZA',
        `- Hoy: ${resumen.limpiezaHoy}`,
        `- Total: ${resumen.limpiezaTotal}`,
        '',
        'SUPERVISOR',
        `- Pendientes abiertos: ${resumen.pendientesAbiertos}`,
        `- Pendientes creados hoy: ${resumen.pendientesHoy}`,
        `- Proyectos hoy / total: ${resumen.proyectosHoy} / ${resumen.proyectosTotal}`,
        '',
        '✅ Resumen generado por bot de operaciones.'
    ].filter(Boolean).join('\n');
}

module.exports = {
    obtenerResumenOperativo,
    construirMensajeResumenOperativo
};
