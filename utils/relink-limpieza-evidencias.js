require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const pool = require('../db');

const ROOT_DIR = path.join(__dirname, '..');
const LEGACY_DIR = path.join(ROOT_DIR, 'evidencias');
const TARGET_DIR = path.join(ROOT_DIR, 'evidencias_limpieza');

const APPLY = process.argv.includes('--apply');
const MOVE = process.argv.includes('--move');
const MAX_MINUTES_ARG = process.argv.find(arg => arg.startsWith('--max-minutes='));
const MAX_MINUTES = MAX_MINUTES_ARG ? Number(MAX_MINUTES_ARG.split('=')[1]) : 15;
const MAX_DIFF_MS = MAX_MINUTES * 60 * 1000;

const VALID_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'bmp']);

function walkFiles(dir) {
    if (!fs.existsSync(dir)) return [];

    const output = [];
    const stack = [dir];

    while (stack.length > 0) {
        const current = stack.pop();
        const entries = fs.readdirSync(current, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(fullPath);
                continue;
            }

            const base = path.basename(entry.name);
            const match = base.match(/^(\d{13})\.([a-zA-Z0-9]+)$/);
            if (!match) continue;

            const timestampMs = Number(match[1]);
            const extension = (match[2] || '').toLowerCase();
            if (!VALID_EXT.has(extension)) continue;

            output.push({
                path: fullPath,
                name: base,
                timestampMs,
                extension
            });
        }
    }

    return output;
}

function toSqlDateFolder(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function nextAvailablePath(filePath) {
    if (!fs.existsSync(filePath)) return filePath;

    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const name = path.basename(filePath, ext);

    let i = 1;
    while (true) {
        const candidate = path.join(dir, `${name}_${i}${ext}`);
        if (!fs.existsSync(candidate)) return candidate;
        i += 1;
    }
}

async function getUsedRoutes() {
    const tables = [
        'evidencias_mtto',
        'evidencias_limpieza',
        'evidencias_pendientes',
        'evidencias_proyectos'
    ];

    const used = new Set();

    for (const table of tables) {
        const res = await pool.query(`SELECT ruta FROM ${table} WHERE ruta IS NOT NULL`);
        for (const row of res.rows) {
            if (row.ruta) used.add(path.normalize(row.ruta));
        }
    }

    return used;
}

async function getPendingActivities() {
    const res = await pool.query(`
        SELECT a.id, a.fecha, a.autor, a.grupo
        FROM actividades_limpieza a
        LEFT JOIN evidencias_limpieza e ON e.actividad_id = a.id
        WHERE a.tipo_mensaje = 'image'
          AND e.id IS NULL
        ORDER BY a.fecha ASC, a.id ASC
    `);

    return res.rows.map(row => ({
        id: row.id,
        fecha: new Date(row.fecha),
        autor: row.autor,
        grupo: row.grupo,
        ts: new Date(row.fecha).getTime()
    }));
}

function matchFiles(activities, files, usedRoutes) {
    const available = files
        .filter(f => !usedRoutes.has(path.normalize(f.path)))
        .sort((a, b) => a.timestampMs - b.timestampMs);

    const usedFilePaths = new Set();
    const links = [];

    for (const activity of activities) {
        let best = null;
        let bestDiff = Number.MAX_SAFE_INTEGER;

        for (const file of available) {
            if (usedFilePaths.has(file.path)) continue;

            const diff = Math.abs(file.timestampMs - activity.ts);
            if (diff > MAX_DIFF_MS) continue;

            if (diff < bestDiff) {
                best = file;
                bestDiff = diff;
            }
        }

        if (best) {
            usedFilePaths.add(best.path);
            links.push({
                activity,
                file: best,
                diffMs: bestDiff
            });
        }
    }

    return links;
}

async function applyLinks(links) {
    let inserted = 0;

    for (const item of links) {
        const folderDate = toSqlDateFolder(item.activity.fecha);
        const targetFolder = path.join(TARGET_DIR, folderDate);
        fs.mkdirSync(targetFolder, { recursive: true });

        const targetPathBase = path.join(targetFolder, item.file.name);
        const targetPath = nextAvailablePath(targetPathBase);

        if (MOVE) {
            fs.renameSync(item.file.path, targetPath);
        } else {
            fs.copyFileSync(item.file.path, targetPath);
        }

        const tipoArchivo = mime.lookup(targetPath) || 'image';

        await pool.query(
            `
            INSERT INTO evidencias_limpieza
            (actividad_id, ruta, tipo_archivo, nombre_archivo)
            VALUES ($1, $2, $3, $4)
            `,
            [
                item.activity.id,
                targetPath,
                tipoArchivo,
                path.basename(targetPath)
            ]
        );

        inserted += 1;
    }

    return inserted;
}

async function main() {
    try {
        const usedRoutes = await getUsedRoutes();
        const activities = await getPendingActivities();
        const files = walkFiles(LEGACY_DIR);

        const links = matchFiles(activities, files, usedRoutes);

        console.log('=== Relink LIMPIEZA ===');
        console.log('modo:', APPLY ? 'APPLY' : 'DRY-RUN');
        console.log('movimiento_archivos:', MOVE ? 'MOVE' : 'COPY');
        console.log('max_minutos:', MAX_MINUTES);
        console.log('actividades_imagen_sin_evidencia:', activities.length);
        console.log('archivos_candidatos_legacy:', files.length);
        console.log('matches_encontrados:', links.length);

        if (links.length > 0) {
            const preview = links.slice(0, 20).map(item => ({
                actividad_id: item.activity.id,
                fecha_actividad: item.activity.fecha.toISOString(),
                archivo: item.file.name,
                diff_segundos: Math.round(item.diffMs / 1000)
            }));

            console.table(preview);

            if (!APPLY) {
                console.log('\nEjecuta con --apply para insertar en BD.');
                console.log('Opcional: --move para mover archivo en lugar de copiar.');
                return;
            }

            const inserted = await applyLinks(links);
            console.log('\ninsertados_en_evidencias_limpieza:', inserted);
        }
    } catch (error) {
        console.error('ERROR relink limpieza:', error.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

main();
