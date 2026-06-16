let imagenesModal = [];

let indiceActual = 0;

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

                        <div class="actividad-texto">${
                            actividad.actividad
                                ? actividad.actividad.trim()
                                : 'Sin actividad'
                            }</div>

<p>
    <b>Pendientes:</b>
</p>

<div class="actividad-texto pendientes">${
    actividad.pendientes
        ? actividad.pendientes.trim()
        : '- Ninguno'
    }</div>
                        <p>
                            <b>Turno:</b>
                            ${actividad.turno}
                        </p>

                        <p>
                            <b>Fecha:</b>
                            ${new Date(
                                actividad.fecha
                            ).toLocaleString()}
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

cargarActividades();

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

        const evidencias =
            await respuesta.json();

        contenedor.innerHTML = '';

        // Crear arreglo para navegacion del modal
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

}

function cerrarModal() {

    document.getElementById(
        'modal'
    ).style.display =
        'none';

}

function imagenAnterior() {

    indiceActual--;

    if (
        indiceActual < 0
    ) {

        indiceActual =
            imagenesModal.length - 1;

    }

    actualizarImagen();

}

function imagenSiguiente() {

    indiceActual++;

    if (
        indiceActual >=
        imagenesModal.length
    ) {

        indiceActual = 0;

    }

    actualizarImagen();

}

function actualizarImagen() {

    document.getElementById(
        'imagenModal'
    ).src =

        imagenesModal[
            indiceActual
        ];

    actualizarContador();

}

function actualizarContador() {

    document.getElementById(
        'contadorImagen'
    ).innerText =

        `${indiceActual + 1} / ${imagenesModal.length}`;

}

window.onclick =
    function(event) {

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

document.addEventListener(
    'keydown',
    event => {

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