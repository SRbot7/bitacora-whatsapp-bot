const moment = require('moment-timezone');

/**
 * SERVICIO DE FLUJO DE PERMISOS
 * Implementa: A) Límites, B) Validación cobertura, C) Aprobación, D) Reportes, E) Deuda
 */

// ============================================
// A) VALIDACIÓN DE LÍMITES MENSUALES
// ============================================

async function validarLimitesPermisoMes(pool, personaKey, tipoPermiso, fechaPermiso) {
    const inicioMes = moment(fechaPermiso).tz('America/Mexico_City').startOf('month').format('YYYY-MM-DD');
    const finMes = moment(fechaPermiso).tz('America/Mexico_City').endOf('month').format('YYYY-MM-DD');

    try {
        const res = await pool.query(
            `SELECT COUNT(*) as total FROM asistencia_limpieza_ajustes 
             WHERE fecha >= $1 AND fecha <= $2 
             AND persona_key = $3 
             AND tipo_permiso = $4 
             AND estado IN ('REGISTRADO', 'APROBADO')`,
            [inicioMes, finMes, personaKey, tipoPermiso]
        );

        const total = Number(res.rows[0]?.total || 0);
        const limites = {
            CAMBIO_DESCANSO: 2,
            DESCUENTO_SUELDO: 999,
            TURNO_DOBLE: 999,
            INTERCAMBIO_TURNO: 999
        };

        const limite = limites[tipoPermiso] || 999;
        const ok = total < limite;

        return {
            ok,
            totalRegistrados: total,
            limite,
            alerta: ok ? null : `⚠️ Límite: máx ${limite} ${tipoPermiso.replace(/_/g, ' ')}/mes. Ya tienes ${total}.`
        };
    } catch (error) {
        console.error('❌ Error validarLimitesPermisoMes:', error);
        return { ok: true, totalRegistrados: 0, limite: 999, alerta: null };
    }
}

// ============================================
// B) VALIDACIÓN DE COBERTURA
// ============================================

async function validarCoberturaTurno(pool, personaKey, fecha, MARCADOR_PERSONAL, EQUIPO_INGENIERIA) {
    try {
        // Determinar si es limpieza o mtto por catálogo
        const enLimpieza = MARCADOR_PERSONAL.some(p => p.key === personaKey);
        const catalogo = enLimpieza ? MARCADOR_PERSONAL : EQUIPO_INGENIERIA;
        const persona = catalogo.find(p => p.key === personaKey);

        if (!persona) {
            return { ok: true, critico: false, msg: null, alternos: [] };
        }

        // Buscar otros en el mismo turno
        const alternos = catalogo.filter(p =>
            p.key !== personaKey &&
            (p.turno || '').includes((persona.turno || 'turno1').split(' ')[0])
        );

        if (alternos.length === 0) {
            return {
                ok: false,
                critico: true,
                msg: `🚨 CRÍTICO: ${persona.nombre} es el ÚNICO en turno. No se puede aprobar sin cobertura.`,
                alternos: []
            };
        }

        return {
            ok: true,
            critico: false,
            msg: null,
            alternos: alternos.map(p => p.nombre)
        };
    } catch (error) {
        console.error('❌ Error validarCoberturaTurno:', error);
        return { ok: true, critico: false, msg: null, alternos: [] };
    }
}

// ============================================
// C) WORKFLOW DE APROBACIÓN
// ============================================

async function registrarPermisoConAprobacion(pool, datos) {
    /**
     * Registra un permiso en estado PENDIENTE_APROBACION (no REGISTRADO directo)
     * datos: { fecha, personaKey, area, tipoPermiso, motivo, creadoPor }
     */
    try {
        const res = await pool.query(
            `INSERT INTO asistencia_limpieza_ajustes
             (fecha, persona_key, tipo, tipo_permiso, motivo, creado_por, estado, confirmado)
             VALUES ($1, $2, $3, $4, $5, $6, 'PENDIENTE_APROBACION', FALSE)
             ON CONFLICT (fecha, persona_key) DO UPDATE SET
                estado = 'PENDIENTE_APROBACION',
                confirmado = FALSE
             RETURNING id, fecha, persona_key, estado`,
            [
                datos.fecha.format('YYYY-MM-DD'),
                datos.personaKey,
                'PERMISO',
                datos.tipoPermiso,
                datos.motivo,
                datos.creadoPor
            ]
        );

        return { ok: true, id: res.rows[0]?.id, estado: 'PENDIENTE_APROBACION' };
    } catch (error) {
        console.error('❌ Error registrarPermisoConAprobacion:', error);
        return { ok: false, error: error.message };
    }
}

async function aprobarPermiso(pool, id, aprobadoPor) {
    try {
        const res = await pool.query(
            `UPDATE asistencia_limpieza_ajustes 
             SET estado = 'APROBADO', confirmado = TRUE, creado_por = $2, updated_at = NOW()
             WHERE id = $1
             RETURNING id, fecha, persona_key, tipo_permiso, estado`,
            [id, `${aprobadoPor} (supervisor)`]
        );

        return { ok: !!res.rows.length, permiso: res.rows[0] };
    } catch (error) {
        console.error('❌ Error aprobarPermiso:', error);
        return { ok: false, error: error.message };
    }
}

// ============================================
// D) REPORTES AVANZADOS
// ============================================

async function reportePermisosDelMes(pool, mesAno) {
    /**
     * mesAno: "07/2026" o "2026-07"
     */
    try {
        const [mes, ano] = mesAno.includes('/')
            ? mesAno.split('/').reverse()
            : mesAno.split('-');

        const res = await pool.query(
            `SELECT 
                fecha, persona_key, tipo_permiso, motivo, estado, creado_por,
                DATE_TRUNC('day', updated_at) as registrado_en
             FROM asistencia_limpieza_ajustes 
             WHERE EXTRACT(YEAR FROM fecha) = $1
             AND EXTRACT(MONTH FROM fecha) = $2
             AND estado != 'CANCELADO'
             ORDER BY fecha ASC, persona_key ASC`,
            [Number(ano), Number(mes)]
        );

        return {
            ok: true,
            mes: mesAno,
            permisos: res.rows,
            resumen: {
                total: res.rows.length,
                aprobados: res.rows.filter(r => r.estado === 'APROBADO').length,
                pendientes: res.rows.filter(r => r.estado === 'PENDIENTE_APROBACION').length,
                porTipo: {
                    descuento: res.rows.filter(r => r.tipo_permiso === 'DESCUENTO_SUELDO').length,
                    cambioDescanso: res.rows.filter(r => r.tipo_permiso === 'CAMBIO_DESCANSO').length,
                    turnoDoble: res.rows.filter(r => r.tipo_permiso === 'TURNO_DOBLE').length,
                    intercambio: res.rows.filter(r => r.tipo_permiso === 'INTERCAMBIO_TURNO').length
                }
            }
        };
    } catch (error) {
        console.error('❌ Error reportePermisosDelMes:', error);
        return { ok: false, error: error.message };
    }
}

async function reportePermisosPersona(pool, personaKey, limite = 15) {
    try {
        const res = await pool.query(
            `SELECT 
                fecha, tipo_permiso, motivo, estado, 
                DATE_TRUNC('day', created_at) as registrado_en
             FROM asistencia_limpieza_ajustes 
             WHERE persona_key = $1 AND estado != 'CANCELADO'
             ORDER BY fecha DESC LIMIT $2`,
            [personaKey, limite]
        );

        return {
            ok: true,
            personaKey,
            permisos: res.rows,
            total: res.rows.length
        };
    } catch (error) {
        console.error('❌ Error reportePermisosPersona:', error);
        return { ok: false, error: error.message };
    }
}

// ============================================
// E) TRACKING DE DEUDA (PAGO CON OTRO DÍA)
// ============================================

async function registrarDeudaPago(pool, personaKey, fechaTurnoDoble, fechaPago) {
    /**
     * Cuando registra TURNO_DOBLE, crea deuda de "pago con otro día"
     * estado: PENDIENTE_PAGO hasta que se ejecute fecha_pago
     */
    try {
        const res = await pool.query(
            `INSERT INTO asistencia_limpieza_ajustes
             (fecha, persona_key, tipo, tipo_permiso, motivo, estado, fecha_pago)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id, estado, fecha_pago`,
            [
                fechaTurnoDoble.format('YYYY-MM-DD'),
                personaKey,
                'PERMISO',
                'TURNO_DOBLE',
                `Deuda: debe trabajar ${fechaPago.format('DD/MM')}`,
                'PENDIENTE_PAGO',
                fechaPago.format('YYYY-MM-DD')
            ]
        );

        return { ok: true, deuda_id: res.rows[0]?.id, fecha_pago: res.rows[0]?.fecha_pago };
    } catch (error) {
        console.error('❌ Error registrarDeudaPago:', error);
        return { ok: false, error: error.message };
    }
}

async function listarDeudasPendientes(pool) {
    try {
        const res = await pool.query(
            `SELECT 
                id, persona_key, fecha, fecha_pago, motivo, creado_por,
                EXTRACT(DAY FROM fecha_pago - NOW()::date) as dias_para_vencer
             FROM asistencia_limpieza_ajustes 
             WHERE estado = 'PENDIENTE_PAGO'
             AND fecha_pago >= NOW()::date
             ORDER BY fecha_pago ASC`
        );

        return {
            ok: true,
            deudasPendientes: res.rows.filter(r => r.dias_para_vencer >= 0),
            deudasVencidas: res.rows.filter(r => r.dias_para_vencer < 0)
        };
    } catch (error) {
        console.error('❌ Error listarDeudasPendientes:', error);
        return { ok: false, error: error.message };
    }
}

module.exports = {
    validarLimitesPermisoMes,
    validarCoberturaTurno,
    registrarPermisoConAprobacion,
    aprobarPermiso,
    reportePermisosDelMes,
    reportePermisosPersona,
    registrarDeudaPago,
    listarDeudasPendientes
};
