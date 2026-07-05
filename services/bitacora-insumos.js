function normalizarTipoMovimiento(valor = '') {
    const t = (valor || '').toString().trim().toUpperCase();
    if (t === 'ENTRADA' || t === 'SALIDA' || t === 'AJUSTE') {
        return t;
    }
    return 'NO_DEFINIDO';
}

function parsearCantidadUnidad(texto = '') {
    const raw = (texto || '').toString().trim();
    if (!raw) {
        return { cantidad: null, unidad: '' };
    }

    const match = raw.match(/(-?\d+(?:[.,]\d+)?)/);
    if (!match) {
        return { cantidad: null, unidad: raw };
    }

    const cantidad = Number.parseFloat(match[1].replace(',', '.'));
    const unidad = raw.replace(match[1], '').trim();

    return {
        cantidad: Number.isFinite(cantidad) ? cantidad : null,
        unidad
    };
}

function parsearLineaInsumo(linea = '') {
    const original = (linea || '').toString().trim();
    if (!original) {
        return null;
    }

    const partes = original
        .split('|')
        .map((p) => p.trim())
        .filter(Boolean);

    if (partes.length === 0) {
        return null;
    }

    let tipo = 'NO_DEFINIDO';
    let item = '';
    let cantidad = null;
    let unidad = '';
    let detalle = '';

    if (partes.length >= 2) {
        tipo = normalizarTipoMovimiento(partes[0]);
        if (tipo === 'NO_DEFINIDO') {
            item = partes[0];
            const cu = parsearCantidadUnidad(partes[1]);
            cantidad = cu.cantidad;
            unidad = cu.unidad;
            detalle = partes.slice(2).join(' | ');
        } else {
            item = partes[1] || '';
            const cu = parsearCantidadUnidad(partes[2] || '');
            cantidad = cu.cantidad;
            unidad = cu.unidad;
            detalle = partes.slice(3).join(' | ');
        }
    } else {
        item = partes[0];
    }

    return {
        tipoMov: tipo,
        item: item || original,
        cantidad,
        unidad,
        detalle,
        lineaOriginal: original
    };
}

async function asegurarTablaInsumos(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS bitacora_insumos_movimientos (
            id BIGSERIAL PRIMARY KEY,
            actividad_id BIGINT NULL REFERENCES bitacora(id) ON DELETE SET NULL,
            fecha TIMESTAMP NOT NULL,
            grupo VARCHAR(120),
            tecnico VARCHAR(100),
            area VARCHAR(120),
            turno VARCHAR(20),
            tipo_mov VARCHAR(20) NOT NULL,
            item TEXT NOT NULL,
            cantidad NUMERIC(12,3) NULL,
            unidad VARCHAR(40),
            detalle TEXT,
            linea_original TEXT NOT NULL,
            mensaje_id VARCHAR(150),
            creado_en TIMESTAMP DEFAULT NOW()
        );
    `);

    await pool.query('CREATE INDEX IF NOT EXISTS idx_bitacora_insumos_fecha ON bitacora_insumos_movimientos(fecha);');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_bitacora_insumos_item ON bitacora_insumos_movimientos(item);');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_bitacora_insumos_tipo ON bitacora_insumos_movimientos(tipo_mov);');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_bitacora_insumos_msg ON bitacora_insumos_movimientos(mensaje_id);');
}

async function guardarMovimientosInsumosBitacora(pool, payload = {}) {
    const lineas = Array.isArray(payload.lineas) ? payload.lineas : [];
    if (!lineas.length) {
        return { total: 0 };
    }

    await asegurarTablaInsumos(pool);

    const rows = lineas
        .map((linea) => parsearLineaInsumo(linea))
        .filter(Boolean);

    if (!rows.length) {
        return { total: 0 };
    }

    if (payload.mensajeId) {
        await pool.query('DELETE FROM bitacora_insumos_movimientos WHERE mensaje_id = $1', [payload.mensajeId]);
    }

    for (const row of rows) {
        await pool.query(
            `
            INSERT INTO bitacora_insumos_movimientos
            (
                actividad_id,
                fecha,
                grupo,
                tecnico,
                area,
                turno,
                tipo_mov,
                item,
                cantidad,
                unidad,
                detalle,
                linea_original,
                mensaje_id
            )
            VALUES
            (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
            )
            `,
            [
                payload.actividadId || null,
                payload.fechaSql,
                payload.grupo || null,
                payload.tecnico || null,
                payload.area || null,
                payload.turno || null,
                row.tipoMov,
                row.item,
                row.cantidad,
                row.unidad || null,
                row.detalle || null,
                row.lineaOriginal,
                payload.mensajeId || null
            ]
        );
    }

    return { total: rows.length };
}

module.exports = {
    guardarMovimientosInsumosBitacora
};