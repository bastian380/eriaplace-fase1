(async () => {
  const sesion = requerirSesion();
  if (!sesion) return;

  const lista = document.getElementById('lista-avisos');
  try {
    const { avisos } = await apiFetch('/notificaciones');
    lista.innerHTML = avisos.length === 0
      ? '<p class="estado-vacio">Todavía no tienes avisos.</p>'
      : avisos.map((a) => `
        <div class="aviso ${a.leida ? '' : 'nuevo'}">
          <div class="aviso-titulo">
            <strong>${esc(a.titulo)}</strong>
            <span class="texto-suave">${new Date(a.creado_en).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' })}</span>
          </div>
          <p>${esc(a.mensaje)}</p>
          ${a.enlace ? `<a href="${esc(a.enlace)}">Ver detalle</a>` : ''}
          ${a.enviada_correo ? '<span class="texto-suave"> · también enviado a tu correo</span>' : ''}
        </div>`).join('');
    // Al abrir la página quedan todos como leídos
    if (avisos.some((a) => !a.leida)) {
      await apiFetch('/notificaciones/leidas', { method: 'PUT' });
      pintarNavegacion();
    }
  } catch (err) {
    lista.innerHTML = `<div class="mensaje error">${esc(err.message)}</div>`;
  }

  // La plataforma también ve qué salió por correo y WhatsApp
  if (sesion.usuario.rol === 'administrador') {
    document.getElementById('tarjeta-envios').classList.remove('oculto');
    const tabla = document.getElementById('tabla-envios');
    try {
      const envios = await apiFetch('/notificaciones/envios');
      tabla.innerHTML = envios.length === 0
        ? '<tr><td colspan="5">Todavía no hay envíos.</td></tr>'
        : envios.map((e) => `
          <tr>
            <td>${new Date(e.creado_en).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}</td>
            <td>${esc(e.nombre)}<br><small>${esc(e.destino)}</small></td>
            <td>${e.canal === 'whatsapp' ? 'WhatsApp' : 'Correo'}</td>
            <td><strong>${esc(e.titulo)}</strong><br><small>${esc(e.mensaje)}</small></td>
            <td><span class="badge ${e.estado === 'fallido' ? 'rechazada' : e.estado === 'enviado' ? 'pagado' : 'pendiente'}">${e.estado}</span></td>
          </tr>`).join('');
    } catch (err) {
      tabla.innerHTML = `<tr><td colspan="5"><div class="mensaje error">${esc(err.message)}</div></td></tr>`;
    }
  }
})();
