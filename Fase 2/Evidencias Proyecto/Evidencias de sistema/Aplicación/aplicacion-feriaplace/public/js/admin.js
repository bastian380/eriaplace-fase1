(async () => {
  const sesion = requerirSesion(ROLES_GESTION);
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
    cargarOcupacion();
    cargarEspera();

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
      const fecha = (pagado && s.pagado_en ? `<br><small>${new Date(s.pagado_en).toLocaleDateString('es-CL')}</small>` : '')
        + (pagado && s.pago_autorizacion ? `<br><small>En línea · código ${esc(s.pago_autorizacion)}</small>` : '');
      return `
        <tr data-id="${s.id}">
          <td>${esc(s.comerciante_nombre)}<br><small>${esc(s.comerciante_email)}</small></td>
          <td>${esc(s.feria_nombre || '-')}</td>
          <td>${esc(s.puesto_codigo || '-')}<br><a href="credencial.html?id=${s.id}" target="_blank">Credencial</a></td>
          <td><input class="monto" type="number" min="0" step="1" value="${s.monto ?? ''}" placeholder="Sin monto"></td>
          <td><span class="badge ${pagado ? 'pagado' : 'pendiente'}">${pagado ? 'pagado' : 'pendiente'}</span>${fecha}</td>
          <td class="acciones-fila">
            <button class="btn-pago sin-margen ${pagado ? 'secundario' : ''}" data-estado="${pagado ? 'pendiente' : 'pagado'}">
              ${pagado ? 'Marcar pendiente' : 'Marcar pagado'}</button>
            <button class="btn-monto secundario sin-margen">Guardar monto</button>
            ${pagado ? '' : '<button class="btn-liberar peligro sin-margen">Liberar puesto</button>'}
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
        // El reporte de ocupación también muestra lo cobrado y por cobrar: se vuelve a pedir para que no quede en $0
        await cargarOcupacion();
        mensajePagos.innerHTML = '<div class="mensaje exito">Pago actualizado.</div>';
      } catch (err) {
        mensajePagos.innerHTML = `<div class="mensaje error">${esc(err.message)}</div>`;
      }
    }
    tablaPagos.querySelectorAll('.btn-pago').forEach((boton) => {
      boton.addEventListener('click', () => guardarPago(boton.closest('tr'), boton.dataset.estado));
    });
    tablaPagos.querySelectorAll('.btn-liberar').forEach((boton) => {
      boton.addEventListener('click', async () => {
        const motivo = prompt('¿Liberar este puesto? Escribe el motivo para el comerciante:');
        if (motivo === null) return;
        mensajePagos.innerHTML = '';
        try {
          const r = await apiFetch(`/solicitudes/${boton.closest('tr').dataset.id}/liberar`, {
            method: 'PUT', body: JSON.stringify({ comentario_admin: motivo }),
          });
          await cargarTodo();
          mensajePagos.innerHTML = `<div class="mensaje exito">Puesto liberado.${r.ofrecido_a_lista ? ' Se le ofreció al primero de la lista de espera.' : ''}</div>`;
        } catch (err) {
          mensajePagos.innerHTML = `<div class="mensaje error">${esc(err.message)}</div>`;
        }
      });
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

  document.getElementById('btn-recordatorios').addEventListener('click', async () => {
    mensajePagos.innerHTML = '';
    try {
      const { enviados } = await apiFetch('/notificaciones/recordatorios', { method: 'POST', body: '{}' });
      mensajePagos.innerHTML = `<div class="mensaje exito">${enviados === 0
        ? 'No hay a quién recordarle: cada comerciante recibe como máximo un recordatorio cada 3 días.'
        : `Se enviaron ${enviados} ${enviados === 1 ? 'recordatorio' : 'recordatorios'}.`}</div>`;
    } catch (err) {
      mensajePagos.innerHTML = `<div class="mensaje error">${esc(err.message)}</div>`;
    }
  });

  // ---------- Lista de espera ----------
  async function cargarEspera() {
    const tabla = document.getElementById('tabla-espera');
    try {
      const filas = await apiFetch('/lista-espera');
      tabla.innerHTML = filas.length === 0
        ? '<tr><td colspan="5">No hay nadie en lista de espera.</td></tr>'
        : filas.map((e) => `
          <tr>
            <td>${e.posicion ?? '-'}</td>
            <td>${esc(e.comerciante_nombre)}<br><small>${esc(e.comerciante_email)}</small></td>
            <td>${esc(e.feria_nombre)}</td>
            <td>${esc(e.rubro)}</td>
            <td>${e.estado === 'ofrecido'
    ? `<span class="badge pendiente">puesto ${esc(e.puesto_codigo)} ofrecido</span><br><small>Vence ${new Date(e.oferta_vence).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}</small>`
    : '<span class="badge sin-pago">esperando</span>'}</td>
          </tr>`).join('');
    } catch (err) {
      tabla.innerHTML = `<tr><td colspan="5"><div class="mensaje error">${esc(err.message)}</div></td></tr>`;
    }
  }

  // ---------- Reporte de ocupación ----------
  async function cargarOcupacion() {
    const tabla = document.getElementById('tabla-ocupacion');
    try {
      const ferias = await apiFetch('/reportes/ocupacion');
      const total = (clave) => ferias.reduce((suma, f) => suma + f[clave], 0);
      const puestos = total('puestos_total');
      const ocupados = total('puestos_ocupados');
      document.getElementById('resumen-ocupacion').innerHTML = `
        <div>Ferias<strong>${ferias.length}</strong></div>
        <div>Puestos ocupados<strong>${ocupados} de ${puestos}</strong><span class="texto-suave">${String(puestos === 0 ? 0 : Math.round((ocupados / puestos) * 1000) / 10).replace('.', ',')} % de ocupación</span></div>
        <div>Puestos libres<strong>${total('puestos_libres')}</strong></div>`;
      pintarGraficos(ferias);
      tabla.innerHTML = ferias.length === 0
        ? '<tr><td colspan="9">Todavía no hay ferias creadas.</td></tr>'
        : ferias.map((f) => `
          <tr>
            <td>${esc(f.nombre)}${f.publicada ? '' : ' <small>(borrador)</small>'}<br><small>${esc(f.comuna || '')}${sesion.usuario.rol === 'administrador' ? ` · ${esc(f.admin_feria_nombre || 'Plataforma')}` : ''}</small></td>
            <td>${esc(formatearRangoFechas(f.fecha_inicio, f.fecha_cierre) || '-')}</td>
            <td>${f.puestos_total}</td>
            <td>${f.puestos_ocupados}</td>
            <td>${f.puestos_libres}</td>
            <td>${String(f.porcentaje_ocupacion).replace('.', ',')} %</td>
            <td>${f.solicitudes_pendientes}</td>
            <td>${formatearPesos(f.cobrado)}</td>
            <td>${formatearPesos(f.por_cobrar)}</td>
          </tr>`).join('');
    } catch (err) {
      document.getElementById('mensaje-ocupacion').innerHTML = `<div class="mensaje error">${esc(err.message)}</div>`;
    }
  }

  // Gráficos de barras del reporte: una fila por feria, hechos con HTML y CSS (sin librerías)
  function pintarGraficos(ferias) {
    const graficoOcupacion = document.getElementById('grafico-ocupacion');
    const graficoCobros = document.getElementById('grafico-cobros');
    const conPuestos = ferias.filter((f) => f.puestos_total > 0);
    graficoOcupacion.innerHTML = conPuestos.length === 0
      ? '<p class="texto-suave">Todavía no hay ferias con puestos.</p>'
      : conPuestos.map((f) => {
        const ancho = (f.puestos_ocupados / f.puestos_total) * 100;
        return `
          <div class="barra-fila" title="${esc(f.nombre)}: ${f.puestos_ocupados} ocupados y ${f.puestos_libres} libres">
            <span class="barra-nombre">${esc(f.nombre)}</span>
            <div class="barra-pista"><div class="barra-parte ocupado" style="width:${ancho}%"></div></div>
            <span class="barra-valor">${f.puestos_ocupados} de ${f.puestos_total} · ${String(f.porcentaje_ocupacion).replace('.', ',')} %</span>
          </div>`;
      }).join('');

    // Los montos se dibujan a la misma escala para comparar ferias: la más grande ocupa todo el ancho
    const conMontos = ferias.filter((f) => f.cobrado + f.por_cobrar > 0);
    const mayor = Math.max(0, ...conMontos.map((f) => f.cobrado + f.por_cobrar));
    graficoCobros.innerHTML = conMontos.length === 0
      ? '<p class="texto-suave">Todavía no hay montos por cobrar.</p>'
      : conMontos.map((f) => `
          <div class="barra-fila" title="${esc(f.nombre)}: cobrado ${formatearPesos(f.cobrado)}, por cobrar ${formatearPesos(f.por_cobrar)}">
            <span class="barra-nombre">${esc(f.nombre)}</span>
            <div class="barra-pista">
              <div class="barra-parte cobrado" style="width:${(f.cobrado / mayor) * 100}%"></div><div class="barra-parte por-cobrar" style="width:${(f.por_cobrar / mayor) * 100}%"></div>
            </div>
            <span class="barra-valor">${formatearPesos(f.cobrado)} de ${formatearPesos(f.cobrado + f.por_cobrar)}</span>
          </div>`).join('');
  }

  // Los reportes se piden con el token de la sesión y se descargan como archivo
  function botonDescarga(id, ruta, nombre) {
    document.getElementById(id).addEventListener('click', async () => {
      const aviso = document.getElementById('mensaje-ocupacion');
      aviso.innerHTML = '';
      try {
        const respuesta = await fetch(`${API_BASE}/reportes/${ruta}`, {
          headers: { Authorization: `Bearer ${obtenerSesion().token}` },
        });
        if (!respuesta.ok) throw new Error('No se pudo generar el archivo');
        const url = URL.createObjectURL(await respuesta.blob());
        const enlace = document.createElement('a');
        enlace.href = url;
        enlace.download = nombre;
        enlace.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        aviso.innerHTML = `<div class="mensaje error">${esc(err.message)}</div>`;
      }
    });
  }
  botonDescarga('btn-csv', 'ocupacion.csv', 'reporte-ocupacion.csv');
  botonDescarga('btn-excel', 'completo.xlsx', 'reporte-feriaplace.xlsx');
  botonDescarga('btn-pdf', 'completo.pdf', 'reporte-feriaplace.pdf');

  // Aviso si el administrador sigue usando la contraseña de ejemplo del README
  if (sesion.clave_de_ejemplo) {
    document.getElementById('aviso-clave').innerHTML = `<div class="mensaje error">Estás usando la contraseña de ejemplo
      del proyecto. <a href="cuenta.html">Cámbiala aquí</a> antes de publicar la aplicación.</div>`;
  }

  // El Administrador de Feria ve solo sus ferias; se lo recordamos arriba
  if (sesion.usuario.rol === 'admin_feria') {
    document.getElementById('aviso-cuentas').innerHTML = `<div class="mensaje">Aquí ves las solicitudes, los pagos y la
      ocupación de tus ferias. Para publicar una feria nueva, créala en <a href="admin-ferias.html">Mis ferias</a> y paga
      su publicación en <a href="cobros.html">Pagos a la plataforma</a>.</div>`;
  }

  // Aviso de cuentas nuevas esperando aprobación (solo la plataforma aprueba cuentas)
  if (sesion.usuario.rol === 'administrador') apiFetch('/usuarios?estado=pendiente').then((pendientes) => {
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
