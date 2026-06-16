// =========================
// CARGA DE CONFIGURACIÓN
// =========================

require('dotenv').config();

const express = require('express');
const cors = require('cors');

const pool = require('./db');

// =========================
// MANEJO GLOBAL DE ERRORES
// =========================

process.on(
    'uncaughtException',

    (err) => {

        console.error(
            '❌ ERROR NO CAPTURADO:'
        );

        console.error(err);

    }
);

process.on(
    'unhandledRejection',

    (err) => {

        console.error(
            '❌ PROMESA RECHAZADA:'
        );

        console.error(err);

    }
);

// =========================
// INICIALIZACIÓN DE EXPRESS
// =========================

const app = express();

// =========================
// MIDDLEWARES
// =========================

// Permitir peticiones externas

app.use(
    cors()
);

// Procesar JSON

app.use(
    express.json()
);

// Dashboard web

app.use(
    express.static(
        'dashboard'
    )
);

// Servir imágenes/evidencias

app.use(
    '/evidencias',

    express.static(
        'evidencias'
    )
);

// =========================
// HEALTH CHECK
// =========================

app.get(

    '/',

    (req, res) => {

        res.json({

            status:
                'ok',

            servicio:
                'Bitacora API'

        });

    }

);

// =========================
// LISTAR ACTIVIDADES
// =========================

app.get(

    '/actividades',

    async (req, res) => {

        try {

            const resultado =
                await pool.query(

                    `
                    SELECT *
                    FROM actividades_mtto
                    ORDER BY fecha DESC
                    LIMIT 100
                    `

                );

            res.json(
                resultado.rows
            );

        } catch (error) {

            console.error(error);

            res.status(500).json({

                error:
                    'Error al consultar actividades'

            });

        }

    }

);

// =========================
// CONSULTAR ACTIVIDAD
// =========================

app.get(

    '/actividad/:id',

    async (req, res) => {

        try {

            const { id } =
                req.params;

            const resultado =
                await pool.query(

                    `
                    SELECT *
                    FROM actividades_mtto
                    WHERE id = $1
                    `,

                    [id]

                );

            res.json(
                resultado.rows[0]
            );

        } catch (error) {

            console.error(error);

            res.status(500).json({

                error:
                    'Error al consultar actividad'

            });

        }

    }

);

// =========================
// CONSULTAR EVIDENCIAS
// =========================

app.get(

    '/actividad/:id/evidencias',

    async (req, res) => {

        try {

            const { id } =
                req.params;

            const resultado =
                await pool.query(

                    `
                    SELECT *
                    FROM evidencias_mtto
                    WHERE actividad_id = $1
                    ORDER BY fecha
                    `,

                    [id]

                );

            res.json(
                resultado.rows
            );

        } catch (error) {

            console.error(error);

            res.status(500).json({

                error:
                    'Error al consultar evidencias'

            });

        }

    }

);

// =========================
// CONFIGURACIÓN DEL SERVIDOR
// =========================

const PORT =

    process.env.API_PORT
    || 5000;

// =========================
// INICIO DEL SERVIDOR
// =========================

app.listen(

    PORT,

    () => {

        console.log(

            `🚀 API escuchando en puerto ${PORT}`

        );

    }

);