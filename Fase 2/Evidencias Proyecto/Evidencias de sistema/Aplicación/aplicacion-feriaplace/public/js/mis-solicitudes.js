(async () => {
  const sesion = requerirSesion(['comerciante']);
  if (!sesion) return;

  const tbody = document.getElementById('tabla-solicitudes');

  // Lista de espera: lugar en la fila y puestos ofrecidos
  async function cargarEspera() {
    const tarjeta = document.getElementById('tarjeta-espera');
    const contenedor = document.getElementById('lista-espera');
    const avisar = (tipo, texto) => { document.getElementById('mensaje-espera').innerHTML = `<div class="mensaje ${tipo}">${esc(texto)}</div>`; };
    const lista = await apiFetch('/lista-espera/mias');
    tarjeta.classList.toggle('oculto', lista.length === 0);
    contenedor.innerHTML = lista.map((e) => (e.estado === 'ofrecido'
      ? `<div class="aviso nuevo" data-id="${e.id}">
          <strong>${esc(e.feria_nombre)}: se liberó el puesto ${esc(e.puesto_codigo)} (${esc(e.puesto_zona)})</strong>
          <p>${e.monto !== null ? `Arriendo: ${formatearPesos(e.monto)}. ` : ''}Lo tienes reservado hasta el ${new Date(e.oferta_vence).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}.</p>
          <div class="acciones-fila">
            <button class="btn-aceptar sin-margen">Aceptar puesto</button>
            <button class="btn-salir secundario sin-margen">No me interesa</button>
          </div>
        </div>`
      : `<div class="aviso" data-id="${e.id}">
          <strong>${esc(e.feria_nombre)}</strong>
          <p>Vas en el lugar ${e.posicion} de la fila (${esc(e.rubro)}).</p>
          <button class="btn-salir secundario sin-margen boton-chico" style="margin-left:0">Salir de la lista</button>
        </div>`)).join('');
    const accion = (selector, ruta) => contenedor.querySelectorAll(selector).forEach((boton) => {
      boton.addEventListener('click', async () => {
        boton.disabled = true;
        try {
          await apiFetch(`/lista-espera/${boton.closest('[data-id]').dataset.id}/${ruta}`, { method: 'POST', body: '{}' });
          window.location.reload();
        } catch (err) {
          boton.disabled = false;
          avisar('error', err.message);
        }
      });
    });
    accion('.btn-aceptar', 'aceptar');
    accion('.btn-salir', 'salir');
  }
  cargarEspera().catch((err) => {
    document.getElementById('tarjeta-espera').classList.remove('oculto');
    document.getElementById('mensaje-espera').innerHTML = `<div class="mensaje error">${esc(err.message)}</div>`;
  });
  try {
    const solicitudes = await apiFetch('/solicitudes/mias');
    if (solicitudes.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7">Aún no has enviado solicitudes.</td></tr>';
      return;
    }
    tbody.innerHTML = solicitudes.map((s) => `
      <tr>
        <td>${esc(s.feria_nombre || '-')}</td>
        <td>${esc(s.rubro)}</td>
        <td>${[
          s.puesto_preferido_codigo ? `Puesto ${esc(s.puesto_preferido_codigo)}` : '',
          esc(s.zona_preferida || ''),
          NOMBRE_TAMANO[s.tamano_preferido] || '',
        ].filter(Boolean).join('<br>') || '-'}</td>
        <td><span class="badge ${s.estado}">${s.estado}</span></td>
        <td>${esc(s.puesto_codigo || '-')}${s.estado === 'confirmada' ? `<br><a href="credencial.html?id=${s.id}">Ver credencial</a>` : ''}</td>
        <td>${s.estado === 'confirmada'
    ? `${s.monto !== null ? formatearPesos(s.monto) : 'Monto por confirmar'}<br>
           <span class="badge ${s.estado_pago === 'pagado' ? 'pagado' : 'pendiente'}">${s.estado_pago === 'pagado' ? 'pagado' : 'pago pendiente'}</span>
           ${s.pago_autorizacion ? `<br><small>En línea · código ${esc(s.pago_autorizacion)}</small>` : ''}
           ${s.estado_pago !== 'pagado' && s.monto > 0 ? `<br><button class="btn-pagar boton-chico" data-id="${s.id}" style="margin-left:0">Pagar en línea</button>` : ''}`
    : '-'}</td>
        <td>${esc(s.comentario_admin || '-')}</td>
      </tr>
    `).join('');
    tbody.querySelectorAll('.btn-pagar').forEach((boton) => {
      boton.addEventListener('click', async () => {
        boton.disabled = true;
        try {
          const pago = await apiFetch('/pagos/iniciar', { method: 'POST', body: JSON.stringify({ tipo: 'puesto', id: Number(boton.dataset.id) }) });
          window.location.href = pago.url;
        } catch (err) {
          boton.disabled = false;
          alert(err.message);
        }
      });
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="mensaje error">${esc(err.message)}</div></td></tr>`;
  }
})();
