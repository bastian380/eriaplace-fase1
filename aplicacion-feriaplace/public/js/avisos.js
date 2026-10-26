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
})();
