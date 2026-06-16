// =========================
// VARIABLES GLOBALES
// =========================

let imagenesModal = [];

let indiceActual = 0;


// =========================
// LIMPIAR TEXTO
// =========================

function limpiarTexto(
    texto,
    valorDefecto = ''
) {

    return (
        texto || valorDefecto
    )
        .trim()
        .replace(
            /^\s+/g,
            ''
        );

}

// =========================
// CARGAR ACTIVIDADES
// =========================

async function cargarActividades() {

    const contenedor =
        document.getElementById(
            'actividades'
        );

    try {

        const respuesta =
            await fetch(
                '/actividades'
            );
            if (
                !respuesta.ok
            ) {

            throw new Error(
                'Error al consultar API'
            );

            }


        const actividades =
            await respuesta.json();

        contenedor.innerHTML = '';

        actividades.forEach(
            actividad => {

                contenedor.innerHTML += `

                    <div class="card">

                        <h3>
                            ID ${actividad.id}
                        </h3>

                        <p>
                            <b>Técnico:</b>
                            ${actividad.tecnico}
                        </p>

                        <p>
                            <b>Área:</b>
                            ${actividad.area}
                        </p>

                       <p>

                            <b>Actividad:</b>

                        </p>

                        <div class="actividad-texto">

                            ${
                                limpiarTexto(
                                    actividad.actividad
                                )
                                .replace(
                                    /\n{2,}/g,
                                    '\n'
                                )
                            }       
                            

                        </div>
                       
                        <p>

                            <b>Pendientes:</b>

                        </p>

                        <div class="actividad-texto pendientes">

                            ${
                                limpiarTexto(
                                    actividad.pendientes,
                                    '- Ninguno'
                                )
                            }

</div>


                        <p>
                            <b>Turno:</b>
                            ${actividad.turno}
                        </p>

                        <p>
                            <b>Fecha:</b>
                                ${new Date(
                                    actividad.fecha
                                ).toLocaleString(
                                    'es-MX',
                                    {
                                        dateStyle: 'short',
                                        timeStyle: 'short'
                                    }
                                )}
                        </p>

                        <button
                            id="btn-${actividad.id}"

                            onclick="
                                verEvidencias(
                                    ${actividad.id}
                                )
                            "
                        >
                            Ver evidencias
                        </button>

                        <div
                            id="evidencias-${actividad.id}"
                        ></div>

                    </div>

                `;

            }
        );

    } catch (error) {

        console.error(error);

        contenedor.innerHTML =
            'Error al cargar actividades';

    }

}

// =========================
// MOSTRAR / OCULTAR
// EVIDENCIAS
// =========================

async function verEvidencias(
    actividadId
) {

    const contenedor =
        document.getElementById(
            `evidencias-${actividadId}`
        );

    const boton =
        document.getElementById(
            `btn-${actividadId}`
        );

    // Ocultar si ya están visibles

    if (
        contenedor.innerHTML.trim()
    ) {

        contenedor.innerHTML = '';

        boton.innerText =
            'Ver evidencias';

        return;

    }

    try {

        const respuesta =
            await fetch(
                `/actividad/${actividadId}/evidencias`
            );

            if (
                !respuesta.ok
                ) {

                    throw new Error(
                        'Error al consultar API'
                    );

                }

        const evidencias =
            await respuesta.json();

        contenedor.innerHTML = '';

        // Crear arreglo de rutas
        // para navegación del modal

        const rutas =
            evidencias.map(
                e => `/${e.ruta}`
            );

        evidencias.forEach(
            evidencia => {

                contenedor.innerHTML += `

                    <img

                        src="/${evidencia.ruta}"

                        title="
                            ${evidencia.nombre_archivo}
                        "

                        onclick='
                            abrirModal(
                                "/${evidencia.ruta}",
                                ${JSON.stringify(rutas)}
                            )
                        '

                    >

                `;

            }
        );

        boton.innerText =
            'Ocultar evidencias';

    } catch (error) {

        console.error(error);

        contenedor.innerHTML =
            'Error al cargar evidencias';

    }

}

// =========================
// ABRIR MODAL
// =========================

function abrirModal(
    ruta,
    imagenes = []
) {

    imagenesModal =
        imagenes;

    indiceActual =
        imagenes.indexOf(
            ruta
        );

    const modal =
        document.getElementById(
            'modal'
        );

    const imagen =
        document.getElementById(
            'imagenModal'
        );

    imagen.src =
        ruta;

    actualizarContador();

    modal.style.display =
        'block';

    modal.setAttribute(
        'aria-hidden',
        'false'
    );

}

// =========================
// CERRAR MODAL
// =========================

function cerrarModal() {

    const modal =
        document.getElementById(
            'modal'
        );

    modal.style.display =
        'none';

    modal.setAttribute(
        'aria-hidden',
        'true'
    );

}

// =========================
// IMAGEN ANTERIOR
// =========================

function imagenAnterior() {

    if (
        imagenesModal.length === 0
    ) return;

    indiceActual--;

    if (
        indiceActual < 0
    ) {

        indiceActual =
            imagenesModal.length - 1;

    }

    actualizarImagen();

}

// =========================
// IMAGEN SIGUIENTE
// =========================

function imagenSiguiente() {

    if (
        imagenesModal.length === 0
    ) return;

    indiceActual++;

    if (
        indiceActual >=
        imagenesModal.length
    ) {

        indiceActual = 0;

    }

    actualizarImagen();

}

// =========================
// ACTUALIZAR IMAGEN
// =========================

function actualizarImagen() {

    document.getElementById(
        'imagenModal'
    ).src =

        imagenesModal[
            indiceActual
        ];

    actualizarContador();

}

// =========================
// ACTUALIZAR CONTADOR
// =========================

function actualizarContador() {

    document.getElementById(
        'contadorImagen'
    ).innerText =

        `${indiceActual + 1} / ${imagenesModal.length}`;

}

// =========================
// CERRAR MODAL
// AL HACER CLICK FUERA
// =========================

window.onclick = function(
    event
) {

    const modal =
        document.getElementById(
            'modal'
        );

    if (
        event.target === modal
    ) {

        cerrarModal();

    }

};

// =========================
// INICIALIZACIÓN
// =========================

cargarActividades();

// =========================
// ATAJOS DE TECLADO
// =========================

document.addEventListener(

    'keydown',

    (event) => {

        const modal =
            document.getElementById(
                'modal'
            );

        if (
            modal.style.display !==
            'block'
        ) {

            return;

        }

        switch (
            event.key
        ) {

            case 'ArrowLeft':

                imagenAnterior();

                break;

            case 'ArrowRight':

                imagenSiguiente();

                break;

            case 'Escape':

                cerrarModal();

                break;

        }

    }

);