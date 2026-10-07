(async () => {
  const sesion = requerirSesion(['administrador']);
  if (!sesion) return;

  const mensaje = document.getElementById('mensaje');
  const tablaPendientes = document.getElementById('tabla-pendientes');
  const tablaHistorial = document.getElementById('tabla-historial');
  const tablaPagos = document.getElementById('tabla-pagos');
  const filtroFeria = document.getElementById('filtro-feria-pagos');
  const mensajePagos = document.getElementById('mensaje-pagos');
  let confirmadas = [];

  async function cargarPuestosDisponibles() {
    return apiFetch('/puestos/disponibles');
  }

  async function cargarTodo() {
    const [pendientes, todas, disponibles] = await Promise.all([
      apiFetch('/solicitudes?estado=pendiente'),
      apiFetch('/solicitudes'),
      cargarPuestosDisponibles(),
    ]);

    tablaPendientes.innerHTML = pendientes.length === 0
      ? '<tr><td colspan="6">No hay solicitudes pendientes.</td></tr>'
      : pendientes.map((s) => {
        // Solo se ofrecen puestos libres de la feria que pidió el comerciante; el preferido queda marcado
        const deLaFeria = disponibles.filter((p) => !s.feria_id || p.feria_id === s.feria_id);
        const opciones = deLaFeria.map((p) => `<option value="${p.id}" ${p.id === s.puesto_preferido_id ? 'selected' : ''}>
          ${esc(p.codigo)} · ${esc(p.zona)} · ${NOMBRE_TAMANO[p.tamano]}${p.precio !== null ? ` · ${formatearPesos(p.precio)}` : ''}${p.id === s.puesto_preferido_id ? ' (preferido)' : ''}</option>`).join('');
        const preferencias = [
          s.puesto_preferido_codigo ? `Puesto ${esc(s.puesto_preferido_codigo)}` : '',
          esc(s.zona_preferida || ''),
          NOMBRE_TAMANO[s.tamano_preferido] || '',
        ].filter(Boolean).join('<br>') || '-';
        return `
          <tr data-id="${s.id}">
            <td>${esc(s.comerciante_nombre)}<br><small>${esc(s.comerciante_email)}</small></td>
            <td>${esc(s.feria_nombre || '-')}</td>
            <td>${esc(s.rubro)}</td>
            <td>${preferencias}</td>
            <td>${esc(s.comentario || '-')}</td>
            <td class="acciones-fila">
              <select class="select-puesto">${opciones || '<option value="">Sin puestos libres</option>'}</select>
              <button class="btn-asignar" data-id="${s.id}">Asignar</button>
              <button class="btn-rechazar secundario" data-id="${s.id}">Rechazar</button>
            </td>
          </tr>
        `;
      }).join('');

    tablaHistorial.innerHTML = todas.map((s) => `
      <tr>
        <td>${esc(s.comerciante_nombre)}</td>
        <td>${esc(s.feria_nombre || '-')}</td>
        <td>${esc(s.rubro)}</td>
        <td><span class="badge ${s.estado}">${s.estado}</span></td>
        <td>${esc(s.puesto_codigo || '-')}</td>
        <td>${esc(s.comentario_admin || '-')}</td>
      </tr>
    `).join('');

    confirmadas = todas.filter((s) => s.estado === 'confirmada');
    pintarPagos();

    document.querySelectorAll('.btn-asignar').forEach((boton) => {
      boton.addEventListener('click', async () => {
        const fila = boton.closest('tr');
        mensaje.innerHTML = '';
        const puestoId = fila.querySelector('.select-puesto').value;
        if (!puestoId) {
          mensaje.innerHTML = '<div class="mensaje error">No hay puesto disponible para asignar.</div>';
          return;
        }
        try {
          await apiFetch(`/solicitudes/${boton.dataset.id}/asignar`, {
            method: 'PUT',
            body: JSON.stringify({ puesto_id: Number(puestoId) }),
          });
          await cargarTodo();
          mensaje.innerHTML = '<div class="mensaje exito">Puesto asignado correctamente.</div>';
        } catch (err) {
          mensaje.innerHTML = `<div class="mensaje error">${esc(err.message)}</div>`;
        }
      });
    });

    document.querySelectorAll('.btn-rechazar').forEach((boton) => {
      boton.addEventListener('click', async () => {
        mensaje.innerHTML = '';
        const motivo = prompt('Motivo del rechazo (opcional):') || '';
        try {
          await apiFetch(`/solicitudes/${boton.dataset.id}/rechazar`, {
            method: 'PUT',
            body: JSON.stringify({ comentario_admin: motivo }),
          });
          await cargarTodo();
          mensaje.innerHTML = '<div class="mensaje exito">Solicitud rechazada.</div>';
        } catch (err) {
          mensaje.innerHTML = `<div class="mensaje error">${esc(err.message)}</div>`;
        }
      });
    });
  }

  // ---------- Pagos ----------
  function pintarPagos() {
    // Filtro por feria, conservando la elegida al recargar
    const elegida = filtroFeria.value;
    const nombres = new Map(confirmadas.map((s) => [String(s.feria_id), s.feria_nombre || 'Sin feria']));
    filtroFeria.innerHTML = '<option value="">Todas las ferias</option>'
      + [...nombres].map(([id, nombre]) => `<option value="${id}">${esc(nombre)}</option>`).join('');
    filtroFeria.value = nombres.has(elegida) ? elegida : '';

    const lista = confirmadas.filter((s) => !filtroFeria.value || String(s.feria_id) === filtroFeria.value);
    const sumar = (filas) => filas.reduce((total, s) => total + (s.monto || 0), 0);
    const pagadas = lista.filter((s) => s.estado_pago === 'pagado');
    const pendientes = lista.filter((s) => s.estado_pago !== 'pagado');
    document.getElementById('resumen-pagos').innerHTML = `
      <div>Cobrado<strong>${formatearPesos(sumar(pagadas))}</strong><span class="texto-suave">${pagadas.length} puestos pagados</span></div>
      <div>Por cobrar<strong>${formatearPesos(sumar(pendientes))}</strong><span class="texto-suave">${pendientes.length} puestos sin pagar</span></div>`;

    if (lista.length === 0) {
      tablaPagos.innerHTML = '<tr><td colspan="6">Todavía no hay puestos asignados.</td></tr>';
      return;
    }
    tablaPagos.innerHTML = lista.map((s) => {
      const pagado = s.estado_pago === 'pagado';
      const fecha = pagado && s.pagado_en ? `<br><small>${new Date(s.pagado_en).toLocaleDateString('es-CL')}</small>` : '';
      return `
        <tr data-id="${s.id}">
          <td>${esc(s.comerciante_nombre)}<br><small>${esc(s.comerciante_email)}</small></td>
          <td>${esc(s.feria_nombre || '-')}</td>
          <td>${esc(s.puesto_codigo || '-')}</td>
          <td><input class="monto" type="number" min="0" step="1" value="${s.monto ?? ''}" placeholder="Sin monto"></td>
          <td><span class="badge ${pagado ? 'pagado' : 'pendiente'}">${pagado ? 'pagado' : 'pendiente'}</span>${fecha}</td>
          <td class="acciones-fila">
            <button class="btn-pago sin-margen ${pagado ? 'secundario' : ''}" data-estado="${pagado ? 'pendiente' : 'pagado'}">
              ${pagado ? 'Marcar pendiente' : 'Marcar pagado'}</button>
            <button class="btn-monto secundario sin-margen">Guardar monto</button>
          </td>
        </tr>`;
    }).join('');

    async function guardarPago(fila, estado) {
      mensajePagos.innerHTML = '';
      const s = confirmadas.find((x) => x.id === Number(fila.dataset.id));
      const texto = fila.querySelector('.monto').value.trim();
      try {
        const actualizada = await apiFetch(`/solicitudes/${s.id}/pago`, {
          method: 'PUT',
          body: JSON.stringify({ estado_pago: estado, monto: texto === '' ? null : Number(texto) }),
        });
        Object.assign(s, actualizada);
        pintarPagos();
        mensajePagos.innerHTML = '<div class="mensaje exito">Pago actualizado.</div>';
      } catch (err) {
        mensajePagos.innerHTML = `<div class="mensaje error">${esc(err.message)}</div>`;
      }
    }
    tablaPagos.querySelectorAll('.btn-pago').forEach((boton) => {
      boton.addEventListener('click', () => guardarPago(boton.closest('tr'), boton.dataset.estado));
    });
    tablaPagos.querySelectorAll('.btn-monto').forEach((boton) => {
      boton.addEventListener('click', () => {
        const fila = boton.closest('tr');
        const s = confirmadas.find((x) => x.id === Number(fila.dataset.id));
        guardarPago(fila, s.estado_pago === 'pagado' ? 'pagado' : 'pendiente');
      });
    });
  }
  filtroFeria.addEventListener('change', pintarPagos);

  // Aviso de cuentas nuevas esperando aprobación
  apiFetch('/usuarios?estado=pendiente').then((pendientes) => {
    if (pendientes.length > 0) {
      document.getElementById('aviso-cuentas').innerHTML = `<div class="mensaje">Hay ${pendientes.length}
        ${pendientes.length === 1 ? 'cuenta nueva esperando' : 'cuentas nuevas esperando'} tu aprobación.
        <a href="admin-usuarios.html">Revisar usuarios</a></div>`;
    }
  }).catch(() => {});

  try {
    await cargarTodo();
  } catch (err) {
    mensaje.innerHTML = `<div class="mensaje error">${esc(err.message)}</div>`;
  }
})();
