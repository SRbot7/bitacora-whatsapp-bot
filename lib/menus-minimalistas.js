/**
 * MENÚS MINIMALISTAS Y PROGRESIVOS
 * Estructura anidada para navegación simple
 */

function menuPrincipal() {
    return [
        '🏠 CENTRO OPERATIVO — Menú Principal',
        '',
        '¿Qué necesitas?',
        '',
        '1) 📝 AYUDA — Resolver dudas',
        '2) 🧭 GUÍA — Registrar algo nuevo',
        '3) 📊 INFORMES — Ver reportes',
        '4) 🔔 ALERTAS — Ver alertas activas',
        '5) ⚙️ CONFIGURAR — Ajustes',
        '',
        'Responde 1-5 o escribe CANCELAR'
    ].join('\n');
}

function menuAyuda() {
    return [
        '❓ AYUDA — ¿Sobre qué necesitas help?',
        '',
        '1) 🚧 Pendientes',
        '2) 🏗️ Proyectos',
        '3) 📸 Evidencias/Fotos',
        '4) 📋 Permisos',
        '5) 👥 Asistencia',
        '0) ← Atrás',
        '',
        'Responde 0-5'
    ].join('\n');
}

function menuGuia() {
    return [
        '🧭 GUÍA — ¿Qué deseas registrar?',
        '',
        '1) 🚧 Nuevo Pendiente',
        '2) 🏗️ Nuevo Proyecto',
        '3) 📋 Nuevo Permiso',
        '0) ← Atrás',
        '',
        'Responde 0-3'
    ].join('\n');
}

function menuInformes() {
    return [
        '📊 INFORMES — ¿Qué consultar?',
        '',
        '1) 📋 Pendientes (LISTAR | ABIERTOS | CERRADOS)',
        '2) 🔨 Preventivos (ver estado)',
        '3) 👥 Asistencia (MARCADOR | EN TURNO)',
        '4) 📋 Permisos (resumen + pendientes)',
        '5) 📅 Resumen Operativo Completo',
        '0) ← Atrás',
        '',
        'Responde 0-5'
    ].join('\n');
}

function menuPendientes() {
    return [
        '🚧 PENDIENTES — ¿Qué ver?',
        '',
        '1) 📋 LISTAR todos',
        '2) ⏳ ABIERTOS (sin cerrar)',
        '3) ✅ CERRADOS (hoy)',
        '4) 🎉 COMPLETADOS (todos)',
        '5) 🔍 Ver uno específico',
        '0) ← Atrás',
        '',
        'Responde 0-5'
    ].join('\n');
}

function menuPreventivos() {
    return [
        '🔨 PREVENTIVOS — ¿Qué acción?',
        '',
        '1) 📋 LISTAR todos',
        '2) ⏳ ABIERTOS/PENDIENTES',
        '3) ✅ CERRADOS',
        '4) 🔒 CERRAR preventivo',
        '0) ← Atrás',
        '',
        'Para cerrar: escribe ID después'
    ].join('\n');
}

function menuAsistencia() {
    return [
        '👥 ASISTENCIA — ¿Qué ver?',
        '',
        '1) 👁️ MARCADOR (quiénes están)',
        '2) ⏱️ EN TURNO (personas activas)',
        '3) 📅 ASISTENCIA HOY',
        '4) 📋 ESTADO TURNO LIMPIEZA',
        '5) ⚠️ ALERTAS ASISTENCIA',
        '0) ← Atrás',
        '',
        'Responde 0-5'
    ].join('\n');
}

function menuAlertas() {
    return [
        '🔔 ALERTAS ACTIVAS',
        '',
        '1) ⚠️ Asistencia (sin check-in)',
        '2) 📋 Ajustes Pendientes',
        '3) 💳 Deudas Vencidas',
        '0) ← Atrás',
        '',
        'Responde 0-3'
    ].join('\n');
}

function menuConfigurar() {
    return [
        '⚙️ CONFIGURAR — Administración',
        '',
        '1) ✅ Aprobar Permisos',
        '2) 🗑️ Cancelar Ajuste',
        '3) 📊 Ver Límites Permisos',
        '0) ← Atrás',
        '',
        'Responde 0-3'
    ].join('\n');
}

// ============ AYUDA DETALLADA (submenu) ============

function detalleAyudaPendientes() {
    return [
        '🚧 PENDIENTES',
        '',
        'Usa: GUIA PENDIENTE',
        'Para registrar paso a paso.',
        '',
        'Consulta operativa:',
        '• LISTAR (pendientes + preventivos + proyectos + permisos limpieza)',
        '• ABIERTOS (totales rápidos)',
        '',
        'Luego envía fotos y se ligan automáticamente.',
        'Cierre rápido: CERRAR <ID>',
        '',
        'Ej: CERRAR 42'
    ].join('\n');
}

function detalleAyudaProyectos() {
    return [
        '🏗️ PROYECTOS',
        '',
        'Usa: GUIA PROYECTO',
        'Para registrar paso a paso.',
        '',
        'Luego envía fotos y se ligan automáticamente.',
        'Cierre rápido: CERRAR <ID>',
        '',
        'Ej: CERRAR 3'
    ].join('\n');
}

function detalleAyudaEvidencias() {
    return [
        '📸 EVIDENCIAS',
        '',
        'Envía fotos DESPUÉS de registrar algo.',
        '',
        'Se ligan automáticamente al último registro tuyo',
        '(pendiente, material, proyecto, permiso).',
        '',
        'Puedes enviar 1 o varias fotos seguidas.'
    ].join('\n');
}

function detalleAyudaPermisos() {
    return [
        '📋 PERMISOS',
        '',
        'Usa: GUIA PERMISO o PERMISO',
        'Para registrar ausencias con tipo.',
        '',
        '4 tipos disponibles:',
        '1) 💰 Descuento sueldo',
        '2) 🔄 Cambio descanso',
        '3) 📅 Turno doble',
        '4) 🤝 Intercambio turno',
        '',
        'El permiso puede estar:',
        '• PENDIENTE_APROBACION (espera supervisor)',
        '• APROBADO (confirmado)',
        '',
        'Confirmar tipo después:',
        '• CONFIRMAR PERMISO <ID> | DESCUENTO SUELDO',
        '• CONFIRMAR PERMISO <ID> | CAMBIO DESCANSO | DD/MM/YYYY',
        '• CONFIRMAR PERMISO <ID> | TURNO DOBLE | DD/MM/YYYY',
        '• CONFIRMAR PERMISO <ID> | INTERCAMBIO TURNO',
        '',
        'Aprobar al final:',
        '• APROBAR PERMISO <ID>',
        '',
        'Dónde verlo:',
        '• LISTAR (sección permisos pendientes)',
        '• ABIERTOS (conteo de permisos pendientes)',
        '• REPORTE (incluye permisos limpieza pendientes)'
    ].join('\n');
}

function detalleAyudaAsistencia() {
    return [
        '👥 ASISTENCIA',
        '',
        'Usa: ASISTENCIA o GUIA ASISTENCIA',
        'Para registrar presencia manual.',
        '',
        'Ver estado:',
        '• MARCADOR — quiénes están en turno',
        '• EN TURNO — personas activas',
        '• ALERTAS — sin registro'
    ].join('\n');
}

// ============ MENÚS PARA GUÍAS (Mostrar Nombres) ============

function guiaPermisoMenuEquipos() {
    return [
        '📋 PERMISO — Paso 1: Equipo',
        '',
        '¿Qué equipo?',
        '',
        '1) 🧹 LIMPIEZA',
        '2) 🛠️ MANTENIMIENTO',
        '',
        'Responde 1 o 2'
    ].join('\n');
}

function guiaPermisoMenuNombres(area, personas) {
    /**
     * personas: array de objetos { nombre, turno }
     */
    const titulo = area === 'LIMPIEZA' ? '🧹 LIMPIEZA' : '🛠️ MANTENIMIENTO';
    const lineas = [
        `📋 PERMISO — Paso 2: Nombre (${titulo})`,
        ''
    ];

    personas.forEach((p, idx) => {
        lineas.push(`${idx + 1}) ${p.nombre}`);
        if (p.turno) lineas.push(`   └─ ${p.turno}`);
    });

    lineas.push('');
    lineas.push('Responde número o escribe nombre exacto');

    return lineas.join('\n');
}

function guiaPermisoPaso3Dia() {
    const hoy = require('moment-timezone')().tz('America/Mexico_City');
    return [
        '📋 PERMISO — Paso 3: Día',
        '',
        '¿Qué día será el permiso?',
        '',
        `Hoy: ${hoy.format('DD/MM/YYYY (dddd)')}`,
        '',
        'Escribe en formato:',
        '• DD/MM (ej: 05/07)',
        '• DD/MM/YYYY (ej: 05/07/2026)'
    ].join('\n');
}

function guiaPermisoPaso4Razon() {
    return [
        '📋 PERMISO — Paso 4: Razón',
        '',
        '¿Cuál es el motivo?',
        '',
        'Ej:',
        '• Cita médica',
        '• Asuntos personales',
        '• Trámite importante',
        '• Otro'
    ].join('\n');
}

function guiaPermisoPaso5Tipo() {
    return [
        '📋 PERMISO — Paso 5: Tipo',
        '',
        '¿Qué tipo de permiso?',
        '',
        '1) 💰 DESCUENTO SUELDO',
        '   → Se quita del salario',
        '',
        '2) 🔄 CAMBIO DESCANSO',
        '   → Cambiar día de descanso',
        '',
        '3) 📅 TURNO DOBLE',
        '   → Trabajar otro día (deuda)',
        '',
        '4) 🤝 INTERCAMBIO TURNO',
        '   → Canjar con compañero',
        '',
        '5) ⏳ PENDIENTE DEFINIR',
        '   → Confirmar después (pago o descuento)',
        '',
        'Responde 1, 2, 3, 4 o 5'
    ].join('\n');
}

module.exports = {
    menuPrincipal,
    menuAyuda,
    menuGuia,
    menuInformes,
    menuPendientes,
    menuPreventivos,
    menuAsistencia,
    menuAlertas,
    menuConfigurar,
    detalleAyudaPendientes,
    detalleAyudaProyectos,
    detalleAyudaEvidencias,
    detalleAyudaPermisos,
    detalleAyudaAsistencia,
    guiaPermisoMenuEquipos,
    guiaPermisoMenuNombres,
    guiaPermisoPaso3Dia,
    guiaPermisoPaso4Razon,
    guiaPermisoPaso5Tipo
};
