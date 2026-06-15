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
                            ${actividad.actividad}
                        </p>

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

        evidencias.forEach(
            evidencia => {

                contenedor.innerHTML += `
                    <img
                        src="/${evidencia.ruta}"

                        title="
                            ${evidencia.nombre_archivo}
                        "
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