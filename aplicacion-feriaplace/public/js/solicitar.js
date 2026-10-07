(async () => {
  const sesion = requerirSesion(['comerciante']);
  if (!sesion) return;

  const mensaje = document.getElementById('mensaje');
  const selectFeria = document.getElementById('feria');
  const selectPuesto = document.getElementById('puesto');
  const selectZona = document.getElementById('zona');
  const contenedorPlano = document.getElementById('plano');
  const parametros = new URLSearchParams(window.location.search);

  let feria = null;

  function pintarPlano() {
    const elegido = Number(selectPuesto.value) || null;
    dibujarPlano(contenedorPlano, feria, feria.puestos, {
      seleccionadoId: elegido,
      alHacerClic: (p) => {
        if (p.estado !== 'disponible') return;
        selectPuesto.value = String(p.id);
        alCambiarPuesto();
      },
    });
  }

  // Al elegir un puesto preferido, la zona y el tamaño se completan con los de ese puesto
  function alCambiarPuesto() {
    const p = feria.puestos.find((x) => x.id === Number(selectPuesto.value));
    if (p) {
      selectZona.value = p.zona;
      document.getElementById('tamano').value = p.tamano;
    }
    pintarPlano();
  }

  async function cargarFeria(id, puestoInicial) {
    feria = await apiFetch(`/ferias/${id}`);
    const disponibles = feria.puestos.filter((p) => p.estado === 'disponible');
    selectPuesto.innerHTML = '<option value="">Sin puesto preferido</option>'
      + disponibles.map((p) => `<option value="${p.id}">${esc(p.codigo)} · ${esc(p.zona)} · ${NOMBRE_TAMANO[p.tamano]}</option>`).join('');
    const zonas = [...new Set(feria.puestos.map((p) => p.zona))].sort();
    selectZona.innerHTML = '<option value="">Sin preferencia</option>'
      + zonas.map((z) => `<option value="${esc(z)}">${esc(z)}</option>`).join('');
    if (puestoInicial && disponibles.some((p) => p.id === puestoInicial)) {
      selectPuesto.value = String(puestoInicial);
      alCambiarPuesto();
    } else {
      pintarPlano();
    }
  }

  try {
    const ferias = await apiFetch('/ferias');
    if (ferias.length === 0) {
      mensaje.innerHTML = '<div class="mensaje error">Todavía no hay ferias abiertas para postular.</div>';
      document.getElementById('form-solicitud').classList.add('oculto');
      return;
    }
    selectFeria.innerHTML = ferias.map((f) => `<option value="${f.id}">${esc(f.nombre)} (${f.puestos_disponibles} disponibles)</option>`).join('');
    const pedida = Number(parametros.get('feria'));
    if (ferias.some((f) => f.id === pedida)) selectFeria.value = String(pedida);
    await cargarFeria(Number(selectFeria.value), Number(parametros.get('puesto')));
  } catch (err) {
    mensaje.innerHTML = `<div class="mensaje error">${esc(err.message)}</div>`;
    return;
  }

  selectFeria.addEventListener('change', () => cargarFeria(Number(selectFeria.value)).catch((err) => {
    mensaje.innerHTML = `<div class="mensaje error">${esc(err.message)}</div>`;
  }));
  selectPuesto.addEventListener('change', alCambiarPuesto);

  document.getElementById('form-solicitud').addEventListener('submit', async (e) => {
    e.preventDefault();
    mensaje.innerHTML = '';
    const cuerpo = {
      feria_id: Number(selectFeria.value),
      puesto_preferido_id: Number(selectPuesto.value) || null,
      rubro: document.getElementById('rubro').value.trim(),
      zona_preferida: selectZona.value || null,
      tamano_preferido: document.getElementById('tamano').value || null,
      comentario: document.getElementById('comentario').value.trim() || null,
    };
    try {
      await apiFetch('/solicitudes', { method: 'POST', body: JSON.stringify(cuerpo) });
      mensaje.innerHTML = '<div class="mensaje exito">Solicitud enviada. Revisa el estado en <a href="mis-solicitudes.html">Mis solicitudes</a>.</div>';
      document.getElementById('rubro').value = '';
      document.getElementById('comentario').value = '';
    } catch (err) {
      mensaje.innerHTML = `<div class="mensaje error">${esc(err.message)}</div>`;
    }
  });
})();
