const moment = require('moment-timezone');

/**
 * SERVICIO DE FLUJO DE PERMISOS
 * Compatibilidad con esquema actual de asistencia_limpieza_ajustes:
 * columnas disponibles -> fecha, persona_key, tipo, turno, motivo, creado_por.
 */

const ESTADOS = {
    PENDIENTE: 'PENDIENTE_APROBACION',
    APROBADO: 'APROBADO',
    CANCELADO: 'CANCELADO',
    PENDIENTE_PAGO: 'PENDIENTE_PAGO'
};

function normalizarTipoPermiso(tipoPermiso = '') {
    const t = String(tipoPermiso || '').toUpperCase().trim();
    if (!t) return 'CAMBIO_DESCANSO';

    if (t.includes('PENDIENTE')) return 'PENDIENTE_DEFINIR';
    if (t.includes('DESCUENTO')) return 'DESCUENTO_SUELDO';
    if (t.includes('TURNO') && t.includes('DOBLE')) return 'TURNO_DOBLE';
    if (t.includes('INTERCAMBIO')) return 'INTERCAMBIO_TURNO';
    if (t.includes('CAMBIO') && t.includes('DESCANSO')) return 'CAMBIO_DESCANSO';

    return t.replace(/\s+/g, '_');
}

function buildMotivoMeta({ estado, tipoPermiso, motivo, fechaPago = '' }) {
    const tp = normalizarTipoPermiso(tipoPermiso);
    const est = String(estado || ESTADOS.APROBADO).toUpperCase();
    const piezas = [`[ESTADO:${est}]`, `[TIPO:${tp}]`];
    if (fechaPago) {
        piezas.push(`[PAGO:${fechaPago}]`);
    }

    const detalle = String(motivo || '').trim();
    return `${piezas.join('')} ${detalle}`.trim();
}

function extractMetaFromMotivo(motivo = '') {
    const texto = String(motivo || '');
    const estado = (texto.match(/\[ESTADO:([^\]]+)\]/i)?.[1] || ESTADOS.APROBADO).toUpperCase().trim();
    const tipoPermiso = normalizarTipoPermiso(texto.match(/\[TIPO:([^\]]+)\]/i)?.[1] || 'CAMBIO_DESCANSO');
    const fechaPago = (texto.match(/\[PAGO:([^\]]+)\]/i)?.[1] || '').trim();
    const motivoLimpio = texto
        .replace(/\[ESTADO:[^\]]+\]/gi, '')
        .replace(/\[TIPO:[^\]]+\]/gi, '')
        .replace(/\[PAGO:[^\]]+\]/gi, '')
        .trim();

    return {
        estado,
        tipoPermiso,
        fechaPago,
        motivoLimpio
    };
}

function buildTipoPermisoFilter(index) {
    return `upper(motivo) LIKE upper($${index})`;
}

function requiereFechaPago(tipoPermiso = '') {
    const t = normalizarTipoPermiso(tipoPermiso);
    return t === 'CAMBIO_DESCANSO' || t === 'TURNO_DOBLE';
}

// ============================================
// A) VALIDACIÓN DE LÍMITES MENSUALES
// ============================================

async function validarLimitesPermisoMes(pool, personaKey, tipoPermiso, fechaPermiso) {
    const inicioMes = moment(fechaPermiso).tz('America/Mexico_City').startOf('month').format('YYYY-MM-DD');
    const finMes = moment(fechaPermiso).tz('America/Mexico_City').endOf('month').format('YYYY-MM-DD');
    const tipoN = normalizarTipoPermiso(tipoPermiso);

    try {
        const res = await pool.query(
            `SELECT COUNT(*) as total FROM asistencia_limpieza_ajustes 
             WHERE fecha >= $1 AND fecha <= $2 
             AND persona_key = $3 
             AND tipo = 'PERMISO'
             AND ${buildTipoPermisoFilter(4)}
             AND upper(motivo) NOT LIKE '%[ESTADO:${ESTADOS.CANCELADO}]%'
            `,
            [inicioMes, finMes, personaKey, `%[TIPO:${tipoN}]%`]
        );

        const total = Number(res.rows[0]?.total || 0);
        const limites = {
            CAMBIO_DESCANSO: 2,
            DESCUENTO_SUELDO: 999,
            TURNO_DOBLE: 999,
            INTERCAMBIO_TURNO: 999,
            PENDIENTE_DEFINIR: 999
        };

        const limite = limites[tipoN] || 999;
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
        const fechaIso = moment(datos.fecha).tz('America/Mexico_City').format('YYYY-MM-DD');
        const motivoMeta = buildMotivoMeta({
            estado: ESTADOS.PENDIENTE,
            tipoPermiso: datos.tipoPermiso,
            motivo: datos.motivo
        });

        const res = await pool.query(
            `INSERT INTO asistencia_limpieza_ajustes
             (fecha, persona_key, tipo, motivo, creado_por, updated_at)
             VALUES ($1, $2, 'PERMISO', $3, $4, NOW())
             ON CONFLICT (fecha, persona_key) DO UPDATE SET
                tipo = 'PERMISO',
                motivo = EXCLUDED.motivo,
                creado_por = EXCLUDED.creado_por,
                updated_at = NOW()
             RETURNING id, fecha, persona_key, motivo`,
            [
                fechaIso,
                datos.personaKey,
                motivoMeta,
                datos.creadoPor
            ]
        );

        return { ok: true, id: res.rows[0]?.id, estado: 'PENDIENTE_APROBACION' };
    } catch (error) {
        console.error('❌ Error registrarPermisoConAprobacion:', error);
        return { ok: false, error: error.message };
    }
}

async function aprobarPermiso(pool, id, aprobadoPor, opciones = {}) {
    try {
        const base = await pool.query(
            `SELECT id, fecha, persona_key, motivo
             FROM asistencia_limpieza_ajustes
             WHERE id = $1
             LIMIT 1`,
            [id]
        );

        if (!base.rows.length) {
            return { ok: false, error: 'Permiso no encontrado' };
        }

        const actual = base.rows[0];
        const meta = extractMetaFromMotivo(actual.motivo);
        const tipoFinal = normalizarTipoPermiso(opciones.tipoPermiso || meta.tipoPermiso);
        const fechaPagoFinal = (opciones.fechaPago || meta.fechaPago || '').trim();

        if (tipoFinal === 'PENDIENTE_DEFINIR') {
            return { ok: false, error: 'Debes definir el tipo. Usa: APROBAR PERMISO <ID> | DESCUENTO/CAMBIO DESCANSO/TURNO DOBLE/INTERCAMBIO' };
        }

        if (requiereFechaPago(tipoFinal) && !fechaPagoFinal) {
            return { ok: false, error: 'Este tipo requiere día de compensación/pago. Usa: APROBAR PERMISO <ID> | TIPO | DD/MM/YYYY o confirma antes con CONFIRMAR PERMISO.' };
        }

        const motivoMeta = buildMotivoMeta({
            estado: ESTADOS.APROBADO,
            tipoPermiso: tipoFinal,
            motivo: meta.motivoLimpio,
            fechaPago: fechaPagoFinal
        });

        const res = await pool.query(
            `UPDATE asistencia_limpieza_ajustes 
             SET tipo = 'PERMISO', motivo = $2, creado_por = $3, updated_at = NOW()
             WHERE id = $1
             RETURNING id, fecha, persona_key, motivo`,
            [id, motivoMeta, `${aprobadoPor} (supervisor)`]
        );

        const permiso = res.rows[0]
            ? {
                ...res.rows[0],
                tipo_permiso: tipoFinal,
                fecha_pago: fechaPagoFinal || null,
                estado: ESTADOS.APROBADO
            }
            : null;

        return { ok: !!res.rows.length, permiso };
    } catch (error) {
        console.error('❌ Error aprobarPermiso:', error);
        return { ok: false, error: error.message };
    }
}

async function confirmarTipoPermiso(pool, id, tipoPermiso, confirmadoPor, opciones = {}) {
    try {
        const base = await pool.query(
            `SELECT id, fecha, persona_key, motivo
             FROM asistencia_limpieza_ajustes
             WHERE id = $1
             LIMIT 1`,
            [id]
        );

        if (!base.rows.length) {
            return { ok: false, error: 'Permiso no encontrado' };
        }

        const actual = base.rows[0];
        const meta = extractMetaFromMotivo(actual.motivo);
        const tipoFinal = normalizarTipoPermiso(tipoPermiso);
        const fechaPagoFinal = (opciones.fechaPago || meta.fechaPago || '').trim();

        if (tipoFinal === 'PENDIENTE_DEFINIR') {
            return { ok: false, error: 'Tipo inválido para confirmar. Usa DESCUENTO, CAMBIO DESCANSO, TURNO DOBLE o INTERCAMBIO.' };
        }

        if (requiereFechaPago(tipoFinal) && !fechaPagoFinal) {
            return { ok: false, error: 'Este tipo requiere día de compensación/pago. Usa: CONFIRMAR PERMISO <ID> | TIPO | DD/MM/YYYY' };
        }

        if (meta.estado !== ESTADOS.PENDIENTE) {
            return { ok: false, error: `Solo se puede confirmar tipo en estado ${ESTADOS.PENDIENTE}` };
        }

        const motivoMeta = buildMotivoMeta({
            estado: meta.estado,
            tipoPermiso: tipoFinal,
            motivo: meta.motivoLimpio,
            fechaPago: fechaPagoFinal
        });

        const res = await pool.query(
            `UPDATE asistencia_limpieza_ajustes
             SET motivo = $2, creado_por = $3, updated_at = NOW()
             WHERE id = $1
             RETURNING id, fecha, persona_key, motivo`,
            [id, motivoMeta, `${confirmadoPor} (confirmo tipo)`]
        );

        const permiso = res.rows[0]
            ? {
                ...res.rows[0],
                tipo_permiso: tipoFinal,
                fecha_pago: fechaPagoFinal || null,
                estado: meta.estado
            }
            : null;

        return { ok: !!res.rows.length, permiso };
    } catch (error) {
        console.error('❌ Error confirmarTipoPermiso:', error);
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
        let mes = '';
        let ano = '';
        if (mesAno.includes('/')) {
            const [mm, yy] = mesAno.split('/');
            mes = mm;
            ano = yy;
        } else {
            const [yy, mm] = mesAno.split('-');
            ano = yy;
            mes = mm;
        }

        const res = await pool.query(
            `SELECT 
                fecha, persona_key, motivo, creado_por,
                DATE_TRUNC('day', updated_at) as registrado_en
             FROM asistencia_limpieza_ajustes 
             WHERE tipo = 'PERMISO'
             AND EXTRACT(YEAR FROM fecha) = $1
             AND EXTRACT(MONTH FROM fecha) = $2
             ORDER BY fecha ASC, persona_key ASC`,
            [Number(ano), Number(mes)]
        );

        const permisos = res.rows
            .map((row) => {
                const meta = extractMetaFromMotivo(row.motivo);
                return {
                    ...row,
                    tipo_permiso: meta.tipoPermiso,
                    estado: meta.estado,
                    motivo: meta.motivoLimpio,
                    fecha_pago: meta.fechaPago || null
                };
            })
            .filter((row) => row.estado !== ESTADOS.CANCELADO);

        return {
            ok: true,
            mes: mesAno,
            permisos,
            resumen: {
                total: permisos.length,
                aprobados: permisos.filter(r => r.estado === ESTADOS.APROBADO).length,
                pendientes: permisos.filter(r => r.estado === ESTADOS.PENDIENTE).length,
                porTipo: {
                    descuento: permisos.filter(r => r.tipo_permiso === 'DESCUENTO_SUELDO').length,
                    cambioDescanso: permisos.filter(r => r.tipo_permiso === 'CAMBIO_DESCANSO').length,
                    turnoDoble: permisos.filter(r => r.tipo_permiso === 'TURNO_DOBLE').length,
                    intercambio: permisos.filter(r => r.tipo_permiso === 'INTERCAMBIO_TURNO').length
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
                fecha, motivo,
                DATE_TRUNC('day', created_at) as registrado_en
             FROM asistencia_limpieza_ajustes 
             WHERE persona_key = $1
               AND tipo = 'PERMISO'
             ORDER BY fecha DESC LIMIT $2`,
            [personaKey, limite]
        );

        const permisos = res.rows
            .map((row) => {
                const meta = extractMetaFromMotivo(row.motivo);
                return {
                    ...row,
                    tipo_permiso: meta.tipoPermiso,
                    estado: meta.estado,
                    motivo: meta.motivoLimpio,
                    fecha_pago: meta.fechaPago || null
                };
            })
            .filter((row) => row.estado !== ESTADOS.CANCELADO);

        return {
            ok: true,
            personaKey,
            permisos,
            total: permisos.length
        };
    } catch (error) {
        console.error('❌ Error reportePermisosPersona:', error);
        return { ok: false, error: error.message };
    }
}

async function listarPermisosPendientes(pool, limite = 20) {
    try {
        const res = await pool.query(
            `SELECT
                id, fecha, persona_key, motivo, creado_por, updated_at
             FROM asistencia_limpieza_ajustes
             WHERE tipo = 'PERMISO'
               AND upper(motivo) LIKE '%[ESTADO:${ESTADOS.PENDIENTE}]%'
             ORDER BY fecha ASC, id ASC
             LIMIT $1`,
            [limite]
        );

        const permisos = res.rows
            .map((row) => {
                const meta = extractMetaFromMotivo(row.motivo);
                return {
                    ...row,
                    tipo_permiso: meta.tipoPermiso,
                    estado: meta.estado,
                    motivo: meta.motivoLimpio,
                    fecha_pago: meta.fechaPago || null
                };
            })
            .filter((row) => row.estado === ESTADOS.PENDIENTE);

        return {
            ok: true,
            permisos,
            total: permisos.length
        };
    } catch (error) {
        console.error('❌ Error listarPermisosPendientes:', error);
        return { ok: false, error: error.message, permisos: [], total: 0 };
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
        const fechaBase = moment(fechaTurnoDoble).tz('America/Mexico_City').format('YYYY-MM-DD');
        const fechaPagoIso = moment(fechaPago).tz('America/Mexico_City').format('YYYY-MM-DD');
        const motivoMeta = buildMotivoMeta({
            estado: ESTADOS.PENDIENTE_PAGO,
            tipoPermiso: 'TURNO_DOBLE',
            motivo: `Deuda: debe trabajar ${moment(fechaPago).tz('America/Mexico_City').format('DD/MM')}`,
            fechaPago: fechaPagoIso
        });

        const res = await pool.query(
            `INSERT INTO asistencia_limpieza_ajustes
             (fecha, persona_key, tipo, motivo, updated_at)
             VALUES ($1, $2, 'PERMISO', $3, NOW())
             RETURNING id, motivo`,
            [
                fechaBase,
                personaKey,
                motivoMeta
            ]
        );

        return { ok: true, deuda_id: res.rows[0]?.id, fecha_pago: fechaPagoIso };
    } catch (error) {
        console.error('❌ Error registrarDeudaPago:', error);
        return { ok: false, error: error.message };
    }
}

async function listarDeudasPendientes(pool) {
    try {
        const res = await pool.query(
            `SELECT 
                id, persona_key, fecha, motivo, creado_por
             FROM asistencia_limpieza_ajustes 
             WHERE tipo = 'PERMISO'
             ORDER BY fecha ASC`
        );

        const hoy = moment().tz('America/Mexico_City').startOf('day');
        const deudas = res.rows
            .map((row) => {
                const meta = extractMetaFromMotivo(row.motivo);
                if (meta.estado !== ESTADOS.PENDIENTE_PAGO || !meta.fechaPago) {
                    return null;
                }

                const fechaPago = moment(meta.fechaPago, 'YYYY-MM-DD');
                const diasParaVencer = fechaPago.diff(hoy, 'days');
                return {
                    ...row,
                    fecha_pago: meta.fechaPago,
                    motivo: meta.motivoLimpio,
                    estado: meta.estado,
                    dias_para_vencer: diasParaVencer
                };
            })
            .filter(Boolean);

        return {
            ok: true,
            deudasPendientes: deudas.filter(r => r.dias_para_vencer >= 0),
            deudasVencidas: deudas.filter(r => r.dias_para_vencer < 0)
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
    confirmarTipoPermiso,
    aprobarPermiso,
    reportePermisosDelMes,
    reportePermisosPersona,
    listarPermisosPendientes,
    registrarDeudaPago,
    listarDeudasPendientes
};
