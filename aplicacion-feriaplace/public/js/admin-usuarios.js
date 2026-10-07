(async () => {
  const sesion = requerirSesion(['administrador']);
  if (!sesion) return;

  const mensaje = document.getElementById('mensaje');
  const tablaPendientes = document.getElementById('tabla-pendientes');
  const tablaRevisados = document.getElementById('tabla-revisados');

  const fecha = (valor) => new Date(valor).toLocaleDateString('es-CL');

  function persona(u) {
    return `${esc(u.nombre)}<br><small>${esc(u.email)}${u.telefono ? ` · ${esc(u.telefono)}` : ''}</small>`;
  }

  async function cargarTodo() {
    const usuarios = await apiFetch('/usuarios');
    const pendientes = usuarios.filter((u) => u.estado === 'pendiente');
    const revisados = usuarios.filter((u) => u.estado !== 'pendiente');

    tablaPendientes.innerHTML = pendientes.length === 0
      ? '<tr><td colspan="4">No hay cuentas esperando aprobación.</td></tr>'
      : pendientes.map((u) => `
        <tr>
          <td>${persona(u)}</td>
          <td>${esc(u.motivo_registro || '-')}</td>
          <td>${fecha(u.creado_en)}</td>
          <td class="acciones-fila">
            <button class="btn-aprobar" data-id="${u.id}">Aprobar</button>
            <button class="btn-rechazar secundario" data-id="${u.id}">Rechazar</button>
          </td>
        </tr>
      `).join('');

    tablaRevisados.innerHTML = revisados.length === 0
      ? '<tr><td colspan="5">Todavía no hay cuentas revisadas.</td></tr>'
      : revisados.map((u) => `
        <tr>
          <td>${persona(u)}</td>
          <td><span class="badge ${u.estado === 'aprobado' ? 'confirmada' : 'rechazada'}">${u.estado}</span></td>
          <td>${u.solicitudes}</td>
          <td>${esc(u.comentario_admin || '-')}</td>
          <td class="acciones-fila">
            ${u.estado === 'aprobado'
              ? `<button class="btn-rechazar secundario" data-id="${u.id}">Bloquear</button>`
              : `<button class="btn-aprobar" data-id="${u.id}">Aprobar</button>`}
          </td>
        </tr>
      `).join('');

    document.querySelectorAll('.btn-aprobar').forEach((boton) => {
      boton.addEventListener('click', async () => {
        mensaje.innerHTML = '';
        try {
          await apiFetch(`/usuarios/${boton.dataset.id}/aprobar`, { method: 'PUT', body: '{}' });
          await cargarTodo();
          mensaje.innerHTML = '<div class="mensaje exito">Cuenta aprobada. Ya puede iniciar sesión y pedir puestos.</div>';
        } catch (err) {
          mensaje.innerHTML = `<div class="mensaje error">${esc(err.message)}</div>`;
        }
      });
    });

    document.querySelectorAll('.btn-rechazar').forEach((boton) => {
      boton.addEventListener('click', async () => {
        mensaje.innerHTML = '';
        const motivo = prompt('Motivo (opcional, la persona lo verá al intentar entrar):');
        if (motivo === null) return;
        try {
          await apiFetch(`/usuarios/${boton.dataset.id}/rechazar`, {
            method: 'PUT',
            body: JSON.stringify({ comentario_admin: motivo }),
          });
          await cargarTodo();
          mensaje.innerHTML = '<div class="mensaje exito">Cuenta rechazada. Esa persona ya no puede entrar.</div>';
        } catch (err) {
          mensaje.innerHTML = `<div class="mensaje error">${esc(err.message)}</div>`;
        }
      });
    });
  }

  try {
    await cargarTodo();
  } catch (err) {
    mensaje.innerHTML = `<div class="mensaje error">${esc(err.message)}</div>`;
  }
})();
