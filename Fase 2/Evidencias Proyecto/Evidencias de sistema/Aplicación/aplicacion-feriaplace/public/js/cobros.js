// Cobros de la plataforma al Administrador de Feria por publicar los puestos de su feria.
// La plataforma ve todos, fija la tarifa y registra los pagos; el Administrador de Feria ve los suyos.
(async () => {
  const sesion = requerirSesion(ROLES_GESTION);
  if (!sesion) return;
  const esPlataforma = sesion.usuario.rol === 'administrador';
  const $ = (id) => document.getElementById(id);
  const mostrar = (id, tipo, texto) => { $(id).innerHTML = texto ? `<div class="mensaje ${tipo}">${esc(texto)}</div>` : ''; };
  const fecha = (valor) => (valor ? new Date(valor).toLocaleDateString('es-CL') : '');
  let cobros = [];

  if (esPlataforma) {
    $('explicacion-cobros').textContent = 'Cada Administrador de Feria paga una tarifa por cada puesto que publica. Cuando recibas la transferencia, marca el cobro como pagado: si cubre todos los puestos de la feria, la feria se publica sola.';
    $('form-tarifa').classList.remove('oculto');
  } else {
    $('titulo-cobros').textContent = 'Pagos a la plataforma';
    $('explicacion-cobros').textContent = 'Para publicar tu feria pagas a FeriaPlace una tarifa por cada puesto publicado. Pide la publicación desde "Mis ferias" y paga en línea aquí abajo (o transfiere el monto y FeriaPlace registrará tu pago). Con el pago hecho, tu feria queda visible para los comerciantes.';
    $('col-admin').classList.add('oculto');
  }

  function pintar(datos) {
    cobros = datos.cobros;
    const r = datos.resumen;
    $('tarifa').value = datos.tarifa_puesto;
    $('resumen-cobros').innerHTML = `
      <div>Tarifa por puesto<strong>${formatearPesos(datos.tarifa_puesto)}</strong></div>
      <div>${esPlataforma ? 'Cobrado' : 'Pagado'}<strong>${formatearPesos(r.cobrado)}</strong></div>
      <div>${esPlataforma ? 'Por cobrar' : 'Por pagar'}<strong>${formatearPesos(r.por_cobrar)}</strong><span class="texto-suave">${r.cobros_pendientes} ${r.cobros_pendientes === 1 ? 'cobro pendiente' : 'cobros pendientes'}</span></div>
      ${esPlataforma ? `<div>Administradores de Feria<strong>${r.administradores}</strong><span class="texto-suave">con cobros</span></div>` : ''}`;
    const columnas = esPlataforma ? 6 : 5;
    if (cobros.length === 0) {
      $('tabla-cobros').innerHTML = `<tr><td colspan="${columnas}">${esPlataforma
        ? 'Todavía no hay cobros. Aparecen cuando un Administrador de Feria pide publicar su feria.'
        : 'Todavía no tienes cobros. Pide la publicación de tu feria en <a href="admin-ferias.html">Mis ferias</a>.'}</td></tr>`;
      return;
    }
    $('tabla-cobros').innerHTML = cobros.map((c) => {
      const pagado = c.estado === 'pagado';
      return `
        <tr data-id="${c.id}">
          ${esPlataforma ? `<td>${esc(c.admin_feria_nombre)}<br><small>${esc(c.admin_feria_email)}${c.organizacion ? ` · ${esc(c.organizacion)}` : ''}</small></td>` : ''}
          <td><a href="admin-ferias.html?feria=${c.feria_id}">${esc(c.feria_nombre)}</a><br><small>${c.publicada ? 'Publicada' : 'Borrador'}</small></td>
          <td>${c.puestos} × ${formatearPesos(c.tarifa)}</td>
          <td>${esPlataforma ? `<input class="monto" type="number" min="0" step="1" value="${c.monto}">` : formatearPesos(c.monto)}</td>
          <td><span class="badge ${pagado ? 'pagado' : 'pendiente'}">${c.estado}</span><br><small>${pagado ? `Pagado el ${fecha(c.pagado_en)}` : `Pedido el ${fecha(c.creado_en)}`}</small></td>
          ${esPlataforma ? `<td class="acciones-fila">
            <button class="btn-cobro sin-margen ${pagado ? 'secundario' : ''}" data-estado="${pagado ? 'pendiente' : 'pagado'}">${pagado ? 'Marcar pendiente' : 'Marcar pagado'}</button>
          </td>` : `<td>${pagado ? '-' : `<button class="btn-pagar sin-margen" data-id="${c.id}">Pagar en línea</button>`}</td>`}
        </tr>`;
    }).join('');
    $('tabla-cobros').querySelectorAll('.btn-pagar').forEach((boton) => {
      boton.addEventListener('click', async () => {
        boton.disabled = true;
        mostrar('mensaje-cobros');
        try {
          const pago = await apiFetch('/pagos/iniciar', { method: 'POST', body: JSON.stringify({ tipo: 'publicacion', id: Number(boton.dataset.id) }) });
          window.location.href = pago.url;
        } catch (err) {
          boton.disabled = false;
          mostrar('mensaje-cobros', 'error', err.message);
        }
      });
    });
    $('tabla-cobros').querySelectorAll('.btn-cobro').forEach((boton) => {
      boton.addEventListener('click', async () => {
        const fila = boton.closest('tr');
        mostrar('mensaje-cobros');
        try {
          const r2 = await apiFetch(`/cobros/${fila.dataset.id}/pago`, {
            method: 'PUT',
            body: JSON.stringify({ estado: boton.dataset.estado, monto: fila.querySelector('.monto').value.trim() }),
          });
          await cargar();
          mostrar('mensaje-cobros', 'exito', r2.estado === 'pagado'
            ? `Pago registrado.${r2.feria_publicada ? ' La feria ya está publicada.' : ''}`
            : `El cobro volvió a pendiente.${r2.feria_publicada ? '' : ' La feria quedó en borrador.'}`);
        } catch (err) {
          mostrar('mensaje-cobros', 'error', err.message);
        }
      });
    });
  }

  async function cargar() {
    pintar(await apiFetch('/cobros'));
  }

  $('form-tarifa').addEventListener('submit', async (e) => {
    e.preventDefault();
    mostrar('mensaje-tarifa');
    try {
      const r = await apiFetch('/cobros/tarifa', { method: 'PUT', body: JSON.stringify({ tarifa_puesto: $('tarifa').value }) });
      await cargar();
      mostrar('mensaje-tarifa', 'exito', `Tarifa guardada: ${formatearPesos(r.tarifa_puesto)} por puesto. Los cobros ya pedidos mantienen su monto.`);
    } catch (err) {
      mostrar('mensaje-tarifa', 'error', err.message);
    }
  });

  try {
    await cargar();
  } catch (err) {
    mostrar('mensaje-cobros', 'error', err.message);
  }
})();
